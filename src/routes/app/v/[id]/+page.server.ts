import {
	createTestSession,
	latestCompletedResults,
	latestCompletedTest,
	normalizeOcrEntry,
	nextContinuousLearningStep,
	parseContinuousLearningSettings,
	parseTestRange,
	ResultStatusSchema,
	removeWords,
	summarizeResults,
	toggleWordStar,
	type ResultStatus,
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
	const latestResults = latestCompletedResults(vocabulary);
	const vocabularyView = { ...vocabulary, tests: undefined };
	return {
		vocabulary: vocabularyView,
		latestResult: latestResults.size
			? {
					id: latest?.id,
					summary: summarizeResults(latestResults.values(), vocabulary.words.length),
					results: Object.fromEntries(latestResults)
				}
			: null,
		continuous: nextContinuousLearningStep(vocabulary)
	};
};

function text(data: FormData, name: string, max: number) {
	const raw = String(data.get(name) ?? '');
	const value = raw
		.replaceAll('*', '')
		.replaceAll('\u2022', '')
		.replaceAll('\u00B7', '')
		.replace(/\s{2,}/g, ' ')
		.trim();
	if (!value || value.length > max) throw new Error('입력값을 확인해 주세요.');
	return value;
}

function optionalText(data: FormData, name: string, max: number) {
	const raw = String(data.get(name) ?? '');
	const value = raw
		.replaceAll('*', '')
		.replaceAll('\u2022', '')
		.replaceAll('\u00B7', '')
		.replace(/\s{2,}/g, ' ')
		.trim();
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
		let data: FormData;
		try {
			data = await request.formData();
		} catch (error) {
			console.error(
				'Upload form parsing failed:',
				{ method: request.method, path: new URL(request.url).pathname },
				error
			);
			return fail(400, {
				action: 'upload',
				message: '업로드 요청을 읽지 못했습니다. 사진을 다시 선택해 주세요.'
			});
		}
		const files = data
			.getAll('images')
			.filter((value): value is File => value instanceof File && value.size > 0);
		if (!files.length)
			return fail(400, { action: 'upload', message: '추가할 사진을 선택해 주세요.' });
		if (files.length > 20)
			return fail(400, {
				action: 'upload',
				message: '사진은 한 번에 최대 20장까지 추가할 수 있습니다.'
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
			console.error(
				'Upload image normalization failed:',
				{
					vocabularyId: params.id,
					images: files.map(({ name, size, type }) => ({ name, size, type }))
				},
				error
			);
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
			console.error(
				'Upload OCR failed:',
				{
					vocabularyId: params.id,
					imageCount: files.length,
					totalBytes: files.reduce((total, file) => total + file.size, 0)
				},
				error
			);
			return fail(502, {
				action: 'upload',
				message: '단어를 읽지 못했습니다. 잠시 후 다시 시도해 주세요.'
			});
		}

		const includePronunciation = String(data.get('includePronunciation') ?? 'on') !== 'off';
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
				.filter(({ english, meaning }) => english && meaning);
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
						starred: false,
						createdAt: now,
						updatedAt: now
					};
				})
			});
		}
		if (!prepared.length) {
			console.error('Upload produced no storable words:', {
				vocabularyId: params.id,
				imageCount: files.length,
				ocrEntryCounts: results.map((result) => result.entries.length)
			});
			return fail(422, { action: 'upload', message: '사진에서 저장할 단어를 찾지 못했습니다.' });
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
				if (!includePronunciation) vocabulary.pronunciationEnabled = false;
				else if (vocabulary.pronunciationEnabled === false) vocabulary.pronunciationEnabled = true;
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
				{
					vocabularyId: params.id,
					imageCount: files.length,
					writtenCount: written.length
				},
				error
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
					starred: false,
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
	toggleStar: async ({ request, locals, params }) => {
		const wordId = String((await request.formData()).get('wordId') || '');
		try {
			await updateVocabulary(locals.userId!, params.id, (vocabulary) =>
				toggleWordStar(vocabulary, wordId)
			);
			return { success: true, action: 'toggleStar' };
		} catch (error) {
			return fail(400, {
				action: 'toggleStar',
				message: error instanceof Error ? error.message : '별표를 저장하지 못했습니다.'
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
			const order = data.get('order') === 'random' ? 'random' : 'sequential';
			const direction =
				data.get('direction') === 'korean-to-english' ? 'korean-to-english' : 'english-to-korean';
			if (data.get('continuous') === 'on') {
				const settings = parseContinuousLearningSettings(
					data.get('continuousBatchSize'),
					data.get('continuousDaySize'),
					data.get('continuousStudyMode')
				);
				const step = nextContinuousLearningStep(vocabulary, settings);
				const range = step?.range;
				const dayRange = step?.dayRange;
				if (step?.status !== 'ready' || !step.phase || !range || !dayRange)
					throw new Error('진행 중인 연속 학습 테스트를 먼저 완료해 주세요.');
				const words = vocabulary.words.filter(
					(word) => word.number >= range.start && word.number <= range.end
				);
				if (!words.length) throw new Error('테스트할 단어가 없습니다.');
				created = createTestSession(words, range, order, direction, Math.random, {
					phase: step.phase,
					batchSize: step.settings.batchSize,
					daySize: step.settings.daySize,
					dayStart: dayRange.start,
					dayEnd: dayRange.end,
					studyMode: step.settings.studyMode
				});
			} else if (data.get('source') === 'recent-result') {
				const latestResults = latestCompletedResults(vocabulary);
				if (!latestResults.size) throw new Error('완료된 테스트 결과가 없습니다.');
				const statusValues = data.getAll('statuses');
				if (!statusValues.length) throw new Error('결과 상태를 하나 이상 선택해 주세요.');
				const statuses = new Set<ResultStatus>();
				for (const value of statusValues) {
					const status = ResultStatusSchema.safeParse(value);
					if (!status.success) throw new Error('결과 상태를 확인해 주세요.');
					statuses.add(status.data);
				}
				const matchingWordIds = new Set(
					[...latestResults].filter(([, result]) => statuses.has(result)).map(([wordId]) => wordId)
				);
				const words = vocabulary.words.filter((word) => matchingWordIds.has(word.id));
				if (!words.length) throw new Error('선택한 결과의 단어가 없습니다.');
				const numbers = words.map(({ number }) => number);
				const range = { start: Math.min(...numbers), end: Math.max(...numbers) };
				created = createTestSession(words, range, order, direction);
			} else if (data.get('source') === 'starred') {
				const words = vocabulary.words.filter((word) => word.starred);
				if (!words.length) throw new Error('별표한 단어가 없습니다.');
				const numbers = words.map(({ number }) => number);
				const range = { start: Math.min(...numbers), end: Math.max(...numbers) };
				created = createTestSession(words, range, order, direction);
			} else {
				const range = parseTestRange(
					vocabulary.words,
					data.get('all') === 'on',
					data.get('start'),
					data.get('end')
				);
				created = createTestSession(range.words, range, order, direction);
			}
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
	},
	cancelContinuous: async ({ locals, params }) => {
		try {
			await updateVocabulary(locals.userId!, params.id, (vocabulary) => ({
				...vocabulary,
				tests: vocabulary.tests.map((test) => {
					const history = { ...test };
					delete history.continuous;
					return history;
				})
			}));
			return {
				success: true,
				action: 'cancelContinuous',
				message: '연속 학습을 취소했습니다. 테스트 기록은 보존됩니다.'
			};
		} catch (error) {
			return fail(400, {
				action: 'cancelContinuous',
				message: error instanceof Error ? error.message : '연속 학습을 취소하지 못했습니다.'
			});
		}
	}
};
