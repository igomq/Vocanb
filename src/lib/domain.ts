import { z } from 'zod';

export const resultStatuses = ['correct', 'wrong', 'unknown', 'ambiguous'] as const;
export const ResultStatusSchema = z.enum(resultStatuses);
export type ResultStatus = z.infer<typeof ResultStatusSchema>;

export const CONTINUOUS_BATCH_SIZE_DEFAULT = 10;
export const CONTINUOUS_DAY_SIZE_DEFAULT = 40;
export const CONTINUOUS_BATCH_SIZE_MIN = 1;
export const CONTINUOUS_BATCH_SIZE_MAX = 500;
export const CONTINUOUS_DAY_SIZE_MIN = 1;
export const CONTINUOUS_DAY_SIZE_MAX = 5000;
export const continuousStudyModes = ['card', 'list'] as const;
export type ContinuousStudyMode = (typeof continuousStudyModes)[number];

export const ContinuousLearningSettingsSchema = z
	.object({
		batchSize: z.number().int().min(CONTINUOUS_BATCH_SIZE_MIN).max(CONTINUOUS_BATCH_SIZE_MAX),
		daySize: z.number().int().min(CONTINUOUS_DAY_SIZE_MIN).max(CONTINUOUS_DAY_SIZE_MAX),
		studyMode: z.enum(continuousStudyModes).default('card')
	})
	.strict()
	.refine(({ batchSize, daySize }) => batchSize <= daySize, {
		message: '묶음 개수는 하루 누적 개수보다 클 수 없습니다.'
	});
export type ContinuousLearningSettings = z.infer<typeof ContinuousLearningSettingsSchema>;

const continuousSettingError = `묶음 개수는 ${CONTINUOUS_BATCH_SIZE_MIN}~${CONTINUOUS_BATCH_SIZE_MAX}, 하루 누적 개수는 ${CONTINUOUS_DAY_SIZE_MIN}~${CONTINUOUS_DAY_SIZE_MAX} 사이의 정수로 입력해 주세요. 묶음 개수는 하루 누적 개수보다 클 수 없습니다.`;

export function parseContinuousLearningSettings(
	batchValue: unknown,
	dayValue: unknown,
	studyModeValue: unknown = 'card'
) {
	const numberValue = (value: unknown) =>
		typeof value === 'number'
			? value
			: typeof value === 'string' && value.trim()
				? Number(value.trim())
				: Number.NaN;
	const parsed = ContinuousLearningSettingsSchema.safeParse({
		batchSize: numberValue(batchValue),
		daySize: numberValue(dayValue),
		studyMode: studyModeValue
	});
	if (!parsed.success) throw new Error(continuousSettingError);
	return parsed.data;
}

export const continuousPhases = ['batch', 'cumulative'] as const;
export const ContinuousTestMetadataSchema = z
	.object({
		phase: z.enum(continuousPhases),
		batchSize: z.number().int().positive(),
		daySize: z.number().int().positive(),
		dayStart: z.number().int().positive(),
		dayEnd: z.number().int().positive(),
		studyMode: z.enum(continuousStudyModes).default('card')
	})
	.strict()
	.refine(({ batchSize, daySize }) => batchSize <= daySize, {
		message: '묶음 개수는 하루 누적 개수보다 클 수 없습니다.'
	})
	.refine(({ dayStart, dayEnd }) => dayStart <= dayEnd, {
		message: '하루 범위가 올바르지 않습니다.'
	});
export type ContinuousPhase = (typeof continuousPhases)[number];
export type ContinuousTestMetadata = z.infer<typeof ContinuousTestMetadataSchema>;

export const PRONUNCIATION_GUIDE_VERSION = 2;

export const PronunciationSchema = z
	.object({
		ipa: z.string().trim().min(1).max(100),
		guide: z.string().trim().min(1).max(100),
		guideVersion: z.number().int().positive().max(100).optional()
	})
	.strict();
export type Pronunciation = z.infer<typeof PronunciationSchema>;

export function needsPronunciationGuideRefresh(pronunciation: Pronunciation | null | undefined) {
	return pronunciation !== null && pronunciation?.guideVersion !== PRONUNCIATION_GUIDE_VERSION;
}

export const WordSchema = z
	.object({
		id: z.string().uuid(),
		number: z.number().int().positive(),
		english: z.string().trim().min(1).max(300),
		meaning: z.string().trim().min(1).max(1000),
		partOfSpeech: z.string().trim().min(1).max(30).optional(),
		pronunciation: PronunciationSchema.nullable().optional(),
		sourceImageId: z.string().uuid().nullable(),
		uncertain: z.boolean().default(false),
		starred: z.boolean().default(false).optional(),
		createdAt: z.string(),
		updatedAt: z.string()
	})
	.strict();
export type Word = z.infer<typeof WordSchema>;

export const VocabularyImageSchema = z
	.object({
		id: z.string().uuid(),
		filename: z.string().regex(/^[0-9a-f-]+\.jpg$/),
		createdAt: z.string(),
		wordCount: z.number().int().nonnegative()
	})
	.strict();

export const TestItemSchema = z
	.object({
		wordId: z.string().uuid(),
		number: z.number().int().positive(),
		english: z.string(),
		meaning: z.string(),
		partOfSpeech: z.string().optional(),
		result: ResultStatusSchema.optional()
	})
	.strict();

export const TestSessionSchema = z
	.object({
		id: z.string().uuid(),
		startedAt: z.string(),
		completedAt: z.string().optional(),
		range: z.object({ start: z.number().int().positive(), end: z.number().int().positive() }),
		order: z.enum(['sequential', 'random']),
		direction: z.enum(['english-to-korean', 'korean-to-english']),
		items: z.array(TestItemSchema).min(1),
		continuous: ContinuousTestMetadataSchema.optional()
	})
	.strict();
export type TestSession = z.infer<typeof TestSessionSchema>;

export const VocabularySchema = z
	.object({
		schemaVersion: z.literal(1),
		id: z.string().uuid(),
		title: z.string().trim().min(1).max(120),
		rangeLabel: z.string().trim().max(120),
		createdAt: z.string(),
		updatedAt: z.string(),
		images: z.array(VocabularyImageSchema),
		words: z.array(WordSchema),
		tests: z.array(TestSessionSchema)
	})
	.strict();
export type Vocabulary = z.infer<typeof VocabularySchema>;

export const UserIndexSchema = z
	.object({
		schemaVersion: z.literal(1),
		vocabularyIds: z.array(z.string().uuid())
	})
	.strict();

export const OcrEntrySchema = z
	.object({
		sourceOrder: z.number().int().nonnegative(),
		printedNumber: z.string().nullable().optional(),
		english: z.string().trim().min(1).max(300),
		meaning: z.string().trim().min(1).max(1000),
		partOfSpeech: z.string().trim().max(30).optional(),
		uncertain: z.boolean()
	})
	.strict();

export const OcrResponseSchema = z.object({ entries: z.array(OcrEntrySchema).max(500) }).strict();
export type OcrResponse = z.infer<typeof OcrResponseSchema>;

const partOfSpeechLabels: Record<string, string> = {
	n: '명',
	noun: '명',
	명사: '명',
	adj: '형',
	adjective: '형',
	형용사: '형',
	v: '동',
	verb: '동',
	동사: '동',
	adv: '부',
	adverb: '부',
	부사: '부'
};
const partOfSpeechPrefix =
	/^\s*(?:\[|\()?(명사|형용사|동사|부사|noun|adjective|verb|adverb|adj|adv|n|v|명|형|동|부)(?:(?:\]|\))|\.|(?=\s|$|[:：]))\s*[:：]?\s*/i;
const relationNote =
	/(?:^|\s+|(?=\[|\())(?:\[|\()?\s*(?:유(?:의어)?|반(?:의어)?|syn(?:onym)?|ant(?:onym)?)(?:\s*[:：]\s*|\s+)(?=\S)[\s\S]*?(?:\]|\)|$)/giu;

export function normalizeOcrEntry(entry: OcrResponse['entries'][number]) {
	let meaning = entry.meaning;
	const prefix = meaning.match(partOfSpeechPrefix);
	if (prefix) meaning = meaning.slice(prefix[0].length);
	meaning = meaning
		.replace(relationNote, ' ')
		.replace(/\s{2,}/g, ' ')
		.trim();
	const rawPartOfSpeech = (entry.partOfSpeech || prefix?.[1] || '').replace(/\.$/, '').trim();
	const partOfSpeech = partOfSpeechLabels[rawPartOfSpeech.toLowerCase()] || rawPartOfSpeech;
	return { ...entry, meaning, ...(partOfSpeech ? { partOfSpeech } : {}) };
}

export function removeWords(vocabulary: Vocabulary, wordIds: ReadonlySet<string>) {
	if (!wordIds.size) throw new Error('삭제할 단어를 선택해 주세요.');
	const words = vocabulary.words.filter((word) => !wordIds.has(word.id));
	if (vocabulary.words.length - words.length !== wordIds.size)
		throw new Error('단어를 찾을 수 없습니다.');

	const wordCounts = new Map<string, number>();
	for (const word of words) {
		if (word.sourceImageId)
			wordCounts.set(word.sourceImageId, (wordCounts.get(word.sourceImageId) || 0) + 1);
	}
	const orphanImages = vocabulary.images.filter((image) => !wordCounts.has(image.id));
	const images = vocabulary.images
		.filter((image) => wordCounts.has(image.id))
		.map((image) => ({ ...image, wordCount: wordCounts.get(image.id)! }));

	return {
		vocabulary: {
			...vocabulary,
			words: words.map((word, index) => ({ ...word, number: index + 1 })),
			images
		},
		orphanImages
	};
}

export function toggleWordStar(vocabulary: Vocabulary, wordId: string) {
	if (!WordSchema.shape.id.safeParse(wordId).success) throw new Error('단어를 찾을 수 없습니다.');
	const word = vocabulary.words.find((candidate) => candidate.id === wordId);
	if (!word) throw new Error('단어를 찾을 수 없습니다.');
	word.starred = !word.starred;
	word.updatedAt = new Date().toISOString();
	return vocabulary;
}

export function parseTestRange(
	words: Word[],
	all: boolean,
	startValue: FormDataEntryValue | null,
	endValue: FormDataEntryValue | null
): { start: number; end: number; words: Word[] } {
	if (!words.length) throw new Error('테스트할 단어가 없습니다.');
	const min = words[0].number;
	const max = words.at(-1)!.number;
	const start = all ? min : Number(startValue);
	const end = all ? max : Number(endValue);
	if (!Number.isInteger(start) || !Number.isInteger(end))
		throw new Error('시작과 끝 번호를 입력해 주세요.');
	if (start > end) throw new Error('시작 번호는 끝 번호보다 클 수 없습니다.');
	if (start < min || end > max) throw new Error(`범위는 ${min}~${max} 안에서 선택해 주세요.`);
	const selected = words.filter((word) => word.number >= start && word.number <= end);
	if (!selected.length) throw new Error('선택한 범위에 단어가 없습니다.');
	return { start, end, words: selected };
}

export function createTestSession(
	selectedWords: Word[],
	range: { start: number; end: number },
	order: TestSession['order'],
	direction: TestSession['direction'],
	random: () => number = Math.random,
	continuous?: ContinuousTestMetadata
): TestSession {
	const words = [...selectedWords];
	if (order === 'random') {
		for (let index = words.length - 1; index > 0; index -= 1) {
			const target = Math.floor(random() * (index + 1));
			[words[index], words[target]] = [words[target], words[index]];
		}
	}
	return {
		id: crypto.randomUUID(),
		startedAt: new Date().toISOString(),
		range,
		order,
		direction,
		...(continuous ? { continuous } : {}),
		items: words.map(({ id, number, english, meaning, partOfSpeech }) => ({
			wordId: id,
			number,
			english,
			meaning,
			...(partOfSpeech ? { partOfSpeech } : {})
		}))
	};
}

export function summarizeTest(test: TestSession, totalWords: number) {
	return summarizeResults(
		test.items.flatMap((item) => (item.result ? [item.result] : [])),
		totalWords
	);
}

export function summarizeResults(results: Iterable<ResultStatus>, totalWords: number) {
	const evaluated = [...results];
	return {
		correct: evaluated.filter((result) => result === 'correct').length,
		tested: evaluated.length,
		total: totalWords
	};
}

export function latestCompletedResults(vocabulary: Pick<Vocabulary, 'tests'>) {
	const results = new Map<string, ResultStatus>();
	for (const test of [...vocabulary.tests].reverse()) {
		if (!test.completedAt) continue;
		for (const item of test.items) {
			if (item.result && !results.has(item.wordId)) results.set(item.wordId, item.result);
		}
	}
	return results;
}

export function latestCompletedTest(vocabulary: Vocabulary) {
	return [...vocabulary.tests].reverse().find((test) => test.completedAt);
}

export type ContinuousLearningProgress = {
	status: 'ready' | 'in-progress' | 'complete';
	settings: ContinuousLearningSettings;
	phase?: ContinuousPhase;
	range?: { start: number; end: number };
	dayRange?: { start: number; end: number };
	testId?: string;
	completedDays: number;
};

export function nextContinuousLearningStep(
	vocabulary: Pick<Vocabulary, 'words' | 'tests'>,
	settings?: ContinuousLearningSettings
): ContinuousLearningProgress | null {
	const first = vocabulary.words[0]?.number;
	const last = vocabulary.words.at(-1)?.number;
	if (first === undefined || last === undefined) return null;

	const completedDays = vocabulary.tests.filter(
		(test) => test.continuous?.phase === 'cumulative' && test.completedAt
	).length;
	const latest = [...vocabulary.tests].reverse().find((test) => test.continuous);
	if (!latest) {
		if (!settings) return null;
		const dayEnd = Math.min(last, first + settings.daySize - 1);
		return {
			status: 'ready',
			settings,
			phase: 'batch',
			range: { start: first, end: Math.min(dayEnd, first + settings.batchSize - 1) },
			dayRange: { start: first, end: dayEnd },
			completedDays
		};
	}

	const metadata = latest.continuous!;
	const currentSettings = {
		batchSize: metadata.batchSize,
		daySize: metadata.daySize,
		studyMode: metadata.studyMode
	};
	const dayRange = { start: metadata.dayStart, end: metadata.dayEnd };
	if (!latest.completedAt) {
		return {
			status: 'in-progress',
			settings: currentSettings,
			phase: metadata.phase,
			range: latest.range,
			dayRange,
			testId: latest.id,
			completedDays
		};
	}

	if (metadata.phase === 'cumulative') {
		const start = latest.range.end + 1;
		if (start > last) return { status: 'complete', settings: currentSettings, completedDays };
		const nextDayEnd = Math.min(last, start + metadata.daySize - 1);
		return {
			status: 'ready',
			settings: currentSettings,
			phase: 'batch',
			range: { start, end: Math.min(nextDayEnd, start + metadata.batchSize - 1) },
			dayRange: { start, end: nextDayEnd },
			completedDays
		};
	}

	if (latest.range.end >= metadata.dayEnd || latest.range.end >= last) {
		return {
			status: 'ready',
			settings: currentSettings,
			phase: 'cumulative',
			range: { start: metadata.dayStart, end: latest.range.end },
			dayRange,
			completedDays
		};
	}

	const start = latest.range.end + 1;
	return {
		status: 'ready',
		settings: currentSettings,
		phase: 'batch',
		range: { start, end: Math.min(metadata.dayEnd, start + metadata.batchSize - 1) },
		dayRange,
		completedDays
	};
}
