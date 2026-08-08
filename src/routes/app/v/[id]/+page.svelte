<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { type ResultStatus, type Word } from '$lib/domain';
	import { SvelteSet } from 'svelte/reactivity';

	let { data, form } = $props();
	let filter = $state<'all' | ResultStatus>('all');
	let testAll = $state(true);
	let testDialog: HTMLDialogElement | undefined = $state();
	let editDialog: HTMLDialogElement | undefined = $state();
	let leaveDialog: HTMLDialogElement | undefined = $state();
	let uploadDialog: HTMLDialogElement | undefined = $state();
	let uploadForm: HTMLFormElement | undefined = $state();
	let photoInput: HTMLInputElement | undefined = $state();
	let editingWord = $state<Word | null>(null);
	let editEnglish = $state('');
	let editMeaning = $state('');
	let uploadPending = $state(false);
	let uploadFileCount = $state(0);
	let startPending = $state(false);
	let editPending = $state(false);
	let deletePending = $state(false);
	let bulkDeletePending = $state(false);
	let selectionMode = $state(false);
	let selectedWordIds = new SvelteSet<string>();

	$effect(() => {
		if (editingWord && editDialog && !editDialog.open) editDialog.showModal();
	});

	let filteredWords = $derived(
		filter === 'all'
			? data.vocabulary.words
			: data.vocabulary.words.filter((word) => data.latestResult?.results[word.id] === filter)
	);

	function statusFor(wordId: string): ResultStatus | undefined {
		return data.latestResult?.results[wordId] as ResultStatus | undefined;
	}

	function statusLabel(status: ResultStatus) {
		return { correct: '맞음', wrong: '틀림', unknown: '아예 몰랐음', ambiguous: '애매함' }[status];
	}

	function closeLeaveDialog() {
		if (leaveDialog?.open) leaveDialog.close();
	}

	function openTestSettings() {
		if (data.vocabulary.words.length && testDialog) testDialog.showModal();
	}

	function closeTestSettings() {
		if (testDialog?.open) testDialog.close();
	}

	function openPhotoPicker() {
		photoInput?.click();
	}

	function submitPhotoUpload() {
		if (photoInput?.files?.length) uploadForm?.requestSubmit();
	}

	function warnBeforeUnload(event: BeforeUnloadEvent) {
		if (!uploadPending) return;
		event.preventDefault();
		event.returnValue = '';
	}

	const enhanceUpload: SubmitFunction = ({ formData }) => {
		uploadPending = true;
		uploadFileCount = formData.getAll('images').length;
		uploadDialog?.showModal();
		return async ({ update }) => {
			try {
				await update();
			} finally {
				uploadPending = false;
				if (uploadDialog?.open) uploadDialog.close();
				if (photoInput) photoInput.value = '';
			}
		};
	};

	const enhanceStartTest: SubmitFunction = () => {
		startPending = true;
		return async ({ update }) => {
			await update();
			startPending = false;
		};
	};

	function openWordEdit(word: Word) {
		editingWord = word;
		editEnglish = word.english;
		editMeaning = word.meaning;
	}

	function closeWordEdit() {
		if (editDialog?.open) editDialog.close();
		editingWord = null;
	}

	const enhanceEditWord: SubmitFunction = () => {
		editPending = true;
		return async ({ update, result }) => {
			await update();
			editPending = false;
			if (result.type === 'success') closeWordEdit();
		};
	};

	const enhanceDeleteWord: SubmitFunction = () => {
		deletePending = true;
		return async ({ update, result }) => {
			await update();
			deletePending = false;
			if (result.type === 'success') closeWordEdit();
		};
	};

	const enhanceDeleteWords: SubmitFunction = () => {
		bulkDeletePending = true;
		return async ({ update, result }) => {
			await update();
			bulkDeletePending = false;
			if (result.type === 'success') closeSelection();
		};
	};

	function closeSelection() {
		selectionMode = false;
		selectedWordIds.clear();
	}

	function toggleWordSelection(event: Event, wordId: string) {
		if ((event.currentTarget as HTMLInputElement).checked) selectedWordIds.add(wordId);
		else selectedWordIds.delete(wordId);
	}

	function toggleAllFiltered() {
		const allSelected = filteredWords.every((word) => selectedWordIds.has(word.id));
		for (const word of filteredWords) {
			if (allSelected) selectedWordIds.delete(word.id);
			else selectedWordIds.add(word.id);
		}
	}

	function confirmDeleteWords(event: SubmitEvent) {
		if (!window.confirm(`선택한 ${selectedWordIds.size}개 단어를 삭제할까요?`))
			event.preventDefault();
	}

	function confirmDelete(event: SubmitEvent) {
		if (!window.confirm('이 단어를 삭제할까요?')) event.preventDefault();
	}

	function imageError(event: Event) {
		const image = event.currentTarget as HTMLImageElement;
		image.hidden = true;
		(image.nextElementSibling as HTMLElement | null)?.removeAttribute('hidden');
	}
</script>

<svelte:window onbeforeunload={warnBeforeUnload} />

<svelte:head>
	<title>{data.vocabulary.title} · Vocanb</title>
</svelte:head>

<div class="content-wrap">
	<header class="page-header vocabulary-heading">
		<div>
			<p class="eyebrow">단어장</p>
			<h1>{data.vocabulary.title}</h1>
			<p class="page-description">
				{#if data.vocabulary.rangeLabel}{data.vocabulary.rangeLabel} ·
				{/if}{data.vocabulary.words.length}개 단어
			</p>
		</div>
		<div class="button-row">
			<button
				class="button button-primary"
				type="button"
				disabled={!data.vocabulary.words.length}
				aria-describedby={!data.vocabulary.words.length ? 'no-words-help' : undefined}
				onclick={openTestSettings}
			>
				테스트
			</button>
			{#if !data.vocabulary.words.length}<span id="no-words-help" class="visually-hidden"
					>단어를 먼저 추가해 주세요.</span
				>{/if}
		</div>
	</header>

	{#if form?.message}
		<p
			class:message-status={form?.success}
			class:message-error={!form?.success}
			class="message"
			role={form?.success ? 'status' : 'alert'}
			aria-live="polite"
		>
			{form.message}
		</p>
	{/if}

	<div class:selection-mode={selectionMode} class="word-toolbar">
		<div class="word-toolbar-left">
			<button
				class="title-link"
				type="button"
				title="학습 종료"
				onclick={() => leaveDialog?.showModal()}>{data.vocabulary.title}</button
			>
			<span class="toolbar-meta">{data.vocabulary.words.length}개</span>
		</div>
		<div class="word-toolbar-right">
			{#if selectionMode}
				<button class="button button-quiet" type="button" onclick={toggleAllFiltered}
					>전체 선택</button
				>
				<button
					class="button button-danger"
					type="submit"
					form="bulk-delete-form"
					disabled={!selectedWordIds.size || bulkDeletePending}
					>{bulkDeletePending ? '삭제 중…' : `삭제 ${selectedWordIds.size}`}</button
				>
				<button class="button button-secondary" type="button" onclick={closeSelection}>취소</button>
			{:else}
				<form
					bind:this={uploadForm}
					method="post"
					action="?/upload"
					enctype="multipart/form-data"
					use:enhance={enhanceUpload}
				>
					<input
						bind:this={photoInput}
						class="visually-hidden"
						id="photo-upload"
						name="images"
						type="file"
						accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
						multiple
						onchange={submitPhotoUpload}
					/>
					<button
						class="icon-button"
						type="button"
						aria-label="단어 사진 추가"
						title="단어 사진 추가"
						onclick={openPhotoPicker}
						disabled={uploadPending}
					>
						{uploadPending ? '…' : '＋'}
					</button>
				</form>
				<button
					class="button button-secondary"
					type="button"
					disabled={!data.vocabulary.words.length}
					title="단어 일괄 삭제"
					onclick={() => (selectionMode = true)}>선택</button
				>
				<button
					class="button button-secondary"
					type="button"
					disabled={!data.vocabulary.words.length}
					onclick={openTestSettings}>테스트</button
				>
			{/if}
		</div>
	</div>

	{#if data.latestResult}
		<section class="result-strip" aria-label="최근 테스트 결과">
			<p class="result-summary">
				맞음 {data.latestResult.summary.correct} · 테스트 {data.latestResult.summary.tested} · 전체 {data
					.latestResult.summary.total}
			</p>
			<label>
				<span class="visually-hidden">최근 결과 필터</span>
				<select class="filter-select" bind:value={filter} disabled={selectionMode}>
					<option value="all">전체 단어</option>
					<option value="correct">맞은 단어</option>
					<option value="wrong">틀린 단어</option>
					<option value="unknown">모르는 단어</option>
					<option value="ambiguous">헷갈린 단어</option>
				</select>
			</label>
		</section>
	{/if}

	{#if data.vocabulary.images.length}
		<details>
			<summary class="field-note">올린 사진 {data.vocabulary.images.length}장</summary>
			<div class="image-strip" aria-label="추가한 단어 사진">
				{#each data.vocabulary.images as image (image.id)}
					<div class="image-thumb">
						<img
							src={`/app/v/${data.vocabulary.id}/images/${image.id}`}
							alt=""
							onerror={imageError}
						/>
						<span class="broken-thumb" hidden aria-label="이미지를 불러오지 못했습니다.">!</span>
					</div>
				{/each}
			</div>
		</details>
	{/if}

	{#if filteredWords.length}
		<form
			id="bulk-delete-form"
			method="post"
			action="?/deleteWords"
			use:enhance={enhanceDeleteWords}
			onsubmit={confirmDeleteWords}
		>
			<section class:word-list-selecting={selectionMode} class="word-list" aria-label="단어 목록">
				{#each filteredWords as word (word.id)}
					{@const status = statusFor(word.id)}
					<div class="word-row">
						{#if selectionMode}<label class="word-select" aria-label={`${word.english} 선택`}>
								<input
									type="checkbox"
									name="wordIds"
									value={word.id}
									checked={selectedWordIds.has(word.id)}
									onchange={(event) => toggleWordSelection(event, word.id)}
								/>
							</label>{/if}
						<span class="word-number">{word.number}</span>
						<div class="word-cell-content">
							<span class="word-english">{word.english}</span>
							{#if word.uncertain}<span class="word-status status-ambiguous">확인 필요</span>{/if}
							{#if status}<span
									class={`word-status status-${status}`}
									title={`최근 결과: ${statusLabel(status)}`}>{statusLabel(status)}</span
								>{/if}
						</div>
						<span class="word-meaning"
							>{#if word.partOfSpeech}<span class="part-of-speech">{word.partOfSpeech}</span
								>{/if}{word.meaning}</span
						>
						<button
							class="word-edit"
							type="button"
							disabled={selectionMode}
							onclick={() => openWordEdit(word)}
							aria-label={`${word.english} 단어 편집`}>편집</button
						>
					</div>
				{/each}
			</section>
		</form>
	{:else}
		<section class="empty-state" aria-labelledby="words-empty-title">
			<div class="empty-state-mark" aria-hidden="true">＋</div>
			<h2 id="words-empty-title">아직 단어가 없어요</h2>
			<p>
				{filter === 'all'
					? '단어 사진을 추가하면 단어를 자동으로 읽어 정리합니다.'
					: '이 필터에 해당하는 단어가 없습니다.'}
			</p>
			{#if filter === 'all'}<button
					class="button button-primary"
					type="button"
					onclick={openPhotoPicker}>사진 추가하기</button
				>{/if}
		</section>
	{/if}
</div>

<dialog
	bind:this={uploadDialog}
	class="modal"
	aria-labelledby="ocr-progress-title"
	aria-describedby="ocr-progress-description"
	oncancel={(event) => event.preventDefault()}
>
	<div class="modal-body ocr-modal-body">
		<h2 id="ocr-progress-title">OCR 진행 중</h2>
		<p id="ocr-progress-description">
			{uploadFileCount}장의 사진에서 단어를 읽고 있어요. 잠시만 기다려 주세요.
		</p>
		<progress class="ocr-progress" aria-label="OCR 처리 중"></progress>
		<p class="ocr-warning">새로고침하거나 창을 닫지 마세요. 분석 결과가 저장되지 않을 수 있어요.</p>
	</div>
</dialog>

<dialog bind:this={testDialog} class="modal" aria-labelledby="test-settings-title">
	<div class="modal-body">
		<div class="modal-header">
			<div>
				<h2 id="test-settings-title">테스트 설정</h2>
				<p>오늘 확인할 범위와 순서를 정해 보세요.</p>
			</div>
			<button
				class="modal-close"
				type="button"
				aria-label="닫기"
				title="닫기"
				onclick={closeTestSettings}>×</button
			>
		</div>

		<form method="post" action="?/startTest" use:enhance={enhanceStartTest} class="form-stack">
			<fieldset class="choice-group">
				<legend>범위</legend>
				<label class="choice"
					><input type="checkbox" name="all" bind:checked={testAll} /> 전체 단어</label
				>
				<div class="choice-options">
					<div class="field">
						<label for="test-start">시작 번호</label>
						<input
							id="test-start"
							name="start"
							type="number"
							min={data.vocabulary.words[0]?.number ?? 1}
							max={data.vocabulary.words.at(-1)?.number ?? 1}
							value={data.vocabulary.words[0]?.number ?? 1}
							disabled={testAll}
						/>
					</div>
					<div class="field">
						<label for="test-end">끝 번호</label>
						<input
							id="test-end"
							name="end"
							type="number"
							min={data.vocabulary.words[0]?.number ?? 1}
							max={data.vocabulary.words.at(-1)?.number ?? 1}
							value={data.vocabulary.words.at(-1)?.number ?? 1}
							disabled={testAll}
						/>
					</div>
				</div>
			</fieldset>

			<fieldset class="choice-group">
				<legend>순서</legend>
				<div class="choice-options">
					<label class="choice"
						><input type="radio" name="order" value="sequential" checked /> 순서대로</label
					>
					<label class="choice"><input type="radio" name="order" value="random" /> 섞어서</label>
				</div>
			</fieldset>

			<fieldset class="choice-group">
				<legend>출제 방향</legend>
				<div class="choice-options">
					<label class="choice"
						><input type="radio" name="direction" value="english-to-korean" checked /> 영어 → 한국어</label
					>
					<label class="choice"
						><input type="radio" name="direction" value="korean-to-english" /> 한국어 → 영어</label
					>
				</div>
			</fieldset>

			{#if form?.action === 'startTest' && form.message}<p
					class="message message-error"
					role="alert"
					aria-live="assertive"
				>
					{form.message}
				</p>{/if}
			<div class="modal-actions">
				<button class="button button-secondary" type="button" onclick={closeTestSettings}
					>취소</button
				>
				<button class="button button-primary" type="submit" disabled={startPending}
					>{startPending ? '준비 중…' : '테스트 시작'}</button
				>
			</div>
		</form>
	</div>
</dialog>

{#if editingWord}
	<dialog bind:this={editDialog} class="modal" aria-labelledby="edit-word-title">
		<div class="modal-body">
			<div class="modal-header">
				<div>
					<h2 id="edit-word-title">단어 편집</h2>
					<p>자동으로 읽은 내용을 바로잡을 수 있어요.</p>
				</div>
				<button
					class="modal-close"
					type="button"
					aria-label="닫기"
					title="닫기"
					onclick={closeWordEdit}>×</button
				>
			</div>

			<form
				id="edit-word-form"
				method="post"
				action="?/updateWord"
				use:enhance={enhanceEditWord}
				class="form-stack"
			>
				<input type="hidden" name="wordId" value={editingWord.id} />
				<div class="field">
					<label for="edit-english">영어</label><input
						id="edit-english"
						name="english"
						maxlength="300"
						bind:value={editEnglish}
						required
					/>
				</div>
				<div class="field">
					<label for="edit-meaning">뜻</label><input
						id="edit-meaning"
						name="meaning"
						maxlength="1000"
						bind:value={editMeaning}
						required
					/>
				</div>
				{#if form?.action === 'updateWord' && form.message}<p
						class="message message-error"
						role="alert"
						aria-live="assertive"
					>
						{form.message}
					</p>{/if}
			</form>
			<div class="modal-actions">
				<form
					method="post"
					action="?/deleteWord"
					use:enhance={enhanceDeleteWord}
					onsubmit={confirmDelete}
				>
					<input type="hidden" name="wordId" value={editingWord.id} />
					<button class="button button-danger" type="submit" disabled={deletePending}
						>{deletePending ? '삭제 중…' : '삭제'}</button
					>
				</form>
				<button class="button button-secondary" type="button" onclick={closeWordEdit}>취소</button>
				<button
					class="button button-primary"
					type="submit"
					form="edit-word-form"
					disabled={editPending}>{editPending ? '저장 중…' : '저장'}</button
				>
			</div>
		</div>
	</dialog>
{/if}

<dialog bind:this={leaveDialog} class="modal" aria-labelledby="leave-vocabulary-title">
	<div class="modal-body">
		<div class="modal-header">
			<div>
				<h2 id="leave-vocabulary-title">학습을 종료할까?</h2>
				<p>단어장은 그대로 저장되고 메인 화면으로 이동합니다.</p>
			</div>
			<button
				class="modal-close"
				type="button"
				aria-label="닫기"
				title="닫기"
				onclick={closeLeaveDialog}>×</button
			>
		</div>
		<div class="modal-actions">
			<button class="button button-secondary" type="button" onclick={closeLeaveDialog}
				>계속 학습</button
			>
			<a class="button button-primary" href={resolve('/app')}>학습 종료</a>
		</div>
	</div>
</dialog>
