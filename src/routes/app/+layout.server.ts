import { listVocabularies } from '$lib/server/storage';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => ({
	vocabularies: (await listVocabularies(locals.userId!)).map(
		({ id, title, rangeLabel, updatedAt }) => ({
			id,
			title,
			rangeLabel,
			updatedAt
		})
	)
});
