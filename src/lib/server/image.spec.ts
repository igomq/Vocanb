import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { normalizeUpload } from './image';

describe('image normalization', () => {
	it('normalizes an allowed image and rejects an unexpected MIME type', async () => {
		const input = await sharp({
			create: { width: 20, height: 10, channels: 3, background: '#ffffff' }
		})
			.png()
			.toBuffer();
		const output = await normalizeUpload(new File([input], 'page.png', { type: 'image/png' }));
		expect((await sharp(output).metadata()).format).toBe('jpeg');
		await expect(
			normalizeUpload(new File([input], 'page.gif', { type: 'image/gif' }))
		).rejects.toThrow('JPEG');
	});
});
