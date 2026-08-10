import {
	createTestSession,
	latestCompletedTest,
	normalizeOcrEntry,
	parseTestRange,
	removeWords,
	summarizeTest,
	type TestSession,
	type Word
} from '$lib/domain';
import { normalizeUpload } from '$lib/server/image';
import { mapWithConcurrency, ocrProvider } from '$lib/server/ocr';
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
	const value = String(data.get(name) ?? '').trim();
	if (!value || value.length > max) throw new Error('입력값을 확인해 주세요.');
	return value;
}

function optionalText(data: FormData, name: string, max: number) {
	const value = String(data.get(name) ?? '').trim();
	if (value.length > max) throw new Error('입력값을 확인해 주세요.');
	return value || undefined;
}

async function deleteVocabularyWords(
	userId: string,
	vocabularyId: string,
	wordIds: ReadonlySet<string>
) {
	let orphanImageFilenames: string[] = [];
	await updateVocabulary(userId, vocabularyId, (vocabulary) => {
		const result = removeWords(vocabulary, wordIds);
		orphanImageFilenames = result.orphanImages.map(({ filename }) => filename);
		return result.vocabulary;
	});
	const cleanup = await Promise.allSettled(
		orphanImageFilenames.map((filename) =>
			rm(imagePath(userId, vocabularyId, filename), { force: true })
		)
	);
	for (const result of cleanup) {
		if (result.status === 'rejected') console.error('Orphan image cleanup failed:', result.reason);
	}
}

export const actions: Actions = {
	upload: async ({ request, locals, params }) => {
		const data = await request.formData();
		const files = data
			.getAll('images')
			.filter((value): value is File => value instanceof File && value.size > 0);
		if (!files.length)
			return fail(400, { action: 'upload', message: '추가할 사진을 선택해 주세요.' });
		if (files.length > 10)
			return fail(400, {
				action: 'upload',
				message: '사진은 한 번에 최대 10장까지 추가할 수 있습니다.'
			});
		if (files.reduce((total, file) => total + file.size, 0) > 90 * 1024 * 1024) {
			return fail(400, {
				action: 'upload',
				message: '한 번에 올리는 사진은 모두 합쳐 90MB 이하여야 합니다.'
			});
		}
		const targetValues = data.getAll('targetWordCounts');
		let targetWordCounts: number[] | undefined;
		if (targetValues.length) {
			if (targetValues.length !== files.length)
				return fail(400, {
					action: 'upload',
					message: '사진별 목표 개수를 사진 수만큼 입력해 주세요.'
				});
			const parsedTargets = targetValues.map((value) =>
				typeof value === 'string' ? Number(value.trim()) : Number.NaN
			);
			if (parsedTargets.some((target) => !Number.isInteger(target) || target < 1 || target > 500))
				return fail(400, {
					action: 'upload',
					message: '각 사진의 목표 개수는 1~500 사이의 정수로 입력해 주세요.'
				});
			targetWordCounts = parsedTargets;
		}

		let normalized: Buffer[];
		try {
			normalized = await mapWithConcurrency(files, 2, normalizeUpload);
		} catch (error) {
			return fail(400, {
				action: 'upload',
				message: error instanceof Error ? error.message : '이미지를 읽을 수 없습니다.'
			});
		}

		let results: Awaited<ReturnType<typeof ocrProvider.extract>>[];
		try {
			results = await mapWithConcurrency(normalized, 2, (bytes, index) =>
				ocrProvider.extract(bytes, targetWordCounts?.[index])
			);
		} catch (error) {
			console.error('OCR failed:', error instanceof Error ? error.message : 'unknown error');
			return fail(502, {
				action: 'upload',
				message: '단어를 읽지 못했습니다. 잠시 후 다시 시도해 주세요.'
			});
		}

		const prepared: {
			imageId: string;
			filename: string;
			bytes: Buffer;
			words: Omit<Word, 'number'>[];
		}[] = [];
		for (const [index, bytes] of normalized.entries()) {
			const entries = [...results[index].entries]
				.sort((left, right) => left.sourceOrder - right.sourceOrder)
				.map(normalizeOcrEntry)
				.filter(({ meaning }) => meaning);
			if (!entries.length) continue;
			const now = new Date().toISOString();
			const imageId = crypto.randomUUID();
			prepared.push({
				imageId,
				filename: `${imageId}.jpg`,
				bytes,
				words: entries.map((entry) => {
					return {
						id: crypto.randomUUID(),
						english: entry.english,
						meaning: entry.meaning,
						...(entry.partOfSpeech ? { partOfSpeech: entry.partOfSpeech } : {}),
						sourceImageId: imageId,
						uncertain: entry.uncertain,
						createdAt: now,
						updatedAt: now
					};
				})
			});
		}
		if (!prepared.length)
			return fail(422, { action: 'upload', message: '사진에서 저장할 단어를 찾지 못했습니다.' });

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
				action: 'upload',
				message: `${prepared.reduce((sum, image) => sum + image.words.length, 0)}개 단어를 추가했습니다.`
			};
		} catch (error) {
			const cleanup = await Promise.allSettled(written.map((path) => rm(path, { force: true })));
			for (const result of cleanup) {
				if (result.status === 'rejected') console.error('Upload rollback failed:', result.reason);
			}
			console.error(
				'Upload save failed:',
				error instanceof Error ? error.message : 'unknown error'
			);
			return fail(500, {
				action: 'upload',
				message: '사진과 단어를 저장하지 못했습니다. 다시 시도해 주세요.'
			});
		}
	},
	addWord: async ({ request, locals, params }) => {
		const data = await request.formData();
		try {
			const english = text(data, 'english', 300);
			const meaning = text(data, 'meaning', 1000);
			const partOfSpeech = optionalText(data, 'partOfSpeech', 30);
			await updateVocabulary(locals.userId!, params.id, (vocabulary) => {
				const now = new Date().toISOString();
				vocabulary.words.push({
					id: crypto.randomUUID(),
					number: Math.max(0, ...vocabulary.words.map((word) => word.number)) + 1,
					english,
					meaning,
					...(partOfSpeech ? { partOfSpeech } : {}),
					sourceImageId: null,
					uncertain: false,
					createdAt: now,
					updatedAt: now
				});
				return vocabulary;
			});
			return { success: true, action: 'addWord', message: '단어를 추가했습니다.' };
		} catch (error) {
			console.error('Word add failed:', error instanceof Error ? error.message : 'unknown error');
			return fail(400, {
				action: 'addWord',
				message: '단어를 추가하지 못했습니다. 입력값을 확인해 주세요.'
			});
		}
	},
	updateWord: async ({ request, locals, params }) => {
		const data = await request.formData();
		const wordId = String(data.get('wordId') || '');
		try {
			const english = text(data, 'english', 300);
			const meaning = text(data, 'meaning', 1000);
			const partOfSpeech = optionalText(data, 'partOfSpeech', 30);
			await updateVocabulary(locals.userId!, params.id, (vocabulary) => {
				const word = vocabulary.words.find((candidate) => candidate.id === wordId);
				if (!word) throw new Error('단어를 찾을 수 없습니다.');
				Object.assign(word, {
					english,
					meaning,
					partOfSpeech,
					pronunciation: undefined,
					uncertain: false,
					updatedAt: new Date().toISOString()
				});
				return vocabulary;
			});
			return { success: true, action: 'updateWord', message: '단어를 수정했습니다.' };
		} catch (error) {
			console.error(
				'Word update failed:',
				error instanceof Error ? error.message : 'unknown error'
			);
			return fail(400, {
				action: 'updateWord',
				message: '단어를 수정하지 못했습니다. 입력값을 확인해 주세요.'
			});
		}
	},
	deleteWord: async ({ request, locals, params }) => {
		const wordId = String((await request.formData()).get('wordId') || '');
		try {
			await deleteVocabularyWords(locals.userId!, params.id, new Set([wordId]));
			return {
				success: true,
				action: 'deleteWord',
				message: '잘못 추출된 단어를 삭제했습니다.'
			};
		} catch (error) {
			console.error(
				'Word delete failed:',
				error instanceof Error ? error.message : 'unknown error'
			);
			return fail(400, { action: 'deleteWord', message: '단어를 삭제하지 못했습니다.' });
		}
	},
	deleteWords: async ({ request, locals, params }) => {
		const wordIds = new Set((await request.formData()).getAll('wordIds').map(String));
		if (!wordIds.size)
			return fail(400, { action: 'deleteWords', message: '삭제할 단어를 선택해 주세요.' });
		try {
			await deleteVocabularyWords(locals.userId!, params.id, wordIds);
			return {
				success: true,
				action: 'deleteWords',
				message: `${wordIds.size}개 단어를 삭제했습니다.`
			};
		} catch (error) {
			console.error(
				'Word batch delete failed:',
				error instanceof Error ? error.message : 'unknown error'
			);
			return fail(400, { action: 'deleteWords', message: '단어를 삭제하지 못했습니다.' });
		}
	},
	startTest: async ({ request, locals, params }) => {
		const data = await request.formData();
		let created: TestSession;
		try {
			const vocabulary = await getVocabulary(locals.userId!, params.id);
			if (!vocabulary)
				return fail(404, { action: 'startTest', message: '단어장을 찾을 수 없습니다.' });
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
				action: 'startTest',
				message: error instanceof Error ? error.message : '테스트 설정을 확인해 주세요.'
			});
		}
		redirect(303, `/app/v/${params.id}/test/${created.id}`);
	}
};
