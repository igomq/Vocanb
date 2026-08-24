import sharp from 'sharp';
import { createTestSession, type Word } from '$lib/domain';
import {
	createVocabulary,
	getVocabulary,
	updateVocabulary,
	uploadDirectory
} from '$lib/server/storage';
import { ocrProvider } from '$lib/server/ocr';
import { mkdtemp, readdir } from 'node:fs/promises';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actions, load } from './+page.server';

vi.mock('node:fs/promises', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:fs/promises')>();
	return { ...actual, rename: vi.fn(actual.rename), rm: vi.fn(actual.rm) };
});

const userId = 'u_0123456789abcdef0123456789abcdef';
let directory: string;

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'vocanb-action-'));
	process.env.DATA_DIR = directory;
});

afterEach(async () => {
	const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
	vi.restoreAllMocks();
	vi.mocked(fsPromises.rename).mockReset().mockImplementation(actual.rename);
	vi.mocked(fsPromises.rm).mockReset().mockImplementation(actual.rm);
	await actual.rm(directory, { recursive: true, force: true });
});

async function imageFile(name = 'page.png') {
	const bytes = await sharp({
		create: { width: 20, height: 20, channels: 3, background: '#ffffff' }
	})
		.png()
		.toBuffer();
	return new File([bytes], name, { type: 'image/png' });
}

function response(entries: { sourceOrder: number; english: string; meaning: string }[]) {
	return { entries: entries.map((entry) => ({ ...entry, uncertain: false })) };
}

async function upload(vocabularyId: string, files: File[], targetWordCounts?: (number | string)[]) {
	const form = new FormData();
	for (const file of files) form.append('images', file);
	for (const target of targetWordCounts ?? []) form.append('targetWordCounts', String(target));
	return actions.upload!({
		request: new Request('http://localhost', { method: 'POST', body: form }),
		locals: { userId },
		params: { id: vocabularyId }
	} as never);
}

async function context(vocabularyId: string, form: FormData) {
	return actions.deleteWords!({
		request: new Request('http://localhost', { method: 'POST', body: form }),
		locals: { userId },
		params: { id: vocabularyId }
	} as never);
}

describe('vocabulary upload action', () => {
	it('logs malformed multipart requests and returns a controlled error', async () => {
		const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const parseError = new Error('multipart aborted');
		const result = await actions.upload!({
			request: {
				method: 'POST',
				url: 'http://localhost/app/v/test?/upload',
				formData: vi.fn().mockRejectedValue(parseError)
			},
			locals: { userId },
			params: { id: crypto.randomUUID() }
		} as never);

		expect(result).toMatchObject({ status: 400 });
		expect(errors).toHaveBeenCalledWith(
			'Upload form parsing failed:',
			{ method: 'POST', path: '/app/v/test' },
			parseError
		);
	});

	it('accepts 20 images and rejects 21', async () => {
		const vocabulary = await createVocabulary(userId, '사진 제한', '');
		vi.spyOn(ocrProvider, 'extract').mockResolvedValue(
			response([{ sourceOrder: 1, english: 'word', meaning: '뜻' }])
		);
		const files = await Promise.all(
			Array.from({ length: 21 }, (_, index) => imageFile(`${index}.png`))
		);

		expect(await upload(vocabulary.id, files.slice(0, 20))).toMatchObject({ success: true });
		expect(await upload(vocabulary.id, files)).toMatchObject({ status: 400 });
	});

	it('passes per-image targets to OCR in image order', async () => {
		const vocabulary = await createVocabulary(userId, '업로드', '');
		const extract = vi
			.spyOn(ocrProvider, 'extract')
			.mockResolvedValue(response([{ sourceOrder: 1, english: 'word', meaning: '뜻' }]));

		expect(
			await upload(vocabulary.id, [await imageFile('one.png'), await imageFile('two.png')], [3, 5])
		).toMatchObject({
			success: true
		});
		expect(extract.mock.calls.map(([, target]) => target)).toEqual([3, 5]);
	});

	it('passes undefined targets in default mode', async () => {
		const vocabulary = await createVocabulary(userId, '기본 추출', '');
		const calls: (number | undefined)[] = [];
		vi.spyOn(ocrProvider, 'extract').mockImplementation(async (_bytes, target) => {
			calls.push(target);
			return response([{ sourceOrder: 1, english: 'word', meaning: '뜻' }]);
		});

		expect(
			await upload(vocabulary.id, [await imageFile('one.png'), await imageFile('two.png')])
		).toMatchObject({
			success: true
		});
		expect(calls).toEqual([undefined, undefined]);
	});

	it('stores every targeted OCR entry without global truncation', async () => {
		const vocabulary = await createVocabulary(userId, '사진별 개수', '');
		vi.spyOn(ocrProvider, 'extract').mockImplementation(async (_bytes, target) =>
			response(
				Array.from({ length: target === 3 ? 3 : 5 }, (_, index) => ({
					sourceOrder: index + 1,
					english: `${target}-${index + 1}`,
					meaning: '뜻'
				}))
			)
		);

		expect(
			await upload(vocabulary.id, [await imageFile('one.png'), await imageFile('two.png')], [3, 5])
		).toMatchObject({
			success: true
		});
		const saved = await getVocabulary(userId, vocabulary.id);
		expect(saved?.words).toHaveLength(8);
		expect(saved?.images.map(({ wordCount }) => wordCount)).toEqual([3, 5]);
	});

	it('keeps image and word order when OCR completes out of order', async () => {
		const vocabulary = await createVocabulary(userId, '비동기 순서', '');
		vi.spyOn(ocrProvider, 'extract').mockImplementation(async (_bytes, target) => {
			await new Promise((resolve) => setTimeout(resolve, target === 3 ? 20 : 0));
			return target === 3
				? response([{ sourceOrder: 1, english: 'first-image', meaning: '뜻' }])
				: response([
						{ sourceOrder: 2, english: 'second-2', meaning: '뜻' },
						{ sourceOrder: 1, english: 'second-1', meaning: '뜻' }
					]);
		});

		expect(
			await upload(vocabulary.id, [await imageFile('one.png'), await imageFile('two.png')], [3, 5])
		).toMatchObject({
			success: true
		});
		expect(
			(await getVocabulary(userId, vocabulary.id))?.words.map(({ english }) => english)
		).toEqual(['first-image', 'second-1', 'second-2']);
	});

	it.each(['0', '-1', '1.5', '501'])('rejects invalid per-image target %s', async (target) => {
		const vocabulary = await createVocabulary(userId, '검증', '');
		const result = await upload(vocabulary.id, [await imageFile()], [target]);
		expect(result).toMatchObject({ status: 400 });
	});

	it('rejects a target/image count mismatch', async () => {
		const vocabulary = await createVocabulary(userId, '개수 검증', '');
		const files = [await imageFile('one.png'), await imageFile('two.png')];
		expect(await upload(vocabulary.id, files, [3])).toMatchObject({ status: 400 });
		expect(await upload(vocabulary.id, files, [3, 5, 7])).toMatchObject({ status: 400 });
	});

	it('stores nothing when OCR fails or produces no storable entries', async () => {
		const cases = [
			{ name: 'OCR failure', error: new Error('OCR down') },
			{
				name: 'empty extraction',
				response: response([])
			},
			{
				name: 'empty normalized meaning',
				response: response([{ sourceOrder: 1, english: 'word', meaning: '반의어 무례한' }])
			}
		];

		for (const testCase of cases) {
			const vocabulary = await createVocabulary(userId, testCase.name, '');
			const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
			vi.spyOn(ocrProvider, 'extract').mockImplementation(async () => {
				if (testCase.error) throw testCase.error;
				return testCase.response!;
			});
			const result = await upload(vocabulary.id, [await imageFile()]);
			expect(result).toMatchObject({ status: testCase.error ? 502 : 422 });
			if (!testCase.error)
				expect(errors).toHaveBeenCalledWith('Upload produced no storable words:', {
					vocabularyId: vocabulary.id,
					imageCount: 1,
					ocrEntryCounts: [testCase.response!.entries.length]
				});
			expect(await getVocabulary(userId, vocabulary.id)).toMatchObject({ words: [], images: [] });
			vi.restoreAllMocks();
		}
	});

	it('stores nothing when one image in a batch fails OCR', async () => {
		const vocabulary = await createVocabulary(userId, '부분 실패', '');
		const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		let call = 0;
		vi.spyOn(ocrProvider, 'extract').mockImplementation(async () => {
			if (++call === 2) throw new Error('second image failed');
			return response([{ sourceOrder: 1, english: 'first', meaning: '첫째' }]);
		});

		expect(
			await upload(vocabulary.id, [await imageFile('one.png'), await imageFile('two.png')])
		).toMatchObject({ status: 502 });
		expect(errors).toHaveBeenCalledWith(
			'Upload OCR failed:',
			{
				vocabularyId: vocabulary.id,
				imageCount: 2,
				totalBytes: expect.any(Number)
			},
			expect.objectContaining({ message: 'second image failed' })
		);
		expect(await getVocabulary(userId, vocabulary.id)).toMatchObject({ words: [], images: [] });
		await expect(readdir(uploadDirectory(userId, vocabulary.id))).rejects.toMatchObject({
			code: 'ENOENT'
		});
	});

	it('logs image normalization failures with request context', async () => {
		const vocabulary = await createVocabulary(userId, '정규화 실패', '');
		const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const file = new File([Uint8Array.from([1, 2, 3])], 'bad.png', { type: 'image/png' });

		const result = await upload(vocabulary.id, [file]);

		expect(result).toMatchObject({ status: 400 });
		expect(errors).toHaveBeenCalledWith(
			'Upload image normalization failed:',
			{
				vocabularyId: vocabulary.id,
				images: [{ name: 'bad.png', size: 3, type: 'image/png' }]
			},
			expect.objectContaining({ name: 'Error' })
		);
	});

	it('rolls back written images when metadata save fails', async () => {
		const vocabularyId = crypto.randomUUID();
		const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		vi.spyOn(ocrProvider, 'extract').mockResolvedValue(
			response([{ sourceOrder: 1, english: 'word', meaning: '뜻' }])
		);
		const result = await upload(vocabularyId, [await imageFile()]);

		expect(result).toMatchObject({ status: 500 });
		expect(errors).toHaveBeenCalledWith(
			'Upload save failed:',
			{
				vocabularyId,
				imageCount: 1,
				writtenCount: 1
			},
			expect.objectContaining({ message: '단어장을 찾을 수 없습니다.' })
		);
		await expect(readdir(uploadDirectory(userId, vocabularyId))).resolves.toEqual([]);
	});

	it('does not mask the original save failure when rollback fails', async () => {
		const vocabularyId = crypto.randomUUID();
		vi.spyOn(ocrProvider, 'extract').mockResolvedValue(
			response([{ sourceOrder: 1, english: 'word', meaning: '뜻' }])
		);
		const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		vi.mocked(fsPromises.rm).mockRejectedValue(new Error('rollback failed'));

		const result = await upload(vocabularyId, [await imageFile()]);

		expect(result).toMatchObject({ status: 500 });
		expect(errors).toHaveBeenCalledWith(
			'Upload save failed:',
			{
				vocabularyId,
				imageCount: 1,
				writtenCount: 1
			},
			expect.objectContaining({ message: '단어장을 찾을 수 없습니다.' })
		);
		expect(await readdir(uploadDirectory(userId, vocabularyId))).toHaveLength(1);
	});
});

describe('vocabulary word actions', () => {
	it('deduplicates posted IDs and preserves words for invalid selections', async () => {
		const vocabulary = await createVocabulary(userId, '삭제', '');
		await updateVocabulary(userId, vocabulary.id, (current) => {
			const now = new Date().toISOString();
			current.words = [1, 2].map((number) => ({
				id: crypto.randomUUID(),
				number,
				english: `word-${number}`,
				meaning: `뜻-${number}`,
				sourceImageId: null,
				uncertain: false,
				starred: false,
				createdAt: now,
				updatedAt: now
			}));
			return current;
		});
		const before = await getVocabulary(userId, vocabulary.id);
		const target = before!.words[0].id;
		const duplicate = new FormData();
		duplicate.append('wordIds', target);
		duplicate.append('wordIds', target);
		expect(await context(vocabulary.id, duplicate)).toMatchObject({ success: true });
		expect((await getVocabulary(userId, vocabulary.id))?.words).toHaveLength(1);

		const mixed = new FormData();
		mixed.append('wordIds', before!.words[1].id);
		mixed.append('wordIds', crypto.randomUUID());
		expect(await context(vocabulary.id, mixed)).toMatchObject({ status: 400 });
		expect((await getVocabulary(userId, vocabulary.id))?.words.map(({ id }) => id)).toEqual([
			before!.words[1].id
		]);

		expect(await context(vocabulary.id, new FormData())).toMatchObject({ status: 400 });
	});

	it('sets and then clears part of speech through the editor action', async () => {
		const vocabulary = await createVocabulary(userId, '품사', '');
		const add = new FormData();
		add.set('english', 'run');
		add.set('meaning', '달리다');
		add.set('partOfSpeech', '동');
		const addResult = await actions.addWord!({
			request: new Request('http://localhost', { method: 'POST', body: add }),
			locals: { userId },
			params: { id: vocabulary.id }
		} as never);
		expect(addResult).toMatchObject({ success: true });
		const word = (await getVocabulary(userId, vocabulary.id))!.words[0];
		expect(word.partOfSpeech).toBe('동');

		const update = new FormData();
		update.set('wordId', word.id);
		update.set('english', word.english);
		update.set('meaning', word.meaning);
		const updateResult = await actions.updateWord!({
			request: new Request('http://localhost', { method: 'POST', body: update }),
			locals: { userId },
			params: { id: vocabulary.id }
		} as never);
		expect(updateResult).toMatchObject({ success: true });
		expect((await getVocabulary(userId, vocabulary.id))!.words[0]).not.toHaveProperty(
			'partOfSpeech'
		);
	});

	it('validates and persists per-word stars', async () => {
		const vocabulary = await createVocabulary(userId, '별표', '');
		const add = new FormData();
		add.set('english', 'remember');
		add.set('meaning', '기억하다');
		await actions.addWord!({
			request: new Request('http://localhost', { method: 'POST', body: add }),
			locals: { userId },
			params: { id: vocabulary.id }
		} as never);
		const word = (await getVocabulary(userId, vocabulary.id))!.words[0];

		const invalid = new FormData();
		invalid.set('wordId', 'not-a-uuid');
		expect(
			await actions.toggleStar!({
				request: new Request('http://localhost', { method: 'POST', body: invalid }),
				locals: { userId },
				params: { id: vocabulary.id }
			} as never)
		).toMatchObject({ status: 400 });

		const toggle = new FormData();
		toggle.set('wordId', word.id);
		expect(
			await actions.toggleStar!({
				request: new Request('http://localhost', { method: 'POST', body: toggle }),
				locals: { userId },
				params: { id: vocabulary.id }
			} as never)
		).toMatchObject({ success: true });
		expect((await getVocabulary(userId, vocabulary.id))!.words[0].starred).toBe(true);
		await actions.toggleStar!({
			request: new Request('http://localhost', { method: 'POST', body: toggle }),
			locals: { userId },
			params: { id: vocabulary.id }
		} as never);
		expect((await getVocabulary(userId, vocabulary.id))!.words[0].starred).toBe(false);
	});
});

describe('test start action', () => {
	async function completedVocabulary() {
		const vocabulary = await createVocabulary(userId, '최근 결과 테스트', '');
		const now = new Date().toISOString();
		const words: Word[] = [1, 2, 3, 4].map((number) => ({
			id: crypto.randomUUID(),
			number,
			english: `word-${number}`,
			meaning: `뜻-${number}`,
			sourceImageId: null,
			uncertain: false,
			starred: false,
			createdAt: now,
			updatedAt: now
		}));
		const completed = createTestSession(
			words,
			{ start: 1, end: 4 },
			'sequential',
			'english-to-korean'
		);
		completed.completedAt = now;
		(['correct', 'wrong', 'correct', 'ambiguous'] as const).forEach(
			(result, index) => (completed.items[index].result = result)
		);
		await updateVocabulary(userId, vocabulary.id, (current) => ({
			...current,
			words,
			tests: [completed]
		}));
		return { vocabulary, words };
	}

	async function start(vocabularyId: string, form: FormData) {
		return actions.startTest!({
			request: new Request('http://localhost', { method: 'POST', body: form }),
			locals: { userId },
			params: { id: vocabularyId }
		} as never);
	}

	it('rejects recent-result requests without a completed result or statuses', async () => {
		const empty = await createVocabulary(userId, '결과 없음', '');
		const noResult = new FormData();
		noResult.set('source', 'recent-result');
		noResult.append('statuses', 'wrong');
		expect(await start(empty.id, noResult)).toHaveProperty(
			'data.message',
			'완료된 테스트 결과가 없습니다.'
		);

		const { vocabulary } = await completedVocabulary();
		const noStatuses = new FormData();
		noStatuses.set('source', 'recent-result');
		expect(await start(vocabulary.id, noStatuses)).toHaveProperty(
			'data.message',
			'결과 상태를 하나 이상 선택해 주세요.'
		);

		const noMatch = new FormData();
		noMatch.set('source', 'recent-result');
		noMatch.append('statuses', 'unknown');
		expect(await start(vocabulary.id, noMatch)).toHaveProperty(
			'data.message',
			'선택한 결과의 단어가 없습니다.'
		);
	});

	it('validates statuses and recomputes multiple selected results in master order', async () => {
		const { vocabulary, words } = await completedVocabulary();
		const invalid = new FormData();
		invalid.set('source', 'recent-result');
		invalid.append('statuses', 'not-a-status');
		expect(await start(vocabulary.id, invalid)).toHaveProperty(
			'data.message',
			'결과 상태를 확인해 주세요.'
		);

		const form = new FormData();
		form.set('source', 'recent-result');
		form.append('statuses', 'wrong');
		form.append('statuses', 'ambiguous');
		form.append('wordIds', words[0].id);
		await expect(start(vocabulary.id, form)).rejects.toMatchObject({ status: 303 });

		const saved = await getVocabulary(userId, vocabulary.id);
		const created = saved!.tests.at(-1)!;
		expect(created.items.map(({ wordId }) => wordId)).toEqual([words[1].id, words[3].id]);
		expect(created.range).toEqual({ start: 2, end: 4 });
	});

	it('keeps results and recent-result selection across disjoint completed tests', async () => {
		const vocabulary = await createVocabulary(userId, '분리된 결과', '');
		const words: Word[] = Array.from({ length: 80 }, (_, index) => ({
			id: crypto.randomUUID(),
			number: index + 1,
			english: `word-${index + 1}`,
			meaning: `뜻-${index + 1}`,
			sourceImageId: null,
			uncertain: false,
			starred: false,
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z'
		}));
		const first = createTestSession(
			words.slice(0, 40),
			{ start: 1, end: 40 },
			'sequential',
			'english-to-korean'
		);
		first.completedAt = '2026-01-01T00:00:00.000Z';
		for (const item of first.items) item.result = 'wrong';
		const second = createTestSession(
			words.slice(40),
			{ start: 41, end: 80 },
			'sequential',
			'english-to-korean'
		);
		second.completedAt = '2026-01-02T00:00:00.000Z';
		for (const item of second.items) item.result = 'correct';
		await updateVocabulary(userId, vocabulary.id, (current) => ({
			...current,
			words,
			tests: [first, second]
		}));

		const page = (await load!({
			locals: { userId },
			params: { id: vocabulary.id }
		} as never))!;
		expect(page.latestResult).toMatchObject({
			summary: { correct: 40, tested: 80, total: 80 },
			results: { [words[0].id]: 'wrong', [words[79].id]: 'correct' }
		});
		expect((await getVocabulary(userId, vocabulary.id))?.tests.map(({ id }) => id)).toEqual([
			first.id,
			second.id
		]);

		const form = new FormData();
		form.set('source', 'recent-result');
		form.set('statuses', 'wrong');
		await expect(start(vocabulary.id, form)).rejects.toMatchObject({ status: 303 });
		const saved = await getVocabulary(userId, vocabulary.id);
		expect(saved?.tests).toHaveLength(3);
		expect(saved?.tests.at(-1)?.items.map(({ wordId }) => wordId)).toEqual(
			words.slice(0, 40).map(({ id }) => id)
		);
	});

	it('starts a test with starred words only', async () => {
		const vocabulary = await createVocabulary(userId, '별표 테스트', '');
		const now = new Date().toISOString();
		const words: Word[] = [1, 2, 3].map((number) => ({
			id: crypto.randomUUID(),
			number,
			english: `word-${number}`,
			meaning: `뜻-${number}`,
			sourceImageId: null,
			uncertain: false,
			starred: number !== 2,
			createdAt: now,
			updatedAt: now
		}));
		await updateVocabulary(userId, vocabulary.id, (current) => ({ ...current, words }));

		const form = new FormData();
		form.set('source', 'starred');
		await expect(start(vocabulary.id, form)).rejects.toMatchObject({ status: 303 });
		const saved = await getVocabulary(userId, vocabulary.id);
		expect(saved?.tests.at(-1)?.items.map(({ wordId }) => wordId)).toEqual([
			words[0].id,
			words[2].id
		]);
	});
});

describe('continuous learning actions', () => {
	it('serializes duplicate starts so one continuous range has one active test', async () => {
		const vocabulary = await createVocabulary(userId, '연속 중복 방지', '');
		const now = new Date().toISOString();
		await updateVocabulary(userId, vocabulary.id, (current) => ({
			...current,
			words: [1, 2].map((number) => ({
				id: crypto.randomUUID(),
				number,
				english: `word-${number}`,
				meaning: `뜻-${number}`,
				sourceImageId: null,
				uncertain: false,
				starred: false,
				createdAt: now,
				updatedAt: now
			}))
		}));
		const start = () => {
			const form = new FormData();
			form.set('continuous', 'on');
			form.set('continuousBatchSize', '1');
			form.set('continuousDaySize', '2');
			form.set('continuousStudyMode', 'card');
			return actions.startTest!({
				request: new Request('http://localhost', { method: 'POST', body: form }),
				locals: { userId },
				params: { id: vocabulary.id }
			} as never);
		};

		const starts = await Promise.allSettled([start(), start()]);
		expect(starts.filter(({ status }) => status === 'rejected')).toHaveLength(1);
		expect(starts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
		expect((await getVocabulary(userId, vocabulary.id))?.tests).toHaveLength(1);
	});

	it('clears only continuous metadata while preserving test history', async () => {
		const vocabulary = await createVocabulary(userId, '연속 취소', '');
		const now = new Date().toISOString();
		const words: Word[] = [1, 2].map((number) => ({
			id: crypto.randomUUID(),
			number,
			english: `word-${number}`,
			meaning: `뜻-${number}`,
			sourceImageId: null,
			uncertain: false,
			starred: false,
			createdAt: now,
			updatedAt: now
		}));
		const normal = createTestSession(
			words,
			{ start: 1, end: 2 },
			'sequential',
			'english-to-korean'
		);
		normal.items[0].result = 'wrong';
		const continuous = createTestSession(
			[words[0]],
			{ start: 1, end: 1 },
			'sequential',
			'english-to-korean',
			Math.random,
			{ phase: 'batch', batchSize: 1, daySize: 2, dayStart: 1, dayEnd: 2, studyMode: 'card' }
		);
		continuous.items[0].result = 'correct';
		await updateVocabulary(userId, vocabulary.id, (current) => ({
			...current,
			words,
			tests: [normal, continuous]
		}));

		expect(
			await actions.cancelContinuous!({
				request: new Request('http://localhost', { method: 'POST' }),
				locals: { userId },
				params: { id: vocabulary.id }
			} as never)
		).toMatchObject({ success: true });
		const saved = await getVocabulary(userId, vocabulary.id);
		expect(saved?.tests).toHaveLength(2);
		expect(saved?.tests[0].items[0].result).toBe('wrong');
		expect(saved?.tests[1].items[0].result).toBe('correct');
		expect(saved?.tests.every((test) => !test.continuous)).toBe(true);
	});
});

describe('vocabulary rename action', () => {
	async function rename(vocabularyId: string, title: string) {
		const form = new FormData();
		form.set('title', title);
		return actions.renameVocabulary!({
			request: new Request('http://localhost', { method: 'POST', body: form }),
			locals: { userId },
			params: { id: vocabularyId }
		} as never);
	}

	it('updates the title and preserves words, images, and tests', async () => {
		const vocabulary = await createVocabulary(userId, '옛날 이름', 'Day 1');
		await updateVocabulary(userId, vocabulary.id, (current) => {
			const now = new Date().toISOString();
			current.words = [
				{
					id: crypto.randomUUID(),
					number: 1,
					english: 'word',
					meaning: '뜻',
					sourceImageId: null,
					uncertain: false,
					starred: false,
					createdAt: now,
					updatedAt: now
				}
			];
			current.images = [
				{
					id: crypto.randomUUID(),
					filename: crypto.randomUUID() + '.jpg',
					createdAt: now,
					wordCount: 1
				}
			];
			return current;
		});

		expect(await rename(vocabulary.id, '새 이름')).toMatchObject({
			success: true,
			action: 'renameVocabulary'
		});
		const saved = await getVocabulary(userId, vocabulary.id);
		expect(saved?.title).toBe('새 이름');
		expect(saved?.rangeLabel).toBe('Day 1');
		expect(saved?.words).toHaveLength(1);
		expect(saved?.images).toHaveLength(1);
		expect(saved?.id).toBe(vocabulary.id);
	});

	it('trims whitespace and rejects empty or over-long titles', async () => {
		const vocabulary = await createVocabulary(userId, '자르기', '');

		expect(await rename(vocabulary.id, '   앞뒤공백   ')).toMatchObject({ success: true });
		expect((await getVocabulary(userId, vocabulary.id))?.title).toBe('앞뒤공백');

		expect(await rename(vocabulary.id, '   ')).toMatchObject({ status: 400 });
		expect(await rename(vocabulary.id, 'x'.repeat(121))).toMatchObject({ status: 400 });
		expect((await getVocabulary(userId, vocabulary.id))?.title).toBe('앞뒤공백');
	});

	it('fails for a missing vocabulary without mutating other vocabularies', async () => {
		const other = await createVocabulary(userId, '다른 단어장', '');
		expect(
			await actions.renameVocabulary!({
				request: new Request('http://localhost', { method: 'POST', body: new FormData() }),
				locals: { userId },
				params: { id: crypto.randomUUID() }
			} as never)
		).toMatchObject({ status: 400 });
		expect((await getVocabulary(userId, other.id))?.title).toBe('다른 단어장');
	});
});
