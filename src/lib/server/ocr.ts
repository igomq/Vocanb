import { OcrResponseSchema, type OcrResponse } from '$lib/domain';
import { GoogleGenAI, MediaResolution, ThinkingLevel, createPartFromBase64 } from '@google/genai';
import { getVertexConfig } from './config';
import { OCR_JSON_SCHEMA, OCR_SYSTEM_INSTRUCTION, OCR_USER_INSTRUCTION } from './ocr-prompt';

export interface OcrProvider {
	extract(image: Buffer): Promise<OcrResponse>;
}

function retryable(error: unknown) {
	const status = Number(
		(error as { status?: number; code?: number }).status || (error as { code?: number }).code
	);
	return status === 429 || (status >= 500 && status < 600);
}

export class VertexOcrProvider implements OcrProvider {
	async extract(image: Buffer) {
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
								{ text: OCR_USER_INSTRUCTION },
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
		throw new Error('단어를 읽지 못했습니다. 잠시 후 다시 시도해 주세요.', { cause: lastError });
	}
}

export const ocrProvider: OcrProvider = new VertexOcrProvider();
