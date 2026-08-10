export const OCR_SYSTEM_INSTRUCTION = `You extract vocabulary pairs from photographed printed study books.

Rules:
1. Extract only entries visibly present in the image.
2. By default, extract only visually prominent headwords: English words or phrases that are substantially larger, bolder, or otherwise clearly styled as the book's main vocabulary entries. Extract these before anything secondary and keep their printed reading order.
3. Exclude small incidental words, word fragments, marginal notes, labels, and secondary vocabulary by default. When the user gives a target count and prominent headwords alone would miss it, add a secondary word only when it is a complete, self-contained vocabulary entry with its own clearly printed Korean meaning. Never use fragments or incidental text to fill a target, and never exceed the target.
4. Preserve each English word or phrase as printed. Never invent a word, Korean meaning, translation, explanation, or missing pair.
5. Preserve only the clearly printed Korean definition. If a secondary word has no clearly printed corresponding Korean meaning, do not emit it.
6. Exclude examples, chapter titles, unit titles, headers, footers, page furniture, and tiny surrounding text unless they are clearly part of a main vocabulary entry.
7. Put a printed part-of-speech marker (such as 명, 형, 동, or 부) in partOfSpeech, never in meaning. Omit partOfSpeech when none is printed.
8. Exclude synonym and antonym annotations (such as 유, 반, synonym, or antonym) from meaning and do not emit their related words unless rule 3 allows them.
9. Infer the book's reading order for multiple columns and use printed numbers when available.
10. Never connect English and Korean text across the wrong row or column.
11. Set uncertain=true when text or pairing is unclear instead of confidently guessing.
12. Do not emit empty entries.
13. Return only the requested structured JSON.`;

export const OCR_USER_INSTRUCTION =
	"Extract only the book's visually prominent main English headwords and their clearly corresponding Korean meanings in reading order. Ignore small incidental words, fragments, marginal notes, labels, examples, and other secondary text by default.";

export function buildOcrUserInstruction(targetEntries?: number) {
	if (targetEntries === undefined) return OCR_USER_INSTRUCTION;
	return `${OCR_USER_INSTRUCTION} Use ${targetEntries} entries as a hard maximum target for this image: return prominent headwords in reading order until the target is reached or those headwords are exhausted, then use secondary words only if prominent headwords alone do not reach the target and each secondary word is a complete printed vocabulary entry with its own clearly paired Korean meaning. Never use fragments or incidental text to fill it. Never invent, duplicate, pair across rows or columns, or pad to reach it; if fewer qualifying entries are visible, return fewer.`;
}

export const OCR_JSON_SCHEMA = {
	type: 'object',
	required: ['entries'],
	properties: {
		entries: {
			type: 'array',
			items: {
				type: 'object',
				required: ['sourceOrder', 'english', 'meaning', 'uncertain'],
				properties: {
					sourceOrder: { type: 'integer' },
					english: { type: 'string' },
					meaning: { type: 'string' },
					partOfSpeech: { type: 'string' },
					uncertain: { type: 'boolean' }
				}
			}
		}
	}
} as const;
