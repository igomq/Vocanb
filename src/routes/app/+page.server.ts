import { isFolderKind, type FolderKind } from '$lib/folders';
import { importSentenceBook } from '$lib/server/sentence-import';
import {
	createFolder,
	deleteFolder,
	getFolders,
	moveItemFolder,
	renameFolder,
	setItemFolder
} from '$lib/server/folders';
import { deleteSentenceBook } from '$lib/server/sentence-storage';
import { createVocabulary, deleteVocabulary, getSuggestions } from '$lib/server/storage';
import { getLearningSnapshot } from '$lib/server/learning-storage';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.userId!;
	const [suggestions, folders, learning] = await Promise.all([
		getSuggestions(userId),
		getFolders(userId),
		getLearningSnapshot(userId)
	]);
	return { ...suggestions, folders, learning };
};

function optionalFolderId(data: FormData) {
	const raw = String(data.get('folderId') || '').trim();
	return raw || null;
}

function readKind(data: FormData) {
	const kind: unknown = String(data.get('kind') || '');
	if (!isFolderKind(kind)) throw new Error('폴더 종류를 확인해 주세요.');
	return kind as FolderKind;
}

async function folderAction(request: Request, userId: string) {
	const data = await request.formData();
	try {
		const kind = readKind(data);
		const action = String(data.get('folderAction') || '');
		if (action === 'create') await createFolder(userId, kind, data.get('name'));
		else if (action === 'rename')
			await renameFolder(userId, kind, String(data.get('folderId') || ''), data.get('name'));
		else if (action === 'delete')
			await deleteFolder(userId, kind, String(data.get('folderId') || ''));
		else if (action === 'setItem')
			await setItemFolder(
				userId,
				kind,
				String(data.get('itemId') || ''),
				String(data.get('folderId') || '').trim() || null
			);
		else throw new Error('폴더 작업을 확인해 주세요.');
	} catch (error) {
		return {
			message: error instanceof Error ? error.message : '폴더를 저장하지 못했습니다.'
		};
	}
	return null;
}

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const data = await request.formData();
		const title = String(data.get('title') || '').trim();
		const rangeLabel = String(data.get('rangeLabel') || '').trim();
		const folderId = optionalFolderId(data);
		if (!title || title.length > 120)
			return fail(400, { message: '제목을 120자 이내로 입력해 주세요.', title, rangeLabel });
		if (rangeLabel.length > 120)
			return fail(400, { message: '범위를 120자 이내로 입력해 주세요.', title, rangeLabel });
		let vocabulary;
		try {
			vocabulary = await createVocabulary(locals.userId!, title, rangeLabel);
			if (folderId) {
				try {
					await setItemFolder(locals.userId!, 'vocabulary', vocabulary.id, folderId);
				} catch (error) {
					console.error('Folder assignment failed:', error);
				}
			}
		} catch (error) {
			console.error(
				'Vocabulary create failed:',
				error instanceof Error ? error.message : 'unknown error'
			);
			return fail(500, {
				message: '단어장을 저장하지 못했습니다. 다시 시도해 주세요.',
				title,
				rangeLabel
			});
		}
		redirect(303, `/app/v/${vocabulary.id}`);
	},
	importSentenceBook: ({ request, locals }) => importSentenceBook(request, locals.userId!),
	deleteVocabulary: async ({ request, locals }) => {
		const id = String((await request.formData()).get('id') || '');
		try {
			await deleteVocabulary(locals.userId!, id);
			await setItemFolder(locals.userId!, 'vocabulary', id, null).catch((error) =>
				console.error('Folder cleanup failed:', error)
			);
		} catch (error) {
			console.error(
				'Vocabulary delete failed:',
				error instanceof Error ? error.message : 'unknown error'
			);
			return fail(400, { message: '단어장을 삭제하지 못했습니다.' });
		}
		redirect(303, '/app');
	},
	deleteSentenceBook: async ({ request, locals }) => {
		const id = String((await request.formData()).get('id') || '');
		try {
			await deleteSentenceBook(locals.userId!, id);
			await setItemFolder(locals.userId!, 'sentence', id, null).catch((error) =>
				console.error('Folder cleanup failed:', error)
			);
		} catch (error) {
			console.error(
				'Sentence book delete failed:',
				error instanceof Error ? error.message : 'unknown error'
			);
			return fail(400, { message: '문장 암기장을 삭제하지 못했습니다.' });
		}
		redirect(303, '/app/s');
	},
	moveItem: async ({ request, locals }) => {
		const data = await request.formData();
		try {
			const kind = readKind(data);
			await moveItemFolder(
				locals.userId!,
				kind,
				String(data.get('itemId') || ''),
				String(data.get('folderId') || '').trim() || null,
				String(data.get('beforeId') || '').trim() || null
			);
		} catch (error) {
			return fail(400, {
				message: error instanceof Error ? error.message : '이동하지 못했습니다.'
			});
		}
		return { success: true };
	},
	folder: async ({ request, locals }) => {
		const failure = await folderAction(request, locals.userId!);
		if (failure) return fail(400, failure);
		return { success: true };
	}
};
