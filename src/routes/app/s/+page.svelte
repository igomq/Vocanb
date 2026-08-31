<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import type { ResolvedPathname } from '$app/types';
	import CreateStudyDialog from '$lib/components/CreateStudyDialog.svelte';
	import FolderPanel from '$lib/components/FolderPanel.svelte';

	type SentenceBook = { id: string; title: string; passageCount: number };

	const sentenceBooks = $derived(page.data.sentenceBooks as SentenceBook[]);
	const folders = $derived(
		page.data.folders as {
			vocabulary: { id: string; name: string; itemIds: string[] }[];
			sentence: { id: string; name: string; itemIds: string[] }[];
		}
	);
	const error = $derived((page.form as { message?: string } | null)?.message ?? '');

	function createUrl(search: URLSearchParams): ResolvedPathname {
		return `${resolve('/app/s')}?${search.toString()}` as ResolvedPathname;
	}

	function openSentenceCreate() {
		const params = new SvelteURLSearchParams(page.url.searchParams);
		params.set('create', '1');
		params.set('type', 'sentence');
		void goto(createUrl(params), { replaceState: true, keepFocus: true });
	}
</script>

<svelte:head>
	<title>문장 암기 · Vocanb</title>
</svelte:head>

<div class="content-wrap">
	<header class="page-header">
		<div>
			<p class="eyebrow">VOCANB</p>
			<h1>문장 암기</h1>
			<p class="page-description">PDF의 강조된 문장을 자동으로 찾아 암기해 보세요.</p>
		</div>
		<div class="button-row">
			<button class="button button-primary" type="button" onclick={openSentenceCreate}
				>+ PDF 추가</button
			>
		</div>
	</header>

	{#if error}
		<p class="message message-error" role="alert" aria-live="assertive">{error}</p>
	{/if}

	<FolderPanel
		kind="sentence"
		folders={folders.sentence}
		items={sentenceBooks.map(({ id, title, passageCount }) => ({
			id,
			title,
			meta: `지문 ${passageCount}개`
		}))}
		labels={{
			heading: '문장 암기 폴더',
			item: '문장 암기장',
			empty: '아직 폴더가 없습니다. 위에서 이름을 정해 만들어 보세요.'
		}}
	/>

	{#if sentenceBooks.length === 0}
		<section class="empty-state" aria-labelledby="sentence-empty-title">
			<div class="empty-state-mark" aria-hidden="true">＋</div>
			<h2 id="sentence-empty-title">첫 문장 암기장을 만들어 보세요</h2>
			<p>영어 지문 PDF를 올리면 지문을 나누고 강조된 문장을 찾아 암기할 수 있게 정리해 드려요.</p>
			<button class="button button-primary" type="button" onclick={openSentenceCreate}
				>PDF 추가하기</button
			>
		</section>
	{:else}
		<section class="empty-state" aria-labelledby="sentence-choose-title">
			<div class="empty-state-mark" aria-hidden="true">⌁</div>
			<h2 id="sentence-choose-title">문장 암기장을 선택하세요</h2>
			<p>왼쪽 목록에서 이어서 공부할 문장 암기장을 고르거나, 새 PDF를 추가해 보세요.</p>
			<button class="button button-secondary" type="button" onclick={openSentenceCreate}
				>PDF 추가하기</button
			>
		</section>
	{/if}
</div>

<CreateStudyDialog {folders} />
