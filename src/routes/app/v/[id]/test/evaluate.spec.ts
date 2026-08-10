import { createTestSession, parseContinuousLearningSettings, type Word } from '$lib/domain';
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

	it('redirects to the next batch automatically', async () => {
		const vocabulary = await createVocabulary(userId, '연속 묶음 전환', '');
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
		const settings = parseContinuousLearningSettings(1, 2, 'list');
		const session = createTestSession(
			[words[0]],
			{ start: 1, end: 1 },
			'sequential',
			'english-to-korean',
			Math.random,
			{ ...settings, phase: 'batch', dayStart: 1, dayEnd: 2 }
		);
		session.items[0].result = 'correct';
		await updateVocabulary(userId, vocabulary.id, (current) => ({
			...current,
			words,
			tests: [session]
		}));

		await expect(
			actions.complete!({
				locals: { userId },
				params: { id: vocabulary.id, testId: session.id }
			} as never)
		).rejects.toMatchObject({ status: 303, location: `/app/v/${vocabulary.id}?continuous=1` });
		expect((await getVocabulary(userId, vocabulary.id))?.tests).toHaveLength(1);
	});

	it('creates the next cumulative test atomically with the prior direction and order', async () => {
		const vocabulary = await createVocabulary(userId, '연속 누적 전환', '');
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
		const settings = parseContinuousLearningSettings(2, 2, 'list');
		const session = createTestSession(
			words,
			{ start: 1, end: 2 },
			'random',
			'korean-to-english',
			() => 0,
			{ ...settings, phase: 'batch', dayStart: 1, dayEnd: 2 }
		);
		for (const item of session.items) item.result = 'correct';
		await updateVocabulary(userId, vocabulary.id, (current) => ({
			...current,
			words,
			tests: [session]
		}));

		let destination: unknown;
		try {
			await actions.complete!({
				locals: { userId },
				params: { id: vocabulary.id, testId: session.id }
			} as never);
		} catch (error) {
			destination = error;
		}
		expect(destination).toMatchObject({ status: 303 });
		const saved = await getVocabulary(userId, vocabulary.id);
		const cumulative = saved!.tests[1];
		expect(destination).toMatchObject({
			location: `/app/v/${vocabulary.id}/test/${cumulative.id}`
		});
		expect(cumulative).toMatchObject({
			order: 'random',
			direction: 'korean-to-english',
			continuous: { phase: 'cumulative', studyMode: 'list' }
		});
	});
});
