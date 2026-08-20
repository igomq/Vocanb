<script lang="ts">
	import { passageNavState, type SentencePassage } from '$lib/sentence-domain';
	import MemorizationPassage from '$lib/components/MemorizationPassage.svelte';
	import PassageSummaryView from '$lib/components/PassageSummaryView.svelte';
	import PassageTranslationView from '$lib/components/PassageTranslationView.svelte';

	let { data } = $props();

	type Tab = 'summary' | 'passage' | 'translation';
	let activeIndex = $state(0);
	let tab = $state<Tab>('passage');

	const passages = $derived(data.book.passages);
	const activePassage = $derived(passages[activeIndex] as SentencePassage);
	const nav = $derived(passageNavState(passages.length, activeIndex));

	function goTo(index: number) {
		if (index < 0 || index >= passages.length) return;
		activeIndex = index;
		tab = 'passage';
	}

	function switchTab(next: Tab) {
		tab = next;
	}
</script>

<svelte:head>
	<title>{data.book.title} · Vocanb</title>
</svelte:head>

<div class="content-wrap">
	<header class="page-header">
		<div>
			<p class="eyebrow">문장 암기</p>
			<h1>{data.book.title}</h1>
			<p class="page-description">강조된 문장을 가려 두고, 기억나는지 확인해 보세요.</p>
		</div>
	</header>

	{#key activePassage.id}
		<section class="sentence-stage" aria-label="지문 학습">
			<div class="sentence-stage-header">
				<h2 class="sentence-passage-label">{activePassage.label}</h2>
				<span class="sentence-passage-position">
					{activeIndex + 1} / {passages.length}
				</span>
			</div>

			<nav class="sentence-nav" aria-label="지문 이동과 보기 선택">
				<button
					class="button button-secondary sentence-nav-arrow"
					type="button"
					onclick={() => goTo(activeIndex - 1)}
					disabled={!nav.canPrevious}>‹ 이전</button
				>
				<div class="sentence-tabs" role="tablist" aria-label="보기 모드">
					<button
						class="sentence-tab"
						class:is-active={tab === 'summary'}
						type="button"
						role="tab"
						aria-selected={tab === 'summary'}
						onclick={() => switchTab('summary')}>정리</button
					>
					<button
						class="sentence-tab"
						class:is-active={tab === 'passage'}
						type="button"
						role="tab"
						aria-selected={tab === 'passage'}
						onclick={() => switchTab('passage')}>본문</button
					>
					<button
						class="sentence-tab"
						class:is-active={tab === 'translation'}
						type="button"
						role="tab"
						aria-selected={tab === 'translation'}
						onclick={() => switchTab('translation')}>번역</button
					>
				</div>
				<button
					class="button button-secondary sentence-nav-arrow"
					type="button"
					onclick={() => goTo(activeIndex + 1)}
					disabled={!nav.canNext}>다음 ›</button
				>
			</nav>

			<div class="sentence-panel">
				{#if tab === 'summary'}
					<PassageSummaryView bookId={data.book.id} passage={activePassage} />
				{:else if tab === 'passage'}
					<MemorizationPassage passage={activePassage} />
				{:else}
					<PassageTranslationView bookId={data.book.id} passage={activePassage} />
				{/if}
			</div>
		</section>
	{/key}
</div>
