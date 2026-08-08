import { OcrResponseSchema, type OcrResponse } from '$lib/domain';
import { GoogleGenAI, MediaResolution, ThinkingLevel, createPartFromBase64 } from '@google/genai';
import { getVertexConfig } from './config';
import { OCR_JSON_SCHEMA, OCR_SYSTEM_INSTRUCTION, buildOcrUserInstruction } from './ocr-prompt';

export interface OcrProvider {
	extract(image: Buffer, targetEntries?: number): Promise<OcrResponse>;
}

export async function mapWithConcurrency<T, R>(
	values: readonly T[],
	limit: number,
	mapper: (value: T, index: number) => Promise<R>
) {
	if (!Number.isInteger(limit) || limit < 1) throw new Error('Concurrency limit must be positive.');
	const results = new Array<R>(values.length);
	let nextIndex = 0;
	let failureIndex = Number.POSITIVE_INFINITY;
	let failureError: unknown;

	const worker = async () => {
		while (true) {
			const index = nextIndex++;
			if (index >= values.length || failureIndex !== Number.POSITIVE_INFINITY) return;
			try {
				results[index] = await mapper(values[index], index);
			} catch (error) {
				if (index < failureIndex) {
					failureIndex = index;
					failureError = error;
				}
			}
		}
	};

	await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
	if (failureIndex !== Number.POSITIVE_INFINITY) throw failureError;
	return results;
}

export function limitOcrEntries(responses: readonly OcrResponse[], targetEntries?: number) {
	let remaining = targetEntries;
	return responses.map((response) => {
		const entries = [...response.entries].sort(
			(left, right) => left.sourceOrder - right.sourceOrder
		);
		const selected = remaining === undefined ? entries : entries.slice(0, remaining);
		if (remaining !== undefined) remaining -= selected.length;
		return { ...response, entries: selected };
	});
}

function retryable(error: unknown) {
	const status = Number(
		(error as { status?: number; code?: number }).status || (error as { code?: number }).code
	);
	return status === 429 || (status >= 500 && status < 600);
}

export class VertexOcrProvider implements OcrProvider {
	async extract(image: Buffer, targetEntries?: number) {
		const { project, location, model } = getVertexConfig();
		const client = new GoogleGenAI({ vertexai: true, project, location });
		let lastError: unknown;
		for (let attempt = 0; attempt < 3; attempt += 1) {
			try {
				const response = await client.models.generateContent({
					model,
					contents: [
						{
							role: 'user',
							parts: [
								{ text: buildOcrUserInstruction(targetEntries) },
								createPartFromBase64(image.toString('base64'), 'image/jpeg')
							]
						}
					],
					config: {
						systemInstruction: OCR_SYSTEM_INSTRUCTION,
						thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
						mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
						responseMimeType: 'application/json',
						responseJsonSchema: OCR_JSON_SCHEMA,
						temperature: 0.1
					}
				});
				if (!response.text) throw new Error('OCR 응답이 비어 있습니다.');
				const parsed = OcrResponseSchema.parse(JSON.parse(response.text));
				if (!parsed.entries.length) throw new Error('사진에서 단어를 찾지 못했습니다.');
				return {
					entries: [...parsed.entries].sort((left, right) => left.sourceOrder - right.sourceOrder)
				};
			} catch (error) {
				lastError = error;
				if (!retryable(error) || attempt === 2) break;
				await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
			}
		}
		const failure = lastError as {
			name?: string;
			status?: number;
			code?: number;
			message?: string;
		};
		console.error('Vertex OCR request failed:', {
			name: failure?.name,
			status: failure?.status ?? failure?.code,
			message: failure?.name === 'ApiError' ? failure.message : undefined
		});
		throw new Error('단어를 읽지 못했습니다. 잠시 후 다시 시도해 주세요.', { cause: lastError });
	}
}

export const ocrProvider: OcrProvider = new VertexOcrProvider();
