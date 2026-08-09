import { UserIndexSchema, VocabularySchema, type Vocabulary } from '$lib/domain';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getDataDir } from './config';

const SAFE_ID = /^(?:u_[0-9a-f]{32}|[0-9a-f-]{36})$/;
// ponytail: in-process locks assume one Node instance; use a shared store before horizontal scaling.
const locks = new Map<string, Promise<void>>();

function safeId(value: string) {
	if (!SAFE_ID.test(value)) throw new Error('잘못된 식별자입니다.');
	return value;
}

function userRoot(userId: string) {
	return join(getDataDir(), 'users', safeId(userId));
}

function indexPath(userId: string) {
	return join(userRoot(userId), 'index.json');
}

function vocabularyPath(userId: string, vocabularyId: string) {
	return join(userRoot(userId), 'vocabularies', `${safeId(vocabularyId)}.json`);
}

export function uploadDirectory(userId: string, vocabularyId: string) {
	return join(userRoot(userId), 'uploads', safeId(vocabularyId));
}

export function imagePath(userId: string, vocabularyId: string, filename: string) {
	if (!/^[0-9a-f-]{36}\.jpg$/.test(filename)) throw new Error('잘못된 이미지 이름입니다.');
	return join(uploadDirectory(userId, vocabularyId), filename);
}

async function withLock<T>(key: string, operation: () => Promise<T>) {
	const previous = locks.get(key) || Promise.resolve();
	let release!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	const chain = previous.then(() => gate);
	locks.set(key, chain);
	await previous;
	try {
		return await operation();
	} finally {
		release();
		if (locks.get(key) === chain) locks.delete(key);
	}
}

async function atomicWrite(path: string, value: unknown) {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${crypto.randomUUID()}.tmp`;
	const handle = await open(temporary, 'wx', 0o600);
	try {
		await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
		await handle.sync();
	} finally {
		await handle.close();
	}
	try {
		await rename(temporary, path);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
}

async function readIndex(userId: string) {
	try {
		return UserIndexSchema.parse(JSON.parse(await readFile(indexPath(userId), 'utf8')));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT')
			return { schemaVersion: 1 as const, vocabularyIds: [] };
		throw new Error('단어장 색인 파일을 읽을 수 없습니다.', { cause: error });
	}
}

export async function getVocabulary(userId: string, vocabularyId: string) {
	try {
		return VocabularySchema.parse(
			JSON.parse(await readFile(vocabularyPath(userId, vocabularyId), 'utf8'))
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw new Error('단어장 파일을 읽을 수 없습니다.', { cause: error });
	}
}

export async function listVocabularies(userId: string) {
	const index = await readIndex(userId);
	const vocabularies = await Promise.all(
		index.vocabularyIds.map((id) => getVocabulary(userId, id))
	);
	return vocabularies
		.filter((vocabulary): vocabulary is Vocabulary => vocabulary !== null)
		.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function createVocabulary(userId: string, title: string, rangeLabel: string) {
	return withLock(userRoot(userId), async () => {
		const now = new Date().toISOString();
		const vocabulary: Vocabulary = {
			schemaVersion: 1,
			id: crypto.randomUUID(),
			title: title.trim(),
			rangeLabel: rangeLabel.trim(),
			createdAt: now,
			updatedAt: now,
			images: [],
			words: [],
			tests: []
		};
		VocabularySchema.parse(vocabulary);
		const index = await readIndex(userId);
		await atomicWrite(vocabularyPath(userId, vocabulary.id), vocabulary);
		await atomicWrite(indexPath(userId), {
			...index,
			vocabularyIds: [vocabulary.id, ...index.vocabularyIds]
		});
		return vocabulary;
	});
}

export async function deleteVocabulary(userId: string, vocabularyId: string) {
	const path = vocabularyPath(userId, vocabularyId);
	return withLock(path, () =>
		withLock(userRoot(userId), async () => {
			const index = await readIndex(userId);
			if (!index.vocabularyIds.includes(vocabularyId))
				throw new Error('단어장을 찾을 수 없습니다.');
			await atomicWrite(indexPath(userId), {
				...index,
				vocabularyIds: index.vocabularyIds.filter((id) => id !== vocabularyId)
			});
			const cleanup = await Promise.allSettled([
				rm(path, { force: true }),
				rm(uploadDirectory(userId, vocabularyId), { recursive: true, force: true })
			]);
			for (const result of cleanup) {
				if (result.status === 'rejected')
					console.error('Vocabulary cleanup failed:', result.reason);
			}
		})
	);
}

export async function updateVocabulary(
	userId: string,
	vocabularyId: string,
	update: (current: Vocabulary) => Vocabulary | Promise<Vocabulary>
) {
	const path = vocabularyPath(userId, vocabularyId);
	return withLock(path, async () => {
		const current = await getVocabulary(userId, vocabularyId);
		if (!current) throw new Error('단어장을 찾을 수 없습니다.');
		const next = VocabularySchema.parse({
			...(await update(structuredClone(current))),
			id: current.id,
			createdAt: current.createdAt,
			updatedAt: new Date().toISOString()
		});
		await atomicWrite(path, next);
		return next;
	});
}

export async function getSuggestions(userId: string) {
	const vocabularies = await listVocabularies(userId);
	return {
		titles: [...new Set(vocabularies.map(({ title }) => title))],
		ranges: [...new Set(vocabularies.map(({ rangeLabel }) => rangeLabel).filter(Boolean))]
	};
}
