import {
	defaultTitleFromFileName,
	normalizeSentenceImport,
	SENTENCE_PDF_MAX_BYTES,
	type SentenceImportResponse
} from '$lib/sentence-domain';
import { isFolderKind, type FolderKind } from '$lib/folders';
import { sentenceImportProvider } from '$lib/server/sentence-ai';
import {
	createFolder,
	deleteFolder,
	getFolders,
	moveItemFolder,
	renameFolder,
	setItemFolder
} from '$lib/server/folders';
import { createSentenceBook, deleteSentenceBook } from '$lib/server/sentence-storage';
import { createVocabulary, deleteVocabulary, getSuggestions } from '$lib/server/storage';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const PDF_MAGIC = '%PDF-';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.userId!;
	const [suggestions, folders] = await Promise.all([getSuggestions(userId), getFolders(userId)]);
	return { ...suggestions, folders };
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
	importSentenceBook: async ({ request, locals }) => {
		let data: FormData;
		try {
			data = await request.formData();
		} catch (error) {
			console.error(
				'Sentence import form parsing failed:',
				{ method: request.method, path: new URL(request.url).pathname },
				error
			);
			return fail(400, {
				message: '업로드 요청을 읽지 못했습니다. PDF 파일을 다시 선택해 주세요.'
			});
		}
		const file = data.get('pdf');
		if (!(file instanceof File) || file.size === 0)
			return fail(400, { message: 'PDF 파일을 선택해 주세요.' });
		if (file.type && file.type !== 'application/pdf')
			return fail(400, { message: 'PDF 파일만 업로드할 수 있습니다.' });
		if (file.size > SENTENCE_PDF_MAX_BYTES)
			return fail(400, { message: 'PDF 파일이 너무 큽니다.' });
		const bytes = Buffer.from(await file.arrayBuffer());
		if (bytes.subarray(0, 5).toString('latin1') !== PDF_MAGIC)
			return fail(400, { message: 'PDF 파일만 업로드할 수 있습니다.' });
		const title = String(data.get('title') || '').trim() || defaultTitleFromFileName(file.name);
		if (title.length > 120) return fail(400, { message: '제목은 120자 이내로 입력해 주세요.' });

		let imported: SentenceImportResponse;
		try {
			imported = await sentenceImportProvider.extract(bytes);
		} catch (error) {
			const failure = error as { name?: string; status?: number; code?: number };
			console.error('Sentence PDF analysis failed:', {
				fileName: file.name,
				fileSize: file.size,
				providerErrorType: failure?.name,
				providerStatus: failure?.status ?? failure?.code
			});
			return fail(502, {
				message:
					error instanceof Error
						? error.message
						: 'PDF를 분석하지 못했습니다. 잠시 후 다시 시도해 주세요.'
			});
		}

		let book;
		try {
			const passages = normalizeSentenceImport(imported);
			const folderId = optionalFolderId(data);
			book = await createSentenceBook(locals.userId!, {
				title,
				sourceFileName: file.name,
				passages
			});
			if (folderId) {
				try {
					await setItemFolder(locals.userId!, 'sentence', book.id, folderId);
				} catch (error) {
					console.error('Folder assignment failed:', error);
				}
			}
		} catch (error) {
			console.error('Sentence book create failed:', {
				fileName: file.name,
				passageCount: imported.passages.length,
				message: error instanceof Error ? error.message : 'unknown error'
			});
			return fail(422, {
				message: error instanceof Error ? error.message : 'PDF에서 지문을 찾지 못했습니다.'
			});
		}
		redirect(303, `/app/s/${book.id}`);
	},
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
