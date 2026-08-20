import { getSentenceBook } from '$lib/server/sentence-storage';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const book = await getSentenceBook(locals.userId!, params.id);
	if (!book) redirect(303, '/app/s');
	return { book };
};
