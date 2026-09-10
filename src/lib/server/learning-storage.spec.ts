import { createTestSession, type Word } from '$lib/domain';
import { emptyState, wordKey } from '$lib/learning';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	completeLearningSession,
	createLearningSession,
	discardLearningSession,
	evaluateLearningItem,
	getLearningSnapshot,
	readAdaptiveDocument,
	syncLearning
} from './learning-storage';
import { createSentenceBook } from './sentence-storage';
import { createVocabulary, getVocabulary, MAX_TEST_HISTORY, updateVocabulary } from './storage';

const userId = 'u_0123456789abcdef0123456789abcdef';
let directory: string;

async function addWord(vocabularyId: string, english: string, meaning: string) {
	const now = new Date().toISOString();
	let word!: Word;
	await updateVocabulary(userId, vocabularyId, (current) => {
		word = {
			id: crypto.randomUUID(),
			number: current.words.length + 1,
			english,
			meaning,
			sourceImageId: null,
			uncertain: false,
			starred: false,
			createdAt: now,
			updatedAt: now
		};
		current.words.push(word);
		return current;
	});
	return word;
}

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'vocanb-learn-'));
	process.env.DATA_DIR = directory;
});

afterEach(async () => rm(directory, { recursive: true, force: true }));

describe('learning storage', () => {
	it('hydrates from completed tests and ignores incomplete ones', async () => {
		const vocabulary = await createVocabulary(userId, '기록', '');
		const apple = await addWord(vocabulary.id, 'apple', '사과');
		const run = await addWord(vocabulary.id, 'run', '달리다');
		const done = createTestSession(
			[apple, run],
			{ start: 1, end: 2 },
			'sequential',
			'english-to-korean'
		);
		done.items[0].result = 'correct';
		done.items[1].result = 'wrong';
		done.completedAt = '2026-09-01T00:00:00.000Z';
		const open = createTestSession(
			[apple],
			{ start: 1, end: 1 },
			'sequential',
			'english-to-korean'
		);
		open.items[0].result = 'correct';
		await updateVocabulary(userId, vocabulary.id, (current) => ({
			...current,
			tests: [done, open]
		}));

		await syncLearning(userId, '2026-09-10T00:00:00.000Z');
		const doc = await readAdaptiveDocument(userId);
		expect(doc.items[wordKey(vocabulary.id, apple.id)].lastGrade).toBe('correct');
		expect(doc.items[wordKey(vocabulary.id, run.id)].lastGrade).toBe('wrong');
		expect(doc.items[wordKey(vocabulary.id, apple.id)].reps).toBe(1);
		expect(doc.appliedSessionIds).toEqual([done.id]);
	});

	it('keeps adaptive state after test history truncation and word deletion', async () => {
		const vocabulary = await createVocabulary(userId, '상한', '');
		const word = await addWord(vocabulary.id, 'keep', '유지');
		const gone = await addWord(vocabulary.id, 'gone', '삭제');
		const session = createTestSession(
			[word],
			{ start: 1, end: 1 },
			'sequential',
			'english-to-korean'
		);
		session.items[0].result = 'wrong';
		session.completedAt = '2026-09-01T00:00:00.000Z';
		await updateVocabulary(userId, vocabulary.id, (current) => ({ ...current, tests: [session] }));
		await syncLearning(userId);
		const before = (await readAdaptiveDocument(userId)).items[wordKey(vocabulary.id, word.id)];
		expect(before.lapseCount).toBe(1);

		const extras = Array.from({ length: MAX_TEST_HISTORY }, () =>
			createTestSession([word], { start: 1, end: 1 }, 'sequential', 'english-to-korean')
		);
		await updateVocabulary(userId, vocabulary.id, (current) => ({
			...current,
			tests: [session, ...extras]
		}));
		const stored = await getVocabulary(userId, vocabulary.id);
		expect(stored?.tests).toHaveLength(MAX_TEST_HISTORY);
		expect(stored?.tests.some((test) => test.id === session.id)).toBe(false);

		await updateVocabulary(userId, vocabulary.id, (current) => ({
			...current,
			words: current.words.filter((item) => item.id !== gone.id)
		}));
		await syncLearning(userId);
		const doc = await readAdaptiveDocument(userId);
		expect(doc.items[wordKey(vocabulary.id, word.id)].lapseCount).toBe(1);
		expect(doc.items[wordKey(vocabulary.id, gone.id)]).toBeUndefined();
	});
	it('creates, evaluates, completes, and discards adaptive sessions without inflating repeats', async () => {
		const vocabulary = await createVocabulary(userId, '추천', '');
		await addWord(vocabulary.id, 'apple', '사과');
		await addWord(vocabulary.id, 'run', '달리다');
		const session = await createLearningSession(userId, { mode: 'adaptive' });
		expect(session.items.length).toBeGreaterThan(0);
		const again = await createLearningSession(userId, { mode: 'adaptive' });
		expect(again.id).toBe(session.id);

		await evaluateLearningItem(userId, { index: 0, result: 'correct', responseMs: 1200 });
		await expect(completeLearningSession(userId)).rejects.toThrow('모든 항목');

		for (const [index] of session.items.entries()) {
			await evaluateLearningItem(userId, { index, result: 'correct' });
		}
		const completed = await completeLearningSession(userId, '2026-09-10T00:00:00.000Z');
		expect(completed.completedAt).toBe('2026-09-10T00:00:00.000Z');
		const doc = await readAdaptiveDocument(userId);
		expect(doc.days[0]?.reviewed).toBe(new Set(session.items.map((item) => item.key)).size);

		const cram = await createLearningSession(userId, { mode: 'cram', itemCount: 2 });
		expect(cram.mode).toBe('cram');
		await discardLearningSession(userId);
		expect((await readAdaptiveDocument(userId)).sessions.some((item) => !item.completedAt)).toBe(
			false
		);
		const snapshot = await getLearningSnapshot(userId);
		expect(snapshot.dashboard.recommended).toBeGreaterThan(0);
	});

	it('starts with empty state for users who have no history', async () => {
		const snapshot = await getLearningSnapshot(userId);
		expect(snapshot.dashboard).toMatchObject({
			recommended: 0,
			overdue: 0,
			studiedToday: 0,
			accuracy: null
		});
		expect(emptyState('2026-09-10T00:00:00.000Z').reps).toBe(0);
	});

	it('mixes sentence passages into adaptive sessions and grades typed recall', async () => {
		const vocabulary = await createVocabulary(userId, '추천', '');
		await addWord(vocabulary.id, 'apple', '사과');
		await createSentenceBook(userId, {
			title: '문장',
			sourceFileName: 'a.pdf',
			passages: [
				{
					label: '1. 본문',
					sourcePageStart: 1,
					sourcePageEnd: 1,
					paragraphs: [{ runs: [{ text: 'the idea', memorize: true }] }]
				}
			]
		});
		const session = await createLearningSession(userId, { mode: 'adaptive' });
		const index = session.items.findIndex((item) => item.kind === 'sentence');
		expect(index).toBeGreaterThanOrEqual(0);
		expect(session.items[index].promptKind).toBe('recall');
		expect(session.items[index].answer).toBe('the idea');
		const correct = await evaluateLearningItem(userId, {
			index,
			typedAnswer: 'the idea'
		});
		expect(correct.items[index].result).toBe('correct');
		const wrong = await evaluateLearningItem(userId, { index, typedAnswer: 'nope' });
		expect(wrong.items[index].result).toBe('wrong');
	});

	it('loads old adaptive.json without settings and reports source due counts', async () => {
		const vocabulary = await createVocabulary(userId, '단어장', '');
		const apple = await addWord(vocabulary.id, 'apple', '사과');
		const done = createTestSession(
			[apple],
			{ start: 1, end: 1 },
			'sequential',
			'english-to-korean'
		);
		done.items[0].result = 'wrong';
		done.completedAt = '2026-09-01T00:00:00.000Z';
		await updateVocabulary(userId, vocabulary.id, (current) => ({ ...current, tests: [done] }));
		await writeFile(
			join(directory, 'users', userId, 'adaptive.json'),
			JSON.stringify({
				schemaVersion: 1,
				items: {},
				confusion: [],
				sessions: [],
				appliedSessionIds: [],
				appliedSignatures: {},
				days: []
			})
		);
		expect((await readAdaptiveDocument(userId)).settings).toBeUndefined();
		await createSentenceBook(userId, {
			title: '문장장',
			sourceFileName: 'a.pdf',
			passages: [
				{
					label: '1. 본문',
					sourcePageStart: 1,
					sourcePageEnd: 1,
					paragraphs: [{ runs: [{ text: 'the idea', memorize: true }] }]
				}
			]
		});
		const snapshot = await getLearningSnapshot(userId);
		expect(snapshot.sourceStats.find((item) => item.sourceId === vocabulary.id)).toMatchObject({
			kind: 'word',
			title: '단어장',
			overdue: 1,
			dueToday: 0
		});
		expect(snapshot.sourceStats.find((item) => item.kind === 'sentence')).toMatchObject({
			title: '문장장',
			overdue: 0,
			dueToday: 0
		});
	});
});
