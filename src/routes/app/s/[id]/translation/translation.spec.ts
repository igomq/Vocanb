import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	createSentenceBook,
	getSentenceBook,
	updateSentenceBook
} from '$lib/server/sentence-storage';
import { POST } from './+server';

vi.mock('$lib/server/sentence-ai', () => ({
	generatePassageSummary: vi.fn(),
	generatePassageTranslation: vi.fn()
}));

import { generatePassageTranslation } from '$lib/server/sentence-ai';

const userId = 'u_0123456789abcdef0123456789abcdef';
let directory: string;

async function createBook() {
	return createSentenceBook(userId, {
		title: '번역 테스트',
		sourceFileName: 'sample.pdf',
		passages: [
			{
				label: '1. 24.6.20. (3강-5)',
				sourcePageStart: 1,
				sourcePageEnd: 2,
				paragraphs: [
					{
						runs: [
							{
								text: 'Great things take time to build. This dream is within reach.',
								memorize: false
							}
						]
					}
				]
			}
		]
	});
}

async function postTranslation(bookId: string, passageId: string) {
	return POST({
		request: new Request('http://localhost', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ passageId })
		}),
		locals: { userId },
		params: { id: bookId }
	} as never);
}

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'vocanb-translation-'));
	process.env.DATA_DIR = directory;
});

afterEach(async () => {
	vi.clearAllMocks();
	await rm(directory, { recursive: true, force: true });
});

describe('passage translation endpoint', () => {
	it('returns 404 for a missing book', async () => {
		const response = await postTranslation(crypto.randomUUID(), crypto.randomUUID());
		expect(response.status).toBe(404);
	});

	it('returns 400 for a malformed passage id', async () => {
		const book = await createBook();
		const response = await postTranslation(book.id, 'nope');
		expect(response.status).toBe(400);
	});

	it('returns 404 for a missing passage', async () => {
		const book = await createBook();
		const response = await postTranslation(book.id, crypto.randomUUID());
		expect(response.status).toBe(404);
	});

	it('returns cached translations without calling Gemini again', async () => {
		const cached = [
			{ english: 'Great things take time to build.', korean: '큰 일은 시간이 걸린다.' }
		];
		const book = await createBook();
		await updateSentenceBook(userId, book.id, (current) => {
			current.passages[0].translation = cached;
			return current;
		});
		const response = await postTranslation(book.id, book.passages[0].id);
		expect(response.status).toBe(200);
		expect((await response.json()).translations).toEqual(cached);
		expect(generatePassageTranslation).not.toHaveBeenCalled();
	});

	it('generates and persists translations once', async () => {
		vi.mocked(generatePassageTranslation).mockResolvedValue([
			{ english: 'Great things take time to build.', korean: '큰 일은 시간이 걸린다.' },
			{ english: 'This dream is within reach.', korean: '이 꿈은 손이 닿는 곳에 있다.' }
		]);
		const book = await createBook();
		const response = await postTranslation(book.id, book.passages[0].id);
		expect(response.status).toBe(200);
		expect(generatePassageTranslation).toHaveBeenCalledTimes(1);
		expect((await getSentenceBook(userId, book.id))!.passages[0].translation).toHaveLength(2);

		await postTranslation(book.id, book.passages[0].id);
		expect(generatePassageTranslation).toHaveBeenCalledTimes(1);
	});

	it('returns 502 when generation fails', async () => {
		vi.mocked(generatePassageTranslation).mockRejectedValue(
			new Error('번역을 생성하지 못했습니다.')
		);
		const book = await createBook();
		const response = await postTranslation(book.id, book.passages[0].id);
		expect(response.status).toBe(502);
		expect((await getSentenceBook(userId, book.id))!.passages[0].translation).toBeNull();
	});
});
