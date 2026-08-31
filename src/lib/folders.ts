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
