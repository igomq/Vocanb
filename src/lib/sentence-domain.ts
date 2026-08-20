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

/** Runs with adjacent same memorize state (and only-whitespace runs) are merged. */
export function normalizeImportRuns(runs: MemorizationRun[]): MemorizationRun[] {
	const merged: MemorizationRun[] = [];
	for (const run of runs) {
		if (!run.text.trim()) continue;
		const previous = merged.at(-1);
		if (previous && previous.memorize === run.memorize) {
			previous.text += run.text;
		} else {
			merged.push({ text: run.text, memorize: run.memorize });
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
