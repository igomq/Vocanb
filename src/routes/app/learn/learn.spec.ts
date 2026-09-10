import { createTestSession, type Word } from '$lib/domain';
import { createVocabulary, updateVocabulary } from '$lib/server/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { actions, load } from './+page.server';
import { readAdaptiveDocument } from '$lib/server/learning-storage';

const userId = 'u_0123456789abcdef0123456789abcdef';
let directory: string;

async function seed() {
	const vocabulary = await createVocabulary(userId, '추천 학습', '');
	const now = new Date().toISOString();
	const words: Word[] = [
		{
			id: crypto.randomUUID(),
			number: 1,
			english: 'apple',
			meaning: '사과',
			sourceImageId: null,
			uncertain: false,
			starred: false,
			createdAt: now,
			updatedAt: now
		},
		{
			id: crypto.randomUUID(),
			number: 2,
			english: 'run',
			meaning: '달리다',
			sourceImageId: null,
			uncertain: false,
			starred: false,
			createdAt: now,
			updatedAt: now
		}
	];
	const done = createTestSession(words, { start: 1, end: 2 }, 'sequential', 'english-to-korean');
	done.items[0].result = 'correct';
	done.items[1].result = 'wrong';
	done.completedAt = now;
	await updateVocabulary(userId, vocabulary.id, (current) => ({
		...current,
		words,
		tests: [done]
	}));
	return vocabulary;
}

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'vocanb-learn-route-'));
	process.env.DATA_DIR = directory;
});

afterEach(async () => rm(directory, { recursive: true, force: true }));

describe('adaptive learn route', () => {
	it('starts a session, stores evaluations, and completes without dropping vocab tests', async () => {
		const vocabulary = await seed();
		const start = new FormData();
		await expect(
			actions.start!({
				request: new Request('http://localhost', { method: 'POST', body: start }),
				locals: { userId }
			} as never)
		).rejects.toMatchObject({ status: 303, location: '/app/learn' });

		const page = (await load!({
			locals: { userId },
			url: new URL('http://localhost/app/learn')
		} as never))!;
		expect(page.session?.items.length).toBeGreaterThan(0);

		for (const [index] of page.session!.items.entries()) {
			const form = new FormData();
			form.set('index', String(index));
			form.set('result', 'correct');
			expect(
				await actions.evaluate!({
					request: new Request('http://localhost', { method: 'POST', body: form }),
					locals: { userId }
				} as never)
			).toMatchObject({ success: true });
		}

		await expect(actions.complete!({ locals: { userId } } as never)).rejects.toMatchObject({
			status: 303,
			location: '/app?learned=1'
		});

		const saved = await readAdaptiveDocument(userId);
		expect(saved.sessions.at(-1)?.completedAt).toBeTruthy();
		expect(saved.appliedSessionIds).toContain(page.session!.id);
		const { getVocabulary } = await import('$lib/server/storage');
		expect((await getVocabulary(userId, vocabulary.id))?.tests).toHaveLength(1);
	});

	it('does not apply a discarded session', async () => {
		await seed();
		const start = new FormData();
		await expect(
			actions.start!({
				request: new Request('http://localhost', { method: 'POST', body: start }),
				locals: { userId }
			} as never)
		).rejects.toMatchObject({ status: 303 });
		await expect(actions.discard!({ locals: { userId } } as never)).rejects.toMatchObject({
			status: 303,
			location: '/app'
		});
		expect(
			(await readAdaptiveDocument(userId)).sessions.some((session) => !session.completedAt)
		).toBe(false);
	});
});
