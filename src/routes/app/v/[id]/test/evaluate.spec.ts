import { createTestSession, type Word } from '$lib/domain';
import { createVocabulary, getVocabulary, updateVocabulary } from '$lib/server/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { actions } from './[testId]/+page.server';

const userId = 'u_0123456789abcdef0123456789abcdef';
let directory: string;

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'vocanb-route-'));
	process.env.DATA_DIR = directory;
});

afterEach(async () => rm(directory, { recursive: true, force: true }));

describe('test evaluation action', () => {
	it('updates only the posted test item in real storage', async () => {
		const vocabulary = await createVocabulary(userId, '평가 테스트', '');
		const now = new Date().toISOString();
		const words: Word[] = [1, 2].map((number) => ({
			id: crypto.randomUUID(),
			number,
			english: `word-${number}`,
			meaning: `뜻-${number}`,
			sourceImageId: null,
			uncertain: false,
			createdAt: now,
			updatedAt: now
		}));
		const session = createTestSession(
			words,
			{ start: 1, end: 2 },
			'sequential',
			'english-to-korean'
		);
		await updateVocabulary(userId, vocabulary.id, (current) => ({
			...current,
			words,
			tests: [session]
		}));

		const form = new FormData();
		form.set('wordId', words[1].id);
		form.set('result', 'ambiguous');
		const response = await actions.evaluate!({
			request: new Request('http://localhost', { method: 'POST', body: form }),
			locals: { userId },
			params: { id: vocabulary.id, testId: session.id }
		} as never);

		expect(response).toMatchObject({ success: true });
		const reloaded = await getVocabulary(userId, vocabulary.id);
		expect(reloaded?.tests[0].items).toEqual([
			session.items[0],
			{ ...session.items[1], result: 'ambiguous' }
		]);
	});
});
