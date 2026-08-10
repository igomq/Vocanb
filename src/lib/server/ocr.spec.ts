import { OcrResponseSchema } from '$lib/domain';
import { describe, expect, it } from 'vitest';
import { mapWithConcurrency, type OcrProvider } from './ocr';
import { OCR_JSON_SCHEMA, buildOcrUserInstruction } from './ocr-prompt';

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

	it('keeps the Vertex response schema structural and leaves strict validation to Zod', () => {
		const schema = JSON.stringify(OCR_JSON_SCHEMA);
		expect(schema).not.toMatch(/additionalProperties|minLength|maxItems|minimum|printedNumber/);
	});

	it('guides a soft target without asking OCR to invent entries', () => {
		const instruction = buildOcrUserInstruction(3);
		expect(instruction).toContain('3 entries');
		expect(instruction).toMatch(/Never invent/);
		expect(instruction).toMatch(/return fewer/);
	});

	it('prioritizes prominent headwords and gates secondary words on a target', () => {
		expect(buildOcrUserInstruction()).toMatch(/visually prominent main English headwords/);
		expect(buildOcrUserInstruction()).toMatch(/Ignore small incidental words, fragments/);
		const targeted = buildOcrUserInstruction(3);
		expect(targeted).toMatch(/prominent headwords alone do not reach the target/);
		expect(targeted).toMatch(/complete printed vocabulary entry/);
		expect(targeted).toMatch(/Never use fragments or incidental text/);
		expect(targeted).toMatch(/hard maximum target/);
	});

	it('bounds concurrent OCR work and preserves input order', async () => {
		let active = 0;
		let maximum = 0;
		const output = await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
			active += 1;
			maximum = Math.max(maximum, active);
			await new Promise((resolve) => setTimeout(resolve, (5 - value) * 2));
			active -= 1;
			return value * 10;
		});
		expect(maximum).toBe(2);
		expect(output).toEqual([10, 20, 30, 40]);
	});
});
