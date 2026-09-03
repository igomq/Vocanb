import { passagePlainText } from '$lib/sentence-domain';
import { generatePassageChatAnswer } from '$lib/server/sentence-ai';
import { getSentenceBook } from '$lib/server/sentence-storage';
import { json } from '@sveltejs/kit';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isChatMessages(value: unknown): value is ChatMessage[] {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		value.length <= 20 &&
		value.every(
			(message) =>
				isRecord(message) &&
				(message.role === 'user' || message.role === 'assistant') &&
				typeof message.content === 'string' &&
				message.content.trim().length > 0 &&
				message.content.length <= 4000
		) &&
		value.at(-1)?.role === 'user' &&
		value.reduce((length, message) => length + message.content.length, 0) <= 20_000
	);
}

export const POST = async ({ request, locals, params }) => {
	const body: unknown = await request.json().catch(() => null);
	const passageId = isRecord(body) && typeof body.passageId === 'string' ? body.passageId : '';
	const messages = isRecord(body) && isChatMessages(body.messages) ? body.messages : null;
	if (!/^[0-9a-f-]{36}$/iu.test(passageId))
		return json({ message: '지문을 찾을 수 없습니다.' }, { status: 400 });
	if (!messages) return json({ message: '대화 내용을 확인해 주세요.' }, { status: 400 });

	const book = await getSentenceBook(locals.userId!, params.id);
	if (!book) return json({ message: '문장 암기장을 찾을 수 없습니다.' }, { status: 404 });
	const passage = book.passages.find((candidate) => candidate.id === passageId);
	if (!passage) return json({ message: '지문을 찾을 수 없습니다.' }, { status: 404 });

	try {
		return json({ answer: await generatePassageChatAnswer(passagePlainText(passage), messages) });
	} catch (error) {
		const failure = error as { name?: string; status?: number; code?: number };
		console.error('Passage chat generation failed:', {
			sentenceBookId: params.id,
			passageId,
			providerErrorType: failure?.name,
			providerStatus: failure?.status ?? failure?.code
		});
		return json(
			{ message: '답변을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.' },
			{ status: 502 }
		);
	}
};
