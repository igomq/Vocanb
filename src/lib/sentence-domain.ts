import { z } from 'zod';

export const SENTENCE_PDF_MAX_BYTES = 15 * 1024 * 1024;

export const MemorizationRunSchema = z
	.object({
		text: z.string().min(1),
		memorize: z.boolean()
	})
	.strict();
export type MemorizationRun = z.infer<typeof MemorizationRunSchema>;

export const PassageParagraphSchema = z
	.object({
		runs: z.array(MemorizationRunSchema).min(1)
	})
	.strict();
export type PassageParagraph = z.infer<typeof PassageParagraphSchema>;

export const PassageSummarySchema = z
	.object({
		topic: z.string().trim().min(1).max(1000),
		flow: z.array(z.string().trim().min(1).max(2000)).min(3).max(5),
		takeaway: z.string().trim().min(1).max(2000)
	})
	.strict();
export type PassageSummary = z.infer<typeof PassageSummarySchema>;

export const TranslationItemSchema = z
	.object({
		english: z.string().min(1),
		korean: z.string().min(1)
	})
	.strict();
export type TranslationItem = z.infer<typeof TranslationItemSchema>;

export const SentencePassageSchema = z
	.object({
		id: z.string().uuid(),
		order: z.number().int().nonnegative(),
		label: z.string().trim().min(1).max(200),
		sourcePageStart: z.number().int().min(1),
		sourcePageEnd: z.number().int().min(1),
		paragraphs: z.array(PassageParagraphSchema).min(1),
		summary: PassageSummarySchema.nullable(),
		translation: z.array(TranslationItemSchema).nullable()
	})
	.strict()
	.refine((passage) => passage.sourcePageStart <= passage.sourcePageEnd, {
		message: '페이지 범위가 올바르지 않습니다.'
	});
export type SentencePassage = z.infer<typeof SentencePassageSchema>;

export const SentenceBookSchema = z
	.object({
		schemaVersion: z.literal(1),
		id: z.string().uuid(),
		title: z.string().trim().min(1).max(120),
		sourceFileName: z.string().trim().min(1).max(300),
		createdAt: z.string(),
		updatedAt: z.string(),
		passages: z.array(SentencePassageSchema).min(1)
	})
	.strict();
export type SentenceBook = z.infer<typeof SentenceBookSchema>;

export const SentenceUserIndexSchema = z
	.object({
		schemaVersion: z.literal(1),
		sentenceBookIds: z.array(z.string().uuid())
	})
	.strict();

export const SentenceImportRunSchema = MemorizationRunSchema;
export const SentenceImportParagraphSchema = PassageParagraphSchema;
export const SentenceImportPassageSchema = z
	.object({
		sourceOrder: z.number().int().nonnegative(),
		label: z.string().trim().min(1).max(200),
		sourcePageStart: z.number().int().min(1),
		sourcePageEnd: z.number().int().min(1),
		paragraphs: z.array(PassageParagraphSchema).min(1)
	})
	.strict()
	.refine((passage) => passage.sourcePageStart <= passage.sourcePageEnd, {
		message: '페이지 범위가 올바르지 않습니다.'
	});
export type SentenceImportPassage = z.infer<typeof SentenceImportPassageSchema>;

export const SentenceImportResponseSchema = z
	.object({
		passages: z.array(SentenceImportPassageSchema).min(1)
	})
	.strict();
export type SentenceImportResponse = z.infer<typeof SentenceImportResponseSchema>;

export const PassageTranslationResponseSchema = z
	.object({
		translations: z
			.array(
				z
					.object({
						index: z.number().int().nonnegative(),
						korean: z.string().trim().min(1).max(4000)
					})
					.strict()
			)
			.min(1)
	})
	.strict();
export type PassageTranslationResponse = z.infer<typeof PassageTranslationResponseSchema>;

export type NormalizedSentencePassage = Omit<
	SentencePassage,
	'id' | 'order' | 'summary' | 'translation'
>;

const leadingPunctuation = /^[\p{P}]+/u;
const trailingPunctuation = /[\p{P}]+$/u;

/** Adjacent equal runs are merged and punctuation touching a target stays under its tape. */
export function normalizeImportRuns(runs: MemorizationRun[]): MemorizationRun[] {
	const merged: MemorizationRun[] = [];
	for (const run of runs) {
		if (!run.text.trim()) continue;
		let text = run.text;
		let previous = merged.at(-1);

		if (previous?.memorize && !run.memorize) {
			const punctuation = text.match(leadingPunctuation)?.[0];
			if (punctuation) {
				previous.text += punctuation;
				text = text.slice(punctuation.length);
				if (!text.trim()) {
					previous.text += text;
					continue;
				}
			}
		}

		previous = merged.at(-1);
		if (run.memorize && previous && !previous.memorize) {
			const punctuation = previous.text.match(trailingPunctuation)?.[0];
			if (punctuation) {
				previous.text = previous.text.slice(0, -punctuation.length);
				text = punctuation + text;
				if (!previous.text) merged.pop();
			}
		}

		previous = merged.at(-1);
		if (previous && previous.memorize === run.memorize) {
			previous.text += text;
		} else {
			merged.push({ text, memorize: run.memorize });
		}
	}
	return merged;
}

/** Sorts passages by sourceOrder and drops paragraphs left empty after normalization. */
export function normalizeSentenceImport(
	response: SentenceImportResponse
): NormalizedSentencePassage[] {
	const passages = [...response.passages]
		.sort((left, right) => left.sourceOrder - right.sourceOrder)
		.map((passage) => ({
			label: passage.label,
			sourcePageStart: passage.sourcePageStart,
			sourcePageEnd: passage.sourcePageEnd,
			paragraphs: passage.paragraphs
				.map((paragraph) => ({ runs: normalizeImportRuns(paragraph.runs) }))
				.filter((paragraph) => paragraph.runs.length > 0)
		}));
	const usable = passages.filter((passage) => passage.paragraphs.length > 0);
	if (!usable.length) throw new Error('PDF에서 지문을 찾지 못했습니다.');
	return usable;
}

export function passagePlainText(passage: Pick<SentencePassage, 'paragraphs'>) {
	return passage.paragraphs
		.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
		.join('\n\n');
}

export type SentenceTestResult = {
	status: 'correct' | 'wrong' | 'ambiguous' | 'partial';
	score?: number;
	wrongWordIndexes?: number[];
};

export type SentenceWordChunk = { text: string; wordIndex: number | null };

/** Splits display text without losing punctuation or offsets between words. */
export function sentenceWordChunks(text: string): SentenceWordChunk[] {
	const matches = [...text.matchAll(/[\p{L}\p{N}]+(?:[’'’-][\p{L}\p{N}]+)*/gu)];
	const chunks: SentenceWordChunk[] = [];
	let cursor = 0;
	for (const [wordIndex, match] of matches.entries()) {
		if (match.index! > cursor)
			chunks.push({ text: text.slice(cursor, match.index), wordIndex: null });
		chunks.push({ text: match[0], wordIndex });
		cursor = match.index! + match[0].length;
	}
	if (cursor < text.length) chunks.push({ text: text.slice(cursor), wordIndex: null });
	return chunks;
}

function normalizeAnswer(text: string) {
	return text
		.normalize('NFKC')
		.toLocaleLowerCase('en')
		.replace(/[^\p{L}\p{N}]/gu, '');
}

function answerWords(text: string) {
	return sentenceWordChunks(text)
		.filter((chunk): chunk is SentenceWordChunk & { wordIndex: number } => chunk.wordIndex !== null)
		.map((chunk) => normalizeAnswer(chunk.text));
}

function editDistance(left: string, right: string) {
	let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
	for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
		const current = [leftIndex];
		for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
			current[rightIndex] = Math.min(
				current[rightIndex - 1] + 1,
				previous[rightIndex] + 1,
				previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
			);
		}
		previous = current;
	}
	return previous[right.length];
}

function wrongExpectedWords(expected: string[], actual: string[]) {
	const lengths = Array.from({ length: expected.length + 1 }, () =>
		new Array<number>(actual.length + 1).fill(0)
	);
	for (let expectedIndex = expected.length - 1; expectedIndex >= 0; expectedIndex -= 1) {
		for (let actualIndex = actual.length - 1; actualIndex >= 0; actualIndex -= 1) {
			lengths[expectedIndex][actualIndex] =
				expected[expectedIndex] === actual[actualIndex]
					? lengths[expectedIndex + 1][actualIndex + 1] + 1
					: Math.max(
							lengths[expectedIndex + 1][actualIndex],
							lengths[expectedIndex][actualIndex + 1]
						);
		}
	}
	const matched = new Set<number>();
	let expectedIndex = 0;
	let actualIndex = 0;
	while (expectedIndex < expected.length && actualIndex < actual.length) {
		if (expected[expectedIndex] === actual[actualIndex]) {
			matched.add(expectedIndex++);
			actualIndex += 1;
		} else if (lengths[expectedIndex + 1][actualIndex] >= lengths[expectedIndex][actualIndex + 1]) {
			expectedIndex += 1;
		} else {
			actualIndex += 1;
		}
	}
	return expected.flatMap((_, index) => (matched.has(index) ? [] : [index]));
}

/** Punctuation/case-insensitive character accuracy plus expected words that differ. */
export function gradeSentenceAnswer(expected: string, actual: string) {
	const normalizedExpected = normalizeAnswer(expected);
	const normalizedActual = normalizeAnswer(actual);
	const longest = Math.max(normalizedExpected.length, normalizedActual.length);
	return {
		score:
			longest === 0
				? 100
				: Math.round(
						((longest - editDistance(normalizedExpected, normalizedActual)) / longest) * 100
					),
		wrongWordIndexes: wrongExpectedWords(answerWords(expected), answerWords(actual))
	};
}

function sentenceFallbackSplit(text: string) {
	return text
		.split(/(?<=[.!?])\s+/u)
		.map((segment) => segment.trim())
		.filter(Boolean);
}

/** Splits English prose into display sentences, preferring Intl.Segmenter. */
export function parseSentenceSegments(text: string) {
	const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
	const sentences = [...segmenter.segment(text)]
		.map(({ segment }) => segment.trim())
		.filter(Boolean);
	if (sentences.length > 1) return sentences;
	return sentenceFallbackSplit(text);
}

export function combineTranslations(
	sources: { index: number; english: string }[],
	translations: PassageTranslationResponse['translations']
): TranslationItem[] {
	if (translations.length !== sources.length) {
		throw new Error('번역 문장 수가 원문과 일치하지 않습니다.');
	}
	const byIndex = new Map(translations.map((item) => [item.index, item]));
	if (byIndex.size !== translations.length) {
		throw new Error('번역 문장 index가 중복되었습니다.');
	}
	return sources.map(({ index, english }) => {
		const item = byIndex.get(index);
		if (!item) throw new Error('번역 문장 index가 누락되었습니다.');
		return { english, korean: item.korean };
	});
}

export function defaultTitleFromFileName(filename: string) {
	return filename.replace(/\.pdf$/iu, '').trim() || '문장 암기장';
}

export function passageNavState(passageCount: number, activeIndex: number) {
	return {
		canPrevious: activeIndex > 0,
		canNext: activeIndex < passageCount - 1
	};
}
