<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import type { Pronunciation, ResultStatus, Word } from '$lib/domain';
	import type { SvelteSet } from 'svelte/reactivity';

	let {
		words,
		selectionMode,
		selectedWordIds,
		revealedPronunciation,
		statusFor,
		pronunciationFor,
		imageNumberFor,
		enhanceDeleteWords,
		confirmDeleteWords,
		ontoggleWordSelection,
		ontogglePronunciation,
		onclosePronunciation,
		onedit
	}: {
		words: Word[];
		selectionMode: boolean;
		selectedWordIds: SvelteSet<string>;
		revealedPronunciation: string | null;
		statusFor: (wordId: string) => ResultStatus | undefined;
		pronunciationFor: (word: Word) => Pronunciation | null | undefined;
		imageNumberFor: (sourceImageId: string | null | undefined) => number | undefined;
		enhanceDeleteWords: SubmitFunction;
		confirmDeleteWords: (event: SubmitEvent) => void;
		ontoggleWordSelection: (event: Event, wordId: string) => void;
		ontogglePronunciation: (wordId: string) => void;
		onclosePronunciation: () => void;
		onedit: (word?: Word) => void;
	} = $props();

	function statusLabel(status: ResultStatus) {
		return { correct: '맞음', wrong: '틀림', unknown: '아예 몰랐음', ambiguous: '애매함' }[status];
	}
</script>

<form id="toggle-star-form" method="post" action="?/toggleStar" use:enhance></form>
<form
	id="bulk-delete-form"
	method="post"
	action="?/deleteWords"
	use:enhance={enhanceDeleteWords}
	onsubmit={confirmDeleteWords}
>
	<section class:word-list-selecting={selectionMode} class="word-list" aria-label="단어 목록">
		{#each words as word (word.id)}
			{@const status = statusFor(word.id)}
			{@const pronunciation = pronunciationFor(word)}
			{@const imageNumber = imageNumberFor(word.sourceImageId)}
			<div class="word-row">
				{#if selectionMode}
					<label class="word-select" aria-label={`${word.english} 선택`}>
						<input
							type="checkbox"
							name="wordIds"
							value={word.id}
							form="bulk-delete-form"
							checked={selectedWordIds.has(word.id)}
							onchange={(event) => ontoggleWordSelection(event, word.id)}
						/>
					</label>
				{/if}
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
								onpointerenter={onclosePronunciation}
								onfocus={onclosePronunciation}
								onclick={() => ontogglePronunciation(word.id)}
							>
								<span class="pronunciation-ipa">{pronunciation.ipa}</span>
								<span class="pronunciation-guide" aria-hidden="true">{pronunciation.guide}</span>
							</button>{/if}
					</div>
					<div class="word-meta">
						{#if imageNumber}<span class="word-source">사진 {imageNumber}</span
							>{:else if word.sourceImageId === null}<span class="word-source is-manual"
								>직접 입력</span
							>{/if}
						{#if word.uncertain}<span class="word-status status-ambiguous">확인 필요</span>{/if}
						{#if status}
							<span
								class={`word-status status-${status}`}
								title={`최근 결과: ${statusLabel(status)}`}>{statusLabel(status)}</span
							>
						{/if}
					</div>
				</div>
				<span class="word-meaning">
					{#if word.partOfSpeech}<span class="part-of-speech">{word.partOfSpeech}</span>{/if}
					{word.meaning}
				</span>
				<button
					class="star-button"
					form="toggle-star-form"
					name="wordId"
					value={word.id}
					type="submit"
					aria-label={word.starred ? `${word.english} 별표 해제` : `${word.english} 별표`}
					aria-pressed={word.starred}
				>
					<span aria-hidden="true">{word.starred ? '★' : '☆'}</span>
				</button>
				<button
					class="word-edit"
					type="button"
					disabled={selectionMode}
					onclick={() => onedit(word)}
					aria-label={`${word.english} 단어 편집`}>편집</button
				>
			</div>
		{/each}
	</section>
</form>
