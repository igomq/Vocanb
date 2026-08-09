import sharp from 'sharp';
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
import { actions } from './+page.server';

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

async function upload(vocabularyId: string, files: File[], targetWordCount?: string) {
	const form = new FormData();
	for (const file of files) form.append('images', file);
	if (targetWordCount !== undefined) form.set('targetWordCount', targetWordCount);
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
	it('allows an empty target and the exact per-image maximum', async () => {
		const vocabulary = await createVocabulary(userId, '업로드', '');
		const extract = vi
			.spyOn(ocrProvider, 'extract')
			.mockResolvedValue(response([{ sourceOrder: 1, english: 'apple', meaning: '사과' }]));

		expect(await upload(vocabulary.id, [await imageFile()])).toMatchObject({ success: true });
		expect(await upload(vocabulary.id, [await imageFile()], '500')).toMatchObject({
			success: true
		});
		expect(extract).toHaveBeenCalledWith(expect.any(Buffer), 500);
	});

	it.each(['1.5', '0', '-1', '1001'])('rejects invalid target %s', async (target) => {
		const vocabulary = await createVocabulary(userId, '검증', '');
		const result = await upload(vocabulary.id, [await imageFile()], target);
		expect(result).toMatchObject({ status: 400 });
	});

	it('caps every OCR request at 500', async () => {
		const vocabulary = await createVocabulary(userId, '여러 사진', '');
		const calls: (number | undefined)[] = [];
		vi.spyOn(ocrProvider, 'extract').mockImplementation(async (_bytes, target) => {
			calls.push(target);
			return response([{ sourceOrder: 1, english: `word-${calls.length}`, meaning: '뜻' }]);
		});

		expect(
			await upload(vocabulary.id, [await imageFile('one.png'), await imageFile('two.png')], '800')
		).toMatchObject({ success: true });
		expect(calls).toEqual([500, 500]);
	});

	it('keeps an imbalanced batch globally capped and in image order', async () => {
		const vocabulary = await createVocabulary(userId, '순서', '');
		const calls: (number | undefined)[] = [];
		vi.spyOn(ocrProvider, 'extract').mockImplementation(async () => {
			calls.push(3);
			return calls.length === 1
				? response([{ sourceOrder: 1, english: 'first', meaning: '첫째' }])
				: response([
						{ sourceOrder: 2, english: 'second-2', meaning: '둘째' },
						{ sourceOrder: 1, english: 'second-1', meaning: '둘째 하나' },
						{ sourceOrder: 3, english: 'second-3', meaning: '셋째' }
					]);
		});

		expect(
			await upload(vocabulary.id, [await imageFile('one.png'), await imageFile('two.png')], '3')
		).toMatchObject({ success: true });
		expect(calls).toEqual([3, 3]);
		expect(
			(await getVocabulary(userId, vocabulary.id))?.words.map(({ english }) => english)
		).toEqual(['first', 'second-1', 'second-2']);
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
			vi.spyOn(ocrProvider, 'extract').mockImplementation(async () => {
				if (testCase.error) throw testCase.error;
				return testCase.response!;
			});
			const result = await upload(vocabulary.id, [await imageFile()]);
			expect(result).toMatchObject({ status: testCase.error ? 502 : 422 });
			expect(await getVocabulary(userId, vocabulary.id)).toMatchObject({ words: [], images: [] });
			vi.restoreAllMocks();
		}
	});

	it('stores nothing when one image in a batch fails OCR', async () => {
		const vocabulary = await createVocabulary(userId, '부분 실패', '');
		let call = 0;
		vi.spyOn(ocrProvider, 'extract').mockImplementation(async () => {
			if (++call === 2) throw new Error('second image failed');
			return response([{ sourceOrder: 1, english: 'first', meaning: '첫째' }]);
		});

		expect(
			await upload(vocabulary.id, [await imageFile('one.png'), await imageFile('two.png')])
		).toMatchObject({ status: 502 });
		expect(await getVocabulary(userId, vocabulary.id)).toMatchObject({ words: [], images: [] });
		await expect(readdir(uploadDirectory(userId, vocabulary.id))).rejects.toMatchObject({
			code: 'ENOENT'
		});
	});

	it('rolls back written images when metadata save fails', async () => {
		const vocabularyId = crypto.randomUUID();
		vi.spyOn(ocrProvider, 'extract').mockResolvedValue(
			response([{ sourceOrder: 1, english: 'word', meaning: '뜻' }])
		);
		const result = await upload(vocabularyId, [await imageFile()]);

		expect(result).toMatchObject({ status: 500 });
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
		expect(errors).toHaveBeenCalledWith('Upload save failed:', '단어장을 찾을 수 없습니다.');
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
});
