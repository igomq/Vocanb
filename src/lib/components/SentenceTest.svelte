<script lang="ts">
	import {
		gradeSentenceAnswer,
		sentenceWordChunks,
		type SentencePassage,
		type SentenceTestResult
	} from '$lib/sentence-domain';
	import { SvelteSet } from 'svelte/reactivity';

	let {
		passage,
		results,
		onresult,
		onreset
	}: {
		passage: SentencePassage;
		results: Record<string, SentenceTestResult>;
		onresult: (key: string, result: SentenceTestResult | null) => void;
		onreset: () => void;
	} = $props();

	type Mode = 'tape' | 'typing';

	let mode = $state<Mode>('tape');
	let answers = $state<Record<string, string>>({});
	let typingFeedback = $state<Record<string, SentenceTestResult>>({});
	const revealed = new SvelteSet<string>();
	const revealedDistractors = new SvelteSet<string>();

	const targetCount = $derived(
		passage.paragraphs.reduce(
			(total, paragraph) => total + paragraph.runs.filter((run) => run.memorize).length,
			0
		)
	);
	const evaluatedCount = $derived(Object.keys(results).length);
	const distractors = $derived.by(() => pickDistractors(passage));

	function targetKey(paragraphIndex: number, runIndex: number) {
		return `${paragraphIndex}:${runIndex}`;
	}

	function hash(value: string) {
		let result = 2166136261;
		for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
		return result >>> 0;
	}

	function pickDistractors(current: SentencePassage) {
		const candidates: string[] = [];
		for (const [paragraphIndex, paragraph] of current.paragraphs.entries()) {
			for (const [runIndex, run] of paragraph.runs.entries()) {
				if (run.memorize) continue;
				for (const chunk of sentenceWordChunks(run.text)) {
					if (chunk.wordIndex !== null && chunk.text.length >= 4)
						candidates.push(`${paragraphIndex}:${runIndex}:${chunk.wordIndex}`);
				}
			}
		}
		const count = Math.min(6, candidates.length, Math.max(2, Math.round(candidates.length * 0.08)));
		return new Set(
			candidates
				.sort((left, right) => hash(current.id + left) - hash(current.id + right))
				.slice(0, count)
		);
	}

	function reveal(key: string) {
		revealed.add(key);
	}

	function revealDistractor(key: string) {
		revealedDistractors.add(key);
	}

	function selfRate(key: string, status: 'correct' | 'wrong' | 'ambiguous') {
		onresult(key, {
			status,
			score: status === 'correct' ? 100 : status === 'wrong' ? 0 : undefined
		});
	}

	function updateAnswer(key: string, expected: string, value: string) {
		answers[key] = value;
		if (!value.trim()) {
			delete typingFeedback[key];
			onresult(key, null);
			return;
		}
		const grade = gradeSentenceAnswer(expected, value);
		const wordCount = sentenceWordChunks(expected).filter(
			(chunk) => chunk.wordIndex !== null
		).length;
		const result: SentenceTestResult = {
			status:
				grade.score === 100
					? 'correct'
					: grade.wrongWordIndexes.length >= wordCount
						? 'wrong'
						: 'partial',
			score: grade.score,
			wrongWordIndexes: grade.wrongWordIndexes
		};
		typingFeedback[key] = result;
		onresult(key, result);
	}

	function reset() {
		revealed.clear();
		revealedDistractors.clear();
		answers = {};
		typingFeedback = {};
		onreset();
	}
</script>

<div class="sentence-test">
	<div class="sentence-test-toolbar">
		<div class="sentence-test-modes" role="group" aria-label="문장 테스트 방식">
			<button
				class:is-active={mode === 'tape'}
				type="button"
				aria-pressed={mode === 'tape'}
				onclick={() => (mode = 'tape')}>단어장식</button
			>
			<button
				class:is-active={mode === 'typing'}
				type="button"
				aria-pressed={mode === 'typing'}
				onclick={() => (mode = 'typing')}>타이핑</button
			>
		</div>
		<span class="sentence-test-progress" aria-live="polite"
			>{evaluatedCount}/{targetCount} 평가</span
		>
	</div>

	<p class="sentence-test-help">
		{mode === 'tape'
			? '테이프를 눌러 정답을 확인한 뒤 기억한 정도를 선택하세요.'
			: '빈칸에 문장을 입력하세요. 문장부호는 채점에서 제외됩니다.'}
	</p>

	<div class="memorization-passage">
		{#each passage.paragraphs as paragraph, paragraphIndex (paragraphIndex)}
			<p class="memorization-paragraph">
				{#each paragraph.runs as run, runIndex (runIndex)}
					{@const key = targetKey(paragraphIndex, runIndex)}
					{#if run.memorize && mode === 'tape'}
						<span class="sentence-test-target">
							<button
								type="button"
								class="memorization-tape"
								class:is-revealed={revealed.has(key)}
								aria-pressed={revealed.has(key)}
								aria-label={revealed.has(key) ? `정답: ${run.text}` : '가려진 암기 문장 보기'}
								onclick={() => reveal(key)}
								><span aria-hidden={!revealed.has(key)}>{run.text}</span></button
							>
							{#if revealed.has(key)}
								<span class="sentence-test-rating" aria-label="암기 결과">
									{#each [{ value: 'correct', label: '맞음' }, { value: 'wrong', label: '틀림' }, { value: 'ambiguous', label: '애매' }] as rating (rating.value)}
										<button
											class:is-selected={results[key]?.status === rating.value}
											type="button"
											aria-pressed={results[key]?.status === rating.value}
											onclick={() =>
												selfRate(key, rating.value as 'correct' | 'wrong' | 'ambiguous')}
											>{rating.label}</button
										>
									{/each}
								</span>
							{/if}
						</span>
					{:else if run.memorize}
						<span class="sentence-typing-target">
							<label class="visually-hidden" for={`answer-${passage.id}-${key}`}
								>암기 문장 입력</label
							>
							<input
								id={`answer-${passage.id}-${key}`}
								type="text"
								value={answers[key] ?? ''}
								autocomplete="off"
								spellcheck="false"
								style={`--answer-chars: ${Math.min(48, Math.max(12, run.text.length))}`}
								oninput={(event) => updateAnswer(key, run.text, event.currentTarget.value)}
							/>
							{#if typingFeedback[key]}
								<span
									class:feedback-correct={typingFeedback[key].status === 'correct'}
									class:feedback-wrong={typingFeedback[key].status !== 'correct'}
									class="sentence-typing-feedback"
									role="status"
								>
									{typingFeedback[key].status === 'correct' ? '맞음' : '틀림'} · {typingFeedback[
										key
									].score}%
								</span>
							{/if}
						</span>
					{:else}
						{#each sentenceWordChunks(run.text) as chunk, chunkIndex (chunkIndex)}
							{@const distractorKey = `${paragraphIndex}:${runIndex}:${chunk.wordIndex}`}
							{#if chunk.wordIndex !== null && distractors.has(distractorKey)}
								<button
									type="button"
									class="memorization-tape sentence-distractor"
									class:is-revealed={revealedDistractors.has(distractorKey)}
									aria-pressed={revealedDistractors.has(distractorKey)}
									aria-label={revealedDistractors.has(distractorKey)
										? `추가 블라인드 단어: ${chunk.text}`
										: '추가 블라인드 단어 보기'}
									onclick={() => revealDistractor(distractorKey)}
									><span aria-hidden={!revealedDistractors.has(distractorKey)}>{chunk.text}</span
									></button
								>
							{:else}{chunk.text}{/if}
						{/each}
					{/if}
				{/each}
			</p>
		{/each}
	</div>

	<div class="memorization-actions">
		<button class="button button-quiet" type="button" onclick={reset}>입력과 가림 초기화</button>
	</div>
</div>
