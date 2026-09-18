import { describe, expect, it } from 'vitest';
import { chatHistory, readChatStream } from './chat-stream';
import { renderChatMarkdown } from './chat-markdown';

function response(text: string) {
	const bytes = new TextEncoder().encode(text);
	return new Response(
		new ReadableStream({
			start(controller) {
				// Split every UTF-8 character and every JSON frame across network chunks.
				for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
				controller.close();
			}
		}),
		{ headers: { 'content-type': 'application/x-ndjson' } }
	);
}

describe('chat stream', () => {
	it('decodes split Korean text, blank heartbeats, and a completion event', async () => {
		const chunks = [];
		for await (const text of readChatStream(
			response(
				'\n{"type":"delta","text":"**뜻**"}\n{"type":"delta","text":"\\n예문"}\n{"type":"done"}\n'
			)
		))
			chunks.push(text);
		expect(chunks).toEqual(['**뜻**', '\n예문']);
	});

	it.each([
		['{"type":"delta","text":"partial"}\n', '연결이 중간에 끊겼습니다'],
		['{"type":"error","message":"다시 질문"}\n', '다시 질문']
	])('rejects incomplete or failed streams', async (text, message) => {
		const consume = async () => {
			for await (const chunk of readChatStream(response(text))) void chunk;
		};
		await expect(consume()).rejects.toThrow(message);
	});

	it('supports the existing JSON response and bounds long conversation history', async () => {
		const reader = readChatStream(Response.json({ answer: '기존 답변' }));
		expect((await reader.next()).value).toBe('기존 답변');
		const messages = Array.from({ length: 25 }, () => ({
			role: 'assistant' as const,
			content: 'a'.repeat(5000)
		}));
		const history = chatHistory([...messages, { role: 'user', content: '후속 질문' }]);
		expect(history.at(-1)?.content).toBe('후속 질문');
		expect(history.length).toBeLessThanOrEqual(20);
		expect(history.reduce((length, item) => length + item.content.length, 0)).toBeLessThanOrEqual(
			20_000
		);
		expect(history.every((item) => item.content.length <= 4000)).toBe(true);
		expect(messages[0].content).toHaveLength(5000);
	});
});

it('renders Markdown while escaping HTML and blocking unsafe links', () => {
	const html = renderChatMarkdown(
		'# 제목\n\n**뜻**\n\n- 예문\n\n`code`\n\n```js\nalert(1)\n```\n\n| 단어 | 뜻 |\n| --- | --- |\n| cat | 고양이 |\n\n<script>alert(1)</script>\n\n[위험](javascript:alert(1))\n\n[문서](https://example.com)'
	);
	for (const tag of ['<h1>', '<strong>', '<ul>', '<code>', '<pre>', '<table>'])
		expect(html).toContain(tag);
	expect(html).not.toContain('<script>');
	expect(html).not.toContain('href="javascript:');
	expect(html).toContain('href="https://example.com"');
});
