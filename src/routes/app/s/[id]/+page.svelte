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
	import { SvelteMap } from 'svelte/reactivity';

	let { data } = $props();

	type Tab = 'summary' | 'passage' | 'test' | 'translation';
	let activeIndex = $state(0);
	let tab = $state<Tab>('passage');
	let testResults = $state<Record<string, Record<string, SentenceTestResult>>>({});
	let resultRevisions = $state<Record<string, number>>({});
	let resultSaveError = $state('');
	let resultSaveConflict = $state(false);
	let savingResults = false;
	const pendingResultSaves = new SvelteMap<string, Record<string, SentenceTestResult>>();
	let syncedBookId = '';

	$effect(() => {
		if (syncedBookId === data.book.id) return;
		syncedBookId = data.book.id;
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

	function goTo(index: number) {
		if (index < 0 || index >= passages.length) return;
		activeIndex = index;
		tab = 'passage';
	}

	function switchTab(next: Tab) {
		tab = next;
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

	{#key activePassage.id}
		<section class="sentence-stage" aria-label="지문 학습">
			<div class="sentence-stage-header">
				<h2 class="sentence-passage-label">{activePassage.label}</h2>
				<span class="sentence-passage-position">
					{activeIndex + 1} / {passages.length}
				</span>
			</div>

			<nav class="sentence-nav" aria-label="지문 이동과 보기 선택">
				<button
					class="button button-secondary sentence-nav-arrow"
					type="button"
					onclick={() => goTo(activeIndex - 1)}
					disabled={!nav.canPrevious}>‹ 이전</button
				>
				<div class="sentence-tabs" role="tablist" aria-label="보기 모드">
					<button
						class="sentence-tab"
						class:is-active={tab === 'summary'}
						type="button"
						role="tab"
						aria-selected={tab === 'summary'}
						onclick={() => switchTab('summary')}>정리</button
					>
					<button
						class="sentence-tab"
						class:is-active={tab === 'passage'}
						type="button"
						role="tab"
						aria-selected={tab === 'passage'}
						onclick={() => switchTab('passage')}>본문</button
					>
					<button
						class="sentence-tab"
						class:is-active={tab === 'test'}
						type="button"
						role="tab"
						aria-selected={tab === 'test'}
						onclick={() => switchTab('test')}>테스트</button
					>
					<button
						class="sentence-tab"
						class:is-active={tab === 'translation'}
						type="button"
						role="tab"
						aria-selected={tab === 'translation'}
						onclick={() => switchTab('translation')}>번역</button
					>
				</div>
				<button
					class="button button-secondary sentence-nav-arrow"
					type="button"
					onclick={() => goTo(activeIndex + 1)}
					disabled={!nav.canNext}>다음 ›</button
				>
			</nav>

			<div class="sentence-panel">
				{#if tab === 'summary'}
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
		</section>
	{/key}
</div>
