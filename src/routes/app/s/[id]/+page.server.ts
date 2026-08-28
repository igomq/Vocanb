import { fail } from '@sveltejs/kit';
import { getSentenceBook, renameSentenceBook } from '$lib/server/sentence-storage';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const book = await getSentenceBook(locals.userId!, params.id);
	if (!book) redirect(303, '/app/s');
	return { book };
};

export const actions: Actions = {
	renameSentenceBook: async ({ request, locals, params }) => {
		const title = String((await request.formData()).get('title') || '').trim();
		try {
			await renameSentenceBook(locals.userId!, params.id, title);
			return { success: true, action: 'renameSentenceBook', message: '이름을 변경했습니다.' };
		} catch (error) {
			console.error(
				'Sentence book rename failed:',
				error instanceof Error ? error.message : 'unknown error'
			);
			return fail(400, {
				action: 'renameSentenceBook',
				message: error instanceof Error ? error.message : '이름을 변경하지 못했습니다.'
			});
		}
	}
};
