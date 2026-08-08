import {
	createTestSession,
	latestCompletedTest,
	parseTestRange,
	summarizeTest,
	type TestSession,
	type Word
} from '$lib/domain';
import { normalizeUpload } from '$lib/server/image';
import { ocrProvider } from '$lib/server/ocr';
import { getVocabulary, imagePath, updateVocabulary, uploadDirectory } from '$lib/server/storage';
import { fail, redirect } from '@sveltejs/kit';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const vocabulary = await getVocabulary(locals.userId!, params.id);
	if (!vocabulary) redirect(303, '/app');
	const latest = latestCompletedTest(vocabulary);
	const vocabularyView = { ...vocabulary, tests: undefined };
	return {
		vocabulary: vocabularyView,
		latestResult: latest
			? {
					id: latest.id,
					summary: summarizeTest(latest, vocabulary.words.length),
					results: Object.fromEntries(
						latest.items.filter((item) => item.result).map((item) => [item.wordId, item.result])
					)
				}
			: null
	};
};

function text(data: FormData, name: string, max: number) {
	const value = String(data.get(name) || '').trim();
	if (!value || value.length > max) throw new Error('입력값을 확인해 주세요.');
	return value;
}

export const actions: Actions = {
	upload: async ({ request, locals, params }) => {
		const data = await request.formData();
		const files = data
			.getAll('images')
			.filter((value): value is File => value instanceof File && value.size > 0);
		if (!files.length) return fail(400, { message: '추가할 사진을 선택해 주세요.' });
		if (files.length > 5)
			return fail(400, { message: '사진은 한 번에 최대 5장까지 추가할 수 있습니다.' });
		if (files.reduce((total, file) => total + file.size, 0) > 45 * 1024 * 1024) {
			return fail(400, { message: '한 번에 올리는 사진은 모두 합쳐 45MB 이하여야 합니다.' });
		}
		const prepared: {
			imageId: string;
			filename: string;
			bytes: Buffer;
			words: Omit<Word, 'number'>[];
		}[] = [];
		for (const file of files) {
			let bytes: Buffer;
			try {
				bytes = await normalizeUpload(file);
			} catch (error) {
				return fail(400, {
					message: error instanceof Error ? error.message : '이미지를 읽을 수 없습니다.'
				});
			}
			let result;
			try {
				result = await ocrProvider.extract(bytes);
			} catch (error) {
				console.error('OCR failed:', error instanceof Error ? error.message : 'unknown error');
				return fail(502, { message: '단어를 읽지 못했습니다. 잠시 후 다시 시도해 주세요.' });
			}
			const now = new Date().toISOString();
			const imageId = crypto.randomUUID();
			prepared.push({
				imageId,
				filename: `${imageId}.jpg`,
				bytes,
				words: result.entries.map((entry) => ({
					id: crypto.randomUUID(),
					english: entry.english,
					meaning: entry.meaning,
					sourceImageId: imageId,
					uncertain: entry.uncertain,
					createdAt: now,
					updatedAt: now
				}))
			});
		}

		const written: string[] = [];
		try {
			await mkdir(uploadDirectory(locals.userId!, params.id), { recursive: true, mode: 0o700 });
			for (const image of prepared) {
				const path = imagePath(locals.userId!, params.id, image.filename);
				await writeFile(path, image.bytes, { flag: 'wx', mode: 0o600 });
				written.push(path);
			}
			await updateVocabulary(locals.userId!, params.id, (vocabulary) => {
				let number = Math.max(0, ...vocabulary.words.map((word) => word.number));
				for (const image of prepared) {
					vocabulary.images.push({
						id: image.imageId,
						filename: image.filename,
						createdAt: new Date().toISOString(),
						wordCount: image.words.length
					});
					vocabulary.words.push(...image.words.map((word) => ({ ...word, number: ++number })));
				}
				return vocabulary;
			});
			return {
				success: true,
				message: `${prepared.reduce((sum, image) => sum + image.words.length, 0)}개 단어를 추가했습니다.`
			};
		} catch (error) {
			await Promise.all(written.map((path) => rm(path, { force: true })));
			console.error(
				'Upload save failed:',
				error instanceof Error ? error.message : 'unknown error'
			);
			return fail(500, { message: '사진과 단어를 저장하지 못했습니다. 다시 시도해 주세요.' });
		}
	},
	updateWord: async ({ request, locals, params }) => {
		const data = await request.formData();
		const wordId = String(data.get('wordId') || '');
		try {
			const english = text(data, 'english', 300);
			const meaning = text(data, 'meaning', 1000);
			await updateVocabulary(locals.userId!, params.id, (vocabulary) => {
				const word = vocabulary.words.find((candidate) => candidate.id === wordId);
				if (!word) throw new Error('단어를 찾을 수 없습니다.');
				Object.assign(word, {
					english,
					meaning,
					uncertain: false,
					updatedAt: new Date().toISOString()
				});
				return vocabulary;
			});
			return { success: true, message: '단어를 수정했습니다.' };
		} catch (error) {
			console.error(
				'Word update failed:',
				error instanceof Error ? error.message : 'unknown error'
			);
			return fail(400, { message: '단어를 수정하지 못했습니다. 입력값을 확인해 주세요.' });
		}
	},
	deleteWord: async ({ request, locals, params }) => {
		const wordId = String((await request.formData()).get('wordId') || '');
		try {
			await updateVocabulary(locals.userId!, params.id, (vocabulary) => {
				const remaining = vocabulary.words.filter((word) => word.id !== wordId);
				if (remaining.length === vocabulary.words.length)
					throw new Error('단어를 찾을 수 없습니다.');
				vocabulary.words = remaining.map((word, index) => ({ ...word, number: index + 1 }));
				return vocabulary;
			});
			return { success: true, message: '잘못 추출된 단어를 삭제했습니다.' };
		} catch (error) {
			console.error(
				'Word delete failed:',
				error instanceof Error ? error.message : 'unknown error'
			);
			return fail(400, { message: '단어를 삭제하지 못했습니다.' });
		}
	},
	startTest: async ({ request, locals, params }) => {
		const data = await request.formData();
		let created: TestSession;
		try {
			const vocabulary = await getVocabulary(locals.userId!, params.id);
			if (!vocabulary) return fail(404, { message: '단어장을 찾을 수 없습니다.' });
			const range = parseTestRange(
				vocabulary.words,
				data.get('all') === 'on',
				data.get('start'),
				data.get('end')
			);
			const order = data.get('order') === 'random' ? 'random' : 'sequential';
			const direction =
				data.get('direction') === 'korean-to-english' ? 'korean-to-english' : 'english-to-korean';
			created = createTestSession(range.words, range, order, direction);
			await updateVocabulary(locals.userId!, params.id, (current) => {
				current.tests.push(created);
				return current;
			});
		} catch (error) {
			return fail(400, {
				message: error instanceof Error ? error.message : '테스트 설정을 확인해 주세요.'
			});
		}
		redirect(303, `/app/v/${params.id}/test/${created.id}`);
	}
};
