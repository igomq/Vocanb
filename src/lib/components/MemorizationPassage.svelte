<script lang="ts">
	import {
		sentenceWordChunks,
		type SentencePassage,
		type SentenceTestResult
	} from '$lib/sentence-domain';
	import { SvelteSet } from 'svelte/reactivity';

	let {
		passage,
		results = {}
	}: { passage: SentencePassage; results?: Record<string, SentenceTestResult> } = $props();

	const revealed = new SvelteSet<string>();

	function key(paragraphIndex: number, runIndex: number) {
		return `${paragraphIndex}:${runIndex}`;
	}

	function toggle(key: string) {
		if (revealed.has(key)) revealed.delete(key);
		else revealed.add(key);
	}

	function hideAll() {
		revealed.clear();
	}

	const hasMemorizedRuns = $derived(
		passage.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.memorize))
	);
</script>

<div class="memorization-passage">
	{#each passage.paragraphs as paragraph, paragraphIndex (paragraphIndex)}
		<p class="memorization-paragraph">
			{#each paragraph.runs as run, runIndex (runIndex)}
				{#if run.memorize}
					{@const runKey = key(paragraphIndex, runIndex)}
					{@const result = results[runKey]}
					{#if result?.status === 'partial'}
						<span class="sentence-result" aria-label={`부분 오답 ${result.score}%`}>
							{#each sentenceWordChunks(run.text) as chunk, chunkIndex (chunkIndex)}
								{#if chunk.wordIndex !== null && result.wrongWordIndexes?.includes(chunk.wordIndex)}<mark
										class="sentence-result-partial">{chunk.text}</mark
									>{:else}{chunk.text}{/if}
							{/each}
						</span>
					{:else if result}
						<mark class={`sentence-result sentence-result-${result.status}`}>{run.text}</mark>
					{:else}
						<button
							type="button"
							class="memorization-tape"
							class:is-revealed={revealed.has(runKey)}
							aria-pressed={revealed.has(runKey)}
							aria-label={revealed.has(runKey)
								? `암기 문장 가리기: ${run.text}`
								: '가려진 암기 문장 보기'}
							onclick={() => toggle(runKey)}
							><span aria-hidden={!revealed.has(runKey)}>{run.text}</span></button
						>
					{/if}
				{:else}
					<span>{run.text}</span>
				{/if}
			{/each}
		</p>
	{/each}
	{#if hasMemorizedRuns}
		<div class="memorization-actions">
			<button class="button button-quiet" type="button" onclick={hideAll}>다시 가리기</button>
		</div>
	{/if}
</div>
