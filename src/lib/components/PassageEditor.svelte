<script lang="ts">
	import { untrack } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import {
		editMemorizationText,
		spliceMemorizationRuns,
		type PassageParagraph,
		type SentencePassage
	} from '$lib/sentence-domain';

	let {
		bookId,
		passage,
		onsave,
		oncancel
	}: {
		bookId: string;
		passage: SentencePassage;
		onsave: (passage: SentencePassage) => void;
		oncancel: () => void;
	} = $props();
	const original = untrack(() => JSON.stringify(passage.paragraphs));
	let paragraphs = $state<PassageParagraph[]>(JSON.parse(original));
	let pending = $state(false);
	let message = $state('');
	let saved = false;
	const dirty = $derived(JSON.stringify(paragraphs) !== original);

	function canLeave() {
		return saved || (!pending && (!dirty || window.confirm('저장하지 않은 수정 내용을 버릴까요?')));
	}
	beforeNavigate(({ cancel }) => {
		if (!canLeave()) cancel();
	});

	function markSelection(index: number, field: HTMLTextAreaElement, memorize: boolean) {
		const start = field.selectionStart;
		const end = field.selectionEnd;
		if (start === end) {
			message = '본문에서 수정할 부분을 먼저 선택해 주세요.';
			field.focus();
			return;
		}
		paragraphs[index].runs = spliceMemorizationRuns(paragraphs[index].runs, start, end, [
			{ text: field.value.slice(start, end), memorize }
		]);
		message = '';
		field.focus();
		field.setSelectionRange(start, end);
	}

	async function save() {
		pending = true;
		message = '';
		try {
			const response = await fetch(`/app/s/${bookId}/passage`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					passageId: passage.id,
					paragraphs,
					expectedParagraphs: JSON.parse(original)
				})
			});
			const body = await response.json().catch(() => null);
			if (!response.ok || !body?.passage)
				throw new Error(
					body?.message || '수정 내용을 저장하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.'
				);
			saved = true;
			onsave(body.passage);
		} catch (error) {
			message = error instanceof Error ? error.message : '연결을 확인한 뒤 다시 저장해 주세요.';
		} finally {
			pending = false;
		}
	}
</script>

<form
	class="form-stack passage-editor"
	onsubmit={(event) => {
		event.preventDefault();
		void save();
	}}
>
	<div>
		<h3>본문·암기 범위 수정</h3>
		<p>
			누락된 문장을 입력하거나 본문을 고친 뒤, 원하는 부분을 선택해 암기 범위를 지정하세요. 새로
			입력한 글자는 직접 암기 범위로 지정해 주세요.
		</p>
		<p>
			저장하면 이 지문의 테스트 결과가 초기화됩니다. 본문을 바꾸면 정리와 번역도 다시 생성합니다.
		</p>
	</div>
	<fieldset disabled={pending}>
		{#each paragraphs as paragraph, index (index)}
			{@const fieldId = `edit-paragraph-${index}`}
			<div class="paragraph-editor">
				<label for={fieldId}>문단 {index + 1}</label>
				<textarea
					id={fieldId}
					rows="6"
					maxlength="100000"
					required
					value={paragraph.runs.map((run) => run.text).join('')}
					oninput={(event) => {
						paragraph.runs = editMemorizationText(paragraph.runs, event.currentTarget.value);
					}}></textarea>
				<div class="button-row">
					<button
						class="button button-secondary"
						type="button"
						onclick={() =>
							markSelection(index, document.getElementById(fieldId) as HTMLTextAreaElement, true)}
						>선택 부분 암기</button
					>
					<button
						class="button button-secondary"
						type="button"
						onclick={() =>
							markSelection(index, document.getElementById(fieldId) as HTMLTextAreaElement, false)}
						>선택 부분 해제</button
					>
					<button
						class="button button-quiet"
						type="button"
						disabled={paragraphs.length === 1}
						onclick={() => {
							if (
								!paragraph.runs.some((run) => run.text.trim()) ||
								window.confirm('이 문단의 본문을 삭제할까요?')
							)
								paragraphs.splice(index, 1);
						}}>문단 삭제</button
					>
				</div>
				<div class="range-preview" aria-label={`문단 ${index + 1} 암기 범위 미리보기`}>
					<span class="preview-label">암기 범위 미리보기 · 표시된 부분을 가립니다</span>
					<p>
						{#each paragraph.runs as run, runIndex (runIndex)}{#if run.memorize}<mark
									>{run.text}</mark
								>{:else}{run.text}{/if}{/each}
					</p>
				</div>
			</div>
		{/each}
		<button
			class="button button-secondary"
			type="button"
			onclick={() => paragraphs.push({ runs: [] })}>문단 추가</button
		>
	</fieldset>
	{#if message}<p class="message message-error" role="alert">{message}</p>{/if}
	<div class="button-row">
		<button class="button button-primary" type="submit" disabled={pending || !dirty}
			>{pending ? '저장 중…' : '수정 저장'}</button
		>
		<button
			class="button button-secondary"
			type="button"
			disabled={pending}
			onclick={() => {
				if (canLeave()) oncancel();
			}}>취소</button
		>
	</div>
</form>

<style>
	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
		min-width: 0;
	}
	.paragraph-editor {
		display: grid;
		gap: 12px;
		margin-bottom: 24px;
	}
	textarea {
		width: 100%;
		min-height: 140px;
		resize: vertical;
		padding: 12px;
		border: 1px solid var(--line);
		border-radius: 8px;
		font: inherit;
		line-height: 1.7;
		color: var(--ink);
		background: var(--panel);
	}
	textarea:focus-visible {
		outline: 3px solid var(--accent);
		outline-offset: 2px;
	}
	.passage-editor p {
		line-height: 1.7;
		overflow-wrap: anywhere;
	}
	.range-preview {
		padding: 12px;
		background: var(--soft);
		border-radius: 8px;
	}
	.range-preview p {
		margin: 8px 0 0;
		white-space: pre-wrap;
	}
	.preview-label {
		font-size: 0.875rem;
	}
	mark {
		background: var(--accent-soft);
		color: var(--ink);
		text-decoration: underline;
		text-decoration-color: var(--accent);
		text-underline-offset: 3px;
	}
</style>
