import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	createSentenceBook,
	getSentenceBook,
	updateSentenceBook
} from '$lib/server/sentence-storage';
import { POST } from './+server';
import { POST as postResults } from '../test-results/+server';
import { POST as postSummary } from '../summary/+server';
import { POST as postTranslation } from '../translation/+server';
import { generatePassageSummary, generatePassageTranslation } from '$lib/server/sentence-ai';
import type { SentenceBook } from '$lib/sentence-domain';

vi.mock('$lib/server/sentence-ai', () => ({
	generatePassageSummary: vi.fn(),
	generatePassageTranslation: vi.fn()
}));
const userId = 'u_0123456789abcdef0123456789abcdef';
let directory: string;
let book: SentenceBook;
const summary = { topic: '주제', flow: ['하나', '둘', '셋'], takeaway: '결론' };
const translation = [{ english: 'Original.', korean: '원문.' }];
const changed = [{ runs: [{ text: 'Original. Restored sentence.', memorize: true }] }];

function event(body: unknown, uid = userId) {
	return {
		request: new Request('http://localhost', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}),
		locals: { userId: uid },
		params: { id: book.id }
	} as never;
}
function edit(paragraphs: unknown = changed, uid = userId) {
	return POST(
		event(
			{
				passageId: book.passages[0].id,
				expectedParagraphs: book.passages[0].paragraphs,
				paragraphs
			},
			uid
		)
	);
}
beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'vocanb-passage-edit-'));
	process.env.DATA_DIR = directory;
	const passage = {
		label: '지문',
		sourcePageStart: 1,
		sourcePageEnd: 1,
		paragraphs: [{ runs: [{ text: 'Original.', memorize: false }] }]
	};
	book = await createSentenceBook(userId, {
		title: '수정',
		sourceFileName: 'source.pdf',
		passages: [passage, passage]
	});
	book = await updateSentenceBook(userId, book.id, (current) => {
		Object.assign(current.passages[0], {
			summary,
			translation,
			testResults: { '0:0': { status: 'correct' } }
		});
		return current;
	});
});
afterEach(async () => {
	vi.resetAllMocks();
	await rm(directory, { recursive: true, force: true });
});

it('persists restored text, clears derived results, preserves sibling passages and rejects stale writes', async () => {
	expect((await edit()).status).toBe(200);
	const saved = (await getSentenceBook(userId, book.id))!;
	expect(saved.passages[0]).toMatchObject({
		paragraphs: changed,
		summary: null,
		translation: null,
		testResults: {},
		testResultsRevision: 1
	});
	expect(saved.passages[1]).toEqual(book.passages[1]);
	await expect(edit()).rejects.toMatchObject({ status: 409 });
	expect(
		(
			await postResults(
				event({
					passageId: book.passages[0].id,
					revision: 0,
					results: { '0:0': { status: 'wrong' } }
				})
			)
		).status
	).toBe(409);
	expect((await getSentenceBook(userId, book.id))!.passages[0].testResults).toEqual({});
});

it('keeps summaries and translations for range-only changes and leaves no-op results alone', async () => {
	expect((await edit(book.passages[0].paragraphs)).status).toBe(200);
	expect((await getSentenceBook(userId, book.id))!.passages[0].testResultsRevision).toBe(0);
	expect((await edit([{ runs: [{ text: 'Original.', memorize: true }] }])).status).toBe(200);
	expect((await getSentenceBook(userId, book.id))!.passages[0]).toMatchObject({
		summary,
		translation,
		testResults: {},
		testResultsRevision: 1
	});
});

it('rejects empty content and other users without altering the book', async () => {
	for (const paragraphs of [
		[],
		[{ runs: [] }],
		[{ runs: [{ text: '  ', memorize: true }] }],
		[{ runs: [{ text: 'x', memorize: 'true' }] }]
	])
		expect((await edit(paragraphs)).status).toBe(400);
	await expect(edit(changed, 'u_fedcba9876543210fedcba9876543210')).rejects.toMatchObject({
		status: 404
	});
	expect(await getSentenceBook(userId, book.id)).toEqual(book);
});

it('does not persist summary or translation generated for text that was edited meanwhile', async () => {
	await updateSentenceBook(userId, book.id, (current) => {
		current.passages[0].summary = null;
		current.passages[0].translation = null;
		return current;
	});
	vi.mocked(generatePassageSummary).mockImplementation(async () => {
		await edit();
		return summary;
	});
	await expect(postSummary(event({ passageId: book.passages[0].id }))).rejects.toMatchObject({
		status: 409
	});
	book = (await getSentenceBook(userId, book.id))!;
	vi.mocked(generatePassageTranslation).mockImplementation(async () => {
		await edit([{ runs: [{ text: 'Changed again.', memorize: true }] }]);
		return translation;
	});
	await expect(postTranslation(event({ passageId: book.passages[0].id }))).rejects.toMatchObject({
		status: 409
	});
	expect((await getSentenceBook(userId, book.id))!.passages[0]).toMatchObject({
		summary: null,
		translation: null
	});
});
