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

import { generatePassageSummary } from '$lib/server/sentence-ai';

const userId = 'u_0123456789abcdef0123456789abcdef';
let directory: string;

async function createBook() {
	return createSentenceBook(userId, {
		title: '요약 테스트',
		sourceFileName: 'sample.pdf',
		passages: [
			{
				label: '1. 24.6.20. (3강-5)',
				sourcePageStart: 1,
				sourcePageEnd: 3,
				paragraphs: [
					{
						runs: [
							{ text: 'Great things take time to build. ', memorize: false },
							{ text: 'This dream is within reach.', memorize: true }
						]
					}
				]
			}
		]
	});
}

async function postSummary(bookId: string, passageId: string) {
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

const summary = { topic: '주제', flow: ['첫째', '둘째', '셋째'], takeaway: '결론' };

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'vocanb-summary-'));
	process.env.DATA_DIR = directory;
});

afterEach(async () => {
	vi.clearAllMocks();
	await rm(directory, { recursive: true, force: true });
});

describe('passage summary endpoint', () => {
	it('returns 404 for a missing book', async () => {
		const response = await postSummary(crypto.randomUUID(), crypto.randomUUID());
		expect(response.status).toBe(404);
	});

	it('returns 400 for a malformed passage id', async () => {
		const book = await createBook();
		const response = await postSummary(book.id, 'not-a-uuid');
		expect(response.status).toBe(400);
	});

	it('returns 404 for a missing passage', async () => {
		const book = await createBook();
		const response = await postSummary(book.id, crypto.randomUUID());
		expect(response.status).toBe(404);
	});

	it('returns a cached summary without calling Gemini again', async () => {
		const book = await createBook();
		await updateSentenceBook(userId, book.id, (current) => {
			current.passages[0].summary = summary;
			return current;
		});
		const response = await postSummary(book.id, book.passages[0].id);
		expect(response.status).toBe(200);
		expect((await response.json()).summary).toEqual(summary);
		expect(generatePassageSummary).not.toHaveBeenCalled();
	});

	it('generates and persists a summary once', async () => {
		vi.mocked(generatePassageSummary).mockResolvedValue(summary);
		const book = await createBook();
		const response = await postSummary(book.id, book.passages[0].id);
		expect(response.status).toBe(200);
		expect((await response.json()).summary).toEqual(summary);
		expect(generatePassageSummary).toHaveBeenCalledTimes(1);
		expect((await getSentenceBook(userId, book.id))!.passages[0].summary).toEqual(summary);

		await postSummary(book.id, book.passages[0].id);
		expect(generatePassageSummary).toHaveBeenCalledTimes(1);
	});

	it('returns 502 when generation fails', async () => {
		vi.mocked(generatePassageSummary).mockRejectedValue(new Error('정리를 생성하지 못했습니다.'));
		const book = await createBook();
		const response = await postSummary(book.id, book.passages[0].id);
		expect(response.status).toBe(502);
		expect((await getSentenceBook(userId, book.id))!.passages[0].summary).toBeNull();
	});
});
