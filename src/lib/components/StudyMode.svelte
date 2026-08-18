<script lang="ts">
	import { enhance } from '$app/forms';
	import type {
		ContinuousLearningProgress,
		ContinuousStudyMode,
		Pronunciation,
		Word
	} from '$lib/domain';

	let {
		title,
		words,
		pronunciationFor,
		revealedPronunciation,
		continuous,
		starredOnly,
		all,
		start,
		end,
		mode,
		index,
		onprevious,
		onnext,
		ontogglePronunciation,
		onclosePronunciation,
		ontest,
		onexit,
		oncancelContinuous
	}: {
		title: string;
		words: Word[];
		pronunciationFor: (word: Word) => Pronunciation | null | undefined;
		revealedPronunciation: string | null;
		continuous: ContinuousLearningProgress | null;
		starredOnly: boolean;
		all: boolean;
		start: number;
		end: number;
		mode: ContinuousStudyMode;
		index: number;
		onprevious: () => void;
		onnext: () => void;
		ontogglePronunciation: (wordId: string) => void;
		onclosePronunciation: () => void;
		ontest: () => void;
		onexit: () => void;
		oncancelContinuous: (event: SubmitEvent) => void;
	} = $props();

	const pageSize = 5;
	const page = $derived(Math.floor(index / pageSize));
	const pageWords = $derived(words.slice(page * pageSize, page * pageSize + pageSize));
	const pageCount = $derived(Math.max(1, Math.ceil(words.length / pageSize)));
	const currentWord = $derived(words[index]);
	const hasPrevious = $derived(index > 0);
	const hasNext = $derived(
		mode === 'card' ? index < words.length - 1 : index + pageSize < words.length
	);
</script>

<header class="study-header">
	<div>
		<p class="eyebrow">{continuous ? '연속 학습' : '암기 모드'} · {title}</p>
		<h1 id="study-title">{continuous ? '이번 묶음 암기' : '단어 암기'}</h1>
		<p class="page-description">
			{continuous
				? `${continuous.range?.start}~${continuous.range?.end}번 묶음`
				: starredOnly
					? all
						? '별표 단어'
						: `${start}~${end}번 별표 단어`
					: all
						? '전체 단어'
						: `${start}~${end}번`} · {words.length}개 · {mode === 'card' ? '카드' : '목록'}
		</p>
	</div>
</header>

{#if mode === 'card'}
	<section class="study-card-stage" aria-labelledby="study-title" aria-live="polite">
		<button
			class="study-nav"
			type="button"
			disabled={!hasPrevious}
			aria-label="이전 단어"
			onclick={onprevious}
		>
			<span aria-hidden="true">‹</span><span class="study-nav-label">이전</span>
		</button>
		{#if currentWord}
			{@const pronunciation = pronunciationFor(currentWord)}
			<article class="study-card">
				<div class="study-card-tools">
					<span class="study-number">{currentWord.number}번</span>
					<form method="post" action="?/toggleStar" use:enhance>
						<input type="hidden" name="wordId" value={currentWord.id} />
						<button
							class="star-button"
							type="submit"
							aria-label={currentWord.starred
								? `${currentWord.english} 별표 해제`
								: `${currentWord.english} 별표`}
							aria-pressed={currentWord.starred}
						>
							<span aria-hidden="true">{currentWord.starred ? '★' : '☆'}</span>
						</button>
					</form>
				</div>
				<div class="study-word-line">
					<h2>{currentWord.english}</h2>
					{#if pronunciation}<button
							class:is-revealed={revealedPronunciation === currentWord.id}
							class="pronunciation-trigger"
							type="button"
							aria-expanded={revealedPronunciation === currentWord.id}
							aria-label={`${currentWord.english} 발음 ${pronunciation.ipa}, ${pronunciation.guide}`}
							onpointerenter={onclosePronunciation}
							onfocus={onclosePronunciation}
							onclick={() => ontogglePronunciation(currentWord.id)}
						>
							<span class="pronunciation-ipa">{pronunciation.ipa}</span>
							<span class="pronunciation-guide" aria-hidden="true">{pronunciation.guide}</span>
						</button>{/if}
				</div>
				{#if currentWord.partOfSpeech}<span class="part-of-speech study-part-of-speech"
						>{currentWord.partOfSpeech}</span
					>{/if}
				<p class="study-meaning">{currentWord.meaning}</p>
			</article>
		{/if}
		<button
			class="study-nav"
			type="button"
			disabled={!hasNext}
			aria-label="다음 단어"
			onclick={onnext}
		>
			<span aria-hidden="true">›</span><span class="study-nav-label">다음</span>
		</button>
	</section>
{:else}
	<section class="study-list-stage" aria-labelledby="study-title" aria-live="polite">
		<button
			class="study-nav"
			type="button"
			disabled={!hasPrevious}
			aria-label="이전 단어 목록"
			onclick={onprevious}
		>
			<span aria-hidden="true">‹</span><span class="study-nav-label">이전</span>
		</button>
		<div class="study-word-list">
			{#each pageWords as word (word.id)}
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
									onpointerenter={onclosePronunciation}
									onfocus={onclosePronunciation}
									onclick={() => ontogglePronunciation(word.id)}
								>
									<span class="pronunciation-ipa">{pronunciation.ipa}</span>
									<span class="pronunciation-guide" aria-hidden="true">{pronunciation.guide}</span>
								</button>{/if}
						</div>
					</div>
					<span class="word-meaning">
						{#if word.partOfSpeech}<span class="part-of-speech">{word.partOfSpeech}</span>{/if}
						{word.meaning}
					</span>
					<form method="post" action="?/toggleStar" use:enhance>
						<input type="hidden" name="wordId" value={word.id} />
						<button
							class="star-button"
							type="submit"
							aria-label={word.starred ? `${word.english} 별표 해제` : `${word.english} 별표`}
							aria-pressed={word.starred}
						>
							<span aria-hidden="true">{word.starred ? '★' : '☆'}</span>
						</button>
					</form>
				</div>
			{/each}
		</div>
		<button
			class="study-nav"
			type="button"
			disabled={!hasNext}
			aria-label="다음 단어 목록"
			onclick={onnext}
		>
			<span aria-hidden="true">›</span><span class="study-nav-label">다음</span>
		</button>
	</section>
{/if}

<p class="study-page-status" aria-live="polite">
	{#if mode === 'card'}
		{index + 1}/{words.length}번
	{:else}
		{page + 1}/{pageCount}쪽 · {pageWords.length}개
	{/if}
</p>

<footer class="study-footer">
	{#if !hasNext}<button class="button button-secondary" type="button" onclick={ontest}
			>이 범위 테스트하기</button
		>{/if}
	{#if continuous}
		<form method="post" action="?/cancelContinuous" onsubmit={oncancelContinuous}>
			<button class="button button-danger" type="submit">연속 학습 취소</button>
		</form>
	{/if}
	<button class="button button-quiet" type="button" onclick={onexit}>돌아가기</button>
</footer>
