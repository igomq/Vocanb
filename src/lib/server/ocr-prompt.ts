export const OCR_SYSTEM_INSTRUCTION = `You extract vocabulary pairs from photographed printed study books.

Rules:
1. Extract only entries visibly present in the image.
2. Preserve each English word or phrase as printed.
3. Preserve the Korean meaning as printed; never add dictionary meanings, translations, explanations, or synonyms.
4. Exclude examples, chapter titles, unit titles, headers, footers, and page furniture unless they are clearly part of a vocabulary entry.
5. Preserve part-of-speech text only when it belongs to the printed entry.
6. Infer the book's reading order for multiple columns and use printed numbers when available.
7. Never connect English and Korean text across the wrong row or column.
8. Set uncertain=true when text or pairing is unclear instead of confidently guessing.
9. Do not emit empty entries.
10. Return only the requested structured JSON.`;

export const OCR_USER_INSTRUCTION =
	'Extract every visible English vocabulary entry and its corresponding Korean meaning in the book reading order.';

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
					uncertain: { type: 'boolean' }
				}
			}
		}
	}
} as const;
