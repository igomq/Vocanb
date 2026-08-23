<script lang="ts">
	import {
		PassageSummarySchema,
		type PassageSummary,
		type SentencePassage
	} from '$lib/sentence-domain';

	let {
		bookId,
		passage
	}: {
		bookId: string;
		passage: SentencePassage;
	} = $props();

	let summary = $state<PassageSummary | null>(null);
	let loading = $state(false);
	let error = $state('');

	async function load() {
		if (summary || loading) return;
		loading = true;
		error = '';
		try {
			const response = await fetch(`/app/s/${bookId}/summary`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ passageId: passage.id })
			});
			const body = await response.json();
			if (!response.ok) throw new Error(body?.message || '정리를 생성하지 못했습니다.');
			summary = PassageSummarySchema.parse(body.summary);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : '정리를 생성하지 못했습니다.';
			console.error('Passage summary generation failed:', error);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (summary) return;
		if (passage.summary) {
			summary = passage.summary;
			return;
		}
		void load();
	});
</script>

{#if summary}
	<div class="passage-summary">
		<p class="eyebrow">핵심 주제</p>
		<p class="passage-summary-topic">{summary.topic}</p>
		<p class="eyebrow">글의 흐름</p>
		<ol class="passage-summary-flow">
			{#each summary.flow as point, index (index)}
				<li>
					<span class="passage-summary-number">{String(index + 1).padStart(2, '0')}</span>
					{point}
				</li>
			{/each}
		</ol>
		<p class="eyebrow">핵심 정리</p>
		<p class="passage-summary-takeaway">{summary.takeaway}</p>
	</div>
{:else if loading}
	<div class="summary-loading" role="status" aria-live="polite">
		<p class="ocr-status">정리를 만드는 중…</p>
		<progress class="ocr-progress" aria-label="정리 생성 중"></progress>
	</div>
{:else}
	<div class="sentence-error-block" role="alert">
		<p class="message message-error">{error || '정리를 생성하지 못했습니다.'}</p>
		<div class="modal-actions">
			<button class="button button-secondary" type="button" onclick={load}>다시 시도</button>
		</div>
	</div>
{/if}
