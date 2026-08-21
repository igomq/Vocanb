<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import type { ResolvedPathname } from '$app/types';
	import type { SubmitFunction } from '@sveltejs/kit';

	let {
		titles = [] as string[],
		ranges = [] as string[]
	}: {
		titles?: string[];
		ranges?: string[];
	} = $props();

	type Step = 'select' | 'vocabulary' | 'sentence';
	let dialog: HTMLDialogElement | undefined = $state();
	let step = $state<Step>('select');
	let createPending = $state(false);
	let importPending = $state(false);
	let importError = $state('');
	let vocabError = $state('');

	const createParam = $derived(page.url.searchParams.get('create'));
	const typeParam = $derived(page.url.searchParams.get('type'));

	$effect(() => {
		if (!dialog) return;
		if (createParam === '1') {
			step =
				typeParam === 'vocabulary'
					? 'vocabulary'
					: typeParam === 'sentence'
						? 'sentence'
						: 'select';
			if (!dialog.open) dialog.showModal();
		} else if (dialog.open) {
			dialog.close();
		}
	});

	const basePath = $derived(
		page.url.pathname.startsWith('/app/s') ? resolve('/app/s') : resolve('/app')
	);

	function studyUrl(search: URLSearchParams): ResolvedPathname {
		return `${basePath}?${search.toString()}` as ResolvedPathname;
	}

	function openStep(next: Step, type?: string) {
		step = next;
		const params = new SvelteURLSearchParams(page.url.searchParams);
		params.set('create', '1');
		if (type) params.set('type', type);
		else params.delete('type');
		void goto(studyUrl(params), { replaceState: true, keepFocus: true });
	}

	function closeCreate() {
		if (dialog?.open) dialog.close();
		if (createParam === '1') {
			void goto(basePath, { replaceState: true, keepFocus: true });
		}
	}

	const enhanceCreate: SubmitFunction = () => {
		createPending = true;
		vocabError = '';
		return async ({ update }) => {
			try {
				await update();
			} finally {
				createPending = false;
			}
			vocabError = (page.form as { message?: string } | null)?.message ?? '';
		};
	};

	const enhanceImport: SubmitFunction = () => {
		importPending = true;
		importError = '';
		return async ({ update }) => {
			try {
				await update();
			} finally {
				importPending = false;
			}
			importError = (page.form as { message?: string } | null)?.message ?? '';
		};
	};
</script>

<dialog
	bind:this={dialog}
	class="modal"
	aria-labelledby="study-create-title"
	oncancel={(event) => {
		if (importPending || createPending) event.preventDefault();
	}}
	onclose={closeCreate}
>
	<div class="modal-body">
		{#if step === 'select'}
			<div class="modal-header">
				<div>
					<h2 id="study-create-title">새 학습장</h2>
					<p>어떤 방식으로 공부할까요?</p>
				</div>
				<button
					class="modal-close"
					type="button"
					aria-label="닫기"
					title="닫기"
					onclick={closeCreate}>×</button
				>
			</div>
			<div class="form-stack">
				<button
					class="study-type-option"
					type="button"
					onclick={() => openStep('vocabulary', 'vocabulary')}
				>
					<strong>단어장</strong>
					<small>사진에서 단어와 뜻을 추출해 암기하고 테스트합니다.</small>
				</button>
				<button
					class="study-type-option"
					type="button"
					onclick={() => openStep('sentence', 'sentence')}
				>
					<strong>문장 암기장</strong>
					<small>PDF의 영어 지문과 강조 문장을 추출해 암기합니다.</small>
				</button>
			</div>
		{:else}
			<div class="modal-header">
				<div>
					<h2 id="study-create-title">{step === 'vocabulary' ? '새 단어장' : '새 문장 암기장'}</h2>
					<p>
						{step === 'vocabulary'
							? '이름과 범위만 정하면 바로 시작할 수 있어요.'
							: 'PDF의 지문과 강조된 문장을 자동으로 분석합니다.'}
					</p>
				</div>
				{#if !createPending && !importPending}
					<button
						class="modal-close"
						type="button"
						aria-label="닫기"
						title="닫기"
						onclick={closeCreate}>×</button
					>
				{/if}
			</div>
			{#if !createPending && !importPending}
				<button class="modal-back" type="button" onclick={() => openStep('select')}
					>← 학습장 형식 다시 선택</button
				>
			{/if}

			{#if step === 'vocabulary'}
				<form method="post" action="/app?/create" use:enhance={enhanceCreate} class="form-stack">
					<div class="field">
						<label for="vocabulary-title">단어장 이름</label>
						<input
							id="vocabulary-title"
							name="title"
							maxlength="120"
							list="study-title-suggestions"
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
							list="study-range-suggestions"
							placeholder="예: Unit 1–3"
						/>
					</div>
					{#if vocabError}
						<p class="message message-error" role="alert" aria-live="assertive">{vocabError}</p>
					{/if}
					<div class="modal-actions">
						<button class="button button-secondary" type="button" onclick={closeCreate}>취소</button
						>
						<button class="button button-primary" type="submit" disabled={createPending}
							>{createPending ? '만드는 중…' : '단어장 만들기'}</button
						>
					</div>
				</form>
				<datalist id="study-title-suggestions">
					{#each titles as title (title)}
						<option value={title}></option>
					{/each}
				</datalist>
				<datalist id="study-range-suggestions">
					{#each ranges as range (range)}
						<option value={range}></option>
					{/each}
				</datalist>
			{:else}
				<form
					method="post"
					action="/app?/importSentenceBook"
					enctype="multipart/form-data"
					use:enhance={enhanceImport}
					class="form-stack"
				>
					<div class="field">
						<label for="sentence-title">제목 <span class="field-note">(선택)</span></label>
						<input
							id="sentence-title"
							name="title"
							maxlength="120"
							placeholder="예: 보정고2 부교재 1-4"
						/>
						<p class="field-note">비워 두면 PDF 파일명에서 제목을 자동으로 만듭니다.</p>
					</div>
					<div class="field">
						<label for="sentence-pdf">PDF 파일</label>
						<input
							id="sentence-pdf"
							name="pdf"
							type="file"
							accept="application/pdf,.pdf"
							required
						/>
					</div>
					{#if importError}
						<p class="message message-error" role="alert" aria-live="assertive">{importError}</p>
					{/if}
					{#if importPending}
						<div class="sentence-progress" role="status" aria-live="polite">
							<p class="ocr-status">PDF 분석 중…</p>
							<p class="sentence-progress-description">지문과 암기 문장을 찾고 있습니다.</p>
							<progress class="ocr-progress" aria-label="PDF 분석 중"></progress>
							<p class="ocr-warning">
								새로고침하거나 창을 닫지 마세요. 분석 결과가 저장되지 않을 수 있어요.
							</p>
						</div>
					{:else}
						<div class="modal-actions">
							<button class="button button-secondary" type="button" onclick={closeCreate}
								>취소</button
							>
							<button class="button button-primary" type="submit" disabled={importPending}
								>문장 암기장 만들기</button
							>
						</div>
					{/if}
				</form>
			{/if}
		{/if}
	</div>
</dialog>
