import { SentenceTestResultSchema } from '$lib/sentence-domain';
import { getSentenceBook, updateSentenceBook } from '$lib/server/sentence-storage';
import { json } from '@sveltejs/kit';
import { z } from 'zod';

const bodySchema = z.object({
	passageId: z.string().uuid(),
	results: z.record(z.string(), SentenceTestResultSchema),
	revision: z.number().int().nonnegative()
});

class StaleResultWrite extends Error {}

export const POST = async ({ request, locals, params }) => {
	const parsed = bodySchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success)
		return json({ message: '테스트 결과가 올바르지 않습니다.' }, { status: 400 });

	const book = await getSentenceBook(locals.userId!, params.id);
	if (!book) return json({ message: '문장 암기장을 찾을 수 없습니다.' }, { status: 404 });
	if (!book.passages.some((passage) => passage.id === parsed.data.passageId))
		return json({ message: '지문을 찾을 수 없습니다.' }, { status: 404 });

	let revision = parsed.data.revision;
	try {
		await updateSentenceBook(locals.userId!, params.id, (current) => {
			const target = current.passages.find((passage) => passage.id === parsed.data.passageId);
			if (!target) throw new Error('지문을 찾을 수 없습니다.');
			if (target.testResultsRevision !== parsed.data.revision) throw new StaleResultWrite();
			target.testResults = parsed.data.results;
			revision = ++target.testResultsRevision;
			return current;
		});
	} catch (error) {
		if (error instanceof StaleResultWrite)
			return json(
				{ message: '다른 탭에서 결과가 변경되었습니다. 새로고침 후 다시 시도해 주세요.' },
				{ status: 409 }
			);
		throw error;
	}
	return json({ ok: true, revision });
};
