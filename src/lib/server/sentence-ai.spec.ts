import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock('@google/genai', async (importOriginal) => ({
	...(await importOriginal<typeof import('@google/genai')>()),
	GoogleGenAI: class {
		models = { generateContent };
	}
}));
vi.mock('./config', () => ({
	getVertexConfig: () => ({ project: 'test', location: 'global', model: 'gemini-3.8-flash' })
}));

import {
	SENTENCE_IMPORT_TIMEOUT_MS,
	VertexSentenceImportProvider,
	generatePassageChatAnswer
} from './sentence-ai';

const imported = {
	passages: [
		{
			sourceOrder: 1,
			label: 'Passage',
			sourcePageStart: 1,
			sourcePageEnd: 1,
			paragraphs: [{ runs: [{ text: 'Hello world.', memorize: true }] }]
		}
	]
};

beforeEach(() => {
	vi.useFakeTimers();
	generateContent.mockReset();
	vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

it('sends vocabulary and analysis follow-ups with a tutoring policy instead of passage-only refusal', async () => {
	generateContent.mockResolvedValue({
		text: '  여기서 to study는 목적을 나타내는 부사적 용법입니다.  '
	});
	const passage = 'She went to the library to study.';
	const messages = [
		{ role: 'user' as const, content: '지문에 없는 resilient 뜻도 알려줘.' },
		{ role: 'assistant' as const, content: '회복력이 있는, 잘 견디는이라는 뜻입니다.' },
		{ role: 'user' as const, content: 'to study가 명사적 용법이라는 내 분석이 맞아?' }
	];
	expect(await generatePassageChatAnswer(passage, messages)).toBe(
		'여기서 to study는 목적을 나타내는 부사적 용법입니다.'
	);
	const request = generateContent.mock.calls[0][0];
	expect(
		request.contents.map((message: { parts: { text: string }[] }) => message.parts[0].text)
	).toEqual(messages.map((message) => message.content));
	expect(request.config.systemInstruction).toContain('using your general knowledge');
	expect(request.config.systemInstruction).toContain('correct mistakes');
	expect(request.config.systemInstruction).toContain(JSON.stringify(passage));
	expect(request.config.systemInstruction).not.toContain('reply exactly');
	expect(request.config.systemInstruction).not.toContain('이 지문에서 확인할 수 없는 내용입니다.');
});

describe('PDF analysis request deadlines', () => {
	it('allows a PDF response after the previous two-minute cutoff', async () => {
		vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
			const controller = new AbortController();
			setTimeout(() => controller.abort(new DOMException('Deadline exceeded', 'TimeoutError')), ms);
			return controller.signal;
		});
		generateContent.mockImplementation(
			({ config }) =>
				new Promise((resolve, reject) => {
					config.abortSignal.addEventListener('abort', () => reject(config.abortSignal.reason));
					setTimeout(() => resolve({ text: JSON.stringify(imported) }), 180_000);
				})
		);
		const result = new VertexSentenceImportProvider().extract(Buffer.from('%PDF-1.4'));
		await vi.advanceTimersByTimeAsync(180_000);
		expect(await result).toEqual(imported);
		expect(generateContent).toHaveBeenCalledTimes(1);
		expect(generateContent.mock.calls[0][0].config.httpOptions.retryOptions.attempts).toBe(1);
	});

	it('uses a fresh deadline on retry and preserves SDK-masked timeout causes', async () => {
		const signals: AbortSignal[] = [];
		vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
			const controller = new AbortController();
			signals.push(controller.signal);
			setTimeout(
				() => controller.abort(new DOMException('Analysis deadline exceeded', 'TimeoutError')),
				ms
			);
			return controller.signal;
		});
		generateContent.mockImplementation(
			({ config }) =>
				new Promise((_resolve, reject) => {
					config.abortSignal.addEventListener('abort', () =>
						reject(new DOMException('This operation was aborted', 'AbortError'))
					);
				})
		);
		const result = new VertexSentenceImportProvider()
			.extract(Buffer.from('%PDF-1.4'))
			.catch((error) => error);
		await vi.advanceTimersByTimeAsync(SENTENCE_IMPORT_TIMEOUT_MS * 2 + 2_000);
		const error = await result;
		expect(error.message).toContain('PDF 분석 시간이 초과되었습니다');
		expect(error.cause.name).toBe('TimeoutError');
		expect(generateContent).toHaveBeenCalledTimes(2);
		expect(signals[0]).not.toBe(signals[1]);
	});

	it('does not retry permanent provider failures', async () => {
		const cause = Object.assign(new Error('Forbidden'), { status: 403 });
		generateContent.mockRejectedValue(cause);
		await expect(
			new VertexSentenceImportProvider().extract(Buffer.from('%PDF-1.4'))
		).rejects.toMatchObject({ cause });
		expect(generateContent).toHaveBeenCalledTimes(1);
	});
});
