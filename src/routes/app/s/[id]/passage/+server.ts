import { SentencePassageEditSchema, passagePlainText } from '$lib/sentence-domain';
import { getSentenceBook, updateSentenceBook } from '$lib/server/sentence-storage';
import { error, json } from '@sveltejs/kit';

export const POST = async ({ request, locals, params }) => {
	const parsed = SentencePassageEditSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success)
		return json(
			{ message: '빈 문단 없이 본문을 100,000자 이내로 입력해 주세요.' },
			{ status: 400 }
		);
	const book = await getSentenceBook(locals.userId!, params.id);
	if (!book) error(404, '문장 암기장을 찾을 수 없습니다.');
	const { passageId, paragraphs, expectedParagraphs } = parsed.data;
	const updated = await updateSentenceBook(locals.userId!, params.id, (current) => {
		const target = current.passages.find((passage) => passage.id === passageId);
		if (!target) error(404, '지문을 찾을 수 없습니다.');
		if (JSON.stringify(target.paragraphs) !== JSON.stringify(expectedParagraphs))
			error(409, '다른 탭에서 지문이 수정되었습니다. 수정 내용을 복사해 두고 새로고침해 주세요.');
		if (JSON.stringify(target.paragraphs) === JSON.stringify(paragraphs)) return current;
		if (passagePlainText(target) !== passagePlainText({ paragraphs })) {
			target.summary = null;
			target.translation = null;
		}
		target.paragraphs = paragraphs;
		target.testResults = {};
		target.testResultsRevision++;
		return current;
	});
	return json({ passage: updated.passages.find((passage) => passage.id === passageId) });
};
