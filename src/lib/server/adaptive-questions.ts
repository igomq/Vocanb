import { applyAiPrompts, type QueueItem } from '$lib/learning';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { getVertexConfig } from './config';

export const ADAPTIVE_AI_TIMEOUT_MS = 8_000;

export const ADAPTIVE_QUESTION_JSON_SCHEMA = {
	type: 'object',
	required: ['items'],
	properties: {
		items: {
			type: 'array',
			items: {
				type: 'object',
				required: ['itemId', 'type', 'prompt', 'answer'],
				properties: {
					itemId: { type: 'string' },
					type: { type: 'string' },
					prompt: { type: 'string' },
					answer: { type: 'string' },
					choices: { type: 'array', items: { type: 'string' } }
				}
			}
		}
	}
} as const;

const SYSTEM = `You write short English-learning prompts. The answer for each item MUST be the supplied English word exactly. Never invent a different correct answer. You may only write context sentences or wrong distractors. Return JSON.`;

export function adaptiveAiEnabled() {
	return Boolean((process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim());
}

export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timer = setTimeout(() => {
					const error = new Error('timeout');
					error.name = 'TimeoutError';
					reject(error);
				}, ms);
			})
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

export type AdaptiveQuestionGenerator = (
	words: { id: string; english: string; meaning: string }[]
) => Promise<unknown>;

export async function vertexGenerateAdaptiveQuestions(
	words: { id: string; english: string; meaning: string }[]
) {
	const { project, location, model } = getVertexConfig();
	const client = new GoogleGenAI({ vertexai: true, project, location });
	const response = await client.models.generateContent({
		model,
		contents: [
			{
				role: 'user',
				parts: [
					{
						text:
							'Create at most one prompt per word. Types: cloze, choice, compare, ko-to-en, form. ' +
							'The answer field must equal the given english word. Cloze prompts must contain ___.\n' +
							JSON.stringify(words)
					}
				]
			}
		],
		config: {
			systemInstruction: SYSTEM,
			thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
			responseMimeType: 'application/json',
			responseJsonSchema: ADAPTIVE_QUESTION_JSON_SCHEMA,
			temperature: 0.2,
			abortSignal: AbortSignal.timeout(ADAPTIVE_AI_TIMEOUT_MS)
		}
	});
	if (!response.text) throw new Error('empty');
	return JSON.parse(response.text);
}

export async function enrichQueueWithAi(
	items: QueueItem[],
	generate?: AdaptiveQuestionGenerator,
	options?: { timeoutMs?: number; enabled?: boolean }
): Promise<QueueItem[]> {
	if (!items.length) return items;
	const enabled = options?.enabled ?? (Boolean(generate) || adaptiveAiEnabled());
	if (!enabled) return items;
	const runner = generate ?? vertexGenerateAdaptiveQuestions;
	const slice = items.slice(0, 8);
	try {
		const payload = await withTimeout(
			runner(
				slice.map((item) => ({
					id: item.itemId,
					english: item.english,
					meaning: item.meaning
				}))
			),
			options?.timeoutMs ?? ADAPTIVE_AI_TIMEOUT_MS
		);
		return [...applyAiPrompts(slice, payload), ...items.slice(8)];
	} catch (error) {
		console.error('Adaptive question generation failed; using fallback prompts.', error);
		return items;
	}
}
