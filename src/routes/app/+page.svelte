<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	let { data, form } = $props();
	let createDialog: HTMLDialogElement | undefined = $state();
	let createPending = $state(false);

	$effect(() => {
		if (!createDialog) return;
		if (page.url.searchParams.get('create') === '1') {
			if (!createDialog.open) createDialog.showModal();
		} else if (createDialog.open) {
			createDialog.close();
		}
	});

	function openCreate() {
		createDialog?.showModal();
	}

	function closeCreate() {
		if (createDialog?.open) createDialog.close();
		if (page.url.searchParams.get('create') === '1') {
			void goto(resolve('/app'), { replaceState: true, keepFocus: true });
		}
	}

	const enhanceCreate: SubmitFunction = () => {
		createPending = true;
		return async ({ update }) => {
			try {
				await update();
			} finally {
				createPending = false;
			}
		};
	};
</script>

<svelte:head>
	<title>내 단어장 · Vocanb</title>
</svelte:head>

<div class="content-wrap">
	<header class="page-header">
		<div>
			<p class="eyebrow">VOCANB</p>
			<h1>내 단어장</h1>
			<p class="page-description">오늘 외울 단어를 고르고, 한 장씩 이어가세요.</p>
		</div>
		<div class="button-row">
			<button class="button button-primary" type="button" onclick={openCreate}
				>+ 단어장 만들기</button
			>
		</div>
	</header>

	{#if form?.message}
		<p class="message message-error" role="alert" aria-live="assertive">{form.message}</p>
	{/if}

	{#if data.titles.length === 0}
		<section class="empty-state" aria-labelledby="empty-title">
			<div class="empty-state-mark" aria-hidden="true">＋</div>
			<h2 id="empty-title">첫 단어장을 만들어 보세요</h2>
			<p>단어장 이름과 범위를 정한 뒤, 단어 사진을 추가하면 외울 준비가 끝납니다.</p>
			<button class="button button-primary" type="button" onclick={openCreate}
				>새 단어장 시작하기</button
			>
		</section>
	{:else}
		<section class="empty-state" aria-labelledby="choose-title">
			<div class="empty-state-mark" aria-hidden="true">⌁</div>
			<h2 id="choose-title">단어장을 선택하세요</h2>
			<p>왼쪽 목록에서 이어서 공부할 단어장을 고르거나, 새 단어장을 만들어 보세요.</p>
			<button class="button button-secondary" type="button" onclick={openCreate}
				>단어장 추가하기</button
			>
		</section>
	{/if}
</div>

<dialog bind:this={createDialog} class="modal" aria-labelledby="create-title" onclose={closeCreate}>
	<div class="modal-body">
		<div class="modal-header">
			<div>
				<h2 id="create-title">새 단어장</h2>
				<p>이름과 범위만 정하면 바로 시작할 수 있어요.</p>
			</div>
			<button class="modal-close" type="button" aria-label="닫기" title="닫기" onclick={closeCreate}
				>×</button
			>
		</div>

		<form method="post" action="?/create" use:enhance={enhanceCreate} class="form-stack">
			<div class="field">
				<label for="vocabulary-title">단어장 이름</label>
				<input
					id="vocabulary-title"
					name="title"
					maxlength="120"
					list="title-suggestions"
					placeholder="예: 오늘 단어장"
					required
				/>
			</div>
			<div class="field">
				<label for="vocabulary-range">범위 <span class="field-note">(선택)</span></label>
				<input
					id="vocabulary-range"
					name="rangeLabel"
					maxlength="120"
					list="range-suggestions"
					placeholder="예: Unit 1–3"
				/>
			</div>
			{#if form?.message}
				<p class="message message-error" role="alert" aria-live="assertive">{form.message}</p>
			{/if}
			<div class="modal-actions">
				<button class="button button-secondary" type="button" onclick={closeCreate}>취소</button>
				<button class="button button-primary" type="submit" disabled={createPending}
					>{createPending ? '만드는 중…' : '단어장 만들기'}</button
				>
			</div>
		</form>
	</div>
</dialog>

<datalist id="title-suggestions">
	{#each data.titles as title (title)}
		<option value={title}></option>
	{/each}
</datalist>
<datalist id="range-suggestions">
	{#each data.ranges as range (range)}
		<option value={range}></option>
	{/each}
</datalist>
