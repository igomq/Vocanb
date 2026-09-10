import { z } from 'zod';

export const FOLDER_KINDS = ['vocabulary', 'sentence'] as const;

export const FolderSchema = z
	.object({
		id: z.string().uuid(),
		name: z.string().trim().min(1).max(120),
		createdAt: z.string(),
		updatedAt: z.string(),
		itemIds: z.array(z.string().uuid())
	})
	.strict();
export type Folder = z.infer<typeof FolderSchema>;

export const FolderFileSchema = z
	.object({
		schemaVersion: z.literal(1),
		vocabulary: z.array(FolderSchema),
		sentence: z.array(FolderSchema)
	})
	.strict();
export type FolderFile = z.infer<typeof FolderFileSchema>;
export type FolderKind = (typeof FOLDER_KINDS)[number];

export function emptyFolderFile(): FolderFile {
	return { schemaVersion: 1, vocabulary: [], sentence: [] };
}

export function isFolderKind(value: unknown): value is FolderKind {
	return FOLDER_KINDS.includes(value as FolderKind);
}

export function folderName(raw: unknown) {
	const name = String(raw ?? '').replace(/\s+/g, ' ');
	const trimmed = name.trim();
	if (!trimmed || trimmed.length > 120) throw new Error('폴더 이름을 120자 이내로 입력해 주세요.');
	return trimmed;
}

/**
 * Drops ids that no longer resolve and keeps an item in at most one folder per kind.
 * Each kind is checked against its own id set, so pruning one never clears the other.
 */
export function pruneFolders(
	folders: FolderFile,
	existing: Record<FolderKind, ReadonlySet<string>>
) {
	const prune = (list: Folder[], ids: ReadonlySet<string>) => {
		const seen = new Set<string>();
		return list.map((folder) => ({
			...folder,
			itemIds: folder.itemIds.filter((id) => {
				if (!ids.has(id) || seen.has(id)) return false;
				seen.add(id);
				return true;
			})
		}));
	};
	return {
		schemaVersion: 1 as const,
		vocabulary: prune(folders.vocabulary, existing.vocabulary),
		sentence: prune(folders.sentence, existing.sentence)
	};
}

/**
 * Moves an item to folderId at a position, or out of every folder when folderId is null.
 * beforeId must name an item already in the target folder; null appends to the end.
 */
export function moveFolderItem(
	folders: FolderFile,
	kind: FolderKind,
	itemId: string,
	folderId: string | null,
	beforeId: string | null
) {
	if (folderId && !folders[kind].some((folder) => folder.id === folderId))
		throw new Error('폴더를 찾을 수 없습니다.');
	if (!folderId && beforeId) throw new Error('위치를 확인해 주세요.');
	if (beforeId === itemId) return folders;
	if (beforeId && !folders[kind].some((folder) => folder.itemIds.includes(beforeId)))
		throw new Error('위치를 확인해 주세요.');
	const stripped = folders[kind].map((folder) => ({
		...folder,
		itemIds: folder.itemIds.filter((id) => id !== itemId)
	}));
	if (!folderId) return { ...folders, [kind]: stripped };
	const now = new Date().toISOString();
	return {
		...folders,
		[kind]: stripped.map((folder) => {
			if (folder.id !== folderId) return folder;
			if (!beforeId) return { ...folder, itemIds: [...folder.itemIds, itemId], updatedAt: now };
			const at = folder.itemIds.indexOf(beforeId);
			return {
				...folder,
				itemIds: [...folder.itemIds.slice(0, at), itemId, ...folder.itemIds.slice(at)],
				updatedAt: now
			};
		})
	};
}
/** Moves an item to folderId, or out of every folder when it is null. */
export function assignFolder(
	folders: FolderFile,
	kind: FolderKind,
	itemId: string,
	folderId: string | null
) {
	return {
		...folders,
		[kind]: folders[kind].map((folder) => {
			const without = folder.itemIds.filter((id) => id !== itemId);
			return folder.id === folderId
				? { ...folder, itemIds: [...without, itemId], updatedAt: new Date().toISOString() }
				: { ...folder, itemIds: without };
		})
	};
}
