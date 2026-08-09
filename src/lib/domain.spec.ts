import {
	OcrResponseSchema,
	WordSchema,
	createTestSession,
	normalizeOcrEntry,
	parseTestRange,
	removeWords,
	summarizeTest,
	type Vocabulary,
	type Word
} from './domain';
import { describe, expect, it } from 'vitest';

const words: Word[] = [1, 2, 3].map((number) => ({
	id: `00000000-0000-4000-8000-00000000000${number}`,
	number,
	english: `word-${number}`,
	meaning: `뜻-${number}`,
	sourceImageId: '10000000-0000-4000-8000-000000000001',
	uncertain: false,
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z'
}));

const deletionVocabulary: Vocabulary = {
	schemaVersion: 1,
	id: '30000000-0000-4000-8000-000000000001',
	title: '삭제 테스트',
	rangeLabel: '',
	createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
	images: [
		{
			id: '10000000-0000-4000-8000-000000000001',
			filename: '10000000-0000-4000-8000-000000000001.jpg',
			createdAt: '2026-01-01T00:00:00.000Z',
			wordCount: 99
		},
		{
			id: '20000000-0000-4000-8000-000000000001',
			filename: '20000000-0000-4000-8000-000000000001.jpg',
			createdAt: '2026-01-01T00:00:00.000Z',
			wordCount: 99
		}
	],
	words: [
		words[0],
		words[1],
		{
			...words[2],
			id: '00000000-0000-4000-8000-000000000004',
			number: 3,
			sourceImageId: '20000000-0000-4000-8000-000000000001'
		},
		{
			...words[2],
			id: '00000000-0000-4000-8000-000000000005',
			number: 4,
			sourceImageId: null
		}
	],
	tests: []
};

describe('test range and mode', () => {
	it('selects the whole vocabulary', () => {
		const range = parseTestRange(words, true, null, null);
		expect(range).toMatchObject({ start: 1, end: 3, words });
	});

	it('rejects out-of-range and reversed ranges', () => {
		expect(() => parseTestRange(words, false, '0', '2')).toThrow('범위는');
		expect(() => parseTestRange(words, false, '3', '2')).toThrow('시작 번호');
	});

	it('supports every order and direction without mutating master order', () => {
		const original = words.map(({ id }) => id);
		const sequential = createTestSession(
			words,
			{ start: 1, end: 3 },
			'sequential',
			'english-to-korean'
		);
		const random = createTestSession(
			words,
			{ start: 1, end: 3 },
			'random',
			'korean-to-english',
			() => 0
		);
		expect(sequential.items.map(({ wordId }) => wordId)).toEqual(original);
		expect(random.items.map(({ wordId }) => wordId)).not.toEqual(original);
		expect(words.map(({ id }) => id)).toEqual(original);
		expect(random.direction).toBe('korean-to-english');
	});

	it('keeps legacy test items without part of speech', () => {
		const [item] = createTestSession(
			[words[0]],
			{ start: 1, end: 1 },
			'sequential',
			'english-to-korean'
		).items;
		expect(item).toEqual({
			wordId: words[0].id,
			number: words[0].number,
			english: words[0].english,
			meaning: words[0].meaning
		});
		expect(item).not.toHaveProperty('partOfSpeech');
	});
});

describe('results and OCR schema', () => {
	it('accepts manual words without a photo source', () => {
		expect(WordSchema.parse({ ...words[0], sourceImageId: null })).toHaveProperty(
			'sourceImageId',
			null
		);
	});

	it('removes words, finds orphan photos, recalculates counts, and keeps manual words', () => {
		const result = removeWords(deletionVocabulary, new Set([words[0].id, words[1].id]));
		expect(result.orphanImages.map(({ id }) => id)).toEqual([
			'10000000-0000-4000-8000-000000000001'
		]);
		expect(result.vocabulary.images.map(({ wordCount }) => wordCount)).toEqual([1]);
		expect(result.vocabulary.words).toMatchObject([
			{ number: 1, sourceImageId: '20000000-0000-4000-8000-000000000001' },
			{ number: 2, sourceImageId: null }
		]);
	});

	it('counts all four result states correctly', () => {
		const session = createTestSession(
			[...words, { ...words[0], id: '00000000-0000-4000-8000-000000000004', number: 4 }],
			{ start: 1, end: 4 },
			'sequential',
			'english-to-korean'
		);
		['correct', 'wrong', 'unknown', 'ambiguous'].forEach((result, index) => {
			session.items[index].result = result as (typeof session.items)[number]['result'];
		});
		expect(summarizeTest(session, 120)).toEqual({ correct: 1, tested: 4, total: 120 });
	});

	it('rejects malformed structured OCR output', () => {
		expect(() =>
			OcrResponseSchema.parse({ entries: [{ english: 'apple', meaning: '' }] })
		).toThrow();
		expect(
			OcrResponseSchema.parse({
				entries: [
					{
						sourceOrder: 1,
						printedNumber: '12',
						english: 'apple',
						meaning: '사과',
						uncertain: false
					}
				]
			})
		).toHaveProperty('entries.0.meaning', '사과');
	});

	it('normalizes OCR meanings without restoring removed text', () => {
		const cases = [
			{
				name: 'Korean relation target',
				meaning: '예의 바른 반의어 무례한',
				expectedMeaning: '예의 바른'
			},
			{ name: 'relation-only meaning', meaning: '반의어 무례한', expectedMeaning: '' },
			{
				name: 'unclosed relation',
				meaning: '형 (반 discourteous',
				expectedMeaning: '',
				expectedPartOfSpeech: '형'
			},
			{
				name: 'attached relation note',
				meaning: '형 예의 바른(반 discourteous)',
				expectedMeaning: '예의 바른',
				expectedPartOfSpeech: '형'
			},
			{
				name: 'bracketed POS',
				meaning: '[형]뜻',
				expectedMeaning: '뜻',
				expectedPartOfSpeech: '형'
			},
			{ name: 'dotted POS', meaning: '형.뜻', expectedMeaning: '뜻', expectedPartOfSpeech: '형' },
			{
				name: 'structured POS wins',
				meaning: '형 뜻',
				partOfSpeech: 'noun',
				expectedMeaning: '뜻',
				expectedPartOfSpeech: '명'
			},
			{ name: 'bare POS-looking word', meaning: '형뜻', expectedMeaning: '형뜻' },
			{ name: 'ordinary word', meaning: '반가운', expectedMeaning: '반가운' }
		] satisfies {
			name: string;
			meaning: string;
			partOfSpeech?: string;
			expectedMeaning: string;
			expectedPartOfSpeech?: string;
		}[];

		for (const testCase of cases) {
			const normalized = normalizeOcrEntry({
				sourceOrder: 1,
				english: 'word',
				meaning: testCase.meaning,
				...(testCase.partOfSpeech ? { partOfSpeech: testCase.partOfSpeech } : {}),
				uncertain: false
			});
			expect(normalized, testCase.name).toMatchObject({ meaning: testCase.expectedMeaning });
			expect(normalized.partOfSpeech, testCase.name).toBe(testCase.expectedPartOfSpeech);
		}
	});
});
