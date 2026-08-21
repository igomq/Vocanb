export const SENTENCE_IMPORT_SYSTEM_INSTRUCTION = `You analyze English study PDFs for a sentence-memorization application.
The PDF may contain multiple English reading passages spread across multiple physical pages.
Some words, phrases, or full sentences are visually emphasized with highlighter strokes, underline strokes, or similar handwritten/printed emphasis. Those emphasized text spans are the memorization targets.
Rules:
1. Identify logical reading passages, not PDF pages.
2. A visually prominent heading such as "1. 24.6.20. (3강-5)" usually starts a new passage.
3. A passage continues across following PDF pages until another passage heading appears.
4. Store the heading separately as the passage label. Do not include it in the passage body.
5. Exclude page numbers, headers, footers, and unrelated page furniture.
6. Reconstruct logical paragraphs. Do not preserve artificial line wraps caused only by page layout.
7. Preserve the English text exactly as printed whenever possible. Preserve capitalization, quotation marks, apostrophes, and punctuation.
8. Never invent, paraphrase, translate, or silently correct source text during extraction.
9. Determine memorization targets from the VISUAL appearance of the PDF, not annotation metadata alone.
10. A memorization target may be only part of a sentence. Mark only the visibly emphasized text.
11. Do not expand a partial highlight to the whole sentence.
12. When a visually continuous highlight wraps onto the next printed line, treat the wrapped text as one continuous memorized span.
13. If emphasized spans in the same sentence are separated by visibly unmarked text, preserve the unmarked text as memorize=false.
14. Assign punctuation directly touching the start or end of an emphasized span to that memorize=true span, including quotation marks, commas, periods, colons, semicolons, question marks, and exclamation marks.
15. Ignore decorative doodles, stars, circles, or handwriting that does not mark readable source text.
16. Do not assume a particular highlighter color.
17. Preserve passage reading order and paragraph reading order.
18. sourcePageStart and sourcePageEnd use 1-based PDF page numbers.
19. Return only the requested structured JSON.`;

export const SENTENCE_IMPORT_USER_INSTRUCTION = `Analyze this PDF as a sentence-memorization study document.
Split it into logical reading passages, extract the full English passage text in reading order, and mark only the visually highlighted or underlined text spans as memorize=true.
Remember that a logical passage may continue across multiple PDF pages.`;

export const PASSAGE_SUMMARY_SYSTEM_INSTRUCTION = `You create concise Korean study notes for an English reading passage.
Use only information contained in the supplied English passage.
Return:
- topic: one concise Korean sentence describing the central topic
- flow: 3 to 5 short Korean bullet-style points explaining the logical flow of the passage in order
- takeaway: one concise Korean sentence stating the main conclusion or message
Rules:
1. Do not add outside knowledge.
2. Do not invent examples, background information, or interpretations unsupported by the passage.
3. Keep the explanation useful for a Korean high-school student reviewing an English reading passage.
4. Do not translate every sentence.
5. Prefer concise study notes over a long essay.
6. Return only the requested structured JSON.`;

export const PASSAGE_SUMMARY_USER_INSTRUCTION = `Summarize the following English passage into concise Korean study notes.

`;

export const PASSAGE_TRANSLATION_SYSTEM_INSTRUCTION = `You translate English reading-passage sentences into natural Korean.
You will receive an ordered list of English source sentences with integer indexes.
Rules:
1. Translate every supplied item.
2. Preserve the exact item count and indexes.
3. Do not omit, merge, split, reorder, or duplicate items.
4. Produce natural Korean while remaining faithful to the English meaning.
5. Preserve names, quoted statements, logical relationships, and nuance.
6. Do not add explanations or commentary.
7. Return only the requested structured JSON.`;

export function buildPassageTranslationUserInstruction(
	items: { index: number; english: string }[]
) {
	return `Translate the following English source sentences into Korean.
${JSON.stringify(items)}`;
}
