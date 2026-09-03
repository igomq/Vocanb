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

	const folderOf = (itemId: string) =>
		folders.find((folder) => folder.itemIds.includes(itemId))?.id ?? '';

	const inFolder = (itemId: string) => folderOf(itemId) !== '';

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
						{#each items as item (item.id)}
							<li class="folder-item">
								<a class="folder-item-title folder-item-link" href={itemHref(item.id)}
									>{item.title}</a
								>
								{#if item.meta}<span class="folder-item-meta">{item.meta}</span>{/if}
								{#if folderOf(item.id) === folder.id}
									<form class="folder-item-form" method="post" action="/app?/folder" use:enhance>
										<input type="hidden" name="kind" value={kind} />
										<input type="hidden" name="folderAction" value="setItem" />
										<input type="hidden" name="itemId" value={item.id} />
										<input type="hidden" name="folderId" value="" />
										<button class="button button-secondary" type="submit">이 폴더에서 빼기</button>
									</form>
								{:else}
									<form class="folder-item-form" method="post" action="/app?/folder" use:enhance>
										<input type="hidden" name="kind" value={kind} />
										<input type="hidden" name="folderAction" value="setItem" />
										<input type="hidden" name="itemId" value={item.id} />
										<input type="hidden" name="folderId" value={folder.id} />
										<button class="button button-secondary" type="submit">이 폴더에 넣기</button>
									</form>
								{/if}
							</li>
						{/each}
					</ul>
				</li>
			{/each}
		</ul>
	{/if}

	{#if items.some((item) => inFolder(item.id))}
		<form class="folder-detach-form" method="post" action="/app?/folder" use:enhance>
			<input type="hidden" name="kind" value={kind} />
			<input type="hidden" name="folderAction" value="setItem" />
			<input type="hidden" name="folderId" value="" />
			<select name="itemId" aria-label={`폴더에서 꺼낼 ${labels.item}`} required>
				{#each items.filter((item) => inFolder(item.id)) as item (item.id)}
					<option value={item.id}>{item.title}</option>
				{/each}
			</select>
			<button class="button button-quiet" type="submit">폴더에서 꺼내기</button>
		</form>
	{/if}
</section>
