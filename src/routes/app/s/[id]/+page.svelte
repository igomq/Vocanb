<script lang="ts">
	import {
		passageNavState,
		type SentencePassage,
		type SentenceTestResult
	} from '$lib/sentence-domain';
	import MemorizationPassage from '$lib/components/MemorizationPassage.svelte';
	import PassageSummaryView from '$lib/components/PassageSummaryView.svelte';
	import PassageTranslationView from '$lib/components/PassageTranslationView.svelte';
	import SentenceTest from '$lib/components/SentenceTest.svelte';
	import SentenceChat from '$lib/components/SentenceChat.svelte';
	import PassageEditor from '$lib/components/PassageEditor.svelte';
	import { MediaQuery, SvelteMap } from 'svelte/reactivity';
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { page } from '$app/state';

	let { data } = $props();

	type Tab = 'summary' | 'passage' | 'test' | 'translation';
	const tabs: Tab[] = ['summary', 'passage', 'test', 'translation'];
	const reducedMotion = new MediaQuery('(prefers-reduced-motion: reduce)');
	let panel: HTMLDivElement | undefined = $state();
	let activeIndex = $state(0);
	let tab = $state<Tab>('passage');
	let testResults = $state<Record<string, Record<string, SentenceTestResult>>>({});
	let resultRevisions = $state<Record<string, number>>({});
	let resultSaveError = $state('');
	let resultSaveConflict = $state(false);
	let renameDialog: HTMLDialogElement | undefined = $state();
	let renameTitle = $state('');
	let renamePending = $state(false);
	let renameError = $state('');
	let savingResults = $state(false);
	let editing = $state(false);
	let editNotice = $state('');
	const pendingResultSaves = new SvelteMap<string, Record<string, SentenceTestResult>>();
	let syncedBookId = $state('');

	$effect(() => {
		if (syncedBookId === data.book.id) return;
		syncedBookId = data.book.id;
		editing = false;
		editNotice = '';
		const index = data.book.passages.findIndex(
			(passage) => passage.id === page.url.searchParams.get('passage')
		);
		activeIndex = index < 0 ? 0 : index;
		testResults = Object.fromEntries(
			data.book.passages.map((passage) => [passage.id, passage.testResults])
		);
		resultRevisions = Object.fromEntries(
			data.book.passages.map((passage) => [passage.id, passage.testResultsRevision])
		);
	});

	const passages = $derived(data.book.passages);
	const activePassage = $derived(passages[activeIndex] as SentencePassage);
	const nav = $derived(passageNavState(passages.length, activeIndex));

	function openRenameDialog() {
		renameTitle = data.book.title;
		renameError = '';
		renameDialog?.showModal();
	}

	function closeRenameDialog() {
		if (renameDialog?.open) renameDialog.close();
	}

	const enhanceRename: SubmitFunction = () => {
		renamePending = true;
		renameError = '';
		return async ({ update, result }) => {
			try {
				await update();
				if (result.type === 'success') {
					closeRenameDialog();
					return;
				}
				if (result.type === 'failure')
					renameError =
						(result.data as { message?: string })?.message ?? '이름을 변경하지 못했습니다.';
			} catch {
				renameError = '이름을 변경하지 못했습니다.';
			} finally {
				renamePending = false;
			}
		};
	};

	function goTo(index: number) {
		if (editing || index === activeIndex || index < 0 || index >= passages.length) return;
		const direction = index > activeIndex ? 1 : -1;
		activeIndex = index;
		editNotice = '';
		tab = 'passage';
		void animatePanel(direction);
	}

	function applyPassage(passage: SentencePassage) {
		data = {
			...data,
			book: {
				...data.book,
				passages: data.book.passages.map((current) =>
					current.id === passage.id ? passage : current
				)
			}
		};
		testResults = { ...testResults, [passage.id]: passage.testResults };
		resultRevisions = { ...resultRevisions, [passage.id]: passage.testResultsRevision };
		pendingResultSaves.delete(passage.id);
		editing = false;
		editNotice = '본문과 암기 범위를 저장했습니다.';
	}

	function switchTab(next: Tab) {
		if (editing || next === tab) return;
		const direction = tabs.indexOf(next) > tabs.indexOf(tab) ? 1 : -1;
		tab = next;
		void animatePanel(direction);
	}

	async function animatePanel(direction: number) {
		await tick();
		panel?.getAnimations().forEach((animation) => animation.cancel());
		if (reducedMotion.current) return;
		panel?.animate(
			[
				{ opacity: 0.35, transform: `translateX(${direction * 18}px)` },
				{ opacity: 1, transform: 'translateX(0)' }
			],
			{ duration: 220, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
		);
	}

	function recordResult(key: string, result: SentenceTestResult | null) {
		const passageResults = { ...(testResults[activePassage.id] ?? {}) };
		if (result) passageResults[key] = result;
		else delete passageResults[key];
		testResults = { ...testResults, [activePassage.id]: passageResults };
		saveResults(activePassage.id, passageResults);
	}

	function resetResults() {
		recordAllResults({});
	}

	function recordAllResults(results: Record<string, SentenceTestResult>) {
		testResults = { ...testResults, [activePassage.id]: results };
		saveResults(activePassage.id, results);
	}

	function saveResults(passageId: string, results: Record<string, SentenceTestResult>) {
		pendingResultSaves.set(passageId, results);
		resultSaveError = '';
		resultSaveConflict = false;
		void flushResultSaves();
	}

	async function flushResultSaves() {
		if (savingResults) return;
		savingResults = true;
		try {
			while (pendingResultSaves.size) {
				const [passageId, results] = pendingResultSaves.entries().next().value!;
				pendingResultSaves.delete(passageId);
				const response = await fetch(`/app/s/${data.book.id}/test-results`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						passageId,
						results,
						revision: resultRevisions[passageId] ?? 0
					})
				});
				const body = await response.json().catch(() => null);
				if (response.status === 409) {
					pendingResultSaves.delete(passageId);
					resultSaveConflict = true;
					resultSaveError = body?.message || '다른 탭에서 결과가 변경되었습니다.';
					continue;
				}
				if (!response.ok || !Number.isInteger(body?.revision)) {
					if (!pendingResultSaves.has(passageId)) pendingResultSaves.set(passageId, results);
					throw new Error(`HTTP ${response.status}`);
				}
				resultRevisions = { ...resultRevisions, [passageId]: body.revision };
			}
		} catch (error) {
			console.error('Sentence test result save failed:', error);
			resultSaveError = '결과를 저장하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.';
		} finally {
			savingResults = false;
		}
	}
</script>

<svelte:head>
	<title>{data.book.title} · Vocanb</title>
</svelte:head>

<div class="content-wrap">
	<header class="page-header">
		<div>
			<p class="eyebrow">문장 암기</p>
			<h1>{data.book.title}</h1>
			<p class="page-description">강조된 문장을 가려 두고, 기억나는지 확인해 보세요.</p>
		</div>
		<div class="button-row">
			<button class="rename-action" type="button" onclick={openRenameDialog}>
				<span aria-hidden="true">✎</span> 이름 변경
			</button>
		</div>
	</header>

	{#if resultSaveError}
		<div class="message message-error" role="alert">
			{resultSaveError}
			<button
				class="button button-quiet"
				type="button"
				onclick={() => (resultSaveConflict ? window.location.reload() : void flushResultSaves())}
				>{resultSaveConflict ? '새로고침' : '다시 저장'}</button
			>
		</div>
	{/if}

	<section class="sentence-stage" aria-label="지문 학습">
		<div class="sentence-stage-header">
			<h2 class="sentence-passage-label">{activePassage.label}</h2>
			{#if !editing}
				<button
					class="button button-secondary"
					type="button"
					disabled={syncedBookId !== data.book.id || savingResults || pendingResultSaves.size > 0}
					onclick={() => {
						editing = true;
						tab = 'passage';
						editNotice = '';
					}}>본문·암기 범위 수정</button
				>
			{/if}
			<span class="sentence-passage-position">
				{activeIndex + 1} / {passages.length}
			</span>
		</div>

		<nav class="sentence-nav" aria-label="지문 이동과 보기 선택">
			<button
				class="button button-secondary sentence-nav-arrow"
				type="button"
				onclick={() => goTo(activeIndex - 1)}
				disabled={editing || !nav.canPrevious}>‹ 이전</button
			>
			<div
				class="sentence-tabs"
				role="tablist"
				aria-label="보기 모드"
				style={`--active-tab: ${tabs.indexOf(tab)}`}
			>
				<button
					class="sentence-tab"
					class:is-active={tab === 'summary'}
					type="button"
					role="tab"
					aria-selected={tab === 'summary'}
					disabled={editing}
					onclick={() => switchTab('summary')}>정리</button
				>
				<button
					class="sentence-tab"
					class:is-active={tab === 'passage'}
					type="button"
					role="tab"
					aria-selected={tab === 'passage'}
					disabled={editing}
					onclick={() => switchTab('passage')}>본문</button
				>
				<button
					class="sentence-tab"
					class:is-active={tab === 'test'}
					type="button"
					role="tab"
					aria-selected={tab === 'test'}
					disabled={editing}
					onclick={() => switchTab('test')}>테스트</button
				>
				<button
					class="sentence-tab"
					class:is-active={tab === 'translation'}
					type="button"
					role="tab"
					aria-selected={tab === 'translation'}
					disabled={editing}
					onclick={() => switchTab('translation')}>번역</button
				>
			</div>
			<button
				class="button button-secondary sentence-nav-arrow"
				type="button"
				onclick={() => goTo(activeIndex + 1)}
				disabled={editing || !nav.canNext}>다음 ›</button
			>
		</nav>

		<div class="sentence-panel">
			{#key activePassage.id}
				<div class="sentence-panel-content" bind:this={panel}>
					{#if editNotice}<p role="status">{editNotice}</p>{/if}
					{#if editing}
						<PassageEditor
							bookId={data.book.id}
							passage={activePassage}
							onsave={applyPassage}
							oncancel={() => (editing = false)}
						/>
					{:else if tab === 'summary'}
						<PassageSummaryView bookId={data.book.id} passage={activePassage} />
					{:else if tab === 'passage'}
						<MemorizationPassage
							passage={activePassage}
							results={testResults[activePassage.id] ?? {}}
						/>
					{:else if tab === 'test'}
						<SentenceTest
							passage={activePassage}
							results={testResults[activePassage.id] ?? {}}
							onresult={recordResult}
							onreset={resetResults}
						/>
					{:else}
						<PassageTranslationView bookId={data.book.id} passage={activePassage} />
					{/if}
				</div>
			{/key}
		</div>
	</section>

	<dialog bind:this={renameDialog} class="modal" aria-labelledby="rename-sentence-title">
		<div class="modal-body">
			<div class="modal-header">
				<div>
					<h2 id="rename-sentence-title">암기장 이름 변경</h2>
					<p>문장 암기장 제목을 수정합니다.</p>
				</div>
				<button
					class="modal-close"
					type="button"
					aria-label="닫기"
					title="닫기"
					onclick={closeRenameDialog}>×</button
				>
			</div>
			<form
				class="form-stack"
				method="post"
				action="?/renameSentenceBook"
				use:enhance={enhanceRename}
			>
				<div class="field">
					<label for="rename-title">이름</label>
					<input
						id="rename-title"
						name="title"
						maxlength="120"
						bind:value={renameTitle}
						autocomplete="off"
						required
					/>
				</div>
				{#if renameError}<p class="message message-error" role="alert" aria-live="assertive">
						{renameError}
					</p>{/if}
				<div class="modal-actions">
					<button class="button button-secondary" type="button" onclick={closeRenameDialog}
						>취소</button
					>
					<button class="button button-primary" type="submit" disabled={renamePending}
						>{renamePending ? '저장 중…' : '저장'}</button
					>
				</div>
			</form>
		</div>
	</dialog>
	<SentenceChat bookId={data.book.id} passage={activePassage} />
</div>
