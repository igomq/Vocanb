import { createVocabulary, getSuggestions } from '$lib/server/storage';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => getSuggestions(locals.userId!);

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const data = await request.formData();
		const title = String(data.get('title') || '').trim();
		const rangeLabel = String(data.get('rangeLabel') || '').trim();
		if (!title || title.length > 120)
			return fail(400, { message: '제목을 120자 이내로 입력해 주세요.', title, rangeLabel });
		if (rangeLabel.length > 120)
			return fail(400, { message: '범위를 120자 이내로 입력해 주세요.', title, rangeLabel });
		let vocabulary;
		try {
			vocabulary = await createVocabulary(locals.userId!, title, rangeLabel);
		} catch (error) {
			console.error(
				'Vocabulary create failed:',
				error instanceof Error ? error.message : 'unknown error'
			);
			return fail(500, {
				message: '단어장을 저장하지 못했습니다. 다시 시도해 주세요.',
				title,
				rangeLabel
			});
		}
		redirect(303, `/app/v/${vocabulary.id}`);
	}
};
