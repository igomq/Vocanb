<script lang="ts">
	import { tick } from 'svelte';
	import type { SentencePassage } from '$lib/sentence-domain';

	let { bookId, passage }: { bookId: string; passage: SentencePassage } = $props();

	type Message = { role: 'user' | 'assistant'; content: string };
	let open = $state(false);
	let question = $state('');
	let pending = $state(false);
	let error = $state('');
	let messages = $state<Message[]>([]);
	let composer: HTMLTextAreaElement | undefined = $state();
	let messageList: HTMLDivElement | undefined = $state();
	let syncedPassageId = '';

	$effect(() => {
		if (syncedPassageId === passage.id) return;
		syncedPassageId = passage.id;
		question = '';
		error = '';
		messages = [];
	});

	async function toggle() {
		open = !open;
		if (open) {
			await tick();
			composer?.focus();
		}
	}

	async function ask(event: SubmitEvent) {
		event.preventDefault();
		const content = question.trim();
		if (!content || pending) return;
		const passageId = passage.id;
		const nextMessages = [...messages, { role: 'user' as const, content }].slice(-20);
		messages = nextMessages;
		question = '';
		error = '';
		pending = true;
		await scrollToLatest();
		try {
			const response = await fetch(`/app/s/${bookId}/chat`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ passageId, messages: nextMessages })
			});
			const body = await response.json().catch(() => null);
			if (!response.ok || typeof body?.answer !== 'string')
				throw new Error(body?.message || '답변을 받지 못했습니다.');
			if (passage.id !== passageId) return;
			messages = [...messages, { role: 'assistant', content: body.answer }];
		} catch (failure) {
			if (passage.id === passageId)
				error = failure instanceof Error ? failure.message : '답변을 받지 못했습니다.';
		} finally {
			pending = false;
			await scrollToLatest();
		}
	}

	async function scrollToLatest() {
		await tick();
		messageList?.scrollTo({ top: messageList.scrollHeight, behavior: 'smooth' });
	}

	function handleComposerKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			composer?.form?.requestSubmit();
		}
	}
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && (open = false)} />

<div class="sentence-chat">
	{#if open}
		<section class="sentence-chat-panel" aria-label="AI 지문 채팅">
			<header class="sentence-chat-header">
				<div>
					<h2>지문에 질문하기</h2>
					<p>{passage.label} · 이 지문 안에서만 답변해요</p>
				</div>
				<button class="sentence-chat-close" type="button" aria-label="채팅 닫기" onclick={toggle}>
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
				</button>
			</header>

			<div class="sentence-chat-messages" bind:this={messageList} role="log" aria-live="polite">
				{#if messages.length === 0}
					<p class="sentence-chat-empty">
						표현의 의미, 글의 흐름, 문법처럼 현재 지문에서 확인할 수 있는 내용을 물어보세요.
					</p>
				{/if}
				{#each messages as message, index (index)}
					<p class:from-user={message.role === 'user'} class="sentence-chat-message">
						{message.content}
					</p>
				{/each}
				{#if pending}<p class="sentence-chat-thinking">답변을 확인하고 있어요…</p>{/if}
			</div>

			<form class="sentence-chat-composer" onsubmit={ask}>
				<label class="visually-hidden" for="sentence-chat-question">지문에 대한 질문</label>
				<textarea
					id="sentence-chat-question"
					bind:this={composer}
					bind:value={question}
					rows="2"
					maxlength="2000"
					placeholder="이 지문에 대해 질문하세요"
					disabled={pending}
					onkeydown={handleComposerKeydown}></textarea>
				<button class="button button-primary" type="submit" disabled={pending || !question.trim()}
					>전송</button
				>
			</form>
			{#if error}<p class="sentence-chat-error" role="alert">{error}</p>{/if}
		</section>
	{/if}

	<button
		class="sentence-chat-trigger"
		type="button"
		aria-label={open ? 'AI 채팅 닫기' : 'AI에게 질문하기'}
		aria-expanded={open}
		onclick={toggle}
	>
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M5 17.5 3.8 21l3.9-1.8c1.3.6 2.7.9 4.3.9 5 0 9-3.6 9-8s-4-8-9-8-9 3.6-9 8c0 2.1.9 4 2.4 5.4Z"
			/>
			<path d="M8 12h.01M12 12h.01M16 12h.01" />
		</svg>
	</button>
</div>
