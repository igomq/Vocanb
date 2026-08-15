import {
	createTestSession,
	nextContinuousLearningStep,
	ResultStatusSchema,
	summarizeTest,
	toggleWordStar
} from '$lib/domain';
import { getVocabulary, updateVocabulary } from '$lib/server/storage';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const vocabulary = await getVocabulary(locals.userId!, params.id);
	const test = vocabulary?.tests.find((candidate) => candidate.id === params.testId);
	if (!vocabulary || !test) redirect(303, `/app/v/${params.id}`);
	const starsByWordId = new Map(vocabulary.words.map((word) => [word.id, word.starred]));
	return {
		title: vocabulary.title,
		rangeLabel: vocabulary.rangeLabel,
		test,
		stars: Object.fromEntries(
			test.items.map((item) => [item.wordId, starsByWordId.get(item.wordId) ?? false])
		),
		summary: summarizeTest(test, vocabulary.words.length)
	};
};

export const actions: Actions = {
	evaluate: async ({ request, locals, params }) => {
		const data = await request.formData();
		const wordId = String(data.get('wordId') || '');
		const result = ResultStatusSchema.safeParse(data.get('result'));
		if (!result.success) return fail(400, { message: '평가를 선택해 주세요.' });
		try {
			await updateVocabulary(locals.userId!, params.id, (vocabulary) => {
				const test = vocabulary.tests.find(
					(candidate) => candidate.id === params.testId && !candidate.completedAt
				);
				const item = test?.items.find((candidate) => candidate.wordId === wordId);
				if (!item) throw new Error('테스트 항목을 찾을 수 없습니다.');
				item.result = result.data;
				return vocabulary;
			});
			return { success: true };
		} catch (error) {
			console.error(
				'Test evaluation failed:',
				error instanceof Error ? error.message : 'unknown error'
			);
			return fail(400, { message: '평가를 저장하지 못했습니다.' });
		}
	},
	toggleStar: async ({ request, locals, params }) => {
		const wordId = String((await request.formData()).get('wordId') || '');
		try {
			await updateVocabulary(locals.userId!, params.id, (vocabulary) =>
				toggleWordStar(vocabulary, wordId)
			);
			return { success: true, action: 'toggleStar' };
		} catch (error) {
			return fail(400, {
				action: 'toggleStar',
				message: error instanceof Error ? error.message : '별표를 저장하지 못했습니다.'
			});
		}
	},
	complete: async ({ locals, params }) => {
		let destination = `/app/v/${params.id}?completed=1`;
		try {
			await updateVocabulary(locals.userId!, params.id, (vocabulary) => {
				const test = vocabulary.tests.find(
					(candidate) => candidate.id === params.testId && !candidate.completedAt
				);
				if (!test) throw new Error('테스트를 찾을 수 없습니다.');
				if (test.items.some((item) => !item.result)) throw new Error('모든 단어를 평가해 주세요.');
				test.completedAt = new Date().toISOString();
				if (test.continuous) {
					const next = nextContinuousLearningStep(vocabulary);
					if (next?.status === 'ready' && next.phase && next.range && next.dayRange) {
						if (next.phase === 'cumulative') {
							const words = vocabulary.words.filter(
								(word) => word.number >= next.range!.start && word.number <= next.range!.end
							);
							if (!words.length) throw new Error('테스트할 단어가 없습니다.');
							const cumulative = createTestSession(
								words,
								next.range,
								test.order,
								test.direction,
								Math.random,
								{
									phase: next.phase,
									batchSize: next.settings.batchSize,
									daySize: next.settings.daySize,
									dayStart: next.dayRange.start,
									dayEnd: next.dayRange.end,
									studyMode: next.settings.studyMode
								}
							);
							vocabulary.tests.push(cumulative);
							destination = `/app/v/${params.id}/test/${cumulative.id}`;
						} else {
							destination = `/app/v/${params.id}?continuous=1`;
						}
					}
				}
				return vocabulary;
			});
		} catch (error) {
			return fail(400, {
				message: error instanceof Error ? error.message : '테스트를 완료하지 못했습니다.'
			});
		}
		redirect(303, destination);
	}
};
