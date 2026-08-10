import { generateKoreanPronunciationGuides, lookupPronunciation } from '$lib/server/pronunciation';
import { createVocabulary, getVocabulary, updateVocabulary } from '$lib/server/storage';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';

vi.mock('$lib/server/pronunciation', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/pronunciation')>()),
	lookupPronunciation: vi.fn(),
	generateKoreanPronunciationGuides: vi.fn()
}));

const userId = 'u_0123456789abcdef0123456789abcdef';
let directory: string;

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'vocanb-pronunciation-'));
	process.env.DATA_DIR = directory;
});

afterEach(async () => {
	vi.clearAllMocks();
	await rm(directory, { recursive: true, force: true });
});

describe('pronunciation endpoint', () => {
	it('deduplicates new dictionary lookups and reuses stored IPA', async () => {
		const vocabulary = await createVocabulary(userId, '발음', '');
		const now = new Date().toISOString();
		await updateVocabulary(userId, vocabulary.id, (current) => {
			current.words = [
				{ id: crypto.randomUUID(), english: 'Apple', pronunciation: undefined },
				{ id: crypto.randomUUID(), english: ' apple ', pronunciation: undefined },
				{
					id: crypto.randomUUID(),
					english: 'orange',
					pronunciation: { ipa: '[ˈɔrɪndʒ]', guide: '오린지' }
				}
			].map((word, index) => ({
				...word,
				number: index + 1,
				meaning: '뜻',
				sourceImageId: null,
				uncertain: false,
				createdAt: now,
				updatedAt: now
			}));
			return current;
		});
		const words = (await getVocabulary(userId, vocabulary.id))!.words;
		vi.mocked(lookupPronunciation).mockResolvedValue({ ipa: '[ˈæpəl]', guide: '애플' });
		vi.mocked(generateKoreanPronunciationGuides).mockImplementation(
			async (inputs) => new Map(inputs.map(({ id }) => [id, '테스트']))
		);

		const response = await POST({
			request: new Request('http://localhost', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ wordIds: words.map(({ id }) => id) })
			}),
			locals: { userId },
			params: { id: vocabulary.id }
		} as never);

		expect(response.status).toBe(200);
		expect(lookupPronunciation).toHaveBeenCalledTimes(1);
		expect(lookupPronunciation).toHaveBeenCalledWith('Apple');
		expect(generateKoreanPronunciationGuides).toHaveBeenCalledTimes(1);
		expect(
			(await getVocabulary(userId, vocabulary.id))?.words.map(
				({ pronunciation }) => pronunciation?.guideVersion
			)
		).toEqual([2, 2, 2]);
	});
});
