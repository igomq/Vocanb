import { describe, expect, it } from 'vitest';
import {
	ADAPTIVE_QUEUE_SIZE,
	AdaptiveDocumentSchema,
	MAX_STABILITY_DAYS,
	MIN_STABILITY_DAYS,
	applyAiPrompt,
	applyAiPrompts,
	applyReview,
	applySessionReviews,
	buildCramQueue,
	buildQueue,
	confusionFromSession,
	cramCapacity,
	dueBucket,
	emptyAdaptiveDocument,
	emptyState,
	formatReason,
	gradeFromSentenceResults,
	isRepeatReview,
	priorityFor,
	pruneItems,
	recordDaily,
	replayReviews,
	seoulDateKey,
	sentenceKey,
	sourceStatsFor,
	summarizeDashboard,
	wordKey,
	type LearningCandidate,
	type LearningState,
	type QueueItem
} from './learning';

const NOW = '2026-09-09T15:00:00.000Z';
const SOURCE = '10000000-0000-4000-8000-000000000001';

function id(n: number) {
	return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function later(hours: number, from = NOW) {
	return new Date(Date.parse(from) + hours * 3_600_000).toISOString();
}

function candidate(
	n: number,
	state: LearningState,
	english = `word-${n}`,
	meaning = `뜻-${n}`
): LearningCandidate {
	return {
		key: wordKey(SOURCE, id(n)),
		kind: 'word',
		sourceId: SOURCE,
		sourceTitle: '테스트',
		itemId: id(n),
		number: n,
		english,
		meaning,
		state
	};
}

function reviewed(
	grade: LearningState['lastGrade'],
	extra: Partial<LearningState> = {}
): LearningState {
	return {
		...emptyState(NOW),
		reps: 3,
		lastReviewedAt: later(-48),
		dueAt: later(-24),
		lastGrade: grade,
		recentResults: grade ? [grade, grade, grade] : [],
		...extra
	};
}

function asQueue(item: ReturnType<typeof buildQueue>[number]): QueueItem {
	return item;
}

describe('scheduler', () => {
	it('is deterministic for the same inputs', () => {
		const first = applyReview(emptyState(NOW), 'correct', NOW);
		const second = applyReview(emptyState(NOW), 'correct', NOW);
		expect(first).toEqual(second);
	});

	it('schedules a new correct item within a day', () => {
		const { state, counted } = applyReview(emptyState(NOW), 'correct', NOW);
		expect(counted).toBe(true);
		expect(state.reps).toBe(1);
		expect(state.mastery).toBeGreaterThan(0.2);
		expect(Date.parse(state.dueAt) - Date.parse(NOW)).toBeGreaterThan(3 * 3_600_000);
		expect(Date.parse(state.dueAt) - Date.parse(NOW)).toBeLessThan(2 * 86_400_000);
	});

	it('brings unknown and wrong items back quickly', () => {
		const unknown = applyReview(emptyState(NOW), 'unknown', NOW).state;
		const wrong = applyReview(emptyState(NOW), 'wrong', NOW).state;
		expect(Date.parse(unknown.dueAt) - Date.parse(NOW)).toBeCloseTo(
			MIN_STABILITY_DAYS * 86_400_000,
			-3
		);
		expect(Date.parse(wrong.dueAt) - Date.parse(NOW)).toBeGreaterThan(
			Date.parse(unknown.dueAt) - Date.parse(NOW)
		);
		expect(unknown.lapseCount).toBe(1);
		expect(wrong.mastery).toBe(0);
	});

	it('grows intervals for long-correct items but never buries them past 180 days', () => {
		let state = emptyState(NOW);
		let at = NOW;
		for (let index = 0; index < 12; index += 1) {
			state = applyReview(state, 'correct', at).state;
			at = state.dueAt;
		}
		const interval = Date.parse(state.dueAt) - Date.parse(state.lastReviewedAt!);
		expect(interval).toBeGreaterThan(20 * 86_400_000);
		expect(interval).toBeLessThanOrEqual(MAX_STABILITY_DAYS * 86_400_000 + 1000);
		expect(state.stability).toBeLessThanOrEqual(MAX_STABILITY_DAYS);
	});

	it('keeps repeated lapses from looping forever or disappearing', () => {
		let state = emptyState(NOW);
		let at = NOW;
		for (let index = 0; index < 6; index += 1) {
			state = applyReview(state, 'wrong', at).state;
			at = state.dueAt;
		}
		expect(state.lapseCount).toBe(6);
		expect(state.streak).toBe(0);
		const wait = Date.parse(state.dueAt) - Date.parse(state.lastReviewedAt!);
		expect(wait).toBeGreaterThan(5 * 60 * 1000);
		expect(wait).toBeLessThanOrEqual(86_400_000 + 1000);
	});

	it('treats partial as weaker than correct and stronger than wrong', () => {
		const correct = applyReview(emptyState(NOW), 'correct', NOW).state;
		const partial = applyReview(emptyState(NOW), 'partial', NOW).state;
		const wrong = applyReview(emptyState(NOW), 'wrong', NOW).state;
		expect(partial.mastery).toBeGreaterThan(wrong.mastery);
		expect(partial.mastery).toBeLessThan(correct.mastery);
		expect(Date.parse(partial.dueAt)).toBeGreaterThan(Date.parse(wrong.dueAt));
		expect(Date.parse(partial.dueAt)).toBeLessThan(Date.parse(correct.dueAt));
	});

	it('does not count a second review at the same timestamp', () => {
		const first = applyReview(emptyState(NOW), 'wrong', NOW);
		const second = applyReview(first.state, 'correct', NOW);
		expect(isRepeatReview(first.state, NOW)).toBe(true);
		expect(second.counted).toBe(false);
		expect(second.state.reps).toBe(1);
		expect(second.state.dueAt).toBe(first.state.dueAt);
		expect(second.state.lastGrade).toBe('correct');
	});

	it('does not let cram reviews move due dates', () => {
		const before = applyReview(emptyState(NOW), 'correct', later(-72)).state;
		const dueAt = before.dueAt;
		const stability = before.stability;
		const after = applyReview(before, 'correct', NOW, { schedule: false }).state;
		expect(after.dueAt).toBe(dueAt);
		expect(after.stability).toBe(stability);
		expect(after.reps).toBe(before.reps + 1);
	});
});

describe('time boundaries', () => {
	it('uses Asia/Seoul calendar days for overdue vs due today', () => {
		expect(seoulDateKey(NOW)).toBe('2026-09-10');
		expect(dueBucket('2026-09-09T14:59:59.000Z', NOW)).toBe('overdue');
		expect(dueBucket(NOW, NOW)).toBe('due-today');
		expect(dueBucket('2026-09-10T14:59:59.000Z', NOW)).toBe('due-today');
		expect(dueBucket('2026-09-10T15:00:00.000Z', NOW)).toBe('future');
	});
});

describe('priority and queue', () => {
	it('ranks overdue and weak items above new and future items', () => {
		const overdue = candidate(1, reviewed('wrong', { dueAt: later(-48), recentWrongRate: 0.8 }));
		const dueToday = candidate(2, reviewed('correct', { dueAt: NOW, lastReviewedAt: later(-20) }));
		const fresh = candidate(3, emptyState(NOW));
		const future = candidate(
			4,
			reviewed('correct', {
				dueAt: later(72),
				lastReviewedAt: later(-2),
				mastery: 0.8,
				recentResults: ['correct', 'correct', 'correct']
			})
		);
		const ranked = [overdue, dueToday, fresh, future]
			.map((item) => ({ key: item.key, ...priorityFor(item.state, NOW) }))
			.sort((left, right) => right.score - left.score);
		expect(ranked.map((item) => item.key)).toEqual([
			overdue.key,
			dueToday.key,
			fresh.key,
			future.key
		]);
		expect(ranked[0].reasons.some((reason) => reason.code === 'overdue')).toBe(true);
	});

	it('keeps queue unique and mixed across buckets', () => {
		const items = [
			...Array.from({ length: 20 }, (_, index) =>
				candidate(
					index + 1,
					reviewed('wrong', {
						dueAt: later(-24 * (index + 1)),
						lapseCount: 2,
						recentWrongRate: 0.7
					})
				)
			),
			...Array.from({ length: 20 }, (_, index) => candidate(index + 40, emptyState(NOW))),
			...Array.from({ length: 8 }, (_, index) =>
				candidate(
					index + 80,
					reviewed('correct', {
						dueAt: NOW,
						lastReviewedAt: later(-20),
						recentResults: ['correct'],
						recentWrongRate: 0
					})
				)
			)
		];
		const queue = buildQueue(items, NOW);
		expect(queue.length).toBe(ADAPTIVE_QUEUE_SIZE);
		expect(new Set(queue.map((item) => item.key)).size).toBe(queue.length);
		const codes = new Set(queue.flatMap((item) => item.reasons.map((reason) => reason.code)));
		expect(codes.has('overdue')).toBe(true);
		expect(codes.has('new')).toBe(true);
	});

	it('caps one vocabulary when several sources exist', () => {
		const other = '20000000-0000-4000-8000-000000000002';
		const items = [
			...Array.from({ length: 30 }, (_, index) => ({
				...candidate(index + 1, reviewed('wrong', { dueAt: later(-24) })),
				sourceId: SOURCE
			})),
			...Array.from({ length: 30 }, (_, index) => ({
				...candidate(index + 100, reviewed('wrong', { dueAt: later(-24) })),
				key: wordKey(other, id(index + 100)),
				sourceId: other,
				itemId: id(index + 100)
			}))
		];
		const queue = buildQueue(items, NOW);
		const fromFirst = queue.filter((item) => item.sourceId === SOURCE).length;
		expect(fromFirst).toBeGreaterThan(0);
		expect(fromFirst).toBeLessThanOrEqual(12);
	});

	it('includes sentence candidates in the adaptive queue', () => {
		const book = '30000000-0000-4000-8000-000000000003';
		const passageId = id(9);
		const items: LearningCandidate[] = [
			candidate(1, reviewed('wrong', { dueAt: later(-48) })),
			{
				key: sentenceKey(book, passageId),
				kind: 'sentence',
				sourceId: book,
				sourceTitle: '문장',
				itemId: passageId,
				english: '1. 본문',
				meaning: 'the idea of freedom',
				state: reviewed('wrong', { dueAt: later(-48) })
			}
		];
		const sentence = buildQueue(items, NOW).find((item) => item.kind === 'sentence');
		expect(sentence?.promptKind).toBe('recall');
		expect(sentence?.prompt).toContain('1. 본문');
		expect(sentence?.answer).toBe('the idea of freedom');
	});
});

describe('cram mode', () => {
	it('maps minutes to a bounded item count', () => {
		expect(cramCapacity({ minutes: 20 })).toBeGreaterThanOrEqual(4);
		expect(cramCapacity({ minutes: 60 })).toBeLessThanOrEqual(80);
		expect(cramCapacity({ itemCount: 12 })).toBe(12);
	});

	it('puts repeated-wrong items first and may repeat hard cards', () => {
		const hard = candidate(
			1,
			reviewed('wrong', { lapseCount: 5, recentWrongRate: 1, mastery: 0.1, dueAt: later(-72) }),
			'affect',
			'영향을 주다'
		);
		const overdue = candidate(2, reviewed('correct', { dueAt: later(-48), mastery: 0.5 }));
		const fresh = candidate(3, emptyState(NOW));
		const queue = buildCramQueue([fresh, overdue, hard], NOW, { itemCount: 5 });
		expect(queue[0].english).toBe('affect');
		expect(queue.filter((item) => item.key === hard.key).length).toBeGreaterThan(1);
	});
});

describe('confusion pairs', () => {
	it('detects affect/effect style misses from spelling and typed answers', () => {
		const pairs = confusionFromSession(
			[
				{
					itemId: id(1),
					english: 'affect',
					meaning: '영향을 주다',
					result: 'wrong',
					typedAnswer: 'effect'
				},
				{ itemId: id(2), english: 'effect', meaning: '결과', result: 'wrong' },
				{ itemId: id(3), english: 'banana', meaning: '바나나', result: 'correct' }
			],
			SOURCE,
			NOW
		);
		expect(pairs.some((pair) => pair.left === 'affect' && pair.right === 'effect')).toBe(true);
		expect(pairs.every((pair) => pair.left !== 'banana' && pair.right !== 'banana')).toBe(true);
	});
});

describe('AI prompt validation', () => {
	const base = asQueue(buildQueue([candidate(1, emptyState(NOW), 'adopt', '채택하다')], NOW)[0]);

	it('keeps fallback when the payload is malformed or has the wrong answer', () => {
		expect(applyAiPrompt(base, null)).toBeNull();
		expect(
			applyAiPrompt(base, {
				itemId: base.itemId,
				type: 'cloze',
				prompt: 'no blank',
				answer: 'adopt'
			})
		).toBeNull();
		expect(
			applyAiPrompt(base, {
				itemId: base.itemId,
				type: 'choice',
				prompt: 'pick',
				answer: 'invented',
				choices: ['invented', 'other']
			})
		).toBeNull();
		const items = applyAiPrompts([base], { items: [{ itemId: base.itemId, type: 'nope' }] });
		expect(items[0]).toEqual(base);
	});

	it('accepts a cloze whose canonical answer matches the word', () => {
		const next = applyAiPrompt(
			{ ...base, choices: ['adopt', 'adapt'] },
			{
				itemId: base.itemId,
				type: 'cloze',
				prompt: 'They will ___ a new policy.',
				answer: 'adopt'
			}
		);
		expect(next?.promptKind).toBe('cloze');
		expect(next?.answer).toBe('adopt');
		expect(next?.choices).toBeUndefined();
		expect(
			applyAiPrompt(
				{ ...base, kind: 'sentence' },
				{
					type: 'cloze',
					prompt: 'They ___ it.',
					answer: 'adopt'
				}
			)
		).toBeNull();
	});
});

describe('stats guards', () => {
	it('does not inflate daily accuracy on repeat taps', () => {
		const key = wordKey(SOURCE, id(1));
		const first = applyReview(emptyState(NOW), 'correct', NOW);
		let days = recordDaily([], NOW, key, 'correct', first.counted);
		const repeat = applyReview(first.state, 'correct', NOW);
		days = recordDaily(days, NOW, key, 'correct', repeat.counted);
		expect(days[0].reviewed).toBe(1);
		expect(days[0].keys).toEqual([key]);
	});

	it('drops deleted items and ignores empty sentence results', () => {
		const live = wordKey(SOURCE, id(1));
		const gone = wordKey(SOURCE, id(2));
		expect(pruneItems({ [live]: emptyState(NOW), [gone]: emptyState(NOW) }, [live])).toEqual({
			[live]: emptyState(NOW)
		});
		expect(gradeFromSentenceResults([])).toBeNull();
		expect(gradeFromSentenceResults([{ status: 'correct' }, { status: 'partial' }])).toBe(
			'partial'
		);
	});

	it('replays history in timestamp order', () => {
		const state = replayReviews(emptyState(later(-72)), [
			{ grade: 'wrong', at: later(-24) },
			{ grade: 'correct', at: later(-48) }
		]);
		expect(state.reps).toBe(2);
		expect(state.lastGrade).toBe('wrong');
	});

	it('completes a session without double-counting duplicate keys', () => {
		const key = wordKey(SOURCE, id(1));
		const states = applySessionReviews(
			{},
			[
				{ key, result: 'wrong' },
				{ key, result: 'correct' }
			],
			NOW,
			{ schedule: false }
		);
		expect(states[key].lastGrade).toBe('correct');
		expect(states[key].reps).toBe(1);
	});

	it('exposes Korean reasons without raw scores', () => {
		expect(formatReason({ code: 'overdue', detail: '2' })).toBe('복습 예정일이 2일 지남');
		expect(formatReason({ code: 'confusion', detail: 'affect' })).toContain('affect');
	});

	it('summarizes a dashboard from aggregated state', () => {
		const items = [
			candidate(1, reviewed('wrong', { mastery: 0.1, lapseCount: 4, dueAt: later(-24) }), 'adopt'),
			candidate(2, emptyState(NOW), 'apple')
		];
		const dashboard = summarizeDashboard(
			items,
			[{ date: '2026-09-10', reviewed: 2, scoreSum: 1, keys: [items[0].key] }],
			[],
			NOW,
			1
		);
		expect(dashboard.overdue).toBe(1);
		expect(dashboard.studiedToday).toBe(1);
		expect(dashboard.hardest?.label).toBe('adopt');
		expect(dashboard.mostMissed?.label).toBe('adopt');
		expect(dashboard.accuracy).toBe(0.5);
	});

	it('counts overdue and due-today per source from candidates', () => {
		const items = [
			candidate(1, reviewed('wrong', { dueAt: later(-48) })),
			candidate(2, reviewed('correct', { dueAt: NOW, lastReviewedAt: later(-20) }))
		];
		const stats = sourceStatsFor(items, NOW);
		expect(stats).toEqual([
			expect.objectContaining({
				sourceId: SOURCE,
				kind: 'word',
				overdue: 1,
				dueToday: 1,
				recommended: buildQueue(items, NOW).length
			})
		]);
	});

	it('parses adaptive documents that omit settings', () => {
		expect(AdaptiveDocumentSchema.parse(emptyAdaptiveDocument()).settings).toBeUndefined();
		expect(
			AdaptiveDocumentSchema.parse({
				...emptyAdaptiveDocument(),
				settings: { aiQuestionLimit: 3 }
			}).settings
		).toEqual({ aiQuestionLimit: 3 });
	});
});
