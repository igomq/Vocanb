<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import type { SentencePassage } from '$lib/sentence-domain';
	import { chatHistory, readChatStream, type ChatMessage } from '$lib/chat-stream';
	import { renderChatMarkdown } from '$lib/chat-markdown';

	let { bookId, passage }: { bookId: string; passage: SentencePassage } = $props();

	let open = $state(false);
	let question = $state('');
	let pending = $state(false);
	let error = $state('');
	let messages = $state<ChatMessage[]>([]);
	let composer: HTMLTextAreaElement | undefined = $state();
	let messageList: HTMLDivElement | undefined = $state();
	let syncedContext = '';
	let activeRequest: AbortController | undefined;
	const context = $derived(`${bookId}:${passage.id}:${JSON.stringify(passage.paragraphs)}`);

	$effect(() => {
		if (syncedContext === context) return;
		syncedContext = context;
		activeRequest?.abort();
		activeRequest = undefined;
		pending = false;
		question = '';
		error = '';
		messages = [];
	});
	onDestroy(() => activeRequest?.abort());

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
		const nextMessages = [
			...messages.filter((message) => message.content),
			{ role: 'user' as const, content }
		].slice(-20);
		const request = new AbortController();
		activeRequest = request;
		messages = [...nextMessages, { role: 'assistant', content: '' }];
		question = '';
		error = '';
		pending = true;
		await scrollToLatest();
		try {
			const response = await fetch(`/app/s/${bookId}/chat`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
				body: JSON.stringify({ passageId, messages: chatHistory(nextMessages) }),
				signal: request.signal
			});
			for await (const delta of readChatStream(response)) {
				if (activeRequest !== request || request.signal.aborted) return;
				const follow =
					!messageList ||
					messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < 80;
				messages[nextMessages.length].content += delta;
				if (follow) await scrollToLatest();
			}
		} catch (failure) {
			if (activeRequest === request && !request.signal.aborted) {
				error = failure instanceof Error ? failure.message : '답변을 받지 못했습니다.';
				if (!messages.at(-1)?.content) {
					messages = nextMessages.slice(0, -1);
					question = content;
				}
			}
		} finally {
			if (activeRequest === request) {
				activeRequest = undefined;
				pending = false;
			}
		}
	}

	async function scrollToLatest() {
		await tick();
		messageList?.scrollTo({ top: messageList.scrollHeight, behavior: 'instant' });
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
					<p>{passage.label} · 단어 뜻부터 문장 분석까지</p>
				</div>
				<button class="sentence-chat-close" type="button" aria-label="채팅 닫기" onclick={toggle}>
					<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
				</button>
			</header>

			<div
				class="sentence-chat-messages"
				bind:this={messageList}
				role="log"
				aria-live="polite"
				aria-busy={pending}
			>
				{#if messages.length === 0}
					<p class="sentence-chat-empty">
						단어 뜻, 문법, 해석을 물어보거나 내가 분석한 문장이 맞는지 확인해 보세요. 지문 밖의
						표현도 질문할 수 있어요.
					</p>
				{/if}
				{#each messages as message, index (index)}
					{#if message.content}
						<div class:from-user={message.role === 'user'} class="sentence-chat-message">
							{#if message.role === 'assistant'}
								<div class="sentence-chat-markdown">
									<!-- Raw HTML and unsafe links are disabled by the Markdown renderer. -->
									<!-- eslint-disable-next-line svelte/no-at-html-tags -->
									{@html renderChatMarkdown(message.content)}
								</div>
							{:else}{message.content}{/if}
						</div>
					{/if}
				{/each}
				{#if pending}<p class="sentence-chat-thinking">
						{messages.at(-1)?.content ? '답변 작성 중…' : '답변을 확인하고 있어요…'}
					</p>{/if}
			</div>

			<form class="sentence-chat-composer" onsubmit={ask}>
				<label class="visually-hidden" for="sentence-chat-question">지문에 대한 질문</label>
				<textarea
					id="sentence-chat-question"
					bind:this={composer}
					bind:value={question}
					rows="2"
					maxlength="2000"
					placeholder="단어 뜻이나 문장 분석을 물어보세요"
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
