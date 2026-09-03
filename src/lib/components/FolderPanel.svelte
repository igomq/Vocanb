<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { FolderKind } from '$lib/folders';

	type Folder = { id: string; name: string; itemIds: string[] };
	type Item = { id: string; title: string; meta: string };

	let {
		kind,
		folders,
		items,
		labels
	}: {
		kind: FolderKind;
		folders: Folder[];
		items: Item[];
		labels: { heading: string; item: string; empty: string };
	} = $props();

	let newName = $state('');
	let renaming = $state<{ id: string; name: string } | null>(null);
	const PAGE = 5;
	let pageBy = $state<Record<string, number>>({});

	const pageOf = (id: string, total: number) =>
		Math.min(pageBy[id] ?? 0, Math.max(0, Math.ceil(total / PAGE) - 1));

	function turn(id: string, total: number, dir: 1 | -1) {
		const max = Math.max(0, Math.ceil(total / PAGE) - 1);
		pageBy[id] = Math.min(max, Math.max(0, pageOf(id, total) + dir));
	}

	const unfiledItems = $derived(
		items.filter((item) => !folders.some((folder) => folder.itemIds.includes(item.id)))
	);

	const itemHref = (id: string) =>
		kind === 'vocabulary' ? resolve('/app/v/[id]', { id }) : resolve('/app/s/[id]', { id });
</script>

<section class="folder-panel" aria-labelledby={`folder-heading-${kind}`}>
	<div class="folder-panel-head">
		<h2 id={`folder-heading-${kind}`}>{labels.heading}</h2>
		<p class="folder-panel-note">
			폴더에 넣은 {labels.item}은 사이드바의 폴더 안에서만 보입니다.
		</p>
	</div>

	<form class="folder-create" method="post" action="/app?/folder" use:enhance>
		<input type="hidden" name="kind" value={kind} />
		<input type="hidden" name="folderAction" value="create" />
		<input
			name="name"
			maxlength="120"
			placeholder="새 폴더 이름"
			aria-label={`새 ${labels.heading} 폴더 이름`}
			bind:value={newName}
			required
		/>
		<button class="button button-secondary" type="submit">폴더 만들기</button>
	</form>

	{#if !folders.length}
		<p class="folder-empty">{labels.empty}</p>
	{:else}
		<ul class="folder-list">
			{#each folders as folder (folder.id)}
				{@const members = items.filter((item) => folder.itemIds.includes(item.id))}
				{@const total = Math.max(1, Math.ceil(members.length / PAGE))}
				{@const pg = pageOf(folder.id, members.length)}
				<li class="folder-row">
					<div class="folder-row-head">
						{#if renaming?.id === folder.id}
							<form
								class="folder-rename"
								method="post"
								action="/app?/folder"
								use:enhance={() =>
									async ({ update }) => {
										await update();
										renaming = null;
									}}
							>
								<input type="hidden" name="kind" value={kind} />
								<input type="hidden" name="folderAction" value="rename" />
								<input type="hidden" name="folderId" value={folder.id} />
								<input
									name="name"
									maxlength="120"
									aria-label={`${folder.name} 폴더 이름 수정`}
									value={folder.name}
									required
								/>
								<button class="button button-secondary" type="submit">저장</button>
								<button class="button button-quiet" type="button" onclick={() => (renaming = null)}
									>취소</button
								>
							</form>
						{:else}
							<h3 class="folder-name">{folder.name}</h3>
							<span class="folder-count">{folder.itemIds.length}개</span>
							<div class="folder-row-actions">
								<button
									class="button button-quiet"
									type="button"
									onclick={() => (renaming = { id: folder.id, name: folder.name })}
									>이름 수정</button
								>
								<form method="post" action="/app?/folder">
									<input type="hidden" name="kind" value={kind} />
									<input type="hidden" name="folderAction" value="delete" />
									<input type="hidden" name="folderId" value={folder.id} />
									<button class="button button-quiet" type="submit">폴더 삭제</button>
								</form>
							</div>
						{/if}
					</div>

					<ul class="folder-items">
						{#each members.slice(pg * PAGE, pg * PAGE + PAGE) as item (item.id)}
							<li class="folder-item">
								<a class="folder-item-title folder-item-link" href={itemHref(item.id)}
									>{item.title}</a
								>
								{#if item.meta}<span class="folder-item-meta">{item.meta}</span>{/if}
								<form class="folder-item-form" method="post" action="/app?/folder" use:enhance>
									<input type="hidden" name="kind" value={kind} />
									<input type="hidden" name="folderAction" value="setItem" />
									<input type="hidden" name="itemId" value={item.id} />
									<input type="hidden" name="folderId" value="" />
									<button class="button button-secondary" type="submit">이 폴더에서 빼기</button>
								</form>
							</li>
						{:else}
							<li class="folder-item-empty">아직 이 폴더에 든 {labels.item}이 없습니다.</li>
						{/each}
					</ul>
					{#if total > 1}
						<div class="folder-pager">
							<button
								type="button"
								aria-label="이전 목록"
								disabled={pg === 0}
								onclick={() => turn(folder.id, members.length, -1)}>‹</button
							>
							<span>{pg + 1} / {total}</span>
							<button
								type="button"
								aria-label="다음 목록"
								disabled={pg === total - 1}
								onclick={() => turn(folder.id, members.length, 1)}>›</button
							>
						</div>
					{/if}
					{#if items.some((item) => !folder.itemIds.includes(item.id))}
						<form class="folder-add-form" method="post" action="/app?/folder" use:enhance>
							<input type="hidden" name="kind" value={kind} />
							<input type="hidden" name="folderAction" value="setItem" />
							<input type="hidden" name="folderId" value={folder.id} />
							<select
								name="itemId"
								aria-label={`${folder.name} 폴더에 넣을 ${labels.item}`}
								required
							>
								{#each items.filter((item) => !folder.itemIds.includes(item.id)) as item (item.id)}
									<option value={item.id}>{item.title}</option>
								{/each}
							</select>
							<button class="button button-secondary" type="submit">이 폴더에 넣기</button>
						</form>
					{/if}
				</li>
			{/each}
		</ul>

		{#if unfiledItems.length}
			{@const uKey = `unfiled:${kind}`}
			{@const uTotal = Math.max(1, Math.ceil(unfiledItems.length / PAGE))}
			{@const uPg = pageOf(uKey, unfiledItems.length)}
			<div class="folder-row folder-unfiled">
				<div class="folder-row-head">
					<h3 class="folder-name">미분류</h3>
					<span class="folder-count">{unfiledItems.length}개</span>
				</div>
				<ul class="folder-items">
					{#each unfiledItems.slice(uPg * PAGE, uPg * PAGE + PAGE) as item (item.id)}
						<li class="folder-item">
							<a class="folder-item-title folder-item-link" href={itemHref(item.id)}>{item.title}</a
							>
							{#if item.meta}<span class="folder-item-meta">{item.meta}</span>{/if}
						</li>
					{/each}
				</ul>
				{#if uTotal > 1}
					<div class="folder-pager">
						<button
							type="button"
							aria-label="이전 목록"
							disabled={uPg === 0}
							onclick={() => turn(uKey, unfiledItems.length, -1)}>‹</button
						>
						<span>{uPg + 1} / {uTotal}</span>
						<button
							type="button"
							aria-label="다음 목록"
							disabled={uPg === uTotal - 1}
							onclick={() => turn(uKey, unfiledItems.length, 1)}>›</button
						>
					</div>
				{/if}
			</div>
		{/if}
	{/if}
</section>
