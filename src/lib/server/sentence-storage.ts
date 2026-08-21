import {
	SentenceBookSchema,
	SentencePassageSchema,
	SentenceUserIndexSchema,
	type NormalizedSentencePassage,
	type SentenceBook
} from '$lib/sentence-domain';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite, safeId, userRoot, withLock } from './storage';

function sentenceIndexPath(userId: string) {
	return join(userRoot(userId), 'sentence-index.json');
}

function sentenceBookPath(userId: string, sentenceBookId: string) {
	return join(userRoot(userId), 'sentence-books', safeId(sentenceBookId) + '.json');
}

async function readSentenceIndex(userId: string) {
	try {
		return SentenceUserIndexSchema.parse(
			JSON.parse(await readFile(sentenceIndexPath(userId), 'utf8'))
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT')
			return { schemaVersion: 1 as const, sentenceBookIds: [] };
		throw new Error('문장 암기 색인 파일을 읽을 수 없습니다.', { cause: error });
	}
}

export async function getSentenceBook(userId: string, sentenceBookId: string) {
	try {
		return SentenceBookSchema.parse(
			JSON.parse(await readFile(sentenceBookPath(userId, sentenceBookId), 'utf8'))
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw new Error('문장 암기장 파일을 읽을 수 없습니다.', { cause: error });
	}
}

export async function listSentenceBooks(userId: string) {
	const index = await readSentenceIndex(userId);
	const books = await Promise.all(index.sentenceBookIds.map((id) => getSentenceBook(userId, id)));
	return books
		.filter((book): book is SentenceBook => book !== null)
		.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function createSentenceBook(
	userId: string,
	input: {
		title: string;
		sourceFileName: string;
		passages: NormalizedSentencePassage[];
	}
) {
	return withLock(userRoot(userId), async () => {
		const now = new Date().toISOString();
		const book: SentenceBook = {
			schemaVersion: 1,
			id: crypto.randomUUID(),
			title: input.title.trim(),
			sourceFileName: input.sourceFileName.trim(),
			createdAt: now,
			updatedAt: now,
			passages: input.passages.map((passage, order) =>
				SentencePassageSchema.parse({
					...passage,
					id: crypto.randomUUID(),
					order,
					summary: null,
					translation: null
				})
			)
		};
		SentenceBookSchema.parse(book);
		const index = await readSentenceIndex(userId);
		await atomicWrite(sentenceBookPath(userId, book.id), book);
		await atomicWrite(sentenceIndexPath(userId), {
			...index,
			sentenceBookIds: [book.id, ...index.sentenceBookIds]
		});
		return book;
	});
}

export async function updateSentenceBook(
	userId: string,
	sentenceBookId: string,
	update: (current: SentenceBook) => SentenceBook | Promise<SentenceBook>
) {
	const path = sentenceBookPath(userId, sentenceBookId);
	return withLock(path, async () => {
		const current = await getSentenceBook(userId, sentenceBookId);
		if (!current) throw new Error('문장 암기장을 찾을 수 없습니다.');
		const updated = await update(structuredClone(current));
		const next = SentenceBookSchema.parse({
			...updated,
			id: current.id,
			createdAt: current.createdAt,
			updatedAt: new Date().toISOString()
		});
		await atomicWrite(path, next);
		return next;
	});
}

export async function deleteSentenceBook(userId: string, sentenceBookId: string) {
	const path = sentenceBookPath(userId, sentenceBookId);
	return withLock(path, () =>
		withLock(userRoot(userId), async () => {
			const index = await readSentenceIndex(userId);
			if (!index.sentenceBookIds.includes(sentenceBookId))
				throw new Error('문장 암기장을 찾을 수 없습니다.');
			await atomicWrite(sentenceIndexPath(userId), {
				...index,
				sentenceBookIds: index.sentenceBookIds.filter((id) => id !== sentenceBookId)
			});
			const { rm } = await import('node:fs/promises');
			try {
				await rm(path, { force: true });
			} catch (error) {
				console.error('Sentence book cleanup failed:', error);
			}
		})
	);
}
