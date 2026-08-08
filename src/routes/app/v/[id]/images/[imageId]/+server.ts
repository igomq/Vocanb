import { getVocabulary, imagePath } from '$lib/server/storage';
import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';

export const GET = async ({ locals, params }) => {
	const vocabulary = await getVocabulary(locals.userId!, params.id);
	const image = vocabulary?.images.find((candidate) => candidate.id === params.imageId);
	if (!image) error(404, '이미지를 찾을 수 없습니다.');
	try {
		return new Response(await readFile(imagePath(locals.userId!, params.id, image.filename)), {
			headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=3600' }
		});
	} catch {
		error(404, '이미지를 읽을 수 없습니다.');
	}
};
