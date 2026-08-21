<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { page } from '$app/state';

	let { data, children } = $props();
	let mobileOpen = $state(false);
	let logoutPending = $state(false);

	const isActive = (id: string) => page.params.id === id;

	function closeDrawer() {
		mobileOpen = false;
	}

	function confirmDeleteVocabulary(event: SubmitEvent, title: string) {
		if (!window.confirm(`‘${title}’ 단어장과 모든 단어를 삭제할까요?`)) event.preventDefault();
	}

	function confirmDeleteSentenceBook(event: SubmitEvent, title: string) {
		if (!window.confirm(`‘${title}’ 문장 암기장과 분석 데이터를 삭제할까요?`))
			event.preventDefault();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') closeDrawer();
	}

	const enhanceLogout: SubmitFunction = () => {
		logoutPending = true;
		return async ({ update }) => {
			try {
				await update();
			} finally {
				logoutPending = false;
			}
		};
	};
</script>

<svelte:head>
	<title>학습 · Vocanb</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

<div class="app-shell">
	{#if mobileOpen}
		<button class="drawer-scrim" type="button" aria-label="메뉴 닫기" onclick={closeDrawer}
		></button>
	{/if}

	<aside class:is-open={mobileOpen} class="app-sidebar" aria-label="학습 탐색">
		<div class="sidebar-inner">
			<a class="brand" href={resolve('/app')} onclick={closeDrawer} aria-label="Vocanb 홈">
				<span>Vocanb</span>
				<small>학습</small>
			</a>

			<div class="sidebar-heading">
				<span>내 학습장</span>
				<form method="get" action={resolve('/app')} onsubmit={closeDrawer}>
					<input type="hidden" name="create" value="1" />
					<button class="sidebar-add" type="submit" aria-label="학습장 추가" title="학습장 추가"
						>+</button
					>
				</form>
			</div>

			<nav class="sidebar-nav" aria-label="학습장 목록">
				<p class="sidebar-section-label">단어장</p>
				<a
					class:is-active={page.url.pathname === '/app'}
					class="sidebar-link"
					href={resolve('/app')}
					onclick={closeDrawer}
					aria-current={page.url.pathname === '/app' ? 'page' : undefined}
				>
					<span class="sidebar-link-index">⌂</span>
					<span class="sidebar-link-copy"
						><span class="sidebar-link-title">전체 단어장</span><span class="sidebar-link-range"
							>홈</span
						></span
					>
				</a>
				{#if data.vocabularies.length}
					{#each data.vocabularies as vocabulary, index (vocabulary.id)}
						<div class="sidebar-item">
							<a
								class:is-active={isActive(vocabulary.id)}
								class="sidebar-link"
								href={resolve('/app/v/[id]', { id: vocabulary.id })}
								onclick={closeDrawer}
								aria-current={isActive(vocabulary.id) ? 'page' : undefined}
							>
								<span class="sidebar-link-index">{String(index + 1).padStart(2, '0')}</span>
								<span class="sidebar-link-copy">
									<span class="sidebar-link-title">{vocabulary.title}</span>
									{#if vocabulary.rangeLabel}<span class="sidebar-link-range"
											>{vocabulary.rangeLabel}</span
										>{/if}
								</span>
							</a>
							<form
								method="post"
								action="/app?/deleteVocabulary"
								onsubmit={(event) => confirmDeleteVocabulary(event, vocabulary.title)}
							>
								<input type="hidden" name="id" value={vocabulary.id} />
								<button
									class="sidebar-delete"
									type="submit"
									aria-label={`${vocabulary.title} 단어장 삭제`}
									title="단어장 삭제">×</button
								>
							</form>
						</div>
					{/each}
				{:else}
					<p class="sidebar-empty">아직 단어장이 없습니다.<br />+ 버튼으로 추가하세요.</p>
				{/if}

				<p class="sidebar-section-label">문장 암기</p>
				<a
					class:is-active={page.url.pathname === '/app/s'}
					class="sidebar-link"
					href={resolve('/app/s')}
					onclick={closeDrawer}
					aria-current={page.url.pathname === '/app/s' ? 'page' : undefined}
				>
					<span class="sidebar-link-index">⌂</span>
					<span class="sidebar-link-copy"
						><span class="sidebar-link-title">문장 암기 홈</span><span class="sidebar-link-range"
							>홈</span
						></span
					>
				</a>
				{#if data.sentenceBooks.length}
					{#each data.sentenceBooks as sentenceBook, index (sentenceBook.id)}
						<div class="sidebar-item">
							<a
								class:is-active={isActive(sentenceBook.id)}
								class="sidebar-link"
								href={resolve('/app/s/[id]', { id: sentenceBook.id })}
								onclick={closeDrawer}
								aria-current={isActive(sentenceBook.id) ? 'page' : undefined}
							>
								<span class="sidebar-link-index">{String(index + 1).padStart(2, '0')}</span>
								<span class="sidebar-link-copy">
									<span class="sidebar-link-title">{sentenceBook.title}</span>
									<span class="sidebar-link-range">지문 {sentenceBook.passageCount}개</span>
								</span>
							</a>
							<form
								method="post"
								action="/app?/deleteSentenceBook"
								onsubmit={(event) => confirmDeleteSentenceBook(event, sentenceBook.title)}
							>
								<input type="hidden" name="id" value={sentenceBook.id} />
								<button
									class="sidebar-delete"
									type="submit"
									aria-label={`${sentenceBook.title} 문장 암기장 삭제`}
									title="문장 암기장 삭제">×</button
								>
							</form>
						</div>
					{/each}
				{:else}
					<p class="sidebar-empty">아직 문장 암기장이 없습니다.<br />+ 버튼으로 추가하세요.</p>
				{/if}
			</nav>

			<div class="sidebar-footer">
				<form method="post" action="/logout" use:enhance={enhanceLogout}>
					<button class="logout-button" type="submit" disabled={logoutPending}
						>{logoutPending ? '로그아웃 중…' : '로그아웃'}</button
					>
				</form>
			</div>
		</div>
	</aside>

	<main class="app-main">
		<header class="mobile-topbar">
			<button
				class="icon-button"
				type="button"
				aria-label="메뉴 열기"
				title="메뉴 열기"
				onclick={() => (mobileOpen = true)}>☰</button
			>
			<span class="mobile-topbar-title">학습</span>
			<span class="mobile-topbar-spacer" aria-hidden="true"></span>
		</header>
		{@render children()}
	</main>
</div>
