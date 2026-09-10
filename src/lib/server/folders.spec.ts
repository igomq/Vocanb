import { assignFolder, emptyFolderFile, folderName, pruneFolders } from '$lib/folders';
import { createFolder, deleteFolder, getFolders, renameFolder, setItemFolder } from './folders';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const userId = 'u_0123456789abcdef0123456789abcdef';
let directory: string;

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'vocanb-folders-'));
	process.env.DATA_DIR = directory;
});

afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;

describe('folder rules', () => {
	it('rejects blank and oversized names', () => {
		expect(() => folderName('  ')).toThrow('폴더 이름');
		expect(() => folderName('a'.repeat(121))).toThrow('폴더 이름');
		expect(folderName('  중간  고등  ')).toBe('중간 고등');
	});

	it('keeps an item in only one folder and drops unknown ids', () => {
		const folders = {
			...emptyFolderFile(),
			vocabulary: [
				{ id: id('1'), name: 'A', createdAt: '', updatedAt: '', itemIds: [id('9'), id('9')] },
				{ id: id('2'), name: 'B', createdAt: '', updatedAt: '', itemIds: [id('9')] }
			],
			sentence: [{ id: id('3'), name: 'C', createdAt: '', updatedAt: '', itemIds: [id('8')] }]
		};
		const pruned = pruneFolders(folders, {
			vocabulary: new Set([id('9')]),
			sentence: new Set([id('8')])
		});
		expect(pruned.vocabulary[0].itemIds).toEqual([id('9')]);
		expect(pruned.vocabulary[1].itemIds).toEqual([]);
		expect(pruned.sentence[0].itemIds).toEqual([id('8')]);
	});

	it('prunes one kind without clearing the other', () => {
		const folders = {
			...emptyFolderFile(),
			vocabulary: [{ id: id('1'), name: 'A', createdAt: '', updatedAt: '', itemIds: [id('9')] }],
			sentence: [{ id: id('2'), name: 'B', createdAt: '', updatedAt: '', itemIds: [id('8')] }]
		};
		const pruned = pruneFolders(folders, {
			vocabulary: new Set([id('9')]),
			sentence: new Set([id('8')])
		});
		expect(pruned.vocabulary[0].itemIds).toEqual([id('9')]);
		expect(pruned.sentence[0].itemIds).toEqual([id('8')]);
	});

	it('moves an item between folders and out of all folders', () => {
		const base = {
			...emptyFolderFile(),
			vocabulary: [
				{ id: id('1'), name: 'A', createdAt: '', updatedAt: '', itemIds: [id('9')] },
				{ id: id('2'), name: 'B', createdAt: '', updatedAt: '', itemIds: [] }
			]
		};
		const moved = assignFolder(base, 'vocabulary', id('9'), id('2'));
		expect(moved.vocabulary[0].itemIds).toEqual([]);
		expect(moved.vocabulary[1].itemIds).toEqual([id('9')]);
		const detached = assignFolder(moved, 'vocabulary', id('9'), null);
		expect(detached.vocabulary.flatMap(({ itemIds }) => itemIds)).toEqual([]);
	});
});

describe('folder storage', () => {
	it('starts empty and creates folders per kind', async () => {
		expect(await getFolders(userId)).toEqual(emptyFolderFile());
		const vocabulary = await createFolder(userId, 'vocabulary', '중간고사');
		const sentence = await createFolder(userId, 'sentence', '수능');
		const folders = await getFolders(userId);
		expect(folders.vocabulary.map(({ id: folderId }) => folderId)).toEqual([vocabulary.id]);
		expect(folders.sentence.map(({ name }) => name)).toEqual(['수능']);
		expect(sentence.id).not.toBe(vocabulary.id);
	});

	it('renames and deletes without touching the other kind', async () => {
		const folder = await createFolder(userId, 'vocabulary', '임시');
		await createFolder(userId, 'sentence', '보존');
		expect((await renameFolder(userId, 'vocabulary', folder.id, '확정')).name).toBe('확정');
		await deleteFolder(userId, 'vocabulary', folder.id);
		const folders = await getFolders(userId);
		expect(folders.vocabulary).toEqual([]);
		expect(folders.sentence).toHaveLength(1);
		await expect(renameFolder(userId, 'vocabulary', folder.id, '없음')).rejects.toThrow(
			'폴더를 찾을 수 없습니다'
		);
		await expect(deleteFolder(userId, 'vocabulary', folder.id)).rejects.toThrow(
			'폴더를 찾을 수 없습니다'
		);
	});

	it('files an item once and rejects an unknown folder', async () => {
		const first = await createFolder(userId, 'vocabulary', 'A');
		const second = await createFolder(userId, 'vocabulary', 'B');
		await setItemFolder(userId, 'vocabulary', id('9'), first.id);
		await setItemFolder(userId, 'vocabulary', id('9'), second.id);
		const folders = await getFolders(userId);
		expect(folders.vocabulary[0].itemIds).toEqual([]);
		expect(folders.vocabulary[1].itemIds).toEqual([id('9')]);
		await expect(setItemFolder(userId, 'vocabulary', id('9'), id('ffff'))).rejects.toThrow(
			'폴더를 찾을 수 없습니다'
		);
	});
});
