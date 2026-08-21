import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSentenceBook, getSentenceBook } from '$lib/server/sentence-storage';
import { POST } from './+server';

const userId = 'u_0123456789abcdef0123456789abcdef';
let directory: string;

async function createBook() {
	return createSentenceBook(userId, {
		title: '결과 테스트',
		sourceFileName: 'sample.pdf',
		passages: [
			{
				label: '1',
				sourcePageStart: 1,
				sourcePageEnd: 1,
				paragraphs: [{ runs: [{ text: 'Great things take time.', memorize: true }] }]
			}
		]
	});
}

function post(bookId: string, passageId: string, results: unknown) {
	return POST({
		request: new Request('http://localhost', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ passageId, results })
		}),
		locals: { userId },
		params: { id: bookId }
	} as never);
}

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'vocanb-results-'));
	process.env.DATA_DIR = directory;
});

afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

describe('sentence test results endpoint', () => {
	it('persists and replaces passage results', async () => {
		const book = await createBook();
		const passageId = book.passages[0].id;
		const results = { '0:0': { status: 'partial', score: 79, wrongWordIndexes: [2] } };
		const response = await post(book.id, passageId, results);
		expect(response.status).toBe(200);
		expect((await getSentenceBook(userId, book.id))!.passages[0].testResults).toEqual(results);

		await post(book.id, passageId, {});
		expect((await getSentenceBook(userId, book.id))!.passages[0].testResults).toEqual({});
	});

	it('rejects malformed results and missing passages', async () => {
		const book = await createBook();
		expect((await post(book.id, book.passages[0].id, { bad: { status: 'nope' } })).status).toBe(
			400
		);
		expect((await post(book.id, crypto.randomUUID(), {})).status).toBe(404);
	});
});
