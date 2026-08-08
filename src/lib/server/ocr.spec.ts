import { OcrResponseSchema } from '$lib/domain';
import { describe, expect, it } from 'vitest';
import type { OcrProvider } from './ocr';

describe('OCR provider boundary', () => {
	it('accepts a mocked provider without Vertex credentials', async () => {
		const provider: OcrProvider = {
			extract: async () =>
				OcrResponseSchema.parse({
					entries: [
						{ sourceOrder: 1, english: 'abandon', meaning: '버리다, 포기하다', uncertain: false }
					]
				})
		};
		expect(await provider.extract(Buffer.from('mock'))).toHaveProperty(
			'entries.0.english',
			'abandon'
		);
	});
});
