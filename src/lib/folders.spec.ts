import { describe, expect, it } from 'vitest';
import { moveFolderItem, type FolderFile } from './folders';

const file = (): FolderFile => ({
	schemaVersion: 1,
	vocabulary: [
		{ id: 'f1', name: 'A', createdAt: '', updatedAt: '', itemIds: ['a', 'b', 'c'] },
		{ id: 'f2', name: 'B', createdAt: '', updatedAt: '', itemIds: ['d'] }
	],
	sentence: []
});

describe('moveFolderItem', () => {
	it('moves within a folder before another item', () => {
		const next = moveFolderItem(file(), 'vocabulary', 'c', 'f1', 'a');
		expect(next.vocabulary[0].itemIds).toEqual(['c', 'a', 'b']);
	});

	it('appends to the end when beforeId is null', () => {
		const next = moveFolderItem(file(), 'vocabulary', 'a', 'f1', null);
		expect(next.vocabulary[0].itemIds).toEqual(['b', 'c', 'a']);
	});

	it('moves across folders', () => {
		const next = moveFolderItem(file(), 'vocabulary', 'b', 'f2', 'd');
		expect(next.vocabulary[0].itemIds).toEqual(['a', 'c']);
		expect(next.vocabulary[1].itemIds).toEqual(['b', 'd']);
	});

	it('removes from every folder when folderId is null', () => {
		const next = moveFolderItem(file(), 'vocabulary', 'b', null, null);
		expect(next.vocabulary[0].itemIds).toEqual(['a', 'c']);
		expect(next.vocabulary[1].itemIds).toEqual(['d']);
	});

	it('is a no-op when beforeId is the item itself', () => {
		const before = file();
		expect(moveFolderItem(before, 'vocabulary', 'a', 'f1', 'a')).toBe(before);
	});

	it('throws for unknown folder or position', () => {
		expect(() => moveFolderItem(file(), 'vocabulary', 'a', 'nope', null)).toThrow();
		expect(() => moveFolderItem(file(), 'vocabulary', 'a', 'f1', 'zzz')).toThrow();
		expect(() => moveFolderItem(file(), 'vocabulary', 'a', null, 'b')).toThrow();
	});
});
