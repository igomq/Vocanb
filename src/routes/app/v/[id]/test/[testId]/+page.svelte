<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { page } from '$app/state';
	import { type ResultStatus } from '$lib/domain';
	import { SvelteSet } from 'svelte/reactivity';

	let { data, form } = $props();
	let revealed = new SvelteSet<string>();
	let pendingWordId = $state<string | null>(null);
	let completePending = $state(false);
	let leaveDialog: HTMLDialogElement | undefined = $state();
	let activeTestId = '';

	let evaluated = $derived(data.test.items.filter((item) => item.result).length);
	let completeReady = $derived(evaluated === data.test.items.length);
	let completed = $derived(Boolean(data.test.completedAt));

	$effect(() => {
		if (activeTestId === data.test.id) return;
		activeTestId = data.test.id;
		revealed.clear();
	});

	const statuses: { value: ResultStatus; label: string }[] = [
		{ value: 'correct', label: '맞음' },
		{ value: 'wrong', label: '틀림' },
		{ value: 'unknown', label: '아예 몰랐음' },
		{ value: 'ambiguous', label: '애매함' }
	];

	function promptFor(item: (typeof data.test.items)[number]) {
		return data.test.direction === 'english-to-korean' ? item.english : item.meaning;
	}

	function answerFor(item: (typeof data.test.items)[number]) {
		return data.test.direction === 'english-to-korean' ? item.meaning : item.english;
	}

	function continuousPhaseLabel() {
		return data.test.continuous?.phase === 'cumulative' ? '오늘 누적 테스트' : '이번 묶음 테스트';
	}

	function reveal(wordId: string) {
		revealed.add(wordId);
	}

	const enhanceEvaluation: SubmitFunction = ({ formData }) => {
		pendingWordId = String(formData.get('wordId'));
		return async ({ update }) => {
			try {
				await update();
			} finally {
				pendingWordId = null;
			}
		};
	};

	const enhanceComplete: SubmitFunction = () => {
		completePending = true;
		return async ({ update }) => {
			try {
				await update();
			} finally {
				completePending = false;
			}
		};
	};

	function openLeaveDialog() {
		leaveDialog?.showModal();
	}

	function closeLeaveDialog() {
		if (leaveDialog?.open) leaveDialog.close();
	}
</script>

<svelte:head>
	<title>테스트 · {data.title} · Vocanb</title>
</svelte:head>

<div class="content-wrap">
	<header class="test-header">
		<div>
			<p class="eyebrow">
				{data.title}{#if data.test.continuous}
					· 연속 학습 · {continuousPhaseLabel()}{:else if data.rangeLabel}
					· {data.rangeLabel}{/if}
			</p>
			<h1>단어 테스트</h1>
			<p class="page-description">
				{data.test.continuous
					? data.test.continuous.phase === 'cumulative'
						? `${data.test.continuous.dayStart}~${data.test.continuous.dayEnd}번을 오늘 누적으로 확인해 보세요.`
						: `${data.test.range.start}~${data.test.range.end}번 묶음을 확인해 보세요.`
					: data.test.direction === 'english-to-korean'
						? '영어를 보고 한국어 뜻을 떠올려 보세요.'
						: '한국어 뜻을 보고 영어 단어를 떠올려 보세요.'}
			</p>
		</div>
		<div class="progress-wrap" aria-label={`진행률 ${evaluated}/${data.test.items.length}`}>
			<span class="progress-label" aria-live="polite"
				>{evaluated}/{data.test.items.length}개 평가 완료</span
			>
			<div class="progress-track" aria-hidden="true">
				<div
					class="progress-value"
					style={`transform: scaleX(${evaluated / data.test.items.length})`}
				></div>
			</div>
		</div>
	</header>

	{#if form?.message}
		<p class="message message-error" role="alert" aria-live="assertive">{form.message}</p>
	{:else if completed}
		<p class="message message-status" role="status" aria-live="polite">
			{data.test.continuous
				? `${continuousPhaseLabel()}를 완료했어요. 다음 단계는 단어장 화면에서 이어갈 수 있습니다.`
				: '완료한 테스트입니다. 결과를 다시 확인할 수 있어요.'}
		</p>
	{/if}

	<section class="test-list" aria-label="테스트 문제">
		{#each data.test.items as item (item.wordId)}
			<div class="test-row">
				<div class="test-row-top">
					<p class="test-prompt">
						{#if data.test.direction === 'korean-to-english' && item.partOfSpeech}<span
								class="part-of-speech">{item.partOfSpeech}</span
							>{/if}{promptFor(item)}
					</p>
					<div class="test-row-tools">
						<form method="post" action="?/toggleStar" use:enhance>
							<input type="hidden" name="wordId" value={item.wordId} />
							<button
								class="star-button"
								type="submit"
								aria-label={data.stars[item.wordId]
									? `${item.english} 별표 해제`
									: `${item.english} 별표`}
								aria-pressed={data.stars[item.wordId]}
							>
								<span aria-hidden="true">{data.stars[item.wordId] ? '★' : '☆'}</span>
							</button>
						</form>
						<span class="test-number">{item.number}번</span>
					</div>
				</div>

				{#if revealed.has(item.wordId) || item.result}
					<div class="answer-block">
						<span class="answer-label">정답</span>
						<p class="answer-text">
							{#if data.test.direction === 'english-to-korean' && item.partOfSpeech}<span
									class="part-of-speech">{item.partOfSpeech}</span
								>{/if}{answerFor(item)}
						</p>
						<form
							class="evaluation-form"
							method="post"
							action="?/evaluate"
							use:enhance={enhanceEvaluation}
						>
							<input type="hidden" name="wordId" value={item.wordId} />
							{#each statuses as status (status.value)}
								<button
									class:is-selected={item.result === status.value}
									class="status-button"
									type="submit"
									name="result"
									value={status.value}
									aria-pressed={item.result === status.value}
									disabled={completed || pendingWordId !== null}
								>
									{pendingWordId === item.wordId ? '저장 중…' : status.label}
								</button>
							{/each}
						</form>
					</div>
				{:else}
					<button
						class="reveal-button"
						type="button"
						aria-expanded="false"
						onclick={() => reveal(item.wordId)}>정답 보기</button
					>
				{/if}
			</div>
		{/each}
	</section>

	<footer class="test-footer">
		<div class="test-exit">
			<button class="button button-quiet" type="button" onclick={openLeaveDialog}>나가기</button>
		</div>
		<div class="test-completion">
			{#if !completeReady && !completed}<p id="complete-help" class="field-note">
					모든 단어를 평가하면 완료할 수 있어요.
				</p>{/if}
			<form
				class="test-complete-form"
				method="post"
				action="?/complete"
				use:enhance={enhanceComplete}
			>
				<button
					class="button button-primary"
					type="submit"
					disabled={!completeReady || completed || completePending}
					aria-describedby={!completeReady && !completed ? 'complete-help' : undefined}
				>
					{completePending ? '완료 처리 중…' : completed ? '완료됨' : '테스트 완료'}
				</button>
			</form>
		</div>
	</footer>
</div>

<dialog bind:this={leaveDialog} class="modal" aria-labelledby="leave-study-title">
	<div class="modal-body">
		<div class="modal-header">
			<div>
				<h2 id="leave-study-title">테스트를 나갈까요?</h2>
				<p>지금까지 평가한 내용은 저장되어 있어요. 나중에 다시 이어볼 수 있습니다.</p>
			</div>
			<button
				class="modal-close"
				type="button"
				aria-label="닫기"
				title="닫기"
				onclick={closeLeaveDialog}>×</button
			>
		</div>
		<div class="modal-actions">
			<button class="button button-secondary" type="button" onclick={closeLeaveDialog}
				>계속 풀기</button
			>
			<a class="button button-primary" href={resolve('/app/v/[id]', { id: page.params.id! })}
				>나가기</a
			>
		</div>
	</div>
</dialog>
