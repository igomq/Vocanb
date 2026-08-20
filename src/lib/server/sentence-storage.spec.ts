import {
	createSentenceBook,
	deleteSentenceBook,
	getSentenceBook,
	listSentenceBooks,
	updateSentenceBook
} from './sentence-storage';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:fs/promises')>();
	return { ...actual, rename: vi.fn(actual.rename), rm: vi.fn(actual.rm) };
});

const userId = 'u_0123456789abcdef0123456789abcdef';
let directory: string;

function passage(input = {}) {
	return {
		label: '1. 24.6.20. (3강-5)',
		sourcePageStart: 1,
		sourcePageEnd: 3,
		paragraphs: [
			{
				runs: [
					{ text: 'Most people resist ', memorize: false },
					{ text: 'the idea', memorize: true }
				]
			}
		],
		...input
	};
}

async function createBook(title = '보정고2 부교재', extra = {}) {
	return createSentenceBook(userId, {
		title,
		sourceFileName: 'sample.pdf',
		passages: [passage()],
		...extra
	});
}

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'vocanb-sentence-'));
	process.env.DATA_DIR = directory;
});

afterEach(async () => {
	const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
	vi.restoreAllMocks();
	vi.mocked(fsPromises.rename).mockReset().mockImplementation(actual.rename);
	vi.mocked(fsPromises.rm).mockReset().mockImplementation(actual.rm);
	await actual.rm(directory, { recursive: true, force: true });
});

describe('sentence book storage', () => {
	it('creates, lists, gets, updates and deletes a book', async () => {
		const created = await createBook();
		expect(created.passages[0]).toMatchObject({
			order: 0,
			label: '1. 24.6.20. (3강-5)',
			summary: null,
			translation: null
		});
		expect((await listSentenceBooks(userId)).map(({ id }) => id)).toEqual([created.id]);
		expect((await getSentenceBook(userId, created.id))?.title).toBe('보정고2 부교재');

		const updated = await updateSentenceBook(userId, created.id, (current) => {
			current.passages[0].summary = {
				topic: '주제',
				flow: ['첫째', '둘째', '셋째'],
				takeaway: '결론'
			};
			return current;
		});
		expect(updated.passages[0].summary?.topic).toBe('주제');
		expect(updated.updatedAt >= created.updatedAt).toBe(true);

		await deleteSentenceBook(userId, created.id);
		expect(await getSentenceBook(userId, created.id)).toBeNull();
		expect(await listSentenceBooks(userId)).toEqual([]);
	});

	it('keeps sibling books when deleting one', async () => {
		const first = await createBook('첫 번째');
		const second = await createBook('두 번째');
		await deleteSentenceBook(userId, first.id);
		expect((await listSentenceBooks(userId)).map(({ id }) => id)).toEqual([second.id]);
		expect(await getSentenceBook(userId, second.id)).toMatchObject({ title: '두 번째' });
	});

	it('rejects deletion of missing books without touching the index', async () => {
		const created = await createBook();
		const indexBefore = await readFile(
			join(directory, 'users', userId, 'sentence-index.json'),
			'utf8'
		);
		await expect(deleteSentenceBook(userId, crypto.randomUUID())).rejects.toThrow(
			'찾을 수 없습니다'
		);
		const indexAfter = await readFile(
			join(directory, 'users', userId, 'sentence-index.json'),
			'utf8'
		);
		expect(indexAfter).toBe(indexBefore);
		expect(await getSentenceBook(userId, created.id)).not.toBeNull();
	});

	it('does not leave a broken index when the index write fails', async () => {
		await createBook('첫 번째');
		const before = await readFile(join(directory, 'users', userId, 'sentence-index.json'), 'utf8');
		vi.mocked(fsPromises.rename).mockRejectedValueOnce(new Error('index write failed'));

		await expect(createBook('두 번째')).rejects.toThrow('index write failed');

		expect(await readFile(join(directory, 'users', userId, 'sentence-index.json'), 'utf8')).toBe(
			before
		);
		expect(await listSentenceBooks(userId)).toHaveLength(1);
	});

	it('isolates users by directory', async () => {
		const created = await createBook('내 책');
		const other = 'u_fedcba9876543210fedcba9876543210';
		expect(await getSentenceBook(other, created.id)).toBeNull();
		expect(await listSentenceBooks(other)).toEqual([]);
	});

	it('reports malformed book JSON instead of overwriting it', async () => {
		const created = await createBook();
		const path = join(directory, 'users', userId, 'sentence-books', `${created.id}.json`);
		await writeFile(path, '{broken', 'utf8');
		await expect(getSentenceBook(userId, created.id)).rejects.toThrow('읽을 수 없습니다');
	});
});
