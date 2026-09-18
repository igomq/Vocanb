import {
	AdaptiveDocumentSchema,
	AdaptiveSessionItemSchema,
	AdaptiveSessionSchema,
	applyReview,
	applySessionReviews,
	buildCramQueue,
	buildQueue,
	confusionFromSession,
	emptyAdaptiveDocument,
	emptyState,
	gradeFromSentenceResults,
	gradeFromVocabResult,
	mergeConfusion,
	pruneItems,
	recordDaily,
	sentenceKey,
	sourceStatsFor,
	summarizeDashboard,
	wordKey,
	sameCanonical,
	type AdaptiveDocument,
	type AdaptiveSession,
	type DashboardData,
	type LearningCandidate,
	type QueueItem,
	type SourceStat,
	type ReviewGrade
} from '$lib/learning';
import type { TestSession, Vocabulary } from '$lib/domain';
import type { SentenceBook, SentencePassage } from '$lib/sentence-domain';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listSentenceBooks } from './sentence-storage';
import { atomicWrite, listVocabularies, userRoot, withLock } from './storage';

function adaptivePath(userId: string) {
	return join(userRoot(userId), 'adaptive.json');
}

export async function readAdaptiveDocument(userId: string) {
	try {
		return AdaptiveDocumentSchema.parse(JSON.parse(await readFile(adaptivePath(userId), 'utf8')));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyAdaptiveDocument();
		throw new Error('학습 상태 파일을 읽을 수 없습니다.', { cause: error });
	}
}

async function writeAdaptiveDocument(userId: string, document: AdaptiveDocument) {
	const parsed = AdaptiveDocumentSchema.parse(document);
	await atomicWrite(adaptivePath(userId), parsed);
	return parsed;
}

function passageTargetCount(passage: SentencePassage) {
	return passage.paragraphs.reduce(
		(total, paragraph) => total + paragraph.runs.filter((run) => run.memorize).length,
		0
	);
}

function passageSignature(passage: SentencePassage) {
	const grade = gradeFromSentenceResults(Object.values(passage.testResults));
	if (!grade) return null;
	if (Object.keys(passage.testResults).length < passageTargetCount(passage)) return null;
	return `${passage.testResultsRevision}:${grade}`;
}

function passagePrompt(passage: SentencePassage) {
	return (
		passage.paragraphs
			.flatMap((paragraph) => paragraph.runs)
			.find((run) => run.memorize)
			?.text.trim() || passage.label
	);
}

export function candidatesFor(
	document: AdaptiveDocument,
	vocabularies: Vocabulary[],
	books: SentenceBook[],
	now: string
): LearningCandidate[] {
	const candidates: LearningCandidate[] = [];
	for (const vocabulary of vocabularies) {
		for (const word of vocabulary.words) {
			const key = wordKey(vocabulary.id, word.id);
			candidates.push({
				key,
				kind: 'word',
				sourceId: vocabulary.id,
				sourceTitle: vocabulary.title,
				itemId: word.id,
				number: word.number,
				english: word.english,
				meaning: word.meaning,
				partOfSpeech: word.partOfSpeech,
				state: document.items[key] ?? emptyState(word.createdAt || now)
			});
		}
	}
	for (const book of books) {
		for (const passage of book.passages) {
			const key = sentenceKey(book.id, passage.id);
			candidates.push({
				key,
				kind: 'sentence',
				sourceId: book.id,
				sourceTitle: book.title,
				itemId: passage.id,
				number: passage.order + 1,
				english: passage.label,
				meaning: passagePrompt(passage).slice(0, 1000) || passage.label,
				href: `/app/s/${book.id}?passage=${passage.id}`,
				state: document.items[key] ?? emptyState(book.createdAt || now)
			});
		}
	}
	return candidates;
}

function applyVocabTest(document: AdaptiveDocument, vocabulary: Vocabulary, test: TestSession) {
	if (!test.completedAt || document.appliedSessionIds.includes(test.id)) return false;
	const live = new Set(vocabulary.words.map((word) => word.id));
	const now = test.completedAt;
	const reviewed = test.items.flatMap((item) => {
		if (!item.result || !live.has(item.wordId)) return [];
		const key = wordKey(vocabulary.id, item.wordId);
		const grade = gradeFromVocabResult(item.result);
		const current = document.items[key] ?? emptyState(now);
		const next = applyReview(current, grade, now);
		document.items[key] = next.state;
		document.days = recordDaily(document.days, now, key, grade, next.counted);
		return [
			{
				itemId: item.wordId,
				english: item.english,
				meaning: item.meaning,
				result: grade
			}
		];
	});
	document.confusion = mergeConfusion(
		document.confusion,
		confusionFromSession(reviewed, vocabulary.id, now)
	);
	document.appliedSessionIds.push(test.id);
	return true;
}

function applySentencePassage(
	document: AdaptiveDocument,
	book: SentenceBook,
	passage: SentencePassage
) {
	const key = sentenceKey(book.id, passage.id);
	const signature = passageSignature(passage);
	if (!signature || document.appliedSignatures[key] === signature) return false;
	const grade = gradeFromSentenceResults(Object.values(passage.testResults));
	if (!grade) return false;
	const now = book.updatedAt;
	const current = document.items[key] ?? emptyState(now);
	const next = applyReview(current, grade, now);
	document.items[key] = next.state;
	document.days = recordDaily(document.days, now, key, grade, next.counted);
	document.appliedSignatures[key] = signature;
	return true;
}

export async function syncLearning(userId: string, now = new Date().toISOString()) {
	return withLock(adaptivePath(userId), async () => {
		const document = await readAdaptiveDocument(userId);
		const [vocabularies, books] = await Promise.all([
			listVocabularies(userId),
			listSentenceBooks(userId)
		]);
		let changed = false;
		const liveKeys: string[] = [];
		for (const vocabulary of vocabularies) {
			for (const word of vocabulary.words) {
				const key = wordKey(vocabulary.id, word.id);
				liveKeys.push(key);
				if (!document.items[key]) {
					document.items[key] = emptyState(word.createdAt || now);
					changed = true;
				}
			}
			const tests = [...vocabulary.tests].sort(
				(left, right) =>
					(left.completedAt || left.startedAt).localeCompare(
						right.completedAt || right.startedAt
					) || left.id.localeCompare(right.id)
			);
			for (const test of tests) if (applyVocabTest(document, vocabulary, test)) changed = true;
		}
		for (const book of books) {
			for (const passage of book.passages) {
				const key = sentenceKey(book.id, passage.id);
				liveKeys.push(key);
				if (!document.items[key]) {
					document.items[key] = emptyState(book.createdAt || now);
					changed = true;
				}
				if (applySentencePassage(document, book, passage)) changed = true;
			}
		}
		const pruned = pruneItems(document.items, liveKeys);
		if (Object.keys(pruned).length !== Object.keys(document.items).length) {
			document.items = pruned;
			changed = true;
		}
		const liveItemIds = new Set(liveKeys.map((key) => key.split(':')[2]).filter(Boolean));
		const confusion = document.confusion.filter(
			(pair) => liveItemIds.has(pair.leftId) && liveItemIds.has(pair.rightId)
		);
		if (confusion.length !== document.confusion.length) {
			document.confusion = confusion;
			changed = true;
		}
		const liveSessionIds = new Set([
			...vocabularies.flatMap((vocabulary) => vocabulary.tests.map((test) => test.id)),
			...document.sessions.map((session) => session.id)
		]);
		const applied = document.appliedSessionIds.filter((id) => liveSessionIds.has(id));
		if (applied.length !== document.appliedSessionIds.length) {
			document.appliedSessionIds = applied;
			changed = true;
		}
		if (changed) await writeAdaptiveDocument(userId, document);
		return { document, vocabularies, books, now };
	});
}

export type LearningSnapshot = {
	dashboard: DashboardData;
	sentenceDue: {
		count: number;
		items: { title: string; label: string; bookId: string; passageId: string }[];
	};
	session: AdaptiveSession | null;
	sourceId: string | null;
	sourceStats: SourceStat[];
};

export async function getLearningSnapshot(
	userId: string,
	sourceId?: string | null
): Promise<LearningSnapshot> {
	const { document, vocabularies, books, now } = await syncLearning(userId);
	const all = candidatesFor(document, vocabularies, books, now);
	const selected = all.filter((item) => !sourceId || item.sourceId === sourceId);
	const queue = buildQueue(selected, now, { pairs: document.confusion });
	const sentences = all.filter((item) => item.kind === 'sentence');
	const sentenceQueue = buildQueue(sentences, now, { pairs: [], limit: 3, pool: sentences });
	return {
		dashboard: summarizeDashboard(all, document.days, document.confusion, now, queue.length),
		sentenceDue: {
			count: sentenceQueue.length,
			items: sentenceQueue.map((item) => ({
				title: item.sourceTitle,
				label: item.english,
				bookId: item.sourceId,
				passageId: item.itemId
			}))
		},
		session:
			document.sessions.find(
				(session) => !session.completedAt && (session.sourceId ?? null) === (sourceId ?? null)
			) ?? null,
		sourceId: sourceId ?? null,
		sourceStats: sourceStatsFor(all, now)
	};
}

function toSessionItem(item: QueueItem) {
	return AdaptiveSessionItemSchema.parse({
		key: item.key,
		kind: item.kind,
		sourceId: item.sourceId,
		itemId: item.itemId,
		...(item.number ? { number: item.number } : {}),
		sourceTitle: item.sourceTitle,
		english: item.english,
		meaning: item.meaning,
		...(item.partOfSpeech ? { partOfSpeech: item.partOfSpeech } : {}),
		...(item.href ? { href: item.href } : {}),
		promptKind: item.promptKind,
		prompt: item.prompt,
		answer: item.answer,
		...(item.choices ? { choices: item.choices } : {}),
		reasons: item.reasons
	});
}

export async function createLearningSession(
	userId: string,
	input: {
		mode: 'adaptive' | 'cram';
		sourceId?: string | null;
		minutes?: number;
		itemCount?: number;
		now?: string;
		enrich?: (items: QueueItem[]) => Promise<QueueItem[]>;
	}
) {
	const now = input.now ?? new Date().toISOString();
	const synced = await syncLearning(userId, now);
	const existing = synced.document.sessions.find(
		(session) =>
			!session.completedAt &&
			session.mode === input.mode &&
			(session.sourceId ?? null) === (input.sourceId ?? null)
	);
	if (existing) return existing;
	const selected = candidatesFor(synced.document, synced.vocabularies, synced.books, now).filter(
		(item) => !input.sourceId || item.sourceId === input.sourceId
	);
	if (!selected.length) throw new Error('추천할 단어가 없습니다.');
	const built =
		input.mode === 'cram'
			? buildCramQueue(selected, now, {
					minutes: input.minutes,
					itemCount: input.itemCount,
					pairs: synced.document.confusion
				})
			: buildQueue(selected, now, { pairs: synced.document.confusion });
	if (!built.length) throw new Error('지금은 추천할 항목이 없습니다.');
	const items = input.enrich ? await input.enrich(built) : built;
	return withLock(adaptivePath(userId), async () => {
		const document = await readAdaptiveDocument(userId);
		const current = document.sessions.find(
			(session) =>
				!session.completedAt &&
				session.mode === input.mode &&
				(session.sourceId ?? null) === (input.sourceId ?? null)
		);
		if (current) return current;
		const session = AdaptiveSessionSchema.parse({
			id: crypto.randomUUID(),
			mode: input.mode,
			startedAt: now,
			sourceId: input.sourceId ?? null,
			...(input.mode === 'cram'
				? { cram: { minutes: input.minutes, itemCount: input.itemCount } }
				: {}),
			items: items.map(toSessionItem)
		});
		document.sessions = [...document.sessions.filter((item) => item.completedAt), session].slice(
			-20
		);
		await writeAdaptiveDocument(userId, document);
		return session;
	});
}

export async function evaluateLearningItem(
	userId: string,
	input: {
		sessionId: string;
		index: number;
		result?: ReviewGrade;
		responseMs?: number;
		typedAnswer?: string;
	}
) {
	return withLock(adaptivePath(userId), async () => {
		const document = await readAdaptiveDocument(userId);
		const session = document.sessions.find(
			(item) => item.id === input.sessionId && !item.completedAt
		);
		const item = session?.items[input.index];
		if (!session || !item) throw new Error('학습 항목을 찾을 수 없습니다.');
		if (input.result === 'unknown' || input.result === 'ambiguous') {
			item.result = input.result;
		} else if (input.result) {
			item.result = input.result;
		} else if (input.typedAnswer) {
			item.result = sameCanonical(input.typedAnswer, item.answer) ? 'correct' : 'wrong';
		} else throw new Error('평가를 선택해 주세요.');
		if (input.responseMs != null) item.responseMs = Math.min(3_600_000, input.responseMs);
		if (input.typedAnswer) item.typedAnswer = input.typedAnswer.slice(0, 300);
		else delete item.typedAnswer;
		await writeAdaptiveDocument(userId, document);
		return session;
	});
}

export async function completeLearningSession(
	userId: string,
	sessionId: string,
	now = new Date().toISOString()
) {
	return withLock(adaptivePath(userId), async () => {
		const document = await readAdaptiveDocument(userId);
		const session = document.sessions.find((item) => item.id === sessionId && !item.completedAt);
		if (!session) throw new Error('진행 중인 학습이 없습니다.');
		const lastByKey = new Map<string, (typeof session.items)[number]>();
		for (const item of session.items) {
			if (item.result) lastByKey.set(item.key, item);
		}
		const uniqueKeys = new Set(session.items.map((item) => item.key));
		if ([...uniqueKeys].some((key) => !lastByKey.get(key)?.result))
			throw new Error('모든 항목을 평가해 주세요.');
		const reviews = [...lastByKey.values()].map((item) => ({
			key: item.key,
			result: item.result,
			responseMs: item.responseMs
		}));
		const before = { ...document.items };
		document.items = applySessionReviews(document.items, reviews, now, {
			schedule: session.mode !== 'cram'
		});
		for (const item of lastByKey.values()) {
			document.days = recordDaily(
				document.days,
				now,
				item.key,
				item.result!,
				document.items[item.key]?.lastCountedAt === now && before[item.key]?.lastCountedAt !== now
			);
		}
		const bySource = new Map<string, typeof session.items>();
		for (const item of lastByKey.values()) {
			const list = bySource.get(item.sourceId) ?? [];
			list.push(item);
			bySource.set(item.sourceId, list);
		}
		for (const [sourceId, items] of bySource) {
			document.confusion = mergeConfusion(
				document.confusion,
				confusionFromSession(items, sourceId, now)
			);
		}
		session.completedAt = now;
		if (!document.appliedSessionIds.includes(session.id))
			document.appliedSessionIds.push(session.id);
		await writeAdaptiveDocument(userId, document);
		return session;
	});
}

export async function discardLearningSession(userId: string, sessionId: string) {
	return withLock(adaptivePath(userId), async () => {
		const document = await readAdaptiveDocument(userId);
		const next = document.sessions.filter(
			(session) => session.id !== sessionId || session.completedAt
		);
		if (next.length === document.sessions.length) return false;
		document.sessions = next;
		await writeAdaptiveDocument(userId, document);
		return true;
	});
}
