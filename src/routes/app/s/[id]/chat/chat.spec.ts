import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSentenceBook } from '$lib/server/sentence-storage';
import { POST } from './+server';

vi.mock('$lib/server/sentence-ai', () => ({ generatePassageChatAnswer: vi.fn() }));

import { generatePassageChatAnswer } from '$lib/server/sentence-ai';

const userId = 'u_0123456789abcdef0123456789abcdef';
let directory: string;

async function createBook() {
	return createSentenceBook(userId, {
		title: '채팅 테스트',
		sourceFileName: 'sample.pdf',
		passages: [
			{
				label: 'Passage 1',
				sourcePageStart: 1,
				sourcePageEnd: 1,
				paragraphs: [{ runs: [{ text: 'Only this passage reaches Gemini.', memorize: false }] }]
			}
		]
	});
}

async function postChat(
	bookId: string,
	passageId: string,
	messages: unknown = [{ role: 'user', content: '무슨 뜻이야?' }],
	accept = 'application/json'
) {
	return POST({
		request: new Request('http://localhost', {
			method: 'POST',
			headers: { 'content-type': 'application/json', accept },
			body: JSON.stringify({ passageId, messages })
		}),
		locals: { userId },
		params: { id: bookId }
	} as never);
}

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'vocanb-chat-'));
	process.env.DATA_DIR = directory;
});

afterEach(async () => {
	vi.clearAllMocks();
	await rm(directory, { recursive: true, force: true });
});

describe('passage chat endpoint', () => {
	it('delivers text before generation finishes and then signals completion', async () => {
		let finish!: () => void;
		const held = new Promise<void>((resolve) => {
			finish = resolve;
		});
		vi.mocked(generatePassageChatAnswer).mockImplementation(async (_text, _messages, stream) => {
			stream!.onDelta('첫 답변');
			await held;
			stream!.onDelta('\n**후속**');
			return '첫 답변\n**후속**';
		});
		const book = await createBook();
		const response = await postChat(
			book.id,
			book.passages[0].id,
			undefined,
			'application/x-ndjson'
		);
		expect(response.headers.get('x-accel-buffering')).toBe('no');
		const reader = response.body!.getReader();
		const decoder = new TextDecoder();
		expect(decoder.decode((await reader.read()).value)).toBe('\n');
		expect(JSON.parse(decoder.decode((await reader.read()).value))).toEqual({
			type: 'delta',
			text: '첫 답변'
		});
		finish();
		let tail = '';
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			tail += decoder.decode(value);
		}
		expect(
			tail
				.trim()
				.split('\n')
				.map((line) => JSON.parse(line))
		).toEqual([{ type: 'delta', text: '\n**후속**' }, { type: 'done' }]);
	});

	it('reports stream failures in-band and aborts generation on disconnect', async () => {
		const book = await createBook();
		vi.mocked(generatePassageChatAnswer).mockRejectedValue(new Error('provider failed'));
		const failure = await postChat(book.id, book.passages[0].id, undefined, 'application/x-ndjson');
		expect(JSON.parse((await failure.text()).trim()).type).toBe('error');
		let signal!: AbortSignal;
		vi.mocked(generatePassageChatAnswer).mockImplementation((_text, _messages, stream) => {
			signal = stream!.signal;
			return new Promise((_resolve, reject) =>
				signal.addEventListener('abort', () => reject(signal.reason), { once: true })
			);
		});
		const response = await postChat(
			book.id,
			book.passages[0].id,
			undefined,
			'application/x-ndjson'
		);
		await response.body!.cancel();
		expect(signal.aborted).toBe(true);
	});

	it('validates the passage and question', async () => {
		const book = await createBook();
		expect((await postChat(book.id, 'not-a-uuid')).status).toBe(400);
		expect((await postChat(book.id, book.passages[0].id, [])).status).toBe(400);
		expect((await postChat(book.id, crypto.randomUUID())).status).toBe(404);
	});

	it('sends only the stored active passage and question to Gemini', async () => {
		vi.mocked(generatePassageChatAnswer).mockResolvedValue('지문 기반 답변');
		const book = await createBook();
		const messages = [
			{ role: 'user', content: '첫 질문' },
			{ role: 'assistant', content: '첫 답변' },
			{ role: 'user', content: '후속 질문' }
		];
		const response = await postChat(book.id, book.passages[0].id, messages);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ answer: '지문 기반 답변' });
		expect(generatePassageChatAnswer).toHaveBeenCalledWith(
			'Only this passage reaches Gemini.',
			messages
		);
	});

	it('returns 502 when Gemini fails', async () => {
		vi.mocked(generatePassageChatAnswer).mockRejectedValue(new Error('답변 실패'));
		const book = await createBook();
		expect((await postChat(book.id, book.passages[0].id)).status).toBe(502);
	});
});
