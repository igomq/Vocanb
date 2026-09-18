import { z } from 'zod';

export const reviewGrades = ['correct', 'partial', 'wrong', 'unknown', 'ambiguous'] as const;
export const ReviewGradeSchema = z.enum(reviewGrades);
export type ReviewGrade = z.infer<typeof ReviewGradeSchema>;

export const reasonCodes = [
	'overdue',
	'due-today',
	'weak',
	'new',
	'stale',
	'low-mastery',
	'confusion',
	'lapse'
] as const;
export const ReasonCodeSchema = z.enum(reasonCodes);
export type ReasonCode = z.infer<typeof ReasonCodeSchema>;
export type QueueReason = { code: ReasonCode; detail?: string };

export const promptKinds = ['recall', 'cloze', 'choice', 'compare', 'ko-to-en', 'form'] as const;
export const PromptKindSchema = z.enum(promptKinds);
export type PromptKind = z.infer<typeof PromptKindSchema>;

export const SEOUL_TZ = 'Asia/Seoul';
export const REPEAT_WINDOW_MS = 10 * 60 * 1000;
export const MIN_STABILITY_DAYS = 10 / (24 * 60);
export const MAX_STABILITY_DAYS = 180;
export const ADAPTIVE_QUEUE_SIZE = 24;
export const CRAM_MAX_ITEMS = 80;
export const CRAM_SECONDS_PER_ITEM = 28;

export const LearningStateSchema = z
	.object({
		mastery: z.number().min(0).max(1),
		stability: z.number().positive().max(MAX_STABILITY_DAYS),
		difficulty: z.number().min(1).max(10),
		lastReviewedAt: z.string().nullable(),
		dueAt: z.string().min(1),
		reps: z.number().int().nonnegative(),
		streak: z.number().int().nonnegative(),
		lapseCount: z.number().int().nonnegative(),
		recentWrongRate: z.number().min(0).max(1),
		avgResponseMs: z.number().nonnegative().nullable(),
		recentResults: z.array(ReviewGradeSchema).max(8),
		lastGrade: ReviewGradeSchema.nullable(),
		lastCountedAt: z.string().nullable()
	})
	.strict();
export type LearningState = z.infer<typeof LearningStateSchema>;

export const QueueReasonSchema = z
	.object({
		code: ReasonCodeSchema,
		detail: z.string().trim().min(1).max(120).optional()
	})
	.strict();

export const AdaptiveSessionItemSchema = z
	.object({
		key: z.string().min(1).max(120),
		kind: z.enum(['word', 'sentence']),
		sourceId: z.string().uuid(),
		itemId: z.string().uuid(),
		number: z.number().int().positive().optional(),
		sourceTitle: z.string().min(1).max(120).optional(),
		english: z.string().min(1).max(300),
		meaning: z.string().min(1).max(1000),
		partOfSpeech: z.string().max(30).optional(),
		href: z.string().max(300).optional(),
		promptKind: PromptKindSchema,
		prompt: z.string().min(1).max(4000),
		answer: z.string().min(1).max(1000),
		choices: z.array(z.string().min(1).max(300)).min(2).max(6).optional(),
		reasons: z.array(QueueReasonSchema).min(1).max(8),
		result: ReviewGradeSchema.optional(),
		responseMs: z.number().nonnegative().max(3_600_000).optional(),
		typedAnswer: z.string().max(300).optional()
	})
	.strict();
export type AdaptiveSessionItem = z.infer<typeof AdaptiveSessionItemSchema>;

export const AdaptiveSessionSchema = z
	.object({
		id: z.string().uuid(),
		mode: z.enum(['adaptive', 'cram']),
		startedAt: z.string().min(1),
		completedAt: z.string().min(1).optional(),
		sourceId: z.string().uuid().nullable(),
		cram: z
			.object({
				minutes: z.number().int().positive().max(180).optional(),
				itemCount: z.number().int().positive().max(CRAM_MAX_ITEMS).optional()
			})
			.strict()
			.optional(),
		items: z.array(AdaptiveSessionItemSchema).min(1).max(CRAM_MAX_ITEMS)
	})
	.strict();
export type AdaptiveSession = z.infer<typeof AdaptiveSessionSchema>;

export const ConfusionPairSchema = z
	.object({
		leftId: z.string().uuid(),
		rightId: z.string().uuid(),
		sourceId: z.string().uuid(),
		left: z.string().min(1).max(300),
		right: z.string().min(1).max(300),
		count: z.number().int().positive(),
		lastAt: z.string().min(1)
	})
	.strict();
export type ConfusionPair = z.infer<typeof ConfusionPairSchema>;

export const DailyBucketSchema = z
	.object({
		date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
		reviewed: z.number().int().nonnegative(),
		scoreSum: z.number().nonnegative(),
		keys: z.array(z.string().min(1).max(120)).max(500)
	})
	.strict();
export type DailyBucket = z.infer<typeof DailyBucketSchema>;

export const AdaptiveDocumentSchema = z
	.object({
		schemaVersion: z.literal(1),
		items: z.record(z.string(), LearningStateSchema),
		confusion: z.array(ConfusionPairSchema).max(100),
		sessions: z.array(AdaptiveSessionSchema).max(20),
		appliedSessionIds: z.array(z.string().uuid()),
		appliedSignatures: z.record(z.string(), z.string().max(400)),
		days: z.array(DailyBucketSchema).max(14),
		settings: z
			.object({
				aiQuestionLimit: z.number().int().min(0).max(8).default(8)
			})
			.strict()
			.optional()
	})
	.strict();
export type AdaptiveDocument = z.infer<typeof AdaptiveDocumentSchema>;

export type LearningCandidate = {
	key: string;
	kind: 'word' | 'sentence';
	sourceId: string;
	sourceTitle: string;
	itemId: string;
	number?: number;
	english: string;
	meaning: string;
	partOfSpeech?: string;
	href?: string;
	state: LearningState;
};

export type QueueItem = LearningCandidate & {
	score: number;
	reasons: QueueReason[];
	promptKind: PromptKind;
	prompt: string;
	answer: string;
	choices?: string[];
};

export type DashboardData = {
	recommended: number;
	overdue: number;
	dueToday: number;
	studiedToday: number;
	accuracy: number | null;
	avgMastery: number | null;
	hardest: { key: string; label: string; mastery: number } | null;
	mostMissed: { key: string; label: string; lapseCount: number } | null;
	nextReview: { date: string; count: number } | null;
	trend: number[];
	confusion: { left: string; right: string; count: number }[];
};

export type SourceStat = {
	sourceId: string;
	title: string;
	kind: 'word' | 'sentence';
	overdue: number;
	dueToday: number;
	recommended: number;
};

const ITEM_KEY = /^(word|sentence):([0-9a-f-]{36}):([0-9a-f-]{36})$/;

export function emptyAdaptiveDocument(): AdaptiveDocument {
	return {
		schemaVersion: 1,
		items: {},
		confusion: [],
		sessions: [],
		appliedSessionIds: [],
		appliedSignatures: {},
		days: []
	};
}

export function emptyState(now: string): LearningState {
	return {
		mastery: 0,
		stability: 0.4,
		difficulty: 5,
		lastReviewedAt: null,
		dueAt: now,
		reps: 0,
		streak: 0,
		lapseCount: 0,
		recentWrongRate: 0,
		avgResponseMs: null,
		recentResults: [],
		lastGrade: null,
		lastCountedAt: null
	};
}

export function wordKey(vocabularyId: string, wordId: string) {
	return `word:${vocabularyId}:${wordId}`;
}

export function sentenceKey(bookId: string, passageId: string) {
	return `sentence:${bookId}:${passageId}`;
}

export function parseItemKey(key: string) {
	const match = ITEM_KEY.exec(key);
	if (!match) return null;
	return { kind: match[1] as 'word' | 'sentence', sourceId: match[2], itemId: match[3] };
}

export function seoulDateKey(iso: string) {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: SEOUL_TZ,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(new Date(iso));
}

export function retrievability(stability: number, elapsedDays: number) {
	if (!(stability > 0) || !Number.isFinite(elapsedDays)) return 0;
	return Math.pow(2, -Math.max(0, elapsedDays) / stability);
}

export function gradeFromVocabResult(
	result: 'correct' | 'wrong' | 'unknown' | 'ambiguous'
): ReviewGrade {
	return result;
}

export function gradeFromSentenceResults(
	results: Iterable<{ status: string }>
): ReviewGrade | null {
	const statuses = [...results].map((result) => result.status);
	if (!statuses.length) return null;
	if (statuses.every((status) => status === 'correct')) return 'correct';
	if (statuses.every((status) => status === 'wrong')) return 'wrong';
	if (statuses.includes('unknown')) return 'unknown';
	if (statuses.includes('wrong')) return 'partial';
	if (statuses.includes('partial')) return 'partial';
	if (statuses.includes('ambiguous')) return 'ambiguous';
	return 'partial';
}

export function gradeScore(grade: ReviewGrade) {
	if (grade === 'correct') return 1;
	if (grade === 'partial') return 0.5;
	return 0;
}

function round4(value: number) {
	return Math.round(value * 10000) / 10000;
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function daysBetween(from: string, to: string) {
	const elapsed = (Date.parse(to) - Date.parse(from)) / 86_400_000;
	return Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
}

function isFail(grade: ReviewGrade) {
	return grade === 'wrong' || grade === 'unknown';
}

export function isRepeatReview(state: LearningState, now: string) {
	if (!state.lastReviewedAt) return false;
	const elapsed = Date.parse(now) - Date.parse(state.lastReviewedAt);
	return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < REPEAT_WINDOW_MS;
}

export function applyReview(
	state: LearningState,
	grade: ReviewGrade,
	now: string,
	options?: { responseMs?: number; schedule?: boolean }
): { state: LearningState; counted: boolean } {
	const schedule = options?.schedule !== false;
	const counted = !isRepeatReview(state, now);
	const elapsed = state.lastReviewedAt ? daysBetween(state.lastReviewedAt, now) : 0;
	const recall = state.lastReviewedAt ? retrievability(state.stability, elapsed) : 0;
	let mastery = state.mastery;
	let stability = state.stability;
	let difficulty = state.difficulty;
	let streak = state.streak;
	let lapseCount = state.lapseCount;
	let reps = state.reps;
	let avgResponseMs = state.avgResponseMs;
	const recentResults = [...state.recentResults, grade].slice(-8);
	const failCount = recentResults.filter(isFail).length;
	const recentWrongRate = recentResults.length ? failCount / recentResults.length : 0;

	if (
		options?.responseMs != null &&
		Number.isFinite(options.responseMs) &&
		options.responseMs >= 0
	) {
		avgResponseMs =
			avgResponseMs == null ? options.responseMs : avgResponseMs * 0.7 + options.responseMs * 0.3;
	}

	if (counted) {
		reps += 1;
		if (isFail(grade)) {
			streak = 0;
			lapseCount += 1;
			difficulty = clamp(difficulty + (grade === 'unknown' ? 0.4 : 0.3), 1, 10);
			mastery = clamp(mastery * (grade === 'unknown' ? 0.4 : 0.6), 0, 1);
			if (schedule) stability = clamp(stability * 0.5, MIN_STABILITY_DAYS, MAX_STABILITY_DAYS);
		} else if (grade === 'partial') {
			streak = 0;
			difficulty = clamp(difficulty - 0.02, 1, 10);
			mastery = clamp(mastery + (1 - mastery) * 0.12, 0, 1);
			if (schedule) {
				stability = clamp(
					stability * (1 + 0.35 * (1 - recall) + 0.05),
					MIN_STABILITY_DAYS,
					MAX_STABILITY_DAYS
				);
			}
		} else if (grade === 'ambiguous') {
			streak = 0;
			difficulty = clamp(difficulty + 0.12, 1, 10);
			mastery = clamp(mastery * 0.92 + 0.04, 0, 1);
			if (schedule) {
				stability = clamp(
					stability * (1 + 0.2 * (1 - recall)),
					MIN_STABILITY_DAYS,
					MAX_STABILITY_DAYS
				);
			}
		} else {
			streak += 1;
			difficulty = clamp(difficulty - 0.15, 1, 10);
			mastery = clamp(mastery + (1 - mastery) * 0.28, 0, 1);
			if (schedule) {
				const factor = 1.7 - difficulty / 10;
				stability = clamp(
					stability * (1 + factor * (0.2 + 0.8 * (1 - recall))),
					MIN_STABILITY_DAYS,
					MAX_STABILITY_DAYS
				);
			}
		}
	} else if (isFail(grade)) mastery = clamp(mastery * 0.85, 0, 1);
	else if (grade === 'correct') mastery = clamp(mastery + (1 - mastery) * 0.08, 0, 1);

	let dueAt = state.dueAt;
	if (schedule && counted) {
		let interval = stability;
		if (isFail(grade)) interval = MIN_STABILITY_DAYS * (grade === 'unknown' ? 1 : 2);
		else if (grade === 'ambiguous') interval = Math.min(stability, 0.5);
		else if (grade === 'partial') interval = Math.min(stability, Math.max(0.25, stability * 0.5));
		if (mastery < 0.3) interval = Math.min(interval, 7);
		if (lapseCount >= 3 && streak < 2) interval = Math.min(interval, 1);
		interval = clamp(interval, MIN_STABILITY_DAYS, MAX_STABILITY_DAYS);
		dueAt = new Date(Date.parse(now) + interval * 86_400_000).toISOString();
	}

	return {
		counted,
		state: {
			mastery: round4(mastery),
			stability: round4(stability),
			difficulty: round4(difficulty),
			lastReviewedAt: now,
			dueAt,
			reps,
			streak,
			lapseCount,
			recentWrongRate: round4(recentWrongRate),
			avgResponseMs: avgResponseMs == null ? null : Math.round(avgResponseMs),
			recentResults,
			lastGrade: grade,
			lastCountedAt: counted ? now : state.lastCountedAt
		}
	};
}

export function applySessionReviews(
	states: Record<string, LearningState>,
	items: { key: string; result?: ReviewGrade; responseMs?: number }[],
	now: string,
	options?: { schedule?: boolean }
): Record<string, LearningState> {
	const lastByKey = new Map<string, { result: ReviewGrade; responseMs?: number }>();
	for (const item of items) {
		if (!item.result) continue;
		lastByKey.set(item.key, { result: item.result, responseMs: item.responseMs });
	}
	const next = { ...states };
	for (const [key, item] of lastByKey) {
		next[key] = applyReview(next[key] ?? emptyState(now), item.result, now, {
			schedule: options?.schedule,
			responseMs: item.responseMs
		}).state;
	}
	return next;
}

export function recordDaily(
	days: DailyBucket[],
	now: string,
	key: string,
	grade: ReviewGrade,
	counted: boolean
) {
	if (!counted) return days;
	const date = seoulDateKey(now);
	const buckets = days.filter((day) => day.date !== date);
	const current = days.find((day) => day.date === date) ?? {
		date,
		reviewed: 0,
		scoreSum: 0,
		keys: [] as string[]
	};
	return [
		...buckets,
		{
			date,
			reviewed: current.reviewed + 1,
			scoreSum: round4(current.scoreSum + gradeScore(grade)),
			keys: current.keys.includes(key) ? current.keys : [...current.keys, key].slice(-500)
		}
	]
		.sort((left, right) => left.date.localeCompare(right.date))
		.slice(-14);
}

export function dueBucket(dueAt: string, now: string): 'overdue' | 'due-today' | 'future' {
	const due = seoulDateKey(dueAt);
	const today = seoulDateKey(now);
	if (due < today) return 'overdue';
	if (due === today) return 'due-today';
	return 'future';
}

export function fnv1a(value: string) {
	let hash = 2166136261;
	for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
	return hash >>> 0;
}

function levenshtein(left: string, right: string) {
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

function normalizeToken(value: string) {
	return value
		.normalize('NFKC')
		.toLocaleLowerCase('en')
		.replace(/[^\p{L}\p{N}]+/gu, '');
}

export function spellingSimilarity(left: string, right: string) {
	const a = normalizeToken(left);
	const b = normalizeToken(right);
	if (!a || !b) return 0;
	const longest = Math.max(a.length, b.length);
	return longest ? 1 - levenshtein(a, b) / longest : 0;
}

function meaningTokens(value: string) {
	return new Set(
		value
			.normalize('NFKC')
			.toLocaleLowerCase('ko')
			.split(/[,/·，、\s]+/u)
			.map((token) => token.replace(/[^\p{L}\p{N}]+/gu, ''))
			.filter((token) => token.length >= 2)
	);
}

export function meaningOverlap(left: string, right: string) {
	const a = meaningTokens(left);
	const b = meaningTokens(right);
	if (!a.size || !b.size) return 0;
	let hit = 0;
	for (const token of a) if (b.has(token)) hit += 1;
	return hit / Math.max(a.size, b.size);
}

export function isConfusedPair(
	left: { english: string; meaning: string },
	right: { english: string; meaning: string },
	typedAnswer?: string
) {
	if (normalizeToken(left.english) === normalizeToken(right.english)) return false;
	if (typedAnswer && normalizeToken(typedAnswer) === normalizeToken(right.english)) return true;
	if (left.english.length >= 3 && spellingSimilarity(left.english, right.english) >= 0.55)
		return true;
	return meaningOverlap(left.meaning, right.meaning) >= 0.5;
}

function pairId(leftId: string, rightId: string) {
	return leftId < rightId ? ([leftId, rightId] as const) : ([rightId, leftId] as const);
}

export function confusionFromSession(
	items: {
		itemId: string;
		english: string;
		meaning: string;
		result?: ReviewGrade;
		typedAnswer?: string;
	}[],
	sourceId: string,
	now: string
): ConfusionPair[] {
	const missed = items.filter(
		(item) => item.result && item.result !== 'correct' && item.result !== 'partial'
	);
	const pairs = new Map<string, ConfusionPair>();
	const bump = (left: (typeof items)[number], right: (typeof items)[number]) => {
		const [leftId, rightId] = pairId(left.itemId, right.itemId);
		const key = `${sourceId}:${leftId}:${rightId}`;
		const leftLabel = leftId === left.itemId ? left.english : right.english;
		const rightLabel = leftId === left.itemId ? right.english : left.english;
		const current = pairs.get(key);
		pairs.set(key, {
			leftId,
			rightId,
			sourceId,
			left: leftLabel,
			right: rightLabel,
			count: (current?.count ?? 0) + 1,
			lastAt: now
		});
	};
	for (const [index, item] of missed.entries()) {
		for (const other of items) {
			if (other.itemId === item.itemId) continue;
			if (isConfusedPair(item, other, item.typedAnswer)) bump(item, other);
		}
		for (const other of missed.slice(index + 1)) {
			if (isConfusedPair(item, other) || isConfusedPair(other, item)) bump(item, other);
		}
	}
	return [...pairs.values()];
}

export function mergeConfusion(existing: ConfusionPair[], incoming: ConfusionPair[]) {
	const map = new Map<string, ConfusionPair>();
	for (const pair of [...existing, ...incoming]) {
		const key = `${pair.sourceId}:${pair.leftId}:${pair.rightId}`;
		const current = map.get(key);
		if (!current) {
			map.set(key, pair);
			continue;
		}
		map.set(key, {
			...pair,
			count: current.count + pair.count,
			lastAt: pair.lastAt > current.lastAt ? pair.lastAt : current.lastAt
		});
	}
	return [...map.values()]
		.sort(
			(left, right) =>
				right.count - left.count ||
				right.lastAt.localeCompare(left.lastAt) ||
				left.leftId.localeCompare(right.leftId)
		)
		.slice(0, 100);
}

export function confusionLabelFor(itemId: string, pairs: ConfusionPair[]) {
	const pair = pairs.find(
		(candidate) => candidate.leftId === itemId || candidate.rightId === itemId
	);
	if (!pair) return undefined;
	return pair.leftId === itemId ? pair.right : pair.left;
}

export function priorityFor(
	state: LearningState,
	now: string,
	extras?: { confusedWith?: string }
): { score: number; reasons: QueueReason[] } {
	const reasons: QueueReason[] = [];
	let score = 0;
	const bucket = dueBucket(state.dueAt, now);
	if (state.reps === 0) {
		reasons.push({ code: 'new' });
		score += 2.4;
	} else if (bucket === 'overdue') {
		const days = Math.max(1, Math.round(daysBetween(state.dueAt, now)));
		reasons.push({ code: 'overdue', detail: String(days) });
		score += 5 + Math.min(days, 14) * 0.6;
	} else if (bucket === 'due-today') {
		reasons.push({ code: 'due-today' });
		score += 3;
	}
	const recent = state.recentResults.slice(-3);
	const recentFails = recent.filter(isFail).length;
	if (recent.length >= 2 && recentFails >= 2) {
		reasons.push({ code: 'weak', detail: `${recentFails}/${recent.length}` });
		score += 4 * (recentFails / recent.length);
	}
	if (state.mastery < 0.35 && state.reps > 0) {
		reasons.push({ code: 'low-mastery' });
		score += (0.35 - state.mastery) * 4;
	}
	if (state.lapseCount >= 2 && state.streak === 0) {
		reasons.push({ code: 'lapse' });
		score += Math.min(state.lapseCount, 6) * 0.5;
	}
	const last = state.lastReviewedAt
		? daysBetween(state.lastReviewedAt, now)
		: Number.POSITIVE_INFINITY;
	if (state.reps > 0 && last >= 14) {
		reasons.push({ code: 'stale', detail: String(Math.round(last)) });
		score += Math.min(last, 60) * 0.08;
	}
	if (extras?.confusedWith) {
		reasons.push({ code: 'confusion', detail: extras.confusedWith });
		score += 2.2;
	}
	score += state.recentWrongRate * 1.5;
	return { score: round4(score), reasons };
}

export function formatReason(reason: QueueReason) {
	switch (reason.code) {
		case 'overdue':
			return `복습 예정일이 ${reason.detail ?? '1'}일 지남`;
		case 'due-today':
			return '오늘 복습 예정';
		case 'weak':
			return `최근 ${reason.detail ?? '여러'}회 틀림`;
		case 'new':
			return '아직 충분히 학습하지 않음';
		case 'stale':
			return `${reason.detail ?? '여러'}일 동안 보지 않음`;
		case 'low-mastery':
			return '아직 덜 익숙함';
		case 'confusion':
			return `최근 ${reason.detail ?? '비슷한 단어'}와 혼동함`;
		case 'lapse':
			return '최근에 자주 틀림';
	}
}

function compareScored(
	left: { score: number; key: string },
	right: { score: number; key: string }
) {
	return right.score - left.score || left.key.localeCompare(right.key);
}

function primaryBucket(reasons: QueueReason[]) {
	for (const code of ['overdue', 'due-today', 'weak', 'new', 'stale'] as const) {
		if (reasons.some((reason) => reason.code === code)) return code;
	}
	return 'other';
}

export function scoreCandidates(
	candidates: LearningCandidate[],
	now: string,
	pairs: ConfusionPair[]
) {
	return candidates
		.map((candidate) => {
			const confusedWith = confusionLabelFor(candidate.itemId, pairs);
			return { ...candidate, ...priorityFor(candidate.state, now, { confusedWith }) };
		})
		.sort(compareScored);
}

export function pickDistractors(
	item: { key: string; english: string; partOfSpeech?: string },
	pool: { key: string; english: string; partOfSpeech?: string }[],
	count: number,
	confusedEnglish?: string
) {
	const answer = normalizeToken(item.english);
	const unique = new Map<string, string>();
	if (confusedEnglish && normalizeToken(confusedEnglish) !== answer)
		unique.set(normalizeToken(confusedEnglish), confusedEnglish);
	const rest = pool
		.filter(
			(candidate) => candidate.key !== item.key && normalizeToken(candidate.english) !== answer
		)
		.sort((left, right) => {
			const leftPos = Number(left.partOfSpeech && left.partOfSpeech === item.partOfSpeech);
			const rightPos = Number(right.partOfSpeech && right.partOfSpeech === item.partOfSpeech);
			return (
				rightPos - leftPos ||
				Math.abs(left.english.length - item.english.length) -
					Math.abs(right.english.length - item.english.length) ||
				fnv1a(item.key + left.english) - fnv1a(item.key + right.english)
			);
		});
	for (const candidate of rest) {
		if (unique.size >= count) break;
		unique.set(normalizeToken(candidate.english), candidate.english);
	}
	return [...unique.values()].slice(0, count);
}

function shuffleChoices(choices: string[], key: string) {
	return [...choices].sort(
		(left, right) => fnv1a(key + left) - fnv1a(key + right) || left.localeCompare(right)
	);
}

export function toQueueItem(
	item: LearningCandidate & { score: number; reasons: QueueReason[] },
	pool: LearningCandidate[],
	confusedWith?: string
): QueueItem {
	const reasons = item.reasons.length
		? item.reasons
		: ([{ code: item.state.reps === 0 ? 'new' : 'low-mastery' }] as QueueReason[]);
	const scored = { ...item, reasons };
	if (item.kind === 'sentence') {
		const excerpt = item.meaning.replace(/\s+/g, ' ').trim().slice(0, 80);
		return {
			...scored,
			promptKind: 'recall',
			prompt: `${item.english} · ${excerpt}`.slice(0, 4000),
			answer: item.meaning
		};
	}
	const sameSource = pool.filter((candidate) => candidate.sourceId === item.sourceId);
	const distractors = pickDistractors(
		item,
		sameSource.length > 3 ? sameSource : pool,
		3,
		confusedWith
	);
	if (confusedWith && distractors.includes(confusedWith)) {
		return {
			...scored,
			promptKind: 'compare',
			prompt: `다음 중 '${item.meaning}'의 뜻에 맞는 단어는?`,
			answer: item.english,
			choices: shuffleChoices([item.english, confusedWith], item.key)
		};
	}
	if (distractors.length >= 2 && fnv1a(item.key) % 3 === 1) {
		return {
			...scored,
			promptKind: 'choice',
			prompt: item.meaning,
			answer: item.english,
			choices: shuffleChoices([item.english, ...distractors.slice(0, 3)], item.key)
		};
	}
	if (fnv1a(item.key) % 3 === 0) {
		return {
			...scored,
			promptKind: 'ko-to-en',
			prompt: item.meaning,
			answer: item.english
		};
	}
	return {
		...scored,
		promptKind: 'recall',
		prompt: item.english,
		answer: item.meaning
	};
}

export function buildQueue(
	candidates: LearningCandidate[],
	now: string,
	options?: { limit?: number; pairs?: ConfusionPair[]; pool?: LearningCandidate[] }
): QueueItem[] {
	const limit = options?.limit ?? ADAPTIVE_QUEUE_SIZE;
	const pairs = options?.pairs ?? [];
	const scored = scoreCandidates(candidates, now, pairs);
	const eligible = scored.filter((item) => item.reasons.length > 0);
	const buckets: Record<string, typeof eligible> = {
		overdue: [],
		'due-today': [],
		weak: [],
		new: [],
		stale: [],
		other: []
	};
	for (const item of eligible) buckets[primaryBucket(item.reasons)].push(item);
	const quotas: Record<string, number> = {
		overdue: 10,
		'due-today': 6,
		weak: 5,
		new: 5,
		stale: 4,
		other: limit
	};
	const selected: typeof eligible = [];
	const used = new Set<string>();
	const sourceCount = new Set(candidates.map((item) => item.sourceId)).size;
	const sourceCap = sourceCount > 1 ? Math.max(8, Math.ceil(limit * 0.5)) : limit;
	const sourceUsed = new Map<string, number>();
	const take = (item: (typeof eligible)[number]) => {
		if (used.has(item.key) || selected.length >= limit) return false;
		const usedForSource = sourceUsed.get(item.sourceId) ?? 0;
		if (usedForSource >= sourceCap) return false;
		used.add(item.key);
		sourceUsed.set(item.sourceId, usedForSource + 1);
		selected.push(item);
		return true;
	};
	const names = Object.keys(buckets);
	let progressed = true;
	while (selected.length < limit && progressed) {
		progressed = false;
		for (const name of names) {
			if (selected.length >= limit) break;
			if ((quotas[name] ?? 0) <= 0) continue;
			const next = buckets[name].find((item) => !used.has(item.key));
			if (!next) continue;
			if (take(next)) {
				quotas[name] -= 1;
				progressed = true;
			} else used.add(next.key);
		}
	}
	for (const item of eligible) take(item);
	const pool = options?.pool ?? candidates;
	return selected.map((item) => toQueueItem(item, pool, confusionLabelFor(item.itemId, pairs)));
}

export function cramCapacity(options: { minutes?: number; itemCount?: number }) {
	if (options.itemCount && Number.isInteger(options.itemCount))
		return clamp(options.itemCount, 1, CRAM_MAX_ITEMS);
	if (options.minutes && Number.isInteger(options.minutes))
		return clamp(Math.round((options.minutes * 60) / CRAM_SECONDS_PER_ITEM), 4, CRAM_MAX_ITEMS);
	return 20;
}

export function cramScore(state: LearningState, now: string, confused: boolean) {
	const overdueDays = dueBucket(state.dueAt, now) === 'overdue' ? daysBetween(state.dueAt, now) : 0;
	return round4(
		state.lapseCount * 3 +
			state.recentWrongRate * 4 +
			Math.min(overdueDays, 14) * 2 +
			(1 - state.mastery) * 3 +
			(confused ? 2 : 0) +
			(state.reps === 0 ? 1 : 0)
	);
}

export function buildCramQueue(
	candidates: LearningCandidate[],
	now: string,
	options: { minutes?: number; itemCount?: number; pairs?: ConfusionPair[] }
): QueueItem[] {
	const capacity = cramCapacity(options);
	const pairs = options.pairs ?? [];
	const ranked = [...candidates]
		.map((candidate) => ({
			candidate,
			confusedWith: confusionLabelFor(candidate.itemId, pairs),
			score: cramScore(candidate.state, now, Boolean(confusionLabelFor(candidate.itemId, pairs)))
		}))
		.sort(
			(left, right) =>
				right.score - left.score || left.candidate.key.localeCompare(right.candidate.key)
		);
	const picked: LearningCandidate[] = [];
	for (const entry of ranked) {
		if (picked.length >= capacity) break;
		picked.push(entry.candidate);
	}
	const withCopies: LearningCandidate[] = [];
	for (const [index, item] of picked.entries()) {
		withCopies.push(item);
		const hard = item.state.lapseCount >= 2 || item.state.recentWrongRate >= 0.5;
		if (hard && withCopies.length < capacity) {
			withCopies.splice(Math.min(withCopies.length, index + 3), 0, item);
		}
	}
	return withCopies.slice(0, capacity).map((item) => {
		const confusedWith = confusionLabelFor(item.itemId, pairs);
		const reasons = priorityFor(item.state, now, { confusedWith }).reasons;
		return toQueueItem(
			{
				...item,
				score: cramScore(item.state, now, Boolean(confusedWith)),
				reasons: reasons.length
					? reasons
					: [{ code: item.state.reps === 0 ? 'new' : 'low-mastery' }]
			},
			candidates,
			confusedWith
		);
	});
}

export function sameCanonical(value: string, expected: string) {
	return normalizeToken(value) === normalizeToken(expected);
}

export function applyAiPrompt(item: QueueItem, draft: unknown): QueueItem | null {
	if (item.kind !== 'word') return null;
	if (!draft || typeof draft !== 'object') return null;
	const data = draft as Record<string, unknown>;
	if (data.itemId != null && data.itemId !== item.itemId) return null;
	const type = PromptKindSchema.safeParse(data.type ?? data.promptKind);
	if (!type.success) return null;
	if (typeof data.prompt !== 'string' || !data.prompt.trim() || data.prompt.length > 4000)
		return null;
	const prompt = data.prompt.trim();
	const rawAnswer = typeof data.answer === 'string' ? data.answer.trim() : item.english;
	if (!sameCanonical(rawAnswer, item.english) && !sameCanonical(rawAnswer, item.meaning))
		return null;
	if (type.data === 'cloze' && !/_{3,}|\[\s*\]/.test(prompt)) return null;
	if (type.data === 'ko-to-en' && !sameCanonical(rawAnswer, item.english)) return null;
	let choices: string[] | undefined;
	if (type.data === 'choice' || type.data === 'compare' || type.data === 'form') {
		if (!Array.isArray(data.choices)) return null;
		const unique: string[] = [];
		for (const choice of data.choices) {
			if (typeof choice !== 'string') return null;
			const trimmed = choice.trim();
			if (!trimmed || trimmed.length > 300) return null;
			if (unique.some((existing) => sameCanonical(existing, trimmed))) continue;
			unique.push(trimmed);
		}
		if (unique.length < 2 || unique.length > 6) return null;
		if (unique.filter((choice) => sameCanonical(choice, item.english)).length !== 1) return null;
		choices = unique.map((choice) => (sameCanonical(choice, item.english) ? item.english : choice));
	}
	return {
		...item,
		promptKind: type.data,
		prompt,
		answer: type.data === 'recall' ? item.meaning : item.english,
		choices
	};
}

export function applyAiPrompts(items: QueueItem[], payload: unknown) {
	const drafts = Array.isArray(payload)
		? payload
		: payload &&
			  typeof payload === 'object' &&
			  Array.isArray((payload as { items?: unknown }).items)
			? (payload as { items: unknown[] }).items
			: null;
	if (!drafts) return items;
	const byId = new Map<string, unknown>();
	for (const draft of drafts) {
		if (!draft || typeof draft !== 'object' || !('itemId' in draft)) continue;
		const itemId = (draft as { itemId?: unknown }).itemId;
		if (typeof itemId === 'string') byId.set(itemId, draft);
	}
	return items.map((item) => {
		const draft = byId.get(item.itemId);
		return draft ? (applyAiPrompt(item, draft) ?? item) : item;
	});
}

export function summarizeDashboard(
	candidates: LearningCandidate[],
	days: DailyBucket[],
	pairs: ConfusionPair[],
	now: string,
	recommended: number
): DashboardData {
	const today = seoulDateKey(now);
	let overdue = 0;
	let dueToday = 0;
	let masterySum = 0;
	let masteryCount = 0;
	let hardest: DashboardData['hardest'] = null;
	let mostMissed: DashboardData['mostMissed'] = null;
	const upcoming = new Map<string, number>();
	for (const item of candidates) {
		const bucket = dueBucket(item.state.dueAt, now);
		if (item.state.reps > 0 && bucket === 'overdue') overdue += 1;
		else if (item.state.reps > 0 && bucket === 'due-today') dueToday += 1;
		else if (item.state.reps > 0 && bucket === 'future') {
			const date = seoulDateKey(item.state.dueAt);
			upcoming.set(date, (upcoming.get(date) ?? 0) + 1);
		}
		if (item.state.reps > 0) {
			masterySum += item.state.mastery;
			masteryCount += 1;
			if (
				!hardest ||
				item.state.mastery < hardest.mastery ||
				(item.state.mastery === hardest.mastery && item.key.localeCompare(hardest.key) < 0)
			) {
				hardest = { key: item.key, label: item.english, mastery: item.state.mastery };
			}
			if (
				item.state.lapseCount > 0 &&
				(!mostMissed ||
					item.state.lapseCount > mostMissed.lapseCount ||
					(item.state.lapseCount === mostMissed.lapseCount &&
						item.key.localeCompare(mostMissed.key) < 0))
			) {
				mostMissed = {
					key: item.key,
					label: item.english,
					lapseCount: item.state.lapseCount
				};
			}
		}
	}
	const todayBucket = days.find((day) => day.date === today);
	const recent = days.filter((day) => day.date <= today).slice(-7);
	const reviewed = recent.reduce((sum, day) => sum + day.reviewed, 0);
	const scoreSum = recent.reduce((sum, day) => sum + day.scoreSum, 0);
	const nextDate = [...upcoming.keys()].sort()[0];
	const trendDates = Array.from({ length: 7 }, (_, index) =>
		seoulDateKey(new Date(Date.parse(now) + (index - 6) * 86_400_000).toISOString())
	);
	const byDate = new Map(days.map((day) => [day.date, day.reviewed]));
	return {
		recommended,
		overdue,
		dueToday,
		studiedToday: todayBucket?.keys.length ?? 0,
		accuracy: reviewed ? round4(scoreSum / reviewed) : null,
		avgMastery: masteryCount ? round4(masterySum / masteryCount) : null,
		hardest,
		mostMissed,
		nextReview: nextDate ? { date: nextDate, count: upcoming.get(nextDate)! } : null,
		trend: trendDates.map((date) => byDate.get(date) ?? 0),
		confusion: pairs.slice(0, 5).map((pair) => ({
			left: pair.left,
			right: pair.right,
			count: pair.count
		}))
	};
}

export function sourceStatsFor(candidates: LearningCandidate[], now: string): SourceStat[] {
	const groups = new Map<string, LearningCandidate[]>();
	for (const item of candidates) {
		const list = groups.get(item.sourceId);
		if (list) list.push(item);
		else groups.set(item.sourceId, [item]);
	}
	return [...groups].map(([sourceId, items]) => {
		let overdue = 0;
		let dueToday = 0;
		for (const item of items) {
			if (item.state.reps === 0) continue;
			const bucket = dueBucket(item.state.dueAt, now);
			if (bucket === 'overdue') overdue += 1;
			else if (bucket === 'due-today') dueToday += 1;
		}
		return {
			sourceId,
			title: items[0].sourceTitle,
			kind: items[0].kind,
			overdue,
			dueToday,
			recommended: buildQueue(items, now).length
		};
	});
}

export function pruneItems(items: Record<string, LearningState>, liveKeys: Iterable<string>) {
	const live = new Set(liveKeys);
	const next: Record<string, LearningState> = {};
	for (const [key, state] of Object.entries(items)) {
		if (live.has(key)) next[key] = state;
	}
	return next;
}

export function replayReviews(
	state: LearningState,
	reviews: { grade: ReviewGrade; at: string; responseMs?: number }[]
) {
	let current = state;
	for (const review of [...reviews].sort(
		(left, right) => left.at.localeCompare(right.at) || left.grade.localeCompare(right.grade)
	)) {
		current = applyReview(current, review.grade, review.at, {
			responseMs: review.responseMs
		}).state;
	}
	return current;
}
