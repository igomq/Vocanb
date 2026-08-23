<script lang="ts">
	import {
		TranslationItemSchema,
		type SentencePassage,
		type TranslationItem
	} from '$lib/sentence-domain';

	let {
		bookId,
		passage
	}: {
		bookId: string;
		passage: SentencePassage;
	} = $props();

	let items = $state<TranslationItem[] | null>(null);
	let loading = $state(false);
	let error = $state('');

	async function load() {
		if (items || loading) return;
		loading = true;
		error = '';
		try {
			const response = await fetch(`/app/s/${bookId}/translation`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ passageId: passage.id })
			});
			const body = await response.json();
			if (!response.ok) throw new Error(body?.message || '번역을 생성하지 못했습니다.');
			items = TranslationItemSchema.array().parse(body.translations);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : '번역을 생성하지 못했습니다.';
			console.error('Passage translation generation failed:', error);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (items) return;
		if (passage.translation) {
			items = passage.translation;
			return;
		}
		void load();
	});
</script>

{#if items}
	<div class="translation-list">
		{#each items as item, index (index)}
			<div class="translation-item">
				<p class="translation-korean">{item.korean}</p>
				<p class="translation-english">{item.english}</p>
			</div>
		{/each}
	</div>
{:else if loading}
	<div class="summary-loading" role="status" aria-live="polite">
		<p class="ocr-status">번역을 만드는 중…</p>
		<progress class="ocr-progress" aria-label="번역 생성 중"></progress>
	</div>
{:else}
	<div class="sentence-error-block" role="alert">
		<p class="message message-error">{error || '번역을 생성하지 못했습니다.'}</p>
		<div class="modal-actions">
			<button class="button button-secondary" type="button" onclick={load}>다시 시도</button>
		</div>
	</div>
{/if}
