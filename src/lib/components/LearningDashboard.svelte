<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { DashboardData } from '$lib/learning';

	let {
		dashboard,
		sentenceDue,
		vocabularyId = null,
		startPending = $bindable(false)
	}: {
		dashboard: DashboardData;
		sentenceDue: {
			count: number;
			items: { title: string; label: string; bookId: string; passageId: string }[];
		};
		vocabularyId?: string | null;
		startPending?: boolean;
	} = $props();

	let cramDialog: HTMLDialogElement | undefined = $state();
	let cramPending = $state(false);
	let detailsOpen = $state(false);

	const startAction = resolve('/app/learn') + '?/start';
	const cramAction = resolve('/app/learn') + '?/cram';
	const percent = (value: number | null) => (value == null ? '—' : `${Math.round(value * 100)}%`);
	const spark = $derived(
		dashboard.trend
			.map((count) => {
				const bars = ['▁', '▂', '▃', '▄', '▅', '▆', '▇'];
				const max = Math.max(1, ...dashboard.trend);
				return bars[Math.min(bars.length - 1, Math.round((count / max) * (bars.length - 1)))];
			})
			.join('')
	);

	const enhanceStart: SubmitFunction = () => {
		startPending = true;
		return async ({ update }) => {
			try {
				await update();
			} finally {
				startPending = false;
			}
		};
	};

	const enhanceCram: SubmitFunction = () => {
		cramPending = true;
		return async ({ update }) => {
			try {
				await update();
			} finally {
				cramPending = false;
				cramDialog?.close();
			}
		};
	};
</script>

<section class="learn-dashboard" aria-label="추천 학습">
	<div class="learn-dashboard-main">
		<div>
			<p class="eyebrow">추천 학습</p>
			<h2>오늘 추천 학습 {dashboard.recommended}개</h2>
			<p class="page-description">
				오늘 복습 {dashboard.dueToday} · 기한 지남 {dashboard.overdue} · 오늘 학습 {dashboard.studiedToday}
			</p>
		</div>
		<div class="button-row">
			<form id="learn-start-form" method="post" action={startAction} use:enhance={enhanceStart}>
				{#if vocabularyId}<input type="hidden" name="vocabularyId" value={vocabularyId} />{/if}
				<button
					class="button button-primary"
					type="submit"
					disabled={!dashboard.recommended || startPending}
					>{startPending ? '준비 중…' : '시작'}</button
				>
			</form>
			<button class="button button-secondary" type="button" onclick={() => cramDialog?.showModal()}
				>벼락치기</button
			>
		</div>
	</div>

	<fieldset class="choice-group learn-ai-limit">
		<legend>AI 문제</legend>
		<div class="choice-options">
			<label class="choice"
				><input type="radio" name="aiQuestionLimit" value="0" form="learn-start-form" /> 0</label
			>
			<label class="choice"
				><input type="radio" name="aiQuestionLimit" value="4" form="learn-start-form" /> 4</label
			>
			<label class="choice"
				><input type="radio" name="aiQuestionLimit" value="8" form="learn-start-form" checked /> 8</label
			>
		</div>
	</fieldset>

	<dl class="learn-metrics">
		<div>
			<dt>최근 정답률</dt>
			<dd>{percent(dashboard.accuracy)}</dd>
		</div>
		<div>
			<dt>평균 숙련도</dt>
			<dd>{percent(dashboard.avgMastery)}</dd>
		</div>
		<div>
			<dt>최근 추세</dt>
			<dd class="learn-spark" aria-label={`최근 7일 학습 ${dashboard.trend.join(', ')}`}>
				{spark}
			</dd>
		</div>
		<div>
			<dt>다음 복습</dt>
			<dd>
				{#if dashboard.nextReview}{dashboard.nextReview.date} · {dashboard.nextReview
						.count}개{:else}—{/if}
			</dd>
		</div>
	</dl>

	<button class="learn-details-toggle" type="button" onclick={() => (detailsOpen = !detailsOpen)}>
		{detailsOpen ? '간단히' : '자세히'}
	</button>

	{#if detailsOpen}
		<ul class="learn-details">
			<li>어려운 단어: {dashboard.hardest?.label ?? '—'}</li>
			<li>많이 틀린 항목: {dashboard.mostMissed?.label ?? '—'}</li>
			{#if dashboard.confusion.length}
				<li>
					헷갈리는 단어:
					{dashboard.confusion.map((pair) => `${pair.left} ↔ ${pair.right}`).join(' · ')}
				</li>
			{/if}
			{#if sentenceDue.count}
				<li>
					문장 복습 {sentenceDue.count}개
					{#each sentenceDue.items as item (item.passageId)}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
						<a href={`${resolve('/app/s/[id]', { id: item.bookId })}?passage=${item.passageId}`}
							>{item.title} {item.label}</a
						>
					{/each}
				</li>
			{/if}
		</ul>
	{/if}
</section>

<dialog bind:this={cramDialog} class="modal" aria-labelledby="cram-title">
	<div class="modal-body">
		<div class="modal-header">
			<div>
				<h2 id="cram-title">벼락치기</h2>
				<p>시험 직전에 자주 틀린 항목부터 빠르게 확인합니다. 복습 일정은 바뀌지 않습니다.</p>
			</div>
			<button
				class="modal-close"
				type="button"
				aria-label="닫기"
				onclick={() => cramDialog?.close()}>×</button
			>
		</div>
		<form class="form-stack" method="post" action={cramAction} use:enhance={enhanceCram}>
			{#if vocabularyId}<input type="hidden" name="vocabularyId" value={vocabularyId} />{/if}
			<fieldset class="choice-group">
				<legend>AI 문제</legend>
				<div class="choice-options">
					<label class="choice"><input type="radio" name="aiQuestionLimit" value="0" /> 0</label>
					<label class="choice"><input type="radio" name="aiQuestionLimit" value="4" /> 4</label>
					<label class="choice"
						><input type="radio" name="aiQuestionLimit" value="8" checked /> 8</label
					>
				</div>
			</fieldset>
			<fieldset class="choice-group">
				<legend>시간</legend>
				<div class="choice-options">
					<label class="choice"><input type="radio" name="minutes" value="20" checked /> 20분</label
					>
					<label class="choice"><input type="radio" name="minutes" value="30" /> 30분</label>
					<label class="choice"><input type="radio" name="minutes" value="60" /> 1시간</label>
				</div>
			</fieldset>
			<div class="field">
				<label for="cram-count">또는 항목 수</label>
				<input
					id="cram-count"
					name="itemCount"
					type="number"
					min="1"
					max="80"
					placeholder="예: 20"
				/>
			</div>
			<div class="modal-actions">
				<button class="button button-secondary" type="button" onclick={() => cramDialog?.close()}
					>취소</button
				>
				<button class="button button-primary" type="submit" disabled={cramPending}
					>{cramPending ? '준비 중…' : '시작'}</button
				>
			</div>
		</form>
	</div>
</dialog>
