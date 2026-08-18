<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type {
		ContinuousLearningProgress,
		ContinuousPhase,
		ResultStatus,
		Vocabulary
	} from '$lib/domain';
	import type { SvelteSet } from 'svelte/reactivity';

	let {
		vocabulary,
		latestResult,
		formMessage,
		startPending,
		enhanceStartTest,
		testAll = $bindable(true),
		testSource = $bindable<'range' | 'recent-result' | 'starred'>('range'),
		testStart = $bindable(1),
		testEnd = $bindable(1),
		testStatuses,
		continuousStep = $bindable<ContinuousLearningProgress | null>(null),
		statusOptions,
		continuousPhaseLabel,
		toggleTestStatus,
		onclose
	}: {
		vocabulary: Pick<Vocabulary, 'words'>;
		latestResult: { results: Record<string, ResultStatus> } | null;
		formMessage?: string;
		startPending: boolean;
		enhanceStartTest: SubmitFunction;
		testAll?: boolean;
		testSource?: 'range' | 'recent-result' | 'starred';
		testStart?: number;
		testEnd?: number;
		testStatuses: SvelteSet<ResultStatus>;
		continuousStep?: ContinuousLearningProgress | null;
		statusOptions: { value: ResultStatus; label: string }[];
		continuousPhaseLabel: (phase: ContinuousPhase) => string;
		toggleTestStatus: (event: Event, status: ResultStatus) => void;
		onclose: () => void;
	} = $props();

	let dialog: HTMLDialogElement | undefined = $state();

	export function open(
		range?: { start: number; end: number },
		continuous?: ContinuousLearningProgress,
		source: 'range' | 'starred' = 'range'
	) {
		if (!vocabulary.words.length) return;
		const first = vocabulary.words[0].number;
		const last = vocabulary.words.at(-1)!.number;
		testStart = range?.start ?? first;
		testEnd = range?.end ?? last;
		testAll = !range;
		testSource = source;
		testStatuses.clear();
		continuousStep = continuous ?? null;
		dialog?.showModal();
	}

	export function close() {
		if (dialog?.open) dialog.close();
	}
</script>

<dialog bind:this={dialog} class="modal" aria-labelledby="test-settings-title">
	<div class="modal-body">
		<div class="modal-header">
			<div>
				<h2 id="test-settings-title">테스트 설정</h2>
				<p>오늘 확인할 범위와 순서를 정해 보세요.</p>
			</div>
			<button class="modal-close" type="button" aria-label="닫기" title="닫기" onclick={onclose}
				>×</button
			>
		</div>

		<form method="post" action="?/startTest" use:enhance={enhanceStartTest} class="form-stack">
			{#if continuousStep?.status === 'ready'}
				<fieldset class="choice-group">
					<legend>연속 학습 단계</legend>
					<p class="continuous-step-summary">
						{continuousPhaseLabel(continuousStep.phase!)} · {continuousStep.range
							?.start}~{continuousStep.range?.end}번
					</p>
					<input type="hidden" name="continuous" value="on" />
					<input
						type="hidden"
						name="continuousBatchSize"
						value={continuousStep.settings.batchSize}
					/>
					<input type="hidden" name="continuousDaySize" value={continuousStep.settings.daySize} />
					<input
						type="hidden"
						name="continuousStudyMode"
						value={continuousStep.settings.studyMode}
					/>
					<p class="field-note">
						{continuousStep.phase === 'cumulative'
							? '오늘 외운 단어를 한 번에 다시 확인합니다.'
							: '이 묶음의 암기를 마친 뒤 시작한 테스트입니다.'}
					</p>
				</fieldset>
			{:else}
				<fieldset class="choice-group">
					<legend>출제 단어</legend>
					<div class="choice-options">
						<label class="choice"
							><input type="radio" name="source" value="range" bind:group={testSource} /> 범위 선택</label
						>
						<label class="choice"
							><input
								type="radio"
								name="source"
								value="recent-result"
								bind:group={testSource}
								disabled={!latestResult}
							/> 최근 결과 선택</label
						>
						<label class="choice"
							><input
								type="radio"
								name="source"
								value="starred"
								bind:group={testSource}
								disabled={!vocabulary.words.some((word) => word.starred)}
							/> 별표 단어</label
						>
					</div>
					{#if testSource === 'range'}
						<label class="choice"
							><input type="checkbox" name="all" bind:checked={testAll} /> 전체 단어</label
						>
						<div class="choice-options">
							<div class="field">
								<label for="test-start">시작 번호</label>
								<input
									id="test-start"
									name="start"
									type="number"
									min={vocabulary.words[0]?.number ?? 1}
									max={vocabulary.words.at(-1)?.number ?? 1}
									bind:value={testStart}
									disabled={testAll}
								/>
							</div>
							<div class="field">
								<label for="test-end">끝 번호</label>
								<input
									id="test-end"
									name="end"
									type="number"
									min={vocabulary.words[0]?.number ?? 1}
									max={vocabulary.words.at(-1)?.number ?? 1}
									bind:value={testEnd}
									disabled={testAll}
								/>
							</div>
						</div>
					{:else if testSource === 'recent-result'}
						<p class="field-note">완료한 테스트들의 단어별 최신 결과에서 골라 출제합니다.</p>
						<div class="choice-options">
							{#each statusOptions as option (option.value)}
								<label class="choice"
									><input
										type="checkbox"
										name="statuses"
										value={option.value}
										checked={testStatuses.has(option.value)}
										onchange={(event) => toggleTestStatus(event, option.value)}
									/>
									{option.label}</label
								>
							{/each}
						</div>
					{:else}
						<p class="field-note">별표한 단어만 출제합니다.</p>
					{/if}
				</fieldset>
			{/if}

			<fieldset class="choice-group">
				<legend>순서</legend>
				<div class="choice-options">
					<label class="choice"
						><input type="radio" name="order" value="sequential" checked /> 순서대로</label
					>
					<label class="choice"><input type="radio" name="order" value="random" /> 섞어서</label>
				</div>
			</fieldset>

			<fieldset class="choice-group">
				<legend>출제 방향</legend>
				<div class="choice-options">
					<label class="choice"
						><input type="radio" name="direction" value="english-to-korean" checked /> 영어 → 한국어</label
					>
					<label class="choice"
						><input type="radio" name="direction" value="korean-to-english" /> 한국어 → 영어</label
					>
				</div>
			</fieldset>

			{#if formMessage}
				<p class="message message-error" role="alert" aria-live="assertive">{formMessage}</p>
			{/if}
			<div class="modal-actions">
				<button class="button button-secondary" type="button" onclick={onclose}>취소</button>
				<button class="button button-primary" type="submit" disabled={startPending}>
					{startPending ? '준비 중…' : '테스트 시작'}
				</button>
			</div>
		</form>
	</div>
</dialog>
