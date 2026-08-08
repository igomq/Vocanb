import sharp from 'sharp';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'heif']);

export async function normalizeUpload(file: File) {
	if (!file.size) throw new Error('빈 이미지입니다.');
	if (file.size > MAX_UPLOAD_BYTES) throw new Error('이미지는 한 장당 20MB 이하여야 합니다.');
	if (file.type && !ALLOWED_MIME.has(file.type.toLowerCase())) {
		throw new Error('JPEG, PNG, WebP 또는 HEIC/HEIF 이미지만 사용할 수 있습니다.');
	}
	const input = Buffer.from(await file.arrayBuffer());
	try {
		const pipeline = sharp(input, { failOn: 'error', limitInputPixels: 40_000_000 });
		const metadata = await pipeline.metadata();
		if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format))
			throw new Error('지원하지 않는 이미지 형식입니다.');
		return await pipeline
			.rotate()
			.resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
			.jpeg({ quality: 90, mozjpeg: true })
			.toBuffer();
	} catch (error) {
		if (file.type === 'image/heic' || file.type === 'image/heif') {
			throw new Error(
				'이 HEIC/HEIF 파일을 읽을 수 없습니다. 기기에서 JPEG로 저장해 다시 시도해 주세요.',
				{
					cause: error
				}
			);
		}
		throw new Error('손상되었거나 지원하지 않는 이미지입니다.', { cause: error });
	}
}
