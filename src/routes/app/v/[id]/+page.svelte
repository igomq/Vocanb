<script lang="ts">
	import { enhance } from '$app/forms';
	import { beforeNavigate } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { SubmitFunction } from '@sveltejs/kit';
	import {
		needsPronunciationGuideRefresh,
		type Pronunciation,
		type ResultStatus,
		type Word
	} from '$lib/domain';
	import { tick } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';

	const MAX_UPLOAD_REQUEST_BYTES = 90 * 1024 * 1024;
	const TARGET_IMAGE_BYTES = 4 * 1024 * 1024;

	function jpegBlob(canvas: HTMLCanvasElement, quality: number) {
		return new Promise<Blob>((resolve, reject) =>
			canvas.toBlob(
				(blob) => (blob ? resolve(blob) : reject(new Error('이미지를 압축할 수 없습니다.'))),
				'image/jpeg',
				quality
			)
		);
	}

	async function prepareUploadFile(file: File) {
		let bitmap: ImageBitmap | undefined;
		try {
			bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
			const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
			let width = Math.max(1, Math.round(bitmap.width * scale));
			let height = Math.max(1, Math.round(bitmap.height * scale));
			const canvas = document.createElement('canvas');
			const context = canvas.getContext('2d');
			if (!context) throw new Error('이미지를 압축할 수 없습니다.');
			let blob: Blob | undefined;
			for (let attempt = 0; attempt < 6; attempt += 1) {
				canvas.width = width;
				canvas.height = height;
				context.drawImage(bitmap, 0, 0, width, height);
				blob = await jpegBlob(canvas, 0.82);
				if (blob.size <= TARGET_IMAGE_BYTES || Math.max(width, height) <= 1200) break;
				width = Math.max(1, Math.round(width * 0.8));
				height = Math.max(1, Math.round(height * 0.8));
			}
			if (!blob) return file;
			if (blob.size >= file.size) return file;
			return new File([blob], file.name.replace(/\.[^.]+$/u, '') + '.jpg', {
				type: 'image/jpeg',
				lastModified: file.lastModified
			});
		} catch {
			return file;
		} finally {
			bitmap?.close();
		}
	}

	let { data, form } = $props();
	let filterAll = $state(true);
	let selectedStatuses = new SvelteSet<ResultStatus>();
	let testAll = $state(true);
	let testDialog: HTMLDialogElement | undefined = $state();
	let wordDialog: HTMLDialogElement | undefined = $state();
	let leaveDialog: HTMLDialogElement | undefined = $state();
	let uploadSettingsDialog: HTMLDialogElement | undefined = $state();
	let uploadDialog: HTMLDialogElement | undefined = $state();
	let photoInput: HTMLInputElement | undefined = $state();
	let uploadFiles = $state<File[]>([]);
	let uploadMode = $state<'all' | 'targets'>('all');
	let uploadTargets = $state<(number | undefined)[]>([]);
	let editingWord = $state<Word | null>(null);
	let editEnglish = $state('');
	let editMeaning = $state('');
	let editPartOfSpeech = $state('');
	let uploadPending = $state(false);
	let uploadError = $state('');
	let uploadFileCount = $state(0);
	let uploadStatus = $state('');
	let uploadProgress = $state<number | undefined>();
	let uploadProgressMax = $state(1);
	let startPending = $state(false);
	let testStart = $state(1);
	let testEnd = $state(1);
	let editPending = $state(false);
	let deletePending = $state(false);
	let bulkDeletePending = $state(false);
	let selectionMode = $state(false);
	let selectedWordIds = new SvelteSet<string>();
	let pronunciationByWordKey = $state<Record<string, Pronunciation | null>>({});
	let revealedPronunciation = $state<string | null>(null);
	let studySettingsDialog: HTMLDialogElement | undefined = $state();
	let studyActive = $state(false);
	let studyAll = $state(true);
	let studyStart = $state(1);
	let studyEnd = $state(1);
	let studyMode = $state<'card' | 'list'>('card');
	let studyIndex = $state(0);
	let studyError = $state('');
	const studyPageSize = 5;

	const statusOptions: { value: ResultStatus; label: string }[] = [
		{ value: 'correct', label: '맞은 단어' },
		{ value: 'wrong', label: '틀린 단어' },
		{ value: 'unknown', label: '모르는 단어' },
		{ value: 'ambiguous', label: '헷갈린 단어' }
	];

	let filteredWords = $derived(
		filterAll
			? data.vocabulary.words
			: data.vocabulary.words.filter((word) => {
					const status = statusFor(word.id);
					return status !== undefined && selectedStatuses.has(status);
				})
	);
	let filterSummary = $derived(
		filterAll
			? '전체 단어'
			: selectedStatuses.size
				? statusOptions
						.filter(({ value }) => selectedStatuses.has(value))
						.map(({ label }) => label.replace(' 단어', ''))
						.join(' · ')
				: '결과 선택 없음'
	);
	let studyWords = $derived(
		data.vocabulary.words.filter(
			(word) => studyAll || (word.number >= studyStart && word.number <= studyEnd)
		)
	);
	let studyPage = $derived(Math.floor(studyIndex / studyPageSize));
	let studyPageWords = $derived(
		studyWords.slice(studyPage * studyPageSize, studyPage * studyPageSize + studyPageSize)
	);
	let studyPageCount = $derived(Math.max(1, Math.ceil(studyWords.length / studyPageSize)));
	let studyCurrentWord = $derived(studyWords[studyIndex]);
	let studyHasPrevious = $derived(studyIndex > 0);
	let studyHasNext = $derived(
		studyMode === 'card'
			? studyIndex < studyWords.length - 1
			: studyIndex + studyPageSize < studyWords.length
	);
	let pronunciationRequestKey = $derived(
		JSON.stringify(
			data.vocabulary.words
				.filter((word) => needsPronunciationGuideRefresh(word.pronunciation))
				.map((word) => [word.id, word.english])
		)
	);
	let pronunciationRequestWordIds = $derived(
		data.vocabulary.words
			.filter((word) => needsPronunciationGuideRefresh(word.pronunciation))
			.map((word) => word.id)
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

	function openTestSettings(range?: { start: number; end: number }) {
		if (!data.vocabulary.words.length || !testDialog) return;
		const first = data.vocabulary.words[0].number;
		const last = data.vocabulary.words.at(-1)!.number;
		testStart = range?.start ?? first;
		testEnd = range?.end ?? last;
		testAll = !range;
		testDialog.showModal();
	}

	function closeTestSettings() {
		if (testDialog?.open) testDialog.close();
	}

	function openStudySettings() {
		if (!data.vocabulary.words.length || !studySettingsDialog) return;
		studyStart = data.vocabulary.words[0].number;
		studyEnd = data.vocabulary.words.at(-1)!.number;
		studyAll = true;
		studyMode = 'card';
		studyError = '';
		studySettingsDialog.showModal();
	}

	function closeStudySettings() {
		if (studySettingsDialog?.open) studySettingsDialog.close();
	}

	function startStudy(event: SubmitEvent) {
		event.preventDefault();
		const first = data.vocabulary.words[0]?.number ?? 1;
		const last = data.vocabulary.words.at(-1)?.number ?? 1;
		const start = studyAll ? first : Number(studyStart);
		const end = studyAll ? last : Number(studyEnd);
		if (
			!Number.isInteger(start) ||
			!Number.isInteger(end) ||
			start < first ||
			end > last ||
			start > end
		) {
			studyError = `범위는 ${first}~${last} 안에서 선택해 주세요.`;
			return;
		}
		studyStart = start;
		studyEnd = end;
		studyIndex = 0;
		studyError = '';
		closePronunciation();
		studyActive = true;
		closeStudySettings();
	}

	function exitStudy() {
		closePronunciation();
		studyActive = false;
		studyIndex = 0;
	}

	function previousStudy() {
		closePronunciation();
		studyIndex = Math.max(0, studyIndex - (studyMode === 'card' ? 1 : studyPageSize));
	}

	function nextStudy() {
		closePronunciation();
		studyIndex = Math.min(
			Math.max(0, studyWords.length - 1),
			studyIndex + (studyMode === 'card' ? 1 : studyPageSize)
		);
	}

	async function testStudyRange() {
		if (!studyActive || !studyWords.length) return;
		const range = studyAll ? undefined : { start: studyStart, end: studyEnd };
		studyActive = false;
		await tick();
		openTestSettings(range);
	}

	function pronunciationKey(word: Pick<Word, 'id' | 'english'>) {
		return JSON.stringify([word.id, word.english]);
	}

	function pronunciationFor(word: Word) {
		const key = pronunciationKey(word);
		return Object.hasOwn(pronunciationByWordKey, key)
			? pronunciationByWordKey[key]
			: word.pronunciation;
	}

	function closePronunciation() {
		revealedPronunciation = null;
	}

	function togglePronunciation(wordId: string) {
		revealedPronunciation = revealedPronunciation === wordId ? null : wordId;
	}

	$effect(() => {
		const closeOnDocumentClick = (event: MouseEvent) => {
			if (!(event.target instanceof Element) || !event.target.closest('.pronunciation-trigger'))
				closePronunciation();
		};
		const closeOnScroll = () => closePronunciation();
		const scrollOptions = { capture: true, passive: true };
		document.addEventListener('click', closeOnDocumentClick);
		document.addEventListener('scroll', closeOnScroll, scrollOptions);
		return () => {
			document.removeEventListener('click', closeOnDocumentClick);
			document.removeEventListener('scroll', closeOnScroll, scrollOptions);
		};
	});

	async function loadPronunciations(wordIds: string[]) {
		try {
			const response = await fetch(
				resolve('/app/v/[id]/pronunciation', { id: data.vocabulary.id }),
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ wordIds })
				}
			);
			if (!response.ok) return;
			const payload = (await response.json()) as {
				pronunciations?: Record<string, { english: string; pronunciation: Pronunciation | null }>;
			};
			const additions = Object.fromEntries(
				Object.entries(payload.pronunciations ?? {}).flatMap(([wordId, result]) => {
					const word = data.vocabulary.words.find((candidate) => candidate.id === wordId);
					return word &&
						needsPronunciationGuideRefresh(word.pronunciation) &&
						word.english === result.english
						? [[pronunciationKey(word), result.pronunciation]]
						: [];
				})
			) as Record<string, Pronunciation | null>;
			pronunciationByWordKey = { ...pronunciationByWordKey, ...additions };
		} catch {
			// Pronunciation is optional; the word list remains useful when the service is unavailable.
		}
	}

	async function loadPronunciationBatches(
		wordIds: string[],
		onProgress?: (completed: number, total: number) => void
	) {
		for (let index = 0; index < wordIds.length; index += 32) {
			await loadPronunciations(wordIds.slice(index, index + 32));
			onProgress?.(Math.min(index + 32, wordIds.length), wordIds.length);
		}
	}

	let pronunciationRequestStarted = '';
	$effect(() => {
		if (
			uploadPending ||
			!pronunciationRequestKey ||
			pronunciationRequestKey === pronunciationRequestStarted
		)
			return;
		pronunciationRequestStarted = pronunciationRequestKey;
		void loadPronunciationBatches(pronunciationRequestWordIds);
	});

	function openPhotoPicker() {
		photoInput?.click();
	}

	function imageNumberFor(sourceImageId: string | null | undefined) {
		if (!sourceImageId) return undefined;
		const index = data.vocabulary.images.findIndex((image) => image.id === sourceImageId);
		return index === -1 ? undefined : index + 1;
	}

	function openUploadSettings() {
		if (!photoInput?.files?.length) return;
		uploadFiles = Array.from(photoInput.files);
		uploadFileCount = uploadFiles.length;
		if (uploadFiles.length > 20) {
			uploadError = '사진은 한 번에 최대 20장까지 추가할 수 있습니다.';
			uploadDialog?.showModal();
			return;
		}
		uploadMode = 'all';
		uploadTargets = uploadFiles.map(() => 1);
		uploadSettingsDialog?.showModal();
	}

	function resetUploadSelection() {
		if (photoInput) photoInput.value = '';
		uploadFiles = [];
		uploadMode = 'all';
		uploadTargets = [];
		uploadFileCount = 0;
		uploadStatus = '';
		uploadProgress = undefined;
		uploadProgressMax = 1;
	}

	function closeUploadSettings() {
		if (uploadSettingsDialog?.open) uploadSettingsDialog.close();
		resetUploadSelection();
	}

	function toggleFilterAll(event: Event) {
		filterAll = (event.currentTarget as HTMLInputElement).checked;
		if (filterAll) selectedStatuses.clear();
	}

	function toggleFilterStatus(event: Event, status: ResultStatus) {
		const checked = (event.currentTarget as HTMLInputElement).checked;
		filterAll = false;
		if (checked) selectedStatuses.add(status);
		else selectedStatuses.delete(status);
	}

	function warnBeforeUnload(event: BeforeUnloadEvent) {
		if (!uploadPending) return;
		event.preventDefault();
		event.returnValue = '';
	}

	function closeUploadResult() {
		if (uploadPending) return;
		if (uploadDialog?.open) uploadDialog.close();
		uploadError = '';
		resetUploadSelection();
	}

	beforeNavigate(({ cancel, willUnload }) => {
		if (uploadPending && !willUnload) cancel();
	});

	const enhanceUpload: SubmitFunction = async ({ formData, controller, cancel }) => {
		uploadPending = true;
		uploadError = '';
		const files = formData
			.getAll('images')
			.filter((value): value is File => value instanceof File && value.size > 0);
		uploadFileCount = files.length;
		uploadProgressMax = Math.max(1, files.length);
		uploadProgress = 0;
		if (uploadSettingsDialog?.open) uploadSettingsDialog.close();
		uploadDialog?.showModal();
		const prepared: File[] = [];
		for (const [index, file] of files.entries()) {
			uploadStatus = `사진 ${index + 1}/${files.length} 업로드 준비 중`;
			await tick();
			prepared.push(await prepareUploadFile(file));
			uploadProgress = index + 1;
		}
		const totalBytes = prepared.reduce((total, file) => total + file.size, 0);
		if (totalBytes > MAX_UPLOAD_REQUEST_BYTES) {
			cancel();
			uploadPending = false;
			uploadError = '사진을 압축해도 전체 용량이 90MB를 넘습니다. 나누어 올려 주세요.';
			uploadProgress = undefined;
			return;
		}
		formData.delete('images');
		for (const file of prepared) formData.append('images', file);
		uploadStatus = `${files.length}장의 사진에서 단어를 읽고 저장하는 중`;
		uploadProgress = undefined;
		let cleaned = false;
		const cleanup = (close: boolean) => {
			if (cleaned) return;
			cleaned = true;
			uploadPending = false;
			if (close && uploadDialog?.open) uploadDialog.close();
			if (close) resetUploadSelection();
		};
		controller.signal.addEventListener(
			'abort',
			() => {
				uploadError =
					'페이지 이동 요청으로 분석 연결이 중단되었습니다. 서버에 저장됐을 수 있으니 잠시 후 목록을 새로고침해 주세요.';
				cleanup(false);
			},
			{ once: true }
		);
		return async ({ update, result }) => {
			try {
				await update();
				if (result.type !== 'success') {
					cleanup(false);
					return;
				}
				await tick();
				const wordIds = pronunciationRequestWordIds;
				if (wordIds.length) {
					uploadProgress = 0;
					uploadProgressMax = wordIds.length;
					uploadStatus = `발음 0/${wordIds.length} 받아오는 중`;
					await loadPronunciationBatches(wordIds, (completed, total) => {
						uploadProgress = completed;
						uploadStatus = `발음 ${completed}/${total} 받아오는 중`;
					});
					pronunciationRequestStarted = pronunciationRequestKey;
				}
				cleanup(true);
			} catch (error) {
				console.error('Upload result handling failed:', error);
				uploadError =
					'분석 결과를 확인하지 못했습니다. 서버에 저장됐을 수 있으니 잠시 후 목록을 새로고침해 주세요.';
				cleanup(false);
			} finally {
				cleanup(false);
			}
		};
	};

	const enhanceStartTest: SubmitFunction = () => {
		startPending = true;
		return async ({ update }) => {
			try {
				await update();
			} finally {
				startPending = false;
			}
		};
	};

	function openWordDialog(word?: Word) {
		editingWord = word ?? null;
		editEnglish = word?.english ?? '';
		editMeaning = word?.meaning ?? '';
		editPartOfSpeech = word?.partOfSpeech ?? '';
		wordDialog?.showModal();
	}

	function closeWordDialog() {
		if (wordDialog?.open) wordDialog.close();
		editingWord = null;
		editPartOfSpeech = '';
	}

	const enhanceWord: SubmitFunction = () => {
		editPending = true;
		return async ({ update, result }) => {
			try {
				await update();
				if (result.type === 'success') closeWordDialog();
			} finally {
				editPending = false;
			}
		};
	};

	const enhanceDeleteWord: SubmitFunction = () => {
		deletePending = true;
		return async ({ update, result }) => {
			try {
				await update();
				if (result.type === 'success') closeWordDialog();
			} finally {
				deletePending = false;
			}
		};
	};

	const enhanceDeleteWords: SubmitFunction = () => {
		bulkDeletePending = true;
		return async ({ update, result }) => {
			try {
				await update();
				if (result.type === 'success') closeSelection();
			} finally {
				bulkDeletePending = false;
			}
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
	{#if studyActive}
		<header class="study-header">
			<div>
				<p class="eyebrow">암기 모드 · {data.vocabulary.title}</p>
				<h1 id="study-title">단어 암기</h1>
				<p class="page-description">
					{studyAll ? '전체 단어' : `${studyStart}~${studyEnd}번`} · {studyWords.length}개 · {studyMode ===
					'card'
						? '카드'
						: '목록'}
				</p>
			</div>
		</header>

		{#if studyMode === 'card'}
			<section class="study-card-stage" aria-labelledby="study-title" aria-live="polite">
				<button
					class="study-nav"
					type="button"
					disabled={!studyHasPrevious}
					aria-label="이전 단어"
					onclick={previousStudy}
				>
					<span aria-hidden="true">‹</span><span class="study-nav-label">이전</span>
				</button>
				{#if studyCurrentWord}
					{@const pronunciation = pronunciationFor(studyCurrentWord)}
					<article class="study-card">
						<span class="study-number">{studyCurrentWord.number}번</span>
						<div class="study-word-line">
							<h2>{studyCurrentWord.english}</h2>
							{#if pronunciation}<button
									class:is-revealed={revealedPronunciation === studyCurrentWord.id}
									class="pronunciation-trigger"
									type="button"
									aria-expanded={revealedPronunciation === studyCurrentWord.id}
									aria-label={`${studyCurrentWord.english} 발음 ${pronunciation.ipa}, ${pronunciation.guide}`}
									onpointerenter={closePronunciation}
									onfocus={closePronunciation}
									onclick={() => togglePronunciation(studyCurrentWord.id)}
								>
									<span class="pronunciation-ipa">{pronunciation.ipa}</span>
									<span class="pronunciation-guide" aria-hidden="true">{pronunciation.guide}</span>
								</button>{/if}
						</div>
						{#if studyCurrentWord.partOfSpeech}<span class="part-of-speech study-part-of-speech"
								>{studyCurrentWord.partOfSpeech}</span
							>{/if}
						<p class="study-meaning">{studyCurrentWord.meaning}</p>
					</article>
				{/if}
				<button
					class="study-nav"
					type="button"
					disabled={!studyHasNext}
					aria-label="다음 단어"
					onclick={nextStudy}
				>
					<span aria-hidden="true">›</span><span class="study-nav-label">다음</span>
				</button>
			</section>
		{:else}
			<section class="study-list-stage" aria-labelledby="study-title" aria-live="polite">
				<button
					class="study-nav"
					type="button"
					disabled={!studyHasPrevious}
					aria-label="이전 단어 목록"
					onclick={previousStudy}
				>
					<span aria-hidden="true">‹</span><span class="study-nav-label">이전</span>
				</button>
				<div class="study-word-list">
					{#each studyPageWords as word (word.id)}
						{@const pronunciation = pronunciationFor(word)}
						<div class="study-word-row">
							<span class="word-number">{word.number}</span>
							<div class="word-cell-content study-word-cell">
								<div class="study-word-line">
									<span class="word-english">{word.english}</span>
									{#if pronunciation}<button
											class:is-revealed={revealedPronunciation === word.id}
											class="pronunciation-trigger"
											type="button"
											aria-expanded={revealedPronunciation === word.id}
											aria-label={`${word.english} 발음 ${pronunciation.ipa}, ${pronunciation.guide}`}
											onpointerenter={closePronunciation}
											onfocus={closePronunciation}
											onclick={() => togglePronunciation(word.id)}
										>
											<span class="pronunciation-ipa">{pronunciation.ipa}</span>
											<span class="pronunciation-guide" aria-hidden="true"
												>{pronunciation.guide}</span
											>
										</button>{/if}
								</div>
							</div>
							<span class="word-meaning"
								>{#if word.partOfSpeech}<span class="part-of-speech">{word.partOfSpeech}</span
									>{/if}{word.meaning}</span
							>
						</div>
					{/each}
				</div>
				<button
					class="study-nav"
					type="button"
					disabled={!studyHasNext}
					aria-label="다음 단어 목록"
					onclick={nextStudy}
				>
					<span aria-hidden="true">›</span><span class="study-nav-label">다음</span>
				</button>
			</section>
		{/if}

		<p class="study-page-status" aria-live="polite">
			{#if studyMode === 'card'}
				{studyIndex + 1}/{studyWords.length}번
			{:else}
				{studyPage + 1}/{studyPageCount}쪽 · {studyPageWords.length}개
			{/if}
		</p>
		<footer class="study-footer">
			{#if !studyHasNext}<button
					class="button button-secondary"
					type="button"
					onclick={testStudyRange}>이 범위 테스트하기</button
				>{/if}
			<button class="button button-quiet" type="button" onclick={exitStudy}>돌아가기</button>
		</footer>
	{:else}
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
					onclick={() => openTestSettings()}
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
					<div class="word-toolbar-group word-toolbar-selection-actions">
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
						<button class="button button-secondary" type="button" onclick={closeSelection}
							>취소</button
						>
					</div>
				{:else}
					<div class="word-toolbar-group word-toolbar-primary-actions">
						<button class="button button-secondary" type="button" onclick={() => openWordDialog()}
							>＋ 단어 추가</button
						>
						<form
							id="photo-upload-form"
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
								onchange={openUploadSettings}
							/>
							<button
								class="button button-secondary"
								type="button"
								aria-label="단어 사진 추가"
								onclick={openPhotoPicker}
								disabled={uploadPending}
							>
								{uploadPending ? '분석 중…' : '＋ 사진 추가'}
							</button>
						</form>
					</div>
					<div class="word-toolbar-group word-toolbar-secondary-actions">
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
							onclick={() => openTestSettings()}>테스트</button
						>
						<button
							class="button button-secondary"
							type="button"
							disabled={!data.vocabulary.words.length}
							onclick={openStudySettings}>암기 모드</button
						>
					</div>
				{/if}
			</div>
		</div>

		{#if data.latestResult}
			<section class="result-strip" aria-label="최근 테스트 결과">
				<p class="result-summary">
					맞음 {data.latestResult.summary.correct} · 테스트 {data.latestResult.summary.tested} · 전체
					{data.latestResult.summary.total}
				</p>
				<details class="filter-menu" aria-disabled={selectionMode} inert={selectionMode}>
					<summary class="filter-summary" aria-label={`최근 결과 필터: ${filterSummary}`}
						>{filterSummary}</summary
					>
					<div class="filter-options">
						<label class="filter-option">
							<input
								type="checkbox"
								checked={filterAll}
								disabled={selectionMode}
								onchange={toggleFilterAll}
							/>
							전체 단어
						</label>
						{#each statusOptions as option (option.value)}
							<label class="filter-option">
								<input
									type="checkbox"
									checked={selectedStatuses.has(option.value)}
									disabled={selectionMode}
									onchange={(event) => toggleFilterStatus(event, option.value)}
								/>
								{option.label}
							</label>
						{/each}
					</div>
				</details>
			</section>
		{/if}

		{#if data.vocabulary.images.length}
			<details>
				<summary class="field-note photo-summary"
					>원본 사진 {data.vocabulary.images.length}장 · 단어 목록의 사진 번호와 연결됩니다.</summary
				>
				<div class="image-strip" aria-label="추가한 단어 사진">
					{#each data.vocabulary.images as image, index (image.id)}
						<div class="image-thumb" aria-label={`사진 ${index + 1}`}>
							<img
								src={`/app/v/${data.vocabulary.id}/images/${image.id}`}
								alt={`사진 ${index + 1}`}
								onerror={imageError}
							/>
							<span class="broken-thumb" hidden aria-label="이미지를 불러오지 못했습니다.">!</span>
							<span class="image-number" aria-hidden="true">사진 {index + 1}</span>
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
						{@const pronunciation = pronunciationFor(word)}
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
								<div class="word-word-line">
									<span class="word-english">{word.english}</span>
									{#if pronunciation}<button
											class:is-revealed={revealedPronunciation === word.id}
											class="pronunciation-trigger"
											type="button"
											aria-expanded={revealedPronunciation === word.id}
											aria-label={`${word.english} 발음 ${pronunciation.ipa}, ${pronunciation.guide}`}
											onpointerenter={closePronunciation}
											onfocus={closePronunciation}
											onclick={() => togglePronunciation(word.id)}
										>
											<span class="pronunciation-ipa">{pronunciation.ipa}</span>
											<span class="pronunciation-guide" aria-hidden="true"
												>{pronunciation.guide}</span
											>
										</button>{/if}
								</div>
								<div class="word-meta">
									{#if imageNumberFor(word.sourceImageId)}<span class="word-source"
											>사진 {imageNumberFor(word.sourceImageId)}</span
										>{:else if word.sourceImageId === null}<span class="word-source is-manual"
											>직접 입력</span
										>{/if}
									{#if word.uncertain}<span class="word-status status-ambiguous">확인 필요</span
										>{/if}
									{#if status}<span
											class={`word-status status-${status}`}
											title={`최근 결과: ${statusLabel(status)}`}>{statusLabel(status)}</span
										>{/if}
								</div>
							</div>
							<span class="word-meaning"
								>{#if word.partOfSpeech}<span class="part-of-speech">{word.partOfSpeech}</span
									>{/if}{word.meaning}</span
							>
							<button
								class="word-edit"
								type="button"
								disabled={selectionMode}
								onclick={() => openWordDialog(word)}
								aria-label={`${word.english} 단어 편집`}>편집</button
							>
						</div>
					{/each}
				</section>
			</form>
		{:else}
			<section class="empty-state" aria-labelledby="words-empty-title">
				<div class="empty-state-mark" aria-hidden="true">＋</div>
				<h2 id="words-empty-title">{filterAll ? '아직 단어가 없어요' : '표시할 단어가 없어요'}</h2>
				<p>
					{filterAll
						? '단어 사진을 추가하면 단어를 자동으로 읽어 정리합니다.'
						: selectedStatuses.size
							? '이 결과에 해당하는 단어가 없습니다.'
							: '결과를 하나 이상 선택해 주세요.'}
				</p>
				{#if filterAll}<button class="button button-primary" type="button" onclick={openPhotoPicker}
						>사진 추가하기</button
					>{/if}
			</section>
		{/if}
	{/if}
</div>

<dialog
	bind:this={uploadSettingsDialog}
	class="modal"
	aria-labelledby="upload-settings-title"
	oncancel={closeUploadSettings}
>
	<div class="modal-body">
		<div class="modal-header">
			<div>
				<h2 id="upload-settings-title">사진 추가</h2>
				<p>{uploadFileCount}장의 사진에서 단어를 추출합니다.</p>
			</div>
			<button
				class="modal-close"
				type="button"
				aria-label="닫기"
				title="닫기"
				onclick={closeUploadSettings}>×</button
			>
		</div>

		<div class="form-stack">
			<fieldset class="choice-group">
				<legend>추출 방식</legend>
				<label class="choice"
					><input type="radio" bind:group={uploadMode} value="all" /> 사진에 보이는 주요 단어 전체 추출</label
				>
				<label class="choice"
					><input type="radio" bind:group={uploadMode} value="targets" /> 사진별 목표 개수 지정</label
				>
			</fieldset>
			{#if uploadMode === 'targets'}
				<div class="form-stack">
					{#each uploadFiles as file, index (file)}
						<div class="field">
							<label for={`upload-target-${index}`}>사진 {index + 1} 목표 개수 ({file.name})</label>
							<input
								id={`upload-target-${index}`}
								name="targetWordCounts"
								form="photo-upload-form"
								type="number"
								min="1"
								max="500"
								step="1"
								inputmode="numeric"
								required
								bind:value={uploadTargets[index]}
							/>
						</div>
					{/each}
					<p class="field-note" aria-live="polite">
						총 목표 개수: {uploadTargets.reduce(
							(total, target) => (total ?? 0) + (target ?? 0),
							0
						)}개
					</p>
				</div>
			{/if}
			<div class="modal-actions">
				<button class="button button-secondary" type="button" onclick={closeUploadSettings}
					>취소</button
				>
				<button class="button button-primary" type="submit" form="photo-upload-form"
					>사진 분석</button
				>
			</div>
		</div>
	</div>
</dialog>

<dialog
	bind:this={uploadDialog}
	class="modal"
	aria-labelledby="ocr-progress-title"
	aria-describedby="ocr-progress-description"
	oncancel={(event) => event.preventDefault()}
>
	<div class="modal-body ocr-modal-body">
		<h2 id="ocr-progress-title">{uploadPending ? '사진 추가 중' : '사진 분석 실패'}</h2>
		{#if uploadPending}
			<p id="ocr-progress-description" class="ocr-status" role="status" aria-live="polite">
				{uploadStatus || `${uploadFileCount}장의 사진을 준비하는 중`}
			</p>
			{#if uploadProgress === undefined}
				<progress
					class="ocr-progress"
					aria-label={uploadStatus || `${uploadFileCount}장의 사진을 준비하는 중`}
				></progress>
			{:else}
				<progress
					class="ocr-progress"
					aria-label={uploadStatus}
					value={uploadProgress}
					max={uploadProgressMax}
				></progress>
			{/if}
			<p class="ocr-warning">
				새로고침하거나 창을 닫지 마세요. 분석 결과가 저장되지 않을 수 있어요.
			</p>
		{:else}
			<p id="ocr-progress-description">사진 분석을 완료하지 못했습니다.</p>
			<p class="message message-error" role="alert" aria-live="assertive">
				{uploadError || form?.message || '잠시 후 다시 시도해 주세요.'}
			</p>
			<div class="modal-actions">
				<button class="button button-secondary" type="button" onclick={closeUploadResult}
					>닫기</button
				>
			</div>
		{/if}
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
							bind:value={testStart}
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
							bind:value={testEnd}
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

<dialog bind:this={studySettingsDialog} class="modal" aria-labelledby="study-settings-title">
	<div class="modal-body">
		<div class="modal-header">
			<div>
				<h2 id="study-settings-title">암기 모드</h2>
				<p>복습할 범위와 화면 방식을 정해 보세요.</p>
			</div>
			<button
				class="modal-close"
				type="button"
				aria-label="닫기"
				title="닫기"
				onclick={closeStudySettings}>×</button
			>
		</div>

		<form class="form-stack" onsubmit={startStudy}>
			<fieldset class="choice-group">
				<legend>범위</legend>
				<label class="choice"><input type="checkbox" bind:checked={studyAll} /> 전체 단어</label>
				<div class="choice-options">
					<div class="field">
						<label for="study-start">시작 번호</label>
						<input
							id="study-start"
							type="number"
							min={data.vocabulary.words[0]?.number ?? 1}
							max={data.vocabulary.words.at(-1)?.number ?? 1}
							bind:value={studyStart}
							disabled={studyAll}
						/>
					</div>
					<div class="field">
						<label for="study-end">끝 번호</label>
						<input
							id="study-end"
							type="number"
							min={data.vocabulary.words[0]?.number ?? 1}
							max={data.vocabulary.words.at(-1)?.number ?? 1}
							bind:value={studyEnd}
							disabled={studyAll}
						/>
					</div>
				</div>
			</fieldset>

			<fieldset class="choice-group">
				<legend>화면 방식</legend>
				<div class="choice-options">
					<label class="choice"
						><input type="radio" bind:group={studyMode} value="card" /> 카드</label
					>
					<label class="choice"
						><input type="radio" bind:group={studyMode} value="list" /> 목록 (최대 5개)</label
					>
				</div>
			</fieldset>

			{#if studyError}<p class="message message-error" role="alert">{studyError}</p>{/if}
			<div class="modal-actions">
				<button class="button button-secondary" type="button" onclick={closeStudySettings}
					>취소</button
				>
				<button class="button button-primary" type="submit">암기 시작</button>
			</div>
		</form>
	</div>
</dialog>

<dialog
	bind:this={wordDialog}
	class="modal"
	aria-labelledby="word-dialog-title"
	oncancel={closeWordDialog}
>
	<div class="modal-body">
		<div class="modal-header">
			<div>
				<h2 id="word-dialog-title">{editingWord ? '단어 편집' : '단어 추가'}</h2>
				<p>
					{editingWord
						? '영어, 한국어 뜻, 품사를 바로잡을 수 있어요.'
						: '사진 없이 직접 저장하는 단어입니다.'}
				</p>
			</div>
			<button
				class="modal-close"
				type="button"
				aria-label="닫기"
				title="닫기"
				onclick={closeWordDialog}>×</button
			>
		</div>

		<form
			id="word-form"
			method="post"
			action={editingWord ? '?/updateWord' : '?/addWord'}
			use:enhance={enhanceWord}
			class="form-stack"
		>
			{#if editingWord}<input type="hidden" name="wordId" value={editingWord.id} />{/if}
			<div class="field">
				<label for="word-english">영어</label><input
					id="word-english"
					name="english"
					maxlength="300"
					bind:value={editEnglish}
					autocomplete="off"
					required
				/>
			</div>
			<div class="field">
				<label for="word-meaning">한국어 뜻</label><input
					id="word-meaning"
					name="meaning"
					maxlength="1000"
					bind:value={editMeaning}
					required
				/>
			</div>
			<div class="field">
				<label for="word-part-of-speech">품사 <span class="field-optional">선택</span></label><input
					id="word-part-of-speech"
					name="partOfSpeech"
					maxlength="30"
					bind:value={editPartOfSpeech}
					placeholder="예: 명사, 동사"
				/>
			</div>
			{#if form?.message && (form.action === (editingWord ? 'updateWord' : 'addWord') || (editingWord && form.action === 'deleteWord'))}<p
					class="message message-error"
					role="alert"
					aria-live="assertive"
				>
					{form.message}
				</p>{/if}
		</form>
		<div class="modal-actions">
			{#if editingWord}<form
					method="post"
					action="?/deleteWord"
					use:enhance={enhanceDeleteWord}
					onsubmit={confirmDelete}
				>
					<input type="hidden" name="wordId" value={editingWord.id} />
					<button class="button button-danger" type="submit" disabled={deletePending}
						>{deletePending ? '삭제 중…' : '삭제'}</button
					>
				</form>{/if}
			<button class="button button-secondary" type="button" onclick={closeWordDialog}>취소</button>
			<button class="button button-primary" type="submit" form="word-form" disabled={editPending}
				>{editPending ? '저장 중…' : editingWord ? '저장' : '단어 추가'}</button
			>
		</div>
	</div>
</dialog>

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
