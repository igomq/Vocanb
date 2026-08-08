import {
	createVocabulary,
	deleteVocabulary,
	getVocabulary,
	listVocabularies,
	uploadDirectory,
	updateVocabulary
} from './storage';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const userId = 'u_0123456789abcdef0123456789abcdef';
let directory: string;

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'vocanb-'));
	process.env.DATA_DIR = directory;
});

afterEach(async () => rm(directory, { recursive: true, force: true }));

describe('filesystem storage', () => {
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
});
