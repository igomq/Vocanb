<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import type { ResolvedPathname } from '$app/types';
	import CreateStudyDialog from '$lib/components/CreateStudyDialog.svelte';

	let { data, form } = $props();

	function createUrl(search: URLSearchParams): ResolvedPathname {
		return `${resolve('/app')}?${search.toString()}` as ResolvedPathname;
	}

	function openCreate() {
		const params = new SvelteURLSearchParams(page.url.searchParams);
		params.set('create', '1');
		void goto(createUrl(params), { replaceState: true, keepFocus: true });
	}
</script>

<svelte:head>
	<title>내 학습장 · Vocanb</title>
</svelte:head>

<div class="content-wrap">
	<header class="page-header">
		<div>
			<p class="eyebrow">VOCANB</p>
			<h1>내 학습장</h1>
			<p class="page-description">단어를 외우거나, PDF의 중요한 문장을 암기해 보세요.</p>
		</div>
		<div class="button-row">
			<button class="button button-primary" type="button" onclick={openCreate}>+ 학습장 추가</button
			>
		</div>
	</header>

	{#if form?.message}
		<p class="message message-error" role="alert" aria-live="assertive">{form.message}</p>
	{/if}

	{#if data.titles.length === 0 && page.data.sentenceBooks.length === 0}
		<section class="empty-state" aria-labelledby="empty-title">
			<div class="empty-state-mark" aria-hidden="true">＋</div>
			<h2 id="empty-title">첫 학습장을 만들어 보세요</h2>
			<p>단어를 외울 수도 있고, PDF의 중요한 문장을 암기할 수도 있습니다.</p>
			<button class="button button-primary" type="button" onclick={openCreate}
				>새 학습장 시작하기</button
			>
		</section>
	{:else}
		<section class="empty-state" aria-labelledby="choose-title">
			<div class="empty-state-mark" aria-hidden="true">⌁</div>
			<h2 id="choose-title">학습장을 선택하세요</h2>
			<p>왼쪽 목록에서 이어서 공부할 학습장을 고르거나, 새 학습장을 만들어 보세요.</p>
			<button class="button button-secondary" type="button" onclick={openCreate}
				>학습장 추가하기</button
			>
		</section>
	{/if}
</div>

<CreateStudyDialog titles={data.titles} ranges={data.ranges} />
