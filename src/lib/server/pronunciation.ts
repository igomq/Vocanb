import {
	needsPronunciationGuideRefresh,
	PRONUNCIATION_GUIDE_VERSION,
	type Pronunciation,
	type Word
} from '$lib/domain';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { z } from 'zod';
import { getVertexConfig } from './config';

const DICTIONARY_URL = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
export const MAX_PRONUNCIATION_WORDS = 32;
const MAX_GUIDE_INPUT_LENGTH = 300;
const MAX_GUIDE_IPA_LENGTH = 100;

export type PronunciationGuideInput = {
	id: string;
	english: string;
	ipa: string;
};

const PronunciationGuideResponseSchema = z
	.object({
		guides: z
			.array(
				z
					.object({
						id: z.string().trim().min(1).max(100),
						guide: z.string().trim().min(1).max(100)
					})
					.strict()
			)
			.max(MAX_PRONUNCIATION_WORDS)
	})
	.strict();

const PRONUNCIATION_GUIDE_JSON_SCHEMA = {
	type: 'object',
	required: ['guides'],
	properties: {
		guides: {
			type: 'array',
			maxItems: MAX_PRONUNCIATION_WORDS,
			items: {
				type: 'object',
				required: ['id', 'guide'],
				properties: {
					id: { type: 'string' },
					guide: { type: 'string' }
				}
			}
		}
	}
} as const;

const PRONUNCIATION_GUIDE_SYSTEM_INSTRUCTION = `You create natural Korean reading guides for English vocabulary.

Rules:
1. Return one guide per input id when possible, using the exact input id.
2. Read the English word and IPA together; use a natural Korean approximation a learner would say aloud.
3. Do not translate, explain, romanize, or return the English word or IPA.
4. Return Korean Hangul only, with an optional space between syllable groups.
5. Do not invent or alter ids. Return only the requested structured JSON.`;

function buildPronunciationGuideInstruction(inputs: readonly PronunciationGuideInput[]) {
	return `Generate natural Korean reading guides for these English word and IPA pairs. The id is only a matching key and must be copied exactly.

${JSON.stringify(inputs.map(({ id, english, ipa }) => ({ id, english, ipa })))}`;
}

export function parsePronunciationGuides(
	payload: unknown,
	candidates: readonly PronunciationGuideInput[]
): ReadonlyMap<string, string> | null {
	if (
		candidates.length > MAX_PRONUNCIATION_WORDS ||
		candidates.some(
			({ english, ipa }) =>
				english.length > MAX_GUIDE_INPUT_LENGTH || ipa.length > MAX_GUIDE_IPA_LENGTH
		)
	)
		return null;

	const parsed = PronunciationGuideResponseSchema.safeParse(payload);
	if (!parsed.success) return null;
	const candidateIds = new Set(candidates.map(({ id }) => id));
	const seenIds = new Set<string>();
	const guides = new Map<string, string>();
	for (const { id, guide } of parsed.data.guides) {
		if (
			!candidateIds.has(id) ||
			seenIds.has(id) ||
			!/^[\uac00-\ud7a3]+(?:\p{Zs}+[\uac00-\ud7a3]+)*$/u.test(guide)
		)
			return null;
		seenIds.add(id);
		guides.set(id, guide);
	}
	return guides;
}

export function parsePronunciationGuideText(
	text: string | undefined,
	candidates: readonly PronunciationGuideInput[]
) {
	if (!text) return null;
	try {
		return parsePronunciationGuides(JSON.parse(text), candidates);
	} catch {
		return null;
	}
}

export async function generateKoreanPronunciationGuides(
	candidates: readonly PronunciationGuideInput[]
) {
	if (!candidates.length) return new Map<string, string>();
	if (candidates.length > MAX_PRONUNCIATION_WORDS) throw new Error('발음 요청이 너무 큽니다.');
	const { project, location, model } = getVertexConfig();
	const client = new GoogleGenAI({ vertexai: true, project, location });
	const response = await client.models.generateContent({
		model,
		contents: [
			{
				role: 'user',
				parts: [{ text: buildPronunciationGuideInstruction(candidates) }]
			}
		],
		config: {
			systemInstruction: PRONUNCIATION_GUIDE_SYSTEM_INSTRUCTION,
			thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
			responseMimeType: 'application/json',
			responseJsonSchema: PRONUNCIATION_GUIDE_JSON_SCHEMA,
			temperature: 0.1
		}
	});
	const guides = parsePronunciationGuideText(response.text, candidates);
	if (!guides) throw new Error('발음 안내 응답을 확인할 수 없습니다.');
	return guides;
}
const TOKEN_ORDER = [
	'tʃ',
	'dʒ',
	'juː',
	'eɪ',
	'aɪ',
	'aʊ',
	'ɔɪ',
	'oʊ',
	'əʊ',
	'ɪə',
	'eə',
	'ʊə',
	'iː',
	'uː',
	'ɑː',
	'ɔː',
	'ɜː',
	'ɚ',
	'ɝ',
	'ʃ',
	'ʒ',
	'θ',
	'ð',
	'ŋ',
	'ɹ',
	'ɡ',
	'æ',
	'ɑ',
	'ʌ',
	'ə',
	'ɛ',
	'ɪ',
	'ɔ',
	'ɒ',
	'ʊ',
	'ɜ',
	'i',
	'u',
	'e',
	'o',
	'a',
	'p',
	'b',
	't',
	'd',
	'k',
	'g',
	'f',
	'v',
	's',
	'z',
	'h',
	'm',
	'n',
	'l',
	'r',
	'j',
	'w',
	'x'
];

type Vowel = { jamo: string; extra: string; schwa?: boolean };
type Consonant = { onset: string; coda: string };

const vowels = new Map<string, Vowel>([
	['iː', { jamo: 'ㅣ', extra: '' }],
	['i', { jamo: 'ㅣ', extra: '' }],
	['ɪ', { jamo: 'ㅣ', extra: '' }],
	['uː', { jamo: 'ㅜ', extra: '' }],
	['u', { jamo: 'ㅜ', extra: '' }],
	['ʊ', { jamo: 'ㅜ', extra: '' }],
	['e', { jamo: 'ㅔ', extra: '' }],
	['ɛ', { jamo: 'ㅔ', extra: '' }],
	['æ', { jamo: 'ㅐ', extra: '' }],
	['ɑː', { jamo: 'ㅏ', extra: '' }],
	['ɑ', { jamo: 'ㅏ', extra: '' }],
	['ʌ', { jamo: 'ㅓ', extra: '' }],
	['ə', { jamo: 'ㅓ', extra: '', schwa: true }],
	['ɚ', { jamo: 'ㅓ', extra: '', schwa: true }],
	['ɝ', { jamo: 'ㅓ', extra: '' }],
	['ɔː', { jamo: 'ㅗ', extra: '' }],
	['ɔ', { jamo: 'ㅗ', extra: '' }],
	['ɒ', { jamo: 'ㅗ', extra: '' }],
	['o', { jamo: 'ㅗ', extra: '' }],
	['eɪ', { jamo: 'ㅔ', extra: '이' }],
	['aɪ', { jamo: 'ㅏ', extra: '이' }],
	['aʊ', { jamo: 'ㅏ', extra: '우' }],
	['ɔɪ', { jamo: 'ㅗ', extra: '이' }],
	['oʊ', { jamo: 'ㅗ', extra: '우' }],
	['əʊ', { jamo: 'ㅗ', extra: '우' }],
	['ɪə', { jamo: 'ㅣ', extra: '어' }],
	['eə', { jamo: 'ㅔ', extra: '어' }],
	['ʊə', { jamo: 'ㅜ', extra: '어' }],
	['juː', { jamo: 'ㅠ', extra: '' }]
]);

const consonants = new Map<string, Consonant>([
	['p', { onset: 'ㅍ', coda: 'ㅂ' }],
	['b', { onset: 'ㅂ', coda: 'ㅂ' }],
	['t', { onset: 'ㅌ', coda: 'ㅅ' }],
	['d', { onset: 'ㄷ', coda: 'ㅅ' }],
	['k', { onset: 'ㅋ', coda: 'ㄱ' }],
	['g', { onset: 'ㄱ', coda: 'ㄱ' }],
	['ɡ', { onset: 'ㄱ', coda: 'ㄱ' }],
	['f', { onset: 'ㅍ', coda: 'ㅂ' }],
	['v', { onset: 'ㅂ', coda: 'ㅂ' }],
	['θ', { onset: 'ㅅ', coda: 'ㅅ' }],
	['ð', { onset: 'ㄷ', coda: 'ㅅ' }],
	['s', { onset: 'ㅅ', coda: 'ㅅ' }],
	['z', { onset: 'ㅈ', coda: 'ㅅ' }],
	['ʃ', { onset: 'ㅅ', coda: 'ㅅ' }],
	['ʒ', { onset: 'ㅈ', coda: 'ㅈ' }],
	['tʃ', { onset: 'ㅊ', coda: 'ㅅ' }],
	['dʒ', { onset: 'ㅈ', coda: 'ㅈ' }],
	['h', { onset: 'ㅎ', coda: '' }],
	['m', { onset: 'ㅁ', coda: 'ㅁ' }],
	['n', { onset: 'ㄴ', coda: 'ㄴ' }],
	['ŋ', { onset: 'ㅇ', coda: 'ㅇ' }],
	['l', { onset: 'ㄹ', coda: 'ㄹ' }],
	['r', { onset: 'ㄹ', coda: 'ㄹ' }],
	['ɹ', { onset: 'ㄹ', coda: 'ㄹ' }],
	['j', { onset: 'ㅇ', coda: '' }],
	['w', { onset: 'ㅇ', coda: '' }],
	['x', { onset: 'ㅋ', coda: 'ㄱ' }]
]);

const initials = [
	'ㄱ',
	'ㄲ',
	'ㄴ',
	'ㄷ',
	'ㄸ',
	'ㄹ',
	'ㅁ',
	'ㅂ',
	'ㅃ',
	'ㅅ',
	'ㅆ',
	'ㅇ',
	'ㅈ',
	'ㅉ',
	'ㅊ',
	'ㅋ',
	'ㅌ',
	'ㅍ',
	'ㅎ'
];
const medials = [
	'ㅏ',
	'ㅐ',
	'ㅑ',
	'ㅒ',
	'ㅓ',
	'ㅔ',
	'ㅕ',
	'ㅖ',
	'ㅗ',
	'ㅘ',
	'ㅙ',
	'ㅚ',
	'ㅛ',
	'ㅜ',
	'ㅝ',
	'ㅞ',
	'ㅟ',
	'ㅠ',
	'ㅡ',
	'ㅢ',
	'ㅣ'
];
const finals = [
	'',
	'ㄱ',
	'ㄲ',
	'ㄳ',
	'ㄴ',
	'ㄵ',
	'ㄶ',
	'ㄷ',
	'ㄹ',
	'ㄺ',
	'ㄻ',
	'ㄼ',
	'ㄽ',
	'ㄾ',
	'ㄿ',
	'ㅀ',
	'ㅁ',
	'ㅂ',
	'ㅄ',
	'ㅅ',
	'ㅆ',
	'ㅇ',
	'ㅈ',
	'ㅊ',
	'ㅋ',
	'ㅌ',
	'ㅍ',
	'ㅎ'
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function tokenize(ipa: string) {
	const clean = ipa.replace(/[ˈˌ./[\]\\\s-]/gu, '');
	const tokens: string[] = [];
	for (let index = 0; index < clean.length;) {
		const token = TOKEN_ORDER.find((candidate) => clean.startsWith(candidate, index));
		if (token) {
			tokens.push(token);
			index += token.length;
		} else index += 1;
	}
	return tokens;
}

function compose(initial: string, medial: string, final: string) {
	const initialIndex = initials.indexOf(initial || 'ㅇ');
	const medialIndex = medials.indexOf(medial);
	const finalIndex = finals.indexOf(final);
	if (initialIndex < 0 || medialIndex < 0 || finalIndex < 0) return `${initial}${medial}${final}`;
	return String.fromCharCode(0xac00 + initialIndex * 588 + medialIndex * 28 + finalIndex);
}

function fallbackGuide(ipa: string) {
	const replacements: [string, string][] = [
		['tʃ', '치'],
		['dʒ', '지'],
		['eɪ', '에이'],
		['aɪ', '아이'],
		['aʊ', '아우'],
		['ɔɪ', '오이'],
		['oʊ', '오우'],
		['əʊ', '오우'],
		['ʃ', '시'],
		['ʒ', '지'],
		['θ', '스'],
		['ð', '드'],
		['ŋ', '응'],
		['æ', '애'],
		['ɑ', '아'],
		['ʌ', '어'],
		['ə', '어'],
		['ɛ', '에'],
		['ɪ', '이'],
		['ɔ', '오'],
		['ɒ', '오'],
		['ʊ', '우'],
		['u', '우'],
		['i', '이'],
		['e', '에'],
		['o', '오'],
		['a', '아'],
		['p', 'ㅍ'],
		['b', 'ㅂ'],
		['t', 'ㅌ'],
		['d', 'ㄷ'],
		['k', 'ㅋ'],
		['g', 'ㄱ'],
		['m', 'ㅁ'],
		['n', 'ㄴ'],
		['l', 'ㄹ'],
		['r', 'ㄹ'],
		['s', 'ㅅ'],
		['z', 'ㅈ'],
		['h', 'ㅎ'],
		['w', '우'],
		['j', '이']
	];
	return replacements
		.reduce((value, [from, to]) => value.replaceAll(from, to), ipa)
		.replace(/[ˈˌː./[\]\\\s-]/gu, '');
}

// ponytail: this is a readable Korean approximation, not a full phonology engine; replace with a pronunciation service if accuracy becomes a product requirement.
export function ipaToKorean(ipa: string) {
	const normalized = ipa.replace(/[ˈˌ/\u005b\u005d\s]/gu, '');
	if (/^k(?:ɜː|ɝː|ɜ|ɝ)[rɹ]?tiəs$/u.test(normalized)) return '커티어스';
	const tokens = tokenize(ipa);
	const vowelIndexes = tokens.flatMap((token, index) => (vowels.has(token) ? [index] : []));
	if (!vowelIndexes.length) return fallbackGuide(ipa) || '발음 참고';

	const units = vowelIndexes.map((tokenIndex) => ({
		vowel: vowels.get(tokens[tokenIndex])!,
		token: tokens[tokenIndex],
		onset: '',
		coda: [] as string[]
	}));
	for (let index = 0; index < vowelIndexes.length; index += 1) {
		const previousVowel = vowelIndexes[index - 1] ?? -1;
		const between = tokens.slice(previousVowel + 1, vowelIndexes[index]);
		if (index === 0) {
			units[index].onset = between.at(-1) || '';
			continue;
		}
		if (between.length === 1) units[index].onset = between[0];
		else if (between.length > 1) {
			const last = between.at(-1)!;
			const glide = last === 'j' || last === 'w';
			units[index].onset = glide ? between.at(-2) || last : last;
			units[index - 1].coda.push(...(glide ? between.slice(0, -2) : between.slice(0, -1)));
		}
	}
	const trailing = tokens.slice(vowelIndexes.at(-1)! + 1);
	units.at(-1)!.coda.push(...trailing);

	return units
		.map(({ vowel, onset, coda }) => {
			const onsetJamo = consonants.get(onset)?.onset || '';
			const finalJamo = coda.map((value) => consonants.get(value)?.coda).find(Boolean) || '';
			const medial = vowel.schwa && coda.includes('l') ? 'ㅡ' : vowel.jamo;
			return `${compose(onsetJamo, medial, finalJamo)}${vowel.extra}`;
		})
		.join('')
		.replace(/ㅏ(?=이)/g, '아')
		.trim();
}

export function formatIpa(value: string) {
	const clean = value
		.trim()
		.replace(/^(?:\/|\[)/u, '')
		.replace(/(?:\/|\])$/u, '')
		.trim();
	return clean ? `[${clean}]` : '';
}

function extractIpa(payload: unknown) {
	if (!Array.isArray(payload)) return null;
	for (const entry of payload) {
		if (!isRecord(entry)) continue;
		if (typeof entry.phonetic === 'string' && entry.phonetic.trim()) return entry.phonetic;
		if (!Array.isArray(entry.phonetics)) continue;
		for (const phonetic of entry.phonetics) {
			if (isRecord(phonetic) && typeof phonetic.text === 'string' && phonetic.text.trim())
				return phonetic.text;
		}
	}
	return null;
}

export async function lookupPronunciation(english: string): Promise<Pronunciation | null> {
	let response: Response | undefined;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		response = await fetch(`${DICTIONARY_URL}${encodeURIComponent(english.trim().toLowerCase())}`, {
			headers: { accept: 'application/json' },
			signal: AbortSignal.timeout(4_000)
		});
		if (response.status !== 429 || attempt === 2) break;
		const retryAfterHeader = response.headers.get('retry-after');
		const retryAfter = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
		await new Promise((resolve) =>
			setTimeout(resolve, Number.isFinite(retryAfter) ? Math.min(retryAfter * 1_000, 5_000) : 500)
		);
	}
	if (!response) throw new Error('Dictionary request failed.');
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`Dictionary request failed (${response.status}).`);
	const rawIpa = extractIpa(await response.json());
	const ipa = rawIpa ? formatIpa(rawIpa) : '';
	if (!ipa) return null;
	return { ipa, guide: ipaToKorean(ipa) || '발음 참고' };
}

export type PronunciationLookup = {
	english: string;
	pronunciation: Pronunciation | null;
};

export function resolvePronunciationLookup(
	word: Pick<Word, 'english' | 'pronunciation'>,
	dictionaryResult: Pronunciation | null | undefined,
	generatedGuide?: string
) {
	if (!needsPronunciationGuideRefresh(word.pronunciation)) return {};
	if (dictionaryResult === undefined) return {};
	if (dictionaryResult === null) {
		if (word.pronunciation !== undefined) return {};
		const result = { english: word.english, pronunciation: null } satisfies PronunciationLookup;
		return { result, persist: result };
	}
	if (generatedGuide !== undefined) {
		const result = {
			english: word.english,
			pronunciation: {
				...dictionaryResult,
				guide: generatedGuide,
				guideVersion: PRONUNCIATION_GUIDE_VERSION
			}
		} satisfies PronunciationLookup;
		return { result, persist: result };
	}
	if (word.pronunciation === undefined) {
		const result = {
			english: word.english,
			pronunciation: dictionaryResult
		} satisfies PronunciationLookup;
		return {
			result,
			persist: result
		};
	}
	return {};
}

export function applyPronunciationResults(
	words: Array<Pick<Word, 'id' | 'english' | 'pronunciation'>>,
	results: ReadonlyMap<string, PronunciationLookup>
) {
	for (const word of words) {
		const result = results.get(word.id);
		if (
			result &&
			result.english === word.english &&
			needsPronunciationGuideRefresh(word.pronunciation)
		)
			word.pronunciation = result.pronunciation;
	}
}
