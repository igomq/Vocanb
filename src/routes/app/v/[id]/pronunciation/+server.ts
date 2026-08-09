import {
	applyPronunciationResults,
	lookupPronunciation,
	type PronunciationLookup
} from '$lib/server/pronunciation';
import { getVocabulary, updateVocabulary } from '$lib/server/storage';
import { json } from '@sveltejs/kit';
import { mapWithConcurrency } from '$lib/server/ocr';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

const MAX_PRONUNCIATION_WORDS = 32;

export const POST = async ({ request, locals, params }) => {
	const body: unknown = await request.json().catch(() => null);
	const rawWordIds = isRecord(body) && Array.isArray(body.wordIds) ? body.wordIds : [];
	const wordIds = new Set(
		rawWordIds.filter(
			(value): value is string => typeof value === 'string' && /^[0-9a-f-]{36}$/iu.test(value)
		)
	);
	if (!wordIds.size || wordIds.size > MAX_PRONUNCIATION_WORDS)
		return json({ message: '발음을 조회할 단어를 확인해 주세요.' }, { status: 400 });

	const vocabulary = await getVocabulary(locals.userId!, params.id);
	if (!vocabulary) return json({ message: '단어장을 찾을 수 없습니다.' }, { status: 404 });
	const words = vocabulary.words.filter(
		(word) => wordIds.has(word.id) && word.pronunciation === undefined
	);
	if (!words.length) return json({ pronunciations: {} });

	const results = await mapWithConcurrency(words, 4, async (word) => {
		try {
			return [
				word.id,
				{ english: word.english, pronunciation: await lookupPronunciation(word.english) }
			] as const;
		} catch (error) {
			console.warn(
				'Pronunciation lookup failed:',
				word.english,
				error instanceof Error ? error.message : 'unknown error'
			);
			return [word.id, undefined] as const;
		}
	});
	const pronunciations = new Map<string, PronunciationLookup>();
	for (const [wordId, result] of results) {
		if (result !== undefined) pronunciations.set(wordId, result);
	}

	if (pronunciations.size) {
		await updateVocabulary(locals.userId!, params.id, (current) => {
			applyPronunciationResults(current.words, pronunciations);
			return current;
		});
	}

	return json({ pronunciations: Object.fromEntries(pronunciations) });
};
