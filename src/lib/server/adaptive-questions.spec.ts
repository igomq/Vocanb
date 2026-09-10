import { describe, expect, it } from 'vitest';
import { emptyState, toQueueItem, wordKey, type QueueItem } from '$lib/learning';
import { enrichQueueWithAi, withTimeout } from './adaptive-questions';

const SOURCE = '10000000-0000-4000-8000-000000000001';
const WORD = '00000000-0000-4000-8000-000000000002';

function item(): QueueItem {
	return toQueueItem(
		{
			key: wordKey(SOURCE, WORD),
			kind: 'word',
			sourceId: SOURCE,
			sourceTitle: 't',
			itemId: WORD,
			english: 'adopt',
			meaning: '채택하다',
			state: emptyState('2026-09-09T15:00:00.000Z'),
			score: 1,
			reasons: [{ code: 'new' }]
		},
		[]
	);
}

describe('adaptive AI fallback', () => {
	it('keeps deterministic prompts when the model returns malformed JSON-like data', async () => {
		const original = item();
		const result = await enrichQueueWithAi([original], async () => ({
			items: [{ itemId: original.itemId, type: 'cloze', prompt: 'missing blank', answer: 'wrong' }]
		}));
		expect(result[0]).toEqual(original);
	});

	it('falls back when generation times out', async () => {
		const original = item();
		const result = await enrichQueueWithAi([original], () => new Promise(() => undefined), {
			timeoutMs: 20
		});
		expect(result[0]).toEqual(original);
	});

	it('applies a valid cloze that keeps the canonical answer', async () => {
		const original = item();
		const result = await enrichQueueWithAi([original], async () => ({
			items: [
				{
					itemId: original.itemId,
					type: 'cloze',
					prompt: 'They will ___ the plan.',
					answer: 'adopt'
				}
			]
		}));
		expect(result[0].promptKind).toBe('cloze');
		expect(result[0].answer).toBe('adopt');
	});

	it('rejects a hanging timeout helper', async () => {
		await expect(withTimeout(new Promise(() => undefined), 10)).rejects.toMatchObject({
			name: 'TimeoutError'
		});
	});
});
