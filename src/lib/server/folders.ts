import {
	FolderFileSchema,
	assignFolder,
	emptyFolderFile,
	folderName,
	moveFolderItem,
	type FolderFile,
	type FolderKind
} from '$lib/folders';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite, safeId, userRoot, withLock } from './storage';

export const MAX_FOLDERS_PER_KIND = 50;

function folderFilePath(userId: string) {
	return join(userRoot(userId), 'folders.json');
}

async function read(userId: string): Promise<FolderFile> {
	try {
		return FolderFileSchema.parse(JSON.parse(await readFile(folderFilePath(userId), 'utf8')));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyFolderFile();
		throw new Error('폴더 정보를 읽을 수 없습니다.', { cause: error });
	}
}

export async function getFolders(userId: string) {
	return read(userId);
}

export async function createFolder(userId: string, kind: FolderKind, rawName: unknown) {
	const name = folderName(rawName);
	return withLock(userRoot(userId), async () => {
		const folders = await read(userId);
		if (folders[kind].length >= MAX_FOLDERS_PER_KIND)
			throw new Error('폴더가 너무 많습니다. 먼저 일부를 정리해 주세요.');
		const now = new Date().toISOString();
		const created = {
			id: crypto.randomUUID(),
			name,
			createdAt: now,
			updatedAt: now,
			itemIds: [] as string[]
		};
		await atomicWrite(folderFilePath(userId), { ...folders, [kind]: [...folders[kind], created] });
		return created;
	});
}

export async function renameFolder(
	userId: string,
	kind: FolderKind,
	folderId: string,
	rawName: unknown
) {
	const name = folderName(rawName);
	return withLock(userRoot(userId), async () => {
		const folders = await read(userId);
		const folder = folders[kind].find((candidate) => candidate.id === folderId);
		if (!folder) throw new Error('폴더를 찾을 수 없습니다.');
		const next = { ...folder, name, updatedAt: new Date().toISOString() };
		await atomicWrite(folderFilePath(userId), {
			...folders,
			[kind]: folders[kind].map((candidate) => (candidate.id === folderId ? next : candidate))
		});
		return next;
	});
}

export async function deleteFolder(userId: string, kind: FolderKind, folderId: string) {
	return withLock(userRoot(userId), async () => {
		const folders = await read(userId);
		if (!folders[kind].some((folder) => folder.id === folderId))
			throw new Error('폴더를 찾을 수 없습니다.');
		await atomicWrite(folderFilePath(userId), {
			...folders,
			[kind]: folders[kind].filter((folder) => folder.id !== folderId)
		});
	});
}

/** Moves an item to a folder position, or out of every folder when folderId is null. */
export async function moveItemFolder(
	userId: string,
	kind: FolderKind,
	itemId: string,
	folderId: string | null,
	beforeId: string | null
) {
	return withLock(userRoot(userId), async () => {
		const folders = await read(userId);
		await atomicWrite(
			folderFilePath(userId),
			moveFolderItem(folders, kind, safeId(itemId), folderId, beforeId)
		);
	});
}

/** Puts an item in a folder, or removes it from all folders when folderId is null. */
export async function setItemFolder(
	userId: string,
	kind: FolderKind,
	itemId: string,
	folderId: string | null
) {
	return withLock(userRoot(userId), async () => {
		const folders = await read(userId);
		if (folderId && !folders[kind].some((folder) => folder.id === folderId))
			throw new Error('폴더를 찾을 수 없습니다.');
		await atomicWrite(
			folderFilePath(userId),
			assignFolder(folders, kind, safeId(itemId), folderId)
		);
	});
}
