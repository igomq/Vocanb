<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { SubmitFunction } from '@sveltejs/kit';
	import LearningDashboard from '$lib/components/LearningDashboard.svelte';
	import { formatReason, sameCanonical, type ReviewGrade } from '$lib/learning';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';

	let { data, form } = $props();
	const revealedKeys = new SvelteSet<string>();
	let pending = $state(false);
	let completePending = $state(false);
	let typed = $state('');
	let shownAt = $state(Date.now());
	let startPending = $state(false);
	let currentKey = $state('');

	const session = $derived(data.session);
	const items = $derived(session?.items ?? []);
	const answered = $derived.by(() => {
		const map = new SvelteMap<string, ReviewGrade>();
		for (const item of items) if (item.result) map.set(item.key, item.result);
		return map;
	});
	const index = $derived.by(() => {
		for (const [i, item] of items.entries()) {
			if (item.result) continue;
			const previous = answered.get(item.key);
			if (previous === 'correct' || previous === 'partial') continue;
			return i;
		}
		return -1;
	});
	const current = $derived(index >= 0 ? items[index] : null);
	const uniqueTotal = $derived(new Set(items.map((item) => item.key)).size);
	const uniqueDone = $derived(
		new Set(items.filter((item) => item.result).map((item) => item.key)).size
	);
	const completeReady = $derived(uniqueTotal > 0 && uniqueDone === uniqueTotal);

	$effect(() => {
		if (!current || current.key === currentKey) return;
		currentKey = current.key;
		typed = current.typedAnswer ?? '';
		shownAt = Date.now();
	});

	const statuses: { value: ReviewGrade; label: string }[] = [
		{ value: 'correct', label: '맞음' },
		{ value: 'wrong', label: '틀림' },
		{ value: 'unknown', label: '아예 몰랐음' },
		{ value: 'ambiguous', label: '애매함' }
	];

	const enhanceEval: SubmitFunction = ({ formData }) => {
		formData.set('responseMs', String(Math.max(0, Date.now() - shownAt)));
		pending = true;
		return async ({ update }) => {
			try {
				await update();
			} finally {
				pending = false;
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
</script>

<svelte:head>
	<title>추천 학습 · Vocanb</title>
</svelte:head>

<div class="content-wrap">
	{#if session}
		<header class="test-header">
			<div>
				<p class="eyebrow">{session.mode === 'cram' ? '벼락치기' : '추천 학습'}</p>
				<h1>
					{current
						? current.promptKind === 'recall'
							? '뜻을 떠올려 보세요'
							: '알맞은 답을 고르세요'
						: '평가를 모두 마쳤습니다'}
				</h1>
				<p class="page-description">
					{#if current}{current.sourceTitle}{#if current.number}
							· {current.number}번{/if}{:else}학습 완료를 눌러 저장하세요.{/if}
				</p>
			</div>
			<div class="progress-wrap" aria-label={`진행률 ${uniqueDone}/${uniqueTotal}`}>
				<span class="progress-label" aria-live="polite">{uniqueDone}/{uniqueTotal}개 평가 완료</span
				>
				<div class="progress-track" aria-hidden="true">
					<div
						class="progress-value"
						style={`transform: scaleX(${uniqueTotal ? uniqueDone / uniqueTotal : 0})`}
					></div>
				</div>
			</div>
		</header>

		{#if form?.message}
			<p class="message message-error" role="alert">{form.message}</p>
		{/if}

		{#if current}
			<section class="learn-card" aria-live="polite">
				<p class="test-prompt">
					{#if current.partOfSpeech && current.promptKind !== 'recall'}
						<span class="part-of-speech">{current.partOfSpeech}</span>
					{/if}
					{current.prompt}
				</p>

				<details class="learn-why">
					<summary>왜 이 문제인가요?</summary>
					<ul>
						{#each current.reasons as reason, i (`${reason.code}-${i}`)}
							<li>{formatReason(reason)}</li>
						{/each}
					</ul>
				</details>

				{#if current.choices?.length}
					<form class="evaluation-form" method="post" action="?/evaluate" use:enhance={enhanceEval}>
						<input type="hidden" name="sessionId" value={session.id} />
						<input type="hidden" name="index" value={index} />
						<input type="hidden" name="responseMs" value={Math.max(0, Date.now() - shownAt)} />
						{#each current.choices as choice (choice)}
							<button
								class="button button-secondary"
								class:is-selected={current.typedAnswer === choice}
								type="submit"
								name="choice"
								value={choice}
								disabled={pending}>{choice}</button
							>
						{/each}
						<button
							class="status-button"
							type="submit"
							name="result"
							value="unknown"
							disabled={pending}>모름</button
						>
						<button
							class="status-button"
							type="submit"
							name="result"
							value="ambiguous"
							disabled={pending}>애매함</button
						>
					</form>
				{:else if current.promptKind === 'ko-to-en' || current.promptKind === 'cloze' || current.promptKind === 'form'}
					<form class="form-stack" method="post" action="?/evaluate" use:enhance={enhanceEval}>
						<input type="hidden" name="sessionId" value={session.id} />
						<input type="hidden" name="index" value={index} />
						<input type="hidden" name="responseMs" value={Math.max(0, Date.now() - shownAt)} />
						<label class="field" for="learn-typed">답</label>
						<input id="learn-typed" name="typedAnswer" bind:value={typed} autocomplete="off" />
						<input
							type="hidden"
							name="result"
							value={typed.trim()
								? sameCanonical(typed, current.answer)
									? 'correct'
									: 'wrong'
								: 'unknown'}
						/>
						<button class="button button-primary" type="submit" disabled={pending}
							>{pending ? '저장 중…' : '확인'}</button
						>
					</form>
				{:else}
					<form class="form-stack" method="post" action="?/evaluate" use:enhance={enhanceEval}>
						<input type="hidden" name="sessionId" value={session.id} />
						<input type="hidden" name="index" value={index} />
						<input type="hidden" name="responseMs" value={Math.max(0, Date.now() - shownAt)} />
						<label class="field" for="learn-typed"
							>답
							<input id="learn-typed" name="typedAnswer" bind:value={typed} autocomplete="off" />
						</label>
						{#if current.result || revealedKeys.has(current.key)}
							<div class="answer-block">
								<span class="answer-label">정답</span>
								<p class="answer-text">
									{#if current.partOfSpeech}<span class="part-of-speech"
											>{current.partOfSpeech}</span
										>{/if}
									{current.answer}
								</p>
								<div class="evaluation-form">
									{#each statuses as status (status.value)}
										<button
											class:is-selected={current.result === status.value}
											class="status-button"
											type="submit"
											name="result"
											value={status.value}
											disabled={pending}>{status.label}</button
										>
									{/each}
								</div>
							</div>
						{:else}
							<button
								class="reveal-button"
								type="button"
								onclick={() => revealedKeys.add(current.key)}>정답 보기</button
							>
						{/if}
					</form>
				{/if}
			</section>
		{/if}

		<footer class="test-footer">
			<a class="button button-quiet" href={resolve('/app')}>나가기</a>
			<form method="post" action="?/complete" use:enhance={enhanceComplete}>
				<input type="hidden" name="sessionId" value={session.id} />
				<button
					class="button button-primary"
					type="submit"
					disabled={!completeReady || completePending}
					>{completePending ? '완료 처리 중…' : '학습 완료'}</button
				>
			</form>
		</footer>
	{:else}
		<header class="page-header">
			<div>
				<p class="eyebrow">VOCANB</p>
				<h1>추천 학습</h1>
				<p class="page-description">복습이 필요한 단어부터 이어서 공부합니다.</p>
			</div>
		</header>
		{#if form?.message}
			<p class="message message-error" role="alert">{form.message}</p>
		{/if}
		<LearningDashboard
			dashboard={data.dashboard}
			sentenceDue={data.sentenceDue}
			vocabularyId={data.sourceId}
			bind:startPending
		/>
		<p><a class="button button-quiet" href={resolve('/app')}>학습장으로</a></p>
	{/if}
</div>
