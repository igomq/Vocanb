import { listSentenceBooks } from '$lib/server/sentence-storage';
import { listVocabularies } from '$lib/server/storage';
import { getFolders } from '$lib/server/folders';
import { pruneFolders } from '$lib/folders';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	const userId = locals.userId!;
	const [vocabularies, sentenceBooks, stored] = await Promise.all([
		listVocabularies(userId),
		listSentenceBooks(userId),
		getFolders(userId)
	]);
	const vocabularyIds = new Set(vocabularies.map(({ id }) => id));
	const sentenceBookIds = new Set(sentenceBooks.map(({ id }) => id));
	const folders = pruneFolders(stored, {
		vocabulary: vocabularyIds,
		sentence: sentenceBookIds
	});
	return {
		folders,
		vocabularies: vocabularies.map(({ id, title, rangeLabel, updatedAt }) => ({
			id,
			title,
			rangeLabel,
			updatedAt
		})),
		sentenceBooks: sentenceBooks.map(({ id, title, updatedAt, passages }) => ({
			id,
			title,
			passageCount: passages.length,
			updatedAt
		}))
	};
};
