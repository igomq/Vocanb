import { passagePlainText, type PassageSummary } from '$lib/sentence-domain';
import { generatePassageSummary } from '$lib/server/sentence-ai';
import { getSentenceBook, updateSentenceBook } from '$lib/server/sentence-storage';
import { json } from '@sveltejs/kit';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

export const POST = async ({ request, locals, params }) => {
	const body: unknown = await request.json().catch(() => null);
	const passageId = isRecord(body) && typeof body.passageId === 'string' ? body.passageId : '';
	if (!/^[0-9a-f-]{36}$/iu.test(passageId))
		return json({ message: '지문을 찾을 수 없습니다.' }, { status: 400 });

	const book = await getSentenceBook(locals.userId!, params.id);
	if (!book) return json({ message: '문장 암기장을 찾을 수 없습니다.' }, { status: 404 });
	const passage = book.passages.find((candidate) => candidate.id === passageId);
	if (!passage) return json({ message: '지문을 찾을 수 없습니다.' }, { status: 404 });

	if (passage.summary) return json({ summary: passage.summary });

	let summary: PassageSummary;
	try {
		summary = await generatePassageSummary(passagePlainText(passage));
	} catch (error) {
		const failure = error as { name?: string; status?: number; code?: number };
		console.error('Passage summary generation failed:', {
			sentenceBookId: params.id,
			passageId,
			providerErrorType: failure?.name,
			providerStatus: failure?.status ?? failure?.code
		});
		return json({ message: '정리를 생성하지 못했습니다.' }, { status: 502 });
	}

	await updateSentenceBook(locals.userId!, params.id, (current) => {
		const target = current.passages.find((candidate) => candidate.id === passageId);
		if (target) target.summary = summary;
		return current;
	});
	return json({ summary });
};
