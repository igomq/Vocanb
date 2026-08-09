import {
	applyPronunciationResults,
	generateKoreanPronunciationGuides,
	lookupPronunciation,
	MAX_PRONUNCIATION_WORDS,
	resolvePronunciationLookup,
	type PronunciationLookup
} from '$lib/server/pronunciation';
import { needsPronunciationGuideRefresh, type Pronunciation } from '$lib/domain';
import { getVocabulary, updateVocabulary } from '$lib/server/storage';
import { json } from '@sveltejs/kit';
import { mapWithConcurrency } from '$lib/server/ocr';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

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
		(word) => wordIds.has(word.id) && needsPronunciationGuideRefresh(word.pronunciation)
	);
	if (!words.length) return json({ pronunciations: {} });

	const dictionaryResults = new Map<string, Pronunciation | null | undefined>();
	const dictionaryLookups = await mapWithConcurrency(words, 4, async (word) => {
		try {
			return [word.id, await lookupPronunciation(word.english)] as const;
		} catch (error) {
			console.warn(
				'Pronunciation lookup failed:',
				word.english,
				error instanceof Error ? error.message : 'unknown error'
			);
			return [word.id, undefined] as const;
		}
	});
	for (const [wordId, result] of dictionaryLookups) dictionaryResults.set(wordId, result);

	const guideInputs = words.flatMap((word) => {
		const pronunciation = dictionaryResults.get(word.id);
		return pronunciation ? [{ id: word.id, english: word.english, ipa: pronunciation.ipa }] : [];
	});
	let generatedGuides = new Map<string, string>();
	if (guideInputs.length) {
		try {
			generatedGuides = new Map(await generateKoreanPronunciationGuides(guideInputs));
		} catch (error) {
			console.warn(
				'Korean pronunciation guide generation failed:',
				error instanceof Error ? error.message : 'unknown error'
			);
		}
	}

	const pronunciations = new Map<string, PronunciationLookup>();
	const persistable = new Map<string, PronunciationLookup>();
	for (const word of words) {
		const resolved = resolvePronunciationLookup(
			word,
			dictionaryResults.get(word.id),
			generatedGuides.get(word.id)
		);
		if (resolved.result) pronunciations.set(word.id, resolved.result);
		if (resolved.persist) persistable.set(word.id, resolved.persist);
	}

	if (persistable.size) {
		await updateVocabulary(locals.userId!, params.id, (current) => {
			applyPronunciationResults(current.words, persistable);
			return current;
		});
	}

	return json({ pronunciations: Object.fromEntries(pronunciations) });
};
