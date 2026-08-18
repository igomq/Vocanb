import {
	applyPronunciationResults,
	generateKoreanPronunciationGuides,
	lookupPronunciation,
	MAX_PRONUNCIATION_WORDS,
	resolvePronunciationLookup,
	type PronunciationLookup
} from '$lib/server/pronunciation';
import { needsPronunciationGuideRefresh, type Pronunciation } from '$lib/domain';
import { mapWithConcurrency } from '$lib/server/ocr';
import { getVocabulary, updateVocabulary } from '$lib/server/storage';
import { json } from '@sveltejs/kit';

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
	const missingByEnglish = new Map<string, typeof words>();
	for (const word of words) {
		if (word.pronunciation) {
			dictionaryResults.set(word.id, word.pronunciation);
			continue;
		}
		const key = word.english.trim().toLowerCase();
		missingByEnglish.set(key, [...(missingByEnglish.get(key) ?? []), word]);
	}
	const lookupResults = await mapWithConcurrency(
		[...missingByEnglish.values()],
		8,
		async (duplicates) => {
			let result: Pronunciation | null | undefined;
			try {
				result = await lookupPronunciation(duplicates[0].english);
			} catch (error) {
				console.warn(
					'Pronunciation lookup failed:',
					duplicates[0].english,
					error instanceof Error ? error.message : 'unknown error'
				);
			}
			return { duplicates, result };
		}
	);
	for (const { duplicates, result } of lookupResults) {
		for (const word of duplicates) dictionaryResults.set(word.id, result);
	}

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
