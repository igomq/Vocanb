import {
	OcrResponseSchema,
	createTestSession,
	normalizeOcrEntry,
	parseTestRange,
	summarizeTest,
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
});

describe('results and OCR schema', () => {
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

	it('separates part of speech and removes relation notes from OCR meanings', () => {
		expect(
			normalizeOcrEntry({
				sourceOrder: 1,
				english: 'courteous',
				meaning: '형 예의 바른, 공손한 (반 discourteous)',
				uncertain: false
			})
		).toMatchObject({ partOfSpeech: '형', meaning: '예의 바른, 공손한' });
		expect(
			normalizeOcrEntry({
				sourceOrder: 2,
				english: 'polite',
				meaning: '예의 바른 반 impolite',
				partOfSpeech: 'adjective',
				uncertain: false
			})
		).toMatchObject({ partOfSpeech: '형', meaning: '예의 바른' });
	});
});
