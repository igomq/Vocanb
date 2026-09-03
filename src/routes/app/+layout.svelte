<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { page } from '$app/state';
	import type { FolderKind } from '$lib/folders';
	import { SvelteSet } from 'svelte/reactivity';

	let { data, children } = $props();
	let mobileOpen = $state(false);
	let logoutPending = $state(false);
	let openFolders = $state<Record<string, boolean>>({});
	let folderDraft = $state<FolderKind | null>(null);
	const PAGE_SIZE = 5;
	let folderPage = $state<Record<string, number>>({});
	let moving = $state<{ kind: FolderKind; folderId: string; id: string } | null>(null);
	let dragging = $state<{ kind: FolderKind; folderId: string; id: string } | null>(null);
	let hoverTimer: ReturnType<typeof setTimeout> | null = null;
	let moveKind = $state<FolderKind>('vocabulary');
	let moveItemId = $state('');
	let moveFolderId = $state('');
	let moveBeforeId = $state('');
	let moveForm: HTMLFormElement | undefined = $state();

	type Item = { id: string; title: string; meta: string };
	type Group = {
		folders: { id: string; name: string; items: Item[]; itemIds: string[] }[];
		unfiled: Item[];
	};

	const isActive = (id: string) => page.params.id === id;

	function isOpen(folderId: string, itemIds: string[]) {
		return openFolders[folderId] ?? itemIds.includes(page.params.id ?? '');
	}

	function toggleFolder(folderId: string, itemIds: string[]) {
		openFolders[folderId] = !isOpen(folderId, itemIds);
	}

	function group(kind: FolderKind, items: Item[]): Group {
		const byId = new Map(items.map((item) => [item.id, item]));
		const folders = data.folders[kind].map((folder) => {
			const children = folder.itemIds.flatMap((id) => {
				const item = byId.get(id);
				return item ? [item] : [];
			});
			return { id: folder.id, name: folder.name, items: children, itemIds: folder.itemIds };
		});
		const filed = new SvelteSet<string>();
		for (const { items: children } of folders) for (const { id } of children) filed.add(id);
		return { folders, unfiled: items.filter((item) => !filed.has(item.id)) };
	}

	const vocabularyGroup = $derived(
		group(
			'vocabulary',
			data.vocabularies.map(({ id, title, rangeLabel }) => ({ id, title, meta: rangeLabel }))
		)
	);
	const sentenceGroup = $derived(
		group(
			'sentence',
			data.sentenceBooks.map(({ id, title, passageCount }) => ({
				id,
				title,
				meta: `지문 ${passageCount}개`
			}))
		)
	);

	const itemHref = (kind: FolderKind, id: string) =>
		kind === 'vocabulary' ? resolve('/app/v/[id]', { id }) : resolve('/app/s/[id]', { id });

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

	function confirmDeleteFolder(event: SubmitEvent, name: string, count: number) {
		const note = count ? '안의 항목은 삭제되지 않고 목록으로 돌아갑니다.' : '';
		if (!window.confirm(`‘${name}’ 폴더를 삭제할까요? ${note}`.trim())) event.preventDefault();
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		closeDrawer();
		moving = null;
	}

	function pageOf(folderId: string, ids: string[]) {
		const max = Math.max(0, Math.ceil(ids.length / PAGE_SIZE) - 1);
		const saved = folderPage[folderId];
		if (saved !== undefined) return Math.min(saved, max);
		const ix = ids.indexOf(page.params.id ?? '');
		return ix < 0 ? 0 : Math.min(Math.floor(ix / PAGE_SIZE), max);
	}

	function turnPage(folderId: string, ids: string[], dir: 1 | -1) {
		const max = Math.max(0, Math.ceil(ids.length / PAGE_SIZE) - 1);
		folderPage[folderId] = Math.min(max, Math.max(0, pageOf(folderId, ids) + dir));
	}

	function armHover(fn: () => void) {
		if (hoverTimer !== null) return;
		hoverTimer = setTimeout(() => {
			hoverTimer = null;
			fn();
		}, 650);
	}

	function clearHover() {
		if (hoverTimer !== null) {
			clearTimeout(hoverTimer);
			hoverTimer = null;
		}
	}

	function submitMove(kind: FolderKind, itemId: string, folderId: string, beforeId: string | null) {
		if (beforeId === itemId) return;
		moveKind = kind;
		moveItemId = itemId;
		moveFolderId = folderId;
		moveBeforeId = beforeId ?? '';
		queueMicrotask(() => moveForm?.requestSubmit());
	}

	function onDragStart(event: DragEvent, kind: FolderKind, folderId: string, item: Item) {
		dragging = { kind, folderId, id: item.id };
		moving = null;
		event.dataTransfer?.setData('text/plain', `${kind}:${item.id}`);
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
	}

	function onDragEnd() {
		dragging = null;
		clearHover();
	}

	function onRowOver(event: DragEvent, kind: FolderKind) {
		if (!dragging || dragging.kind !== kind) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
	}

	function onRowDrop(
		event: DragEvent,
		kind: FolderKind,
		folderId: string,
		beforeId: string | null
	) {
		if (!dragging || dragging.kind !== kind || dragging.folderId !== folderId) return;
		event.preventDefault();
		clearHover();
		submitMove(kind, dragging.id, folderId, beforeId);
		dragging = null;
	}

	function onPagerOver(
		event: DragEvent,
		kind: FolderKind,
		folderId: string,
		ids: string[],
		dir: 1 | -1
	) {
		if (!dragging || dragging.kind !== kind || dragging.folderId !== folderId) return;
		event.preventDefault();
		armHover(() => turnPage(folderId, ids, dir));
	}

	function toggleMove(kind: FolderKind, folderId: string, item: Item) {
		moving = moving?.id === item.id ? null : { kind, folderId, id: item.id };
	}

	const placeEnhance: SubmitFunction =
		() =>
		async ({ update }) => {
			await update();
			moving = null;
			dragging = null;
		};
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

				{#each vocabularyGroup.folders as folder (folder.id)}
					{@const p = pageOf(folder.id, folder.itemIds)}
					{@const maxP = Math.max(0, Math.ceil(folder.itemIds.length / PAGE_SIZE) - 1)}
					{@const shown = folder.items.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE)}
					<div class="sidebar-folder">
						<div class="sidebar-item">
							<button
								class="sidebar-link sidebar-folder-toggle"
								class:is-drop={dragging?.kind === 'vocabulary' && dragging.folderId === folder.id}
								type="button"
								aria-expanded={isOpen(folder.id, folder.itemIds)}
								onclick={() => toggleFolder(folder.id, folder.itemIds)}
							>
								<span class="sidebar-link-index"
									>{isOpen(folder.id, folder.itemIds) ? '▾' : '▸'}</span
								>
								<span class="sidebar-link-copy">
									<span class="sidebar-link-title">{folder.name}</span>
									<span class="sidebar-link-range">{folder.items.length}개</span>
								</span>
							</button>
							<form
								method="post"
								action="/app?/folder"
								onsubmit={(event) => confirmDeleteFolder(event, folder.name, folder.items.length)}
							>
								<input type="hidden" name="kind" value="vocabulary" />
								<input type="hidden" name="folderAction" value="delete" />
								<input type="hidden" name="folderId" value={folder.id} />
								<button
									class="sidebar-delete"
									type="submit"
									aria-label={`${folder.name} 폴더 삭제`}
									title="폴더 삭제">×</button
								>
							</form>
						</div>
						{#if isOpen(folder.id, folder.itemIds)}
							<div class="sidebar-folder-items">
								{#each shown as item (item.id)}
									<div class="sidebar-item is-reorder">
										<a
											class:is-active={isActive(item.id)}
											class:is-drop={moving?.id === item.id || dragging?.id === item.id}
											class="sidebar-link"
											href={itemHref('vocabulary', item.id)}
											ondragover={(event) => onRowOver(event, 'vocabulary')}
											ondrop={(event) => onRowDrop(event, 'vocabulary', folder.id, item.id)}
											onclick={(event) => {
												if (
													!moving ||
													moving.kind !== 'vocabulary' ||
													moving.folderId !== folder.id
												) {
													closeDrawer();
													return;
												}
												event.preventDefault();
												submitMove('vocabulary', moving.id, folder.id, item.id);
												moving = null;
											}}
											aria-current={isActive(item.id) ? 'page' : undefined}
										>
											<span class="sidebar-link-index">·</span>
											<span class="sidebar-link-copy">
												<span class="sidebar-link-title">{item.title}</span>
												{#if item.meta}<span class="sidebar-link-range">{item.meta}</span>{/if}
											</span>
										</a>
										<button
											class="sidebar-move"
											type="button"
											draggable="true"
											title="끌거나 눌러서 순서 이동"
											aria-label={`${item.title} 순서 이동`}
											ondragstart={(event) => onDragStart(event, 'vocabulary', folder.id, item)}
											ondragend={onDragEnd}
											onclick={() => toggleMove('vocabulary', folder.id, item)}>⠿</button
										>
										<form
											method="post"
											action="/app?/deleteVocabulary"
											onsubmit={(event) => confirmDeleteVocabulary(event, item.title)}
										>
											<input type="hidden" name="id" value={item.id} />
											<button
												class="sidebar-delete"
												type="submit"
												aria-label={`${item.title} 단어장 삭제`}
												title="단어장 삭제">×</button
											>
										</form>
									</div>
								{/each}
								{#if !folder.items.length}
									<p class="sidebar-empty">폴더가 비어 있습니다.</p>
								{/if}
								{#if maxP > 0}
									<div class="sidebar-pager">
										<button
											type="button"
											aria-label="이전 목록"
											disabled={p === 0}
											onclick={() => turnPage(folder.id, folder.itemIds, -1)}
											ondragover={(event) =>
												onPagerOver(event, 'vocabulary', folder.id, folder.itemIds, -1)}
											ondragleave={clearHover}
											ondrop={clearHover}>‹</button
										>
										<span>{p + 1} / {maxP + 1}</span>
										<button
											type="button"
											aria-label="다음 목록"
											disabled={p === maxP}
											onclick={() => turnPage(folder.id, folder.itemIds, 1)}
											ondragover={(event) =>
												onPagerOver(event, 'vocabulary', folder.id, folder.itemIds, 1)}
											ondragleave={clearHover}
											ondrop={clearHover}>›</button
										>
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{/each}

				{#if folderDraft === 'vocabulary'}
					<form class="sidebar-folder-create" method="post" action="/app?/folder">
						<input type="hidden" name="kind" value="vocabulary" />
						<input type="hidden" name="folderAction" value="create" />
						<input
							class="sidebar-folder-input"
							name="name"
							maxlength="120"
							placeholder="폴더 이름"
							aria-label="새 단어장 폴더 이름"
							required
							onkeydown={(event) => event.key === 'Escape' && (folderDraft = null)}
						/>
						<button class="sidebar-folder-save" type="submit">저장</button>
						<button
							class="sidebar-folder-cancel"
							type="button"
							aria-label="폴더 추가 취소"
							onclick={() => (folderDraft = null)}>×</button
						>
					</form>
				{:else}
					<button
						class="sidebar-folder-add"
						type="button"
						onclick={() => (folderDraft = 'vocabulary')}>+ 폴더</button
					>
				{/if}

				{#each vocabularyGroup.unfiled as vocabulary (vocabulary.id)}
					<div class="sidebar-item">
						<a
							class:is-active={isActive(vocabulary.id)}
							class="sidebar-link"
							href={itemHref('vocabulary', vocabulary.id)}
							onclick={closeDrawer}
							aria-current={isActive(vocabulary.id) ? 'page' : undefined}
						>
							<span class="sidebar-link-index">·</span>
							<span class="sidebar-link-copy">
								<span class="sidebar-link-title">{vocabulary.title}</span>
								{#if vocabulary.meta}<span class="sidebar-link-range">{vocabulary.meta}</span>{/if}
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
				{#if !vocabularyGroup.unfiled.length && !vocabularyGroup.folders.length}
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

				{#each sentenceGroup.folders as folder (folder.id)}
					{@const p = pageOf(folder.id, folder.itemIds)}
					{@const maxP = Math.max(0, Math.ceil(folder.itemIds.length / PAGE_SIZE) - 1)}
					{@const shown = folder.items.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE)}
					<div class="sidebar-folder">
						<div class="sidebar-item">
							<button
								class="sidebar-link sidebar-folder-toggle"
								class:is-drop={dragging?.kind === 'sentence' && dragging.folderId === folder.id}
								type="button"
								aria-expanded={isOpen(folder.id, folder.itemIds)}
								onclick={() => toggleFolder(folder.id, folder.itemIds)}
							>
								<span class="sidebar-link-index"
									>{isOpen(folder.id, folder.itemIds) ? '▾' : '▸'}</span
								>
								<span class="sidebar-link-copy">
									<span class="sidebar-link-title">{folder.name}</span>
									<span class="sidebar-link-range">{folder.items.length}개</span>
								</span>
							</button>
							<form
								method="post"
								action="/app?/folder"
								onsubmit={(event) => confirmDeleteFolder(event, folder.name, folder.items.length)}
							>
								<input type="hidden" name="kind" value="sentence" />
								<input type="hidden" name="folderAction" value="delete" />
								<input type="hidden" name="folderId" value={folder.id} />
								<button
									class="sidebar-delete"
									type="submit"
									aria-label={`${folder.name} 폴더 삭제`}
									title="폴더 삭제">×</button
								>
							</form>
						</div>
						{#if isOpen(folder.id, folder.itemIds)}
							<div class="sidebar-folder-items">
								{#each shown as item (item.id)}
									<div class="sidebar-item is-reorder">
										<a
											class:is-active={isActive(item.id)}
											class:is-drop={moving?.id === item.id || dragging?.id === item.id}
											class="sidebar-link"
											href={itemHref('sentence', item.id)}
											ondragover={(event) => onRowOver(event, 'sentence')}
											ondrop={(event) => onRowDrop(event, 'sentence', folder.id, item.id)}
											onclick={(event) => {
												if (
													!moving ||
													moving.kind !== 'sentence' ||
													moving.folderId !== folder.id
												) {
													closeDrawer();
													return;
												}
												event.preventDefault();
												submitMove('sentence', moving.id, folder.id, item.id);
												moving = null;
											}}
											aria-current={isActive(item.id) ? 'page' : undefined}
										>
											<span class="sidebar-link-index">·</span>
											<span class="sidebar-link-copy">
												<span class="sidebar-link-title">{item.title}</span>
												{#if item.meta}<span class="sidebar-link-range">{item.meta}</span>{/if}
											</span>
										</a>
										<button
											class="sidebar-move"
											type="button"
											draggable="true"
											title="끌거나 눌러서 순서 이동"
											aria-label={`${item.title} 순서 이동`}
											ondragstart={(event) => onDragStart(event, 'sentence', folder.id, item)}
											ondragend={onDragEnd}
											onclick={() => toggleMove('sentence', folder.id, item)}>⠿</button
										>
										<form
											method="post"
											action="/app?/deleteSentenceBook"
											onsubmit={(event) => confirmDeleteSentenceBook(event, item.title)}
										>
											<input type="hidden" name="id" value={item.id} />
											<button
												class="sidebar-delete"
												type="submit"
												aria-label={`${item.title} 문장 암기장 삭제`}
												title="문장 암기장 삭제">×</button
											>
										</form>
									</div>
								{/each}
								{#if !folder.items.length}
									<p class="sidebar-empty">폴더가 비어 있습니다.</p>
								{/if}
								{#if maxP > 0}
									<div class="sidebar-pager">
										<button
											type="button"
											aria-label="이전 목록"
											disabled={p === 0}
											onclick={() => turnPage(folder.id, folder.itemIds, -1)}
											ondragover={(event) =>
												onPagerOver(event, 'sentence', folder.id, folder.itemIds, -1)}
											ondragleave={clearHover}
											ondrop={clearHover}>‹</button
										>
										<span>{p + 1} / {maxP + 1}</span>
										<button
											type="button"
											aria-label="다음 목록"
											disabled={p === maxP}
											onclick={() => turnPage(folder.id, folder.itemIds, 1)}
											ondragover={(event) =>
												onPagerOver(event, 'sentence', folder.id, folder.itemIds, 1)}
											ondragleave={clearHover}
											ondrop={clearHover}>›</button
										>
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{/each}

				{#if folderDraft === 'sentence'}
					<form class="sidebar-folder-create" method="post" action="/app?/folder">
						<input type="hidden" name="kind" value="sentence" />
						<input type="hidden" name="folderAction" value="create" />
						<input
							class="sidebar-folder-input"
							name="name"
							maxlength="120"
							placeholder="폴더 이름"
							aria-label="새 문장 암기 폴더 이름"
							required
							onkeydown={(event) => event.key === 'Escape' && (folderDraft = null)}
						/>
						<button class="sidebar-folder-save" type="submit">저장</button>
						<button
							class="sidebar-folder-cancel"
							type="button"
							aria-label="폴더 추가 취소"
							onclick={() => (folderDraft = null)}>×</button
						>
					</form>
				{:else}
					<button
						class="sidebar-folder-add"
						type="button"
						onclick={() => (folderDraft = 'sentence')}>+ 폴더</button
					>
				{/if}

				{#each sentenceGroup.unfiled as book (book.id)}
					<div class="sidebar-item">
						<a
							class:is-active={isActive(book.id)}
							class="sidebar-link"
							href={itemHref('sentence', book.id)}
							onclick={closeDrawer}
							aria-current={isActive(book.id) ? 'page' : undefined}
						>
							<span class="sidebar-link-index">·</span>
							<span class="sidebar-link-copy">
								<span class="sidebar-link-title">{book.title}</span>
								{#if book.meta}<span class="sidebar-link-range">{book.meta}</span>{/if}
							</span>
						</a>
						<form
							method="post"
							action="/app?/deleteSentenceBook"
							onsubmit={(event) => confirmDeleteSentenceBook(event, book.title)}
						>
							<input type="hidden" name="id" value={book.id} />
							<button
								class="sidebar-delete"
								type="submit"
								aria-label={`${book.title} 문장 암기장 삭제`}
								title="문장 암기장 삭제">×</button
							>
						</form>
					</div>
				{/each}
				{#if !sentenceGroup.unfiled.length && !sentenceGroup.folders.length}
					<p class="sidebar-empty">아직 문장 암기장이 없습니다.<br />+ 버튼으로 추가하세요.</p>
				{/if}
			</nav>

			<form
				bind:this={moveForm}
				class="visually-hidden"
				method="post"
				action="/app?/moveItem"
				use:enhance={placeEnhance}
				aria-hidden="true"
				tabindex="-1"
			>
				<input type="hidden" name="kind" bind:value={moveKind} />
				<input type="hidden" name="itemId" bind:value={moveItemId} />
				<input type="hidden" name="folderId" bind:value={moveFolderId} />
				<input type="hidden" name="beforeId" bind:value={moveBeforeId} />
			</form>
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
