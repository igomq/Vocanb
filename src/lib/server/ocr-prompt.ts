export const OCR_SYSTEM_INSTRUCTION = `You extract vocabulary pairs from photographed printed study books.

Rules:
1. Extract only entries visibly present in the image.
2. Preserve each English word or phrase as printed.
3. Preserve only the Korean definition as printed; never add dictionary meanings, translations, or explanations.
4. Exclude examples, chapter titles, unit titles, headers, footers, and page furniture unless they are clearly part of a vocabulary entry.
5. Put a printed part-of-speech marker (such as 명, 형, 동, or 부) in partOfSpeech, never in meaning. Omit partOfSpeech when none is printed.
6. Exclude synonym and antonym annotations (such as 유, 반, synonym, or antonym) and their related words from meaning.
7. Infer the book's reading order for multiple columns and use printed numbers when available.
8. Never connect English and Korean text across the wrong row or column.
9. Set uncertain=true when text or pairing is unclear instead of confidently guessing.
10. Do not emit empty entries.
11. Return only the requested structured JSON.`;

export const OCR_USER_INSTRUCTION =
	'Extract every visible English vocabulary entry and its corresponding Korean meaning in the book reading order.';

export function buildOcrUserInstruction(targetEntries?: number) {
	if (targetEntries === undefined) return OCR_USER_INSTRUCTION;
	return `${OCR_USER_INSTRUCTION} Use an approximate soft target of ${targetEntries} entries for this image. Never invent, duplicate, or pad entries to reach it; if fewer entries are visibly present, return fewer.`;
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
