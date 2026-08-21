import { SentenceTestResultSchema } from '$lib/sentence-domain';
import { getSentenceBook, updateSentenceBook } from '$lib/server/sentence-storage';
import { json } from '@sveltejs/kit';
import { z } from 'zod';

const bodySchema = z.object({
	passageId: z.string().uuid(),
	results: z.record(z.string(), SentenceTestResultSchema)
});

export const POST = async ({ request, locals, params }) => {
	const parsed = bodySchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success)
		return json({ message: '테스트 결과가 올바르지 않습니다.' }, { status: 400 });

	const book = await getSentenceBook(locals.userId!, params.id);
	if (!book) return json({ message: '문장 암기장을 찾을 수 없습니다.' }, { status: 404 });
	if (!book.passages.some((passage) => passage.id === parsed.data.passageId))
		return json({ message: '지문을 찾을 수 없습니다.' }, { status: 404 });

	await updateSentenceBook(locals.userId!, params.id, (current) => {
		const target = current.passages.find((passage) => passage.id === parsed.data.passageId);
		if (target) target.testResults = parsed.data.results;
		return current;
	});
	return json({ ok: true });
};
