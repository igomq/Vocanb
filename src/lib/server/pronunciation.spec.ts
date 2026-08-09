import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	applyPronunciationResults,
	ipaToKorean,
	lookupPronunciation,
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
	});

	it('treats a missing dictionary entry as a normal fallback', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
		expect(await lookupPronunciation('not-a-word')).toBeNull();
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
});
