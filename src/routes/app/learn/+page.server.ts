import { ReviewGradeSchema } from '$lib/learning';
import { enrichQueueWithAi } from '$lib/server/adaptive-questions';
import {
	completeLearningSession,
	createLearningSession,
	discardLearningSession,
	evaluateLearningItem,
	getLearningSnapshot
} from '$lib/server/learning-storage';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

function optionalId(value: FormDataEntryValue | string | null) {
	const id = String(value || '').trim();
	if (!id) return null;
	if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
	return id;
}

function learnPath(sourceId: string | null) {
	return sourceId ? `/app/learn?vocabularyId=${sourceId}` : '/app/learn';
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const sourceId = optionalId(url.searchParams.get('vocabularyId'));
	return getLearningSnapshot(locals.userId!, sourceId);
};

export const actions: Actions = {
	start: async ({ request, locals }) => {
		const data = await request.formData();
		const sourceId = optionalId(data.get('vocabularyId'));
		try {
			await createLearningSession(locals.userId!, {
				mode: 'adaptive',
				sourceId,
				enrich: (items) => enrichQueueWithAi(items)
			});
		} catch (error) {
			return fail(400, {
				message: error instanceof Error ? error.message : '추천 학습을 시작하지 못했습니다.'
			});
		}
		redirect(303, learnPath(sourceId));
	},
	cram: async ({ request, locals }) => {
		const data = await request.formData();
		const sourceId = optionalId(data.get('vocabularyId'));
		try {
			const itemCount = Number(data.get('itemCount'));
			const minutes = Number(data.get('minutes'));
			await createLearningSession(locals.userId!, {
				mode: 'cram',
				sourceId,
				itemCount: Number.isInteger(itemCount) && itemCount > 0 ? itemCount : undefined,
				minutes: Number.isInteger(minutes) && minutes > 0 ? minutes : undefined,
				enrich: (items) => enrichQueueWithAi(items)
			});
		} catch (error) {
			return fail(400, {
				message: error instanceof Error ? error.message : '벼락치기를 시작하지 못했습니다.'
			});
		}
		redirect(303, learnPath(sourceId));
	},
	evaluate: async ({ request, locals }) => {
		const data = await request.formData();
		const index = Number(data.get('index'));
		const result = ReviewGradeSchema.safeParse(data.get('result'));
		const responseMs = Number(data.get('responseMs'));
		const typedAnswer = String(data.get('choice') || data.get('typedAnswer') || '').trim();
		if (!Number.isInteger(index) || index < 0 || (!result.success && !typedAnswer))
			return fail(400, { message: '평가를 선택해 주세요.' });
		try {
			await evaluateLearningItem(locals.userId!, {
				index,
				result: result.success ? result.data : undefined,
				responseMs: Number.isFinite(responseMs) && responseMs >= 0 ? responseMs : undefined,
				typedAnswer: typedAnswer || undefined
			});
			return { success: true };
		} catch (error) {
			return fail(400, {
				message: error instanceof Error ? error.message : '평가를 저장하지 못했습니다.'
			});
		}
	},
	complete: async ({ locals }) => {
		try {
			await completeLearningSession(locals.userId!);
		} catch (error) {
			return fail(400, {
				message: error instanceof Error ? error.message : '학습을 완료하지 못했습니다.'
			});
		}
		redirect(303, '/app?learned=1');
	},
	discard: async ({ locals }) => {
		await discardLearningSession(locals.userId!);
		redirect(303, '/app');
	}
};
