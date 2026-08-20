import {
	PassageSummarySchema,
	PassageTranslationResponseSchema,
	SentenceImportResponseSchema,
	combineTranslations,
	parseSentenceSegments,
	type PassageSummary,
	type SentenceImportResponse,
	type TranslationItem
} from '$lib/sentence-domain';
import { GoogleGenAI, ThinkingLevel, createPartFromBase64 } from '@google/genai';
import { getVertexConfig } from './config';
import {
	PASSAGE_SUMMARY_SYSTEM_INSTRUCTION,
	PASSAGE_SUMMARY_USER_INSTRUCTION,
	PASSAGE_TRANSLATION_SYSTEM_INSTRUCTION,
	SENTENCE_IMPORT_SYSTEM_INSTRUCTION,
	SENTENCE_IMPORT_USER_INSTRUCTION,
	buildPassageTranslationUserInstruction
} from './sentence-prompts';

export const SENTENCE_IMPORT_TIMEOUT_MS = 120_000;
export const SENTENCE_TEXT_TIMEOUT_MS = 60_000;

export const SENTENCE_IMPORT_JSON_SCHEMA = {
	type: 'object',
	required: ['passages'],
	properties: {
		passages: {
			type: 'array',
			items: {
				type: 'object',
				required: ['sourceOrder', 'label', 'sourcePageStart', 'sourcePageEnd', 'paragraphs'],
				properties: {
					sourceOrder: { type: 'integer' },
					label: { type: 'string' },
					sourcePageStart: { type: 'integer' },
					sourcePageEnd: { type: 'integer' },
					paragraphs: {
						type: 'array',
						items: {
							type: 'object',
							required: ['runs'],
							properties: {
								runs: {
									type: 'array',
									items: {
										type: 'object',
										required: ['text', 'memorize'],
										properties: {
											text: { type: 'string' },
											memorize: { type: 'boolean' }
										}
									}
								}
							}
						}
					}
				}
			}
		}
	}
} as const;

export const PASSAGE_SUMMARY_JSON_SCHEMA = {
	type: 'object',
	required: ['topic', 'flow', 'takeaway'],
	properties: {
		topic: { type: 'string' },
		flow: { type: 'array', items: { type: 'string' } },
		takeaway: { type: 'string' }
	}
} as const;

export const PASSAGE_TRANSLATION_JSON_SCHEMA = {
	type: 'object',
	required: ['translations'],
	properties: {
		translations: {
			type: 'array',
			items: {
				type: 'object',
				required: ['index', 'korean'],
				properties: {
					index: { type: 'integer' },
					korean: { type: 'string' }
				}
			}
		}
	}
} as const;

export interface SentenceImportProvider {
	extract(pdf: Buffer): Promise<SentenceImportResponse>;
}

function retryable(error: unknown) {
	const status = Number(
		(error as { status?: number; code?: number }).status || (error as { code?: number }).code
	);
	const name = (error as { name?: string }).name;
	return (
		status === 429 ||
		(status >= 500 && status < 600) ||
		name === 'AbortError' ||
		name === 'TimeoutError'
	);
}

type VertexRequest = {
	model: string;
	contents: {
		role: string;
		parts: unknown[];
	}[];
	config: {
		systemInstruction?: string;
		thinkingConfig?: { thinkingLevel: number | string };
		responseMimeType?: string;
		responseJsonSchema?: unknown;
		temperature?: number;
		abortSignal?: AbortSignal;
	};
};

async function generateWithRetry(
	client: GoogleGenAI,
	request: VertexRequest,
	attempts: number,
	timeoutMs: number
) {
	let lastError: unknown;
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		try {
			const response = await client.models.generateContent({
				model: request.model,
				contents: request.contents,
				config: {
					...(request.config as object),
					abortSignal: AbortSignal.timeout(timeoutMs)
				}
			} as never);
			return response;
		} catch (error) {
			lastError = error;
			if (!retryable(error) || attempt === attempts - 1) break;
			await new Promise((resolve) =>
				setTimeout(resolve, 1_000 * 2 ** attempt + Math.random() * 250)
			);
		}
	}
	throw lastError;
}

function describeError(error: unknown) {
	const failure = error as { name?: string; status?: number; code?: number; message?: string };
	return {
		name: failure?.name,
		status: failure?.status ?? failure?.code,
		message: failure?.name === 'ApiError' ? failure.message : undefined
	};
}

export class VertexSentenceImportProvider implements SentenceImportProvider {
	async extract(pdf: Buffer) {
		const { project, location, model } = getVertexConfig();
		const client = new GoogleGenAI({ vertexai: true, project, location });
		let response;
		try {
			response = await generateWithRetry(
				client,
				{
					model,
					contents: [
						{
							role: 'user',
							parts: [
								{ text: SENTENCE_IMPORT_USER_INSTRUCTION },
								createPartFromBase64(pdf.toString('base64'), 'application/pdf')
							]
						}
					],
					config: {
						systemInstruction: SENTENCE_IMPORT_SYSTEM_INSTRUCTION,
						thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
						responseMimeType: 'application/json',
						responseJsonSchema: SENTENCE_IMPORT_JSON_SCHEMA,
						temperature: 0.1
					}
				},
				4,
				SENTENCE_IMPORT_TIMEOUT_MS
			);
		} catch (error) {
			console.error('Sentence PDF analysis request failed:', describeError(error));
			throw new Error('PDF를 분석하지 못했습니다. 잠시 후 다시 시도해 주세요.', { cause: error });
		}
		if (!response.text) throw new Error('PDF를 분석하지 못했습니다. 잠시 후 다시 시도해 주세요.');
		try {
			const parsed = SentenceImportResponseSchema.parse(JSON.parse(response.text));
			if (!parsed.passages.length) throw new Error('PDF에서 지문을 찾지 못했습니다.');
			return parsed;
		} catch (error) {
			console.error('Sentence PDF analysis response validation failed:', describeError(error));
			if (error instanceof Error && error.message === 'PDF에서 지문을 찾지 못했습니다.') {
				throw error;
			}
			throw new Error('PDF를 분석하지 못했습니다. 잠시 후 다시 시도해 주세요.', { cause: error });
		}
	}
}

export const sentenceImportProvider: SentenceImportProvider = new VertexSentenceImportProvider();

export async function generatePassageSummary(text: string): Promise<PassageSummary> {
	const { project, location, model } = getVertexConfig();
	const client = new GoogleGenAI({ vertexai: true, project, location });
	try {
		const response = await generateWithRetry(
			client,
			{
				model,
				contents: [
					{
						role: 'user',
						parts: [{ text: PASSAGE_SUMMARY_USER_INSTRUCTION + text }]
					}
				],
				config: {
					systemInstruction: PASSAGE_SUMMARY_SYSTEM_INSTRUCTION,
					responseMimeType: 'application/json',
					responseJsonSchema: PASSAGE_SUMMARY_JSON_SCHEMA,
					temperature: 0.2
				}
			},
			3,
			SENTENCE_TEXT_TIMEOUT_MS
		);
		if (!response.text) throw new Error('정리 응답이 비어 있습니다.');
		return PassageSummarySchema.parse(JSON.parse(response.text));
	} catch (error) {
		if (
			error instanceof Error &&
			/응답이 비어|찾지 못했습니다|읽지 못했습니다/.test(error.message)
		) {
			throw error;
		}
		throw new Error('정리를 생성하지 못했습니다.', { cause: error });
	}
}

export async function generatePassageTranslation(text: string): Promise<TranslationItem[]> {
	const sentences = parseSentenceSegments(text);
	if (!sentences.length) throw new Error('번역할 문장이 없습니다.');
	const sources = sentences.map((english, index) => ({ index, english }));
	const { project, location, model } = getVertexConfig();
	const client = new GoogleGenAI({ vertexai: true, project, location });
	try {
		const response = await generateWithRetry(
			client,
			{
				model,
				contents: [
					{
						role: 'user',
						parts: [{ text: buildPassageTranslationUserInstruction(sources) }]
					}
				],
				config: {
					systemInstruction: PASSAGE_TRANSLATION_SYSTEM_INSTRUCTION,
					responseMimeType: 'application/json',
					responseJsonSchema: PASSAGE_TRANSLATION_JSON_SCHEMA,
					temperature: 0.2
				}
			},
			3,
			SENTENCE_TEXT_TIMEOUT_MS
		);
		if (!response.text) throw new Error('번역 응답이 비어 있습니다.');
		const parsed = PassageTranslationResponseSchema.parse(JSON.parse(response.text));
		return combineTranslations(sources, parsed.translations);
	} catch (error) {
		if (
			error instanceof Error &&
			/응답이 비어|찾지 못했습니다|읽지 못했습니다/.test(error.message)
		) {
			throw error;
		}
		throw new Error('번역을 생성하지 못했습니다.', { cause: error });
	}
}
