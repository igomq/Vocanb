import { listSentenceBooks } from '$lib/server/sentence-storage';
import { listVocabularies } from '$lib/server/storage';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => ({
	vocabularies: (await listVocabularies(locals.userId!)).map(
		({ id, title, rangeLabel, updatedAt }) => ({ id, title, rangeLabel, updatedAt })
	),
	sentenceBooks: (await listSentenceBooks(locals.userId!)).map(
		({ id, title, updatedAt, passages }) => ({
			id,
			title,
			passageCount: passages.length,
			updatedAt
		})
	)
});
