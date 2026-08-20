import {
	defaultTitleFromFileName,
	normalizeSentenceImport,
	SENTENCE_PDF_MAX_BYTES,
	type SentenceImportResponse
} from '$lib/sentence-domain';
import { sentenceImportProvider } from '$lib/server/sentence-ai';
import { createSentenceBook, deleteSentenceBook } from '$lib/server/sentence-storage';
import { createVocabulary, deleteVocabulary, getSuggestions } from '$lib/server/storage';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const PDF_MAGIC = '%PDF-';

export const load: PageServerLoad = async ({ locals }) => getSuggestions(locals.userId!);

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const data = await request.formData();
		const title = String(data.get('title') || '').trim();
		const rangeLabel = String(data.get('rangeLabel') || '').trim();
		if (!title || title.length > 120)
			return fail(400, { message: '제목을 120자 이내로 입력해 주세요.', title, rangeLabel });
		if (rangeLabel.length > 120)
			return fail(400, { message: '범위를 120자 이내로 입력해 주세요.', title, rangeLabel });
		let vocabulary;
		try {
			vocabulary = await createVocabulary(locals.userId!, title, rangeLabel);
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
			book = await createSentenceBook(locals.userId!, {
				title,
				sourceFileName: file.name,
				passages
			});
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
		} catch (error) {
			console.error(
				'Sentence book delete failed:',
				error instanceof Error ? error.message : 'unknown error'
			);
			return fail(400, { message: '문장 암기장을 삭제하지 못했습니다.' });
		}
		redirect(303, '/app/s');
	}
};
