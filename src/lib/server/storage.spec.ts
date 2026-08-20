import {
	createVocabulary,
	deleteVocabulary,
	getVocabulary,
	listVocabularies,
	uploadDirectory,
	updateVocabulary
} from './storage';
import { MAX_TEST_HISTORY } from './storage';
import { createTestSession, type Word } from '$lib/domain';
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
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

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'vocanb-'));
	process.env.DATA_DIR = directory;
});

afterEach(async () => {
	const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
	vi.restoreAllMocks();
	vi.mocked(fsPromises.rename).mockReset().mockImplementation(actual.rename);
	vi.mocked(fsPromises.rm).mockReset().mockImplementation(actual.rm);
	await actual.rm(directory, { recursive: true, force: true });
});

describe('filesystem storage', () => {
	it('bounds persisted test history', async () => {
		const vocabulary = await createVocabulary(userId, '기록 상한', '');
		const now = new Date().toISOString();
		const word: Word = {
			id: crypto.randomUUID(),
			number: 1,
			english: 'word',
			meaning: '뜻',
			sourceImageId: null,
			uncertain: false,
			starred: false,
			createdAt: now,
			updatedAt: now
		};
		const tests = Array.from({ length: MAX_TEST_HISTORY + 1 }, () =>
			createTestSession([word], { start: 1, end: 1 }, 'sequential', 'english-to-korean')
		);

		await updateVocabulary(userId, vocabulary.id, (current) => ({
			...current,
			words: [word],
			tests
		}));

		const stored = await getVocabulary(userId, vocabulary.id);
		expect(stored?.tests).toHaveLength(MAX_TEST_HISTORY);
		expect(stored?.tests[0].id).toBe(tests[1].id);
	});

	it('creates duplicate titles as separate vocabularies', async () => {
		const first = await createVocabulary(userId, '워드마스터', 'Day 1');
		const second = await createVocabulary(userId, '워드마스터', 'Day 1');
		expect(first.id).not.toBe(second.id);
		expect(await listVocabularies(userId)).toHaveLength(2);
	});

	it('serializes concurrent updates and keeps sequential numbering across images', async () => {
		const vocabulary = await createVocabulary(userId, '수능', '1~10');
		const append = (english: string, imageId: string) =>
			updateVocabulary(userId, vocabulary.id, (current) => {
				const number = Math.max(0, ...current.words.map((word) => word.number)) + 1;
				const now = new Date().toISOString();
				current.images.push({
					id: imageId,
					filename: `${imageId}.jpg`,
					createdAt: now,
					wordCount: 1
				});
				current.words.push({
					id: crypto.randomUUID(),
					number,
					english,
					meaning: `뜻-${english}`,
					sourceImageId: imageId,
					uncertain: false,
					createdAt: now,
					updatedAt: now
				});
				return current;
			});
		await Promise.all([
			append('apple', '10000000-0000-4000-8000-000000000001'),
			append('banana', '10000000-0000-4000-8000-000000000002')
		]);
		const stored = await getVocabulary(userId, vocabulary.id);
		expect(stored?.words.map(({ number }) => number)).toEqual([1, 2]);
		expect(stored?.images).toHaveLength(2);
	});

	it('reports malformed JSON instead of overwriting it', async () => {
		const vocabulary = await createVocabulary(userId, '깨진 파일', '');
		const path = join(directory, 'users', userId, 'vocabularies', `${vocabulary.id}.json`);
		await writeFile(path, '{broken', 'utf8');
		await expect(getVocabulary(userId, vocabulary.id)).rejects.toThrow('읽을 수 없습니다');
	});

	it('deletes a vocabulary from storage and the user index', async () => {
		const vocabulary = await createVocabulary(userId, '삭제할 단어장', '');
		const uploads = uploadDirectory(userId, vocabulary.id);
		await mkdir(uploads, { recursive: true });
		await writeFile(join(uploads, 'image.jpg'), 'image');
		await deleteVocabulary(userId, vocabulary.id);
		expect(await getVocabulary(userId, vocabulary.id)).toBeNull();
		expect(await listVocabularies(userId)).toEqual([]);
		await expect(access(uploads)).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('deletes only the selected vocabulary and preserves siblings', async () => {
		const first = await createVocabulary(userId, '첫 번째', '');
		const second = await createVocabulary(userId, '두 번째', '');
		const siblingUploads = uploadDirectory(userId, second.id);
		await mkdir(siblingUploads, { recursive: true });
		await writeFile(join(siblingUploads, 'sibling.jpg'), 'sibling');

		await deleteVocabulary(userId, first.id);

		expect((await listVocabularies(userId)).map(({ id }) => id)).toEqual([second.id]);
		expect(await getVocabulary(userId, second.id)).toMatchObject({ id: second.id });
		expect(await access(join(siblingUploads, 'sibling.jpg'))).toBeUndefined();
	});

	it('rejects missing and other-user IDs without changing data', async () => {
		const vocabulary = await createVocabulary(userId, '보존', '');
		const uploads = uploadDirectory(userId, vocabulary.id);
		await mkdir(uploads, { recursive: true });
		await writeFile(join(uploads, 'keep.jpg'), 'keep');
		const before = await getVocabulary(userId, vocabulary.id);

		await expect(deleteVocabulary(userId, crypto.randomUUID())).rejects.toThrow('찾을 수 없습니다');
		await expect(
			deleteVocabulary('u_fedcba9876543210fedcba9876543210', vocabulary.id)
		).rejects.toThrow('찾을 수 없습니다');

		expect(await getVocabulary(userId, vocabulary.id)).toEqual(before);
		expect(await access(join(uploads, 'keep.jpg'))).toBeUndefined();
	});

	it('does not clean up files when the index commit fails', async () => {
		const vocabulary = await createVocabulary(userId, '색인 실패', '');
		const uploads = uploadDirectory(userId, vocabulary.id);
		await mkdir(uploads, { recursive: true });
		await writeFile(join(uploads, 'keep.jpg'), 'keep');
		vi.mocked(fsPromises.rename).mockRejectedValueOnce(new Error('index failed'));

		await expect(deleteVocabulary(userId, vocabulary.id)).rejects.toThrow('index failed');

		expect(await getVocabulary(userId, vocabulary.id)).toEqual(vocabulary);
		expect(await access(join(uploads, 'keep.jpg'))).toBeUndefined();
	});

	it('removes every duplicate occurrence from a valid index', async () => {
		const vocabulary = await createVocabulary(userId, '중복 색인', '');
		await writeFile(
			join(directory, 'users', userId, 'index.json'),
			JSON.stringify({ schemaVersion: 1, vocabularyIds: [vocabulary.id, vocabulary.id] })
		);

		await deleteVocabulary(userId, vocabulary.id);

		expect(await listVocabularies(userId)).toEqual([]);
	});

	it('keeps the index committed when cleanup fails', async () => {
		const vocabulary = await createVocabulary(userId, '정리 실패', '');
		const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
		vi.mocked(fsPromises.rm)
			.mockImplementationOnce(actual.rm)
			.mockRejectedValueOnce(new Error('cleanup failed'));

		await expect(deleteVocabulary(userId, vocabulary.id)).resolves.toBeUndefined();

		expect(await listVocabularies(userId)).toEqual([]);
		expect(await getVocabulary(userId, vocabulary.id)).toBeNull();
	});
});
