import { afterEach, describe, expect, it, vi } from 'vitest';

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock('@google/genai', () => ({
	GoogleGenAI: class {
		models = { generateContent };
	},
	ThinkingLevel: { LOW: 'LOW' }
}));

import {
	applyPronunciationResults,
	generateKoreanPronunciationGuides,
	ipaToKorean,
	lookupPronunciation,
	parsePronunciationGuides,
	resolvePronunciationLookup,
	type PronunciationLookup
} from './pronunciation';

afterEach(() => vi.unstubAllGlobals());

describe('pronunciation lookup', () => {
	it('normalizes dictionary IPA and derives a compact Korean guide', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify([{ phonetics: [{ text: '/ˈæpəl/' }] }]), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				})
			)
		);

		expect(await lookupPronunciation('apple')).toEqual({ ipa: '[ˈæpəl]', guide: '애플' });
		expect(ipaToKorean('/ˈkæt/')).toBe('캣');
		expect(ipaToKorean('/ˈkɝːtiəs/')).toBe('커티어스');
	});

	it('treats a missing dictionary entry as a normal fallback', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
		expect(await lookupPronunciation('not-a-word')).toBeNull();
	});

	it('honors a dictionary rate limit before retrying', async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '0' } }))
			.mockResolvedValueOnce(
				new Response(JSON.stringify([{ phonetic: '/test/' }]), { status: 200 })
			);
		vi.stubGlobal('fetch', fetch);

		expect(await lookupPronunciation('retry-word')).toMatchObject({ ipa: '[test]' });
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('does not apply an in-flight result after the spelling changes', () => {
		const words = [
			{ id: 'changed', english: 'orange', pronunciation: undefined },
			{ id: 'missing', english: 'missing', pronunciation: undefined }
		];
		const results = new Map<string, PronunciationLookup>([
			['changed', { english: 'apple', pronunciation: { ipa: '[ˈæpəl]', guide: '애플' } }],
			['missing', { english: 'missing', pronunciation: null }]
		]);

		applyPronunciationResults(words, results);

		expect(words[0].pronunciation).toBeUndefined();
		expect(words[1].pronunciation).toBeNull();
	});

	it('strictly matches natural Korean guides by stable input id', () => {
		const candidates = [{ id: 'courteous', english: 'courteous', ipa: '[ˈkɝːtiəs]' }];
		expect(
			parsePronunciationGuides({ guides: [{ id: 'courteous', guide: '커티어스' }] }, candidates)
		).toEqual(new Map([['courteous', '커티어스']]));
		expect(
			parsePronunciationGuides({ guides: [{ id: 'other', guide: '커티어스' }] }, candidates)
		).toBeNull();
		expect(
			parsePronunciationGuides(
				{ guides: [{ id: 'courteous', guide: '커티어스 (courteous)' }] },
				candidates
			)
		).toBeNull();
	});

	it('upgrades stale guides and preserves them when AI is unavailable', () => {
		const word = {
			id: 'courteous',
			english: 'courteous',
			pronunciation: { ipa: '[ˈkɝːtiəs]', guide: '티엇' }
		};
		const dictionary = { ipa: '[ˈkɝːtiəs]', guide: '커티어스' };
		const upgraded = resolvePronunciationLookup(word, dictionary, '커티어스');
		expect(upgraded.persist?.pronunciation).toMatchObject({
			ipa: dictionary.ipa,
			guide: '커티어스',
			guideVersion: 2
		});
		const stale = { ...word };
		applyPronunciationResults([stale], new Map([['courteous', upgraded.persist!]]));
		expect(stale.pronunciation).toMatchObject({ guide: '커티어스', guideVersion: 2 });
		expect(resolvePronunciationLookup(word, dictionary)).toEqual({});
	});

	it('persists a local guide so later guide refreshes do not repeat dictionary lookup', () => {
		const result = resolvePronunciationLookup(
			{ english: 'apple', pronunciation: undefined },
			{ ipa: '[ˈæpəl]', guide: '애플' }
		);
		expect(result.result).toEqual({
			english: 'apple',
			pronunciation: { ipa: '[ˈæpəl]', guide: '애플' }
		});
		expect(result.persist).toEqual(result.result);
	});

	it('times out Vertex requests and retries transient failures', async () => {
		process.env.GOOGLE_CLOUD_PROJECT = 'test-project';
		generateContent.mockRejectedValueOnce({ status: 503 }).mockResolvedValueOnce({
			text: JSON.stringify({ guides: [{ id: 'apple', guide: '애플' }] })
		});

		const result = await generateKoreanPronunciationGuides([
			{ id: 'apple', english: 'apple', ipa: '[ˈæpəl]' }
		]);

		expect(result).toEqual(new Map([['apple', '애플']]));
		expect(generateContent).toHaveBeenCalledTimes(2);
		expect(generateContent.mock.calls[0][0].config.abortSignal).toBeInstanceOf(AbortSignal);
	});
});
