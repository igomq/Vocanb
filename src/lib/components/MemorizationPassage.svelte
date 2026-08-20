<script lang="ts">
	import type { SentencePassage } from '$lib/sentence-domain';
	import { SvelteSet } from 'svelte/reactivity';

	let { passage }: { passage: SentencePassage } = $props();

	const revealed = new SvelteSet<string>();

	function key(paragraphIndex: number, runIndex: number) {
		return `${paragraphIndex}:${runIndex}`;
	}

	function toggle(key: string) {
		if (revealed.has(key)) revealed.delete(key);
		else revealed.add(key);
	}

	function hideAll() {
		revealed.clear();
	}

	const hasMemorizedRuns = $derived(
		passage.paragraphs.some((paragraph) => paragraph.runs.some((run) => run.memorize))
	);
</script>

<div class="memorization-passage">
	{#each passage.paragraphs as paragraph, paragraphIndex (paragraphIndex)}
		<p class="memorization-paragraph">
			{#each paragraph.runs as run, runIndex (runIndex)}
				{#if run.memorize}
					<button
						type="button"
						class="memorization-tape"
						class:is-revealed={revealed.has(key(paragraphIndex, runIndex))}
						aria-pressed={revealed.has(key(paragraphIndex, runIndex))}
						aria-label={revealed.has(key(paragraphIndex, runIndex))
							? '암기 문장 가리기'
							: '암기 문장 보기'}
						onclick={() => toggle(key(paragraphIndex, runIndex))}>{run.text}</button
					>
				{:else}
					<span>{run.text}</span>
				{/if}
			{/each}
		</p>
	{/each}
	{#if hasMemorizedRuns}
		<div class="memorization-actions">
			<button class="button button-quiet" type="button" onclick={hideAll}>다시 가리기</button>
		</div>
	{/if}
</div>
