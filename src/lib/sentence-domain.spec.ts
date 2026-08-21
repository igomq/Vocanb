import {
	SentenceImportResponseSchema,
	SentencePassageSchema,
	combineTranslations,
	defaultTitleFromFileName,
	gradeSentenceAnswer,
	normalizeImportRuns,
	normalizeSentenceImport,
	parseSentenceSegments,
	passageNavState,
	passagePlainText
} from './sentence-domain';
import { describe, expect, it } from 'vitest';

const importResponse = {
	passages: [
		{
			sourceOrder: 0,
			label: '1. 24.6.20. (3강-5)',
			sourcePageStart: 1,
			sourcePageEnd: 3,
			paragraphs: [
				{
					runs: [
						{ text: 'Most people resist ', memorize: false },
						{ text: 'the idea of a true self-estimate', memorize: true }
					]
				}
			]
		},
		{
			sourceOrder: 1,
			label: '2. 24.3.20. (3강-6)',
			sourcePageStart: 4,
			sourcePageEnd: 5,
			paragraphs: [
				{
					runs: [{ text: 'Great things take time to build.', memorize: true }]
				}
			]
		}
	]
};

describe('sentence import validation', () => {
	it('parses a valid import response', () => {
		const parsed = SentenceImportResponseSchema.parse(importResponse);
		expect(parsed.passages).toHaveLength(2);
		expect(parsed.passages[0].label).toBe('1. 24.6.20. (3강-5)');
	});

	it('rejects empty passage lists', () => {
		expect(() => SentenceImportResponseSchema.parse({ passages: [] })).toThrow();
	});

	it('rejects runs without the memorize flag', () => {
		const bad = { ...importResponse, passages: [importResponse.passages[0]] };
		bad.passages[0].paragraphs[0].runs[0] = { text: 'no flag here' } as never;
		expect(() => SentenceImportResponseSchema.parse(bad)).toThrow();
	});

	it('rejects invalid page ranges', () => {
		const bad = {
			passages: [
				{
					sourceOrder: 0,
					label: 'x',
					sourcePageStart: 5,
					sourcePageEnd: 2,
					paragraphs: [{ runs: [{ text: 'text', memorize: false }] }]
				}
			]
		};
		expect(() => SentenceImportResponseSchema.parse(bad)).toThrow('페이지 범위');
	});

	it('rejects stored passages with reversed pages', () => {
		expect(() =>
			SentencePassageSchema.parse({
				id: '00000000-0000-4000-8000-000000000001',
				order: 0,
				label: 'x',
				sourcePageStart: 3,
				sourcePageEnd: 1,
				paragraphs: [{ runs: [{ text: 't', memorize: false }] }],
				summary: null,
				translation: null
			})
		).toThrow('페이지 범위');
	});
});

describe('sentence normalization', () => {
	it('merges adjacent runs with the same memorize state', () => {
		expect(
			normalizeImportRuns([
				{ text: 'a ', memorize: false },
				{ text: 'b ', memorize: false },
				{ text: 'target', memorize: true },
				{ text: ',', memorize: true }
			])
		).toEqual([
			{ text: 'a b ', memorize: false },
			{ text: 'target,', memorize: true }
		]);
	});

	it('drops whitespace-only runs', () => {
		expect(
			normalizeImportRuns([
				{ text: '   ', memorize: false },
				{ text: 'hi', memorize: true }
			])
		).toEqual([{ text: 'hi', memorize: true }]);
	});

	it('absorbs punctuation touching a memorized span without dropping following text', () => {
		expect(
			normalizeImportRuns([
				{ text: 'She called it “', memorize: false },
				{ text: 'a distant dream', memorize: true },
				{ text: ',” but kept trying.', memorize: false }
			])
		).toEqual([
			{ text: 'She called it ', memorize: false },
			{ text: '“a distant dream,”', memorize: true },
			{ text: ' but kept trying.', memorize: false }
		]);
	});

	it('keeps trailing whitespace when a punctuation-only run follows a target', () => {
		expect(
			normalizeImportRuns([
				{ text: 'Remember this', memorize: true },
				{ text: '. ', memorize: false },
				{ text: 'Next sentence.', memorize: false }
			])
		).toEqual([
			{ text: 'Remember this. ', memorize: true },
			{ text: 'Next sentence.', memorize: false }
		]);
	});

	it('sorts passages by sourceOrder and reapplies order', () => {
		const normalized = normalizeSentenceImport({
			passages: [importResponse.passages[1], importResponse.passages[0]]
		});
		expect(normalized.map(({ label }) => label)).toEqual([
			'1. 24.6.20. (3강-5)',
			'2. 24.3.20. (3강-6)'
		]);
	});

	it('throws when every passage is empty after normalization', () => {
		expect(() =>
			normalizeSentenceImport({
				passages: [
					{
						sourceOrder: 0,
						label: 'x',
						sourcePageStart: 1,
						sourcePageEnd: 1,
						paragraphs: [{ runs: [{ text: '   ', memorize: false }] }]
					}
				]
			})
		).toThrow('PDF에서 지문을 찾지 못했습니다.');
	});

	it('reconstructs plain passage text with paragraph breaks', () => {
		const passage = {
			paragraphs: [
				{
					runs: [
						{ text: 'First line. ', memorize: false },
						{ text: 'target', memorize: true }
					]
				},
				{ runs: [{ text: 'Second paragraph.', memorize: false }] }
			]
		};
		expect(passagePlainText(passage)).toBe('First line. target\n\nSecond paragraph.');
	});
});

describe('sentence segmentation and translation pairing', () => {
	it('grades typing without punctuation or case and locates partial word errors', () => {
		expect(gradeSentenceAnswer('Great things take time.', 'great things take time')).toEqual({
			score: 100,
			wrongWordIndexes: []
		});
		expect(gradeSentenceAnswer('Great things take time.', 'great things need time')).toEqual({
			score: 79,
			wrongWordIndexes: [2]
		});
		expect(gradeSentenceAnswer("Don't stop.", 'dont stop')).toEqual({
			score: 100,
			wrongWordIndexes: []
		});
	});

	it('does not shift every later mismatch when one expected word is omitted', () => {
		expect(gradeSentenceAnswer('one two three four', 'one three four').wrongWordIndexes).toEqual([
			1
		]);
	});

	it('splits English prose into sentences', () => {
		const segments = parseSentenceSegments(
			'Great things take time to build. This once-distant dream now seems within our reach.'
		);
		expect(segments).toHaveLength(2);
		expect(segments[0]).toContain('Great things take time to build.');
	});

	it('keeps a single-segment passage intact', () => {
		const segments = parseSentenceSegments('Most people resist the idea of a true self-estimate.');
		expect(segments).toEqual(['Most people resist the idea of a true self-estimate.']);
	});

	it('recombines translations by index without rewriting English', () => {
		const sources = [
			{ index: 0, english: 'A.' },
			{ index: 1, english: 'B.' }
		];
		const items = combineTranslations(sources, [
			{ index: 1, korean: 'ㄴ' },
			{ index: 0, korean: 'ㄱ' }
		]);
		expect(items).toEqual([
			{ english: 'A.', korean: 'ㄱ' },
			{ english: 'B.', korean: 'ㄴ' }
		]);
	});

	it('rejects missing or duplicate translation indexes', () => {
		expect(() =>
			combineTranslations(
				[{ index: 0, english: 'A.' }],
				[
					{ index: 0, korean: 'ㄱ' },
					{ index: 0, korean: 'ㄱ' }
				]
			)
		).toThrow('일치하지 않습니다');
	});
});

describe('sentence book helpers', () => {
	it('derives the default title from a file name', () => {
		expect(defaultTitleFromFileName('보정고2 부교재 1-4 8월 20일.pdf')).toBe(
			'보정고2 부교재 1-4 8월 20일'
		);
		expect(defaultTitleFromFileName('sample.PDF')).toBe('sample');
	});

	it('computes previous/next availability per position', () => {
		expect(passageNavState(4, 0)).toEqual({ canPrevious: false, canNext: true });
		expect(passageNavState(4, 1)).toEqual({ canPrevious: true, canNext: true });
		expect(passageNavState(4, 3)).toEqual({ canPrevious: true, canNext: false });
	});
});
