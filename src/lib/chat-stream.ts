export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export function chatHistory(messages: ChatMessage[]) {
	const history = messages
		.filter((message) => message.content.trim())
		.slice(-20)
		.map((message) => ({ ...message, content: message.content.slice(0, 4000) }));
	while (history.reduce((length, message) => length + message.content.length, 0) > 20_000)
		history.shift();
	return history;
}

export async function* readChatStream(response: Response): AsyncGenerator<string> {
	if (!response.ok || !response.headers.get('content-type')?.includes('application/x-ndjson')) {
		const body = await response.json().catch(() => null);
		if (response.ok && typeof body?.answer === 'string' && body.answer.trim()) {
			yield body.answer;
			return;
		}
		throw new Error(body?.message || '답변을 받지 못했습니다. 다시 시도해 주세요.');
	}
	if (!response.body) throw new Error('답변 연결을 열지 못했습니다.');
	const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
	let buffer = '';
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) throw new Error('답변 연결이 중간에 끊겼습니다. 다시 질문해 주세요.');
			buffer += value;
			let end: number;
			while ((end = buffer.indexOf('\n')) >= 0) {
				const line = buffer.slice(0, end).trim();
				buffer = buffer.slice(end + 1);
				if (!line) continue;
				const event = JSON.parse(line);
				if (event?.type === 'done') return;
				if (event?.type === 'error')
					throw new Error(
						typeof event.message === 'string' ? event.message : '답변을 생성하지 못했습니다.'
					);
				if (event?.type !== 'delta' || typeof event.text !== 'string')
					throw new Error('답변 형식을 읽지 못했습니다.');
				yield event.text;
			}
		}
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}
