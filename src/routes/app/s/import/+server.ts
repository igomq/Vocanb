import { importSentenceBook } from '$lib/server/sentence-import';
import { isRedirect, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ request, locals }) => {
	if (!locals.userId) return json({ message: '로그인이 필요합니다.' }, { status: 401 });
	const userId = locals.userId;
	let heartbeat: ReturnType<typeof setInterval>;
	let disconnected = false;
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			const encoder = new TextEncoder();
			const send = (text: string) => {
				if (!disconnected) controller.enqueue(encoder.encode(text));
			};
			// JSON permits whitespace: keep proxies receiving bytes while analysis runs.
			send('\n');
			heartbeat = setInterval(() => send('\n'), 15_000);
			void (async () => {
				try {
					const failure = await importSentenceBook(request, userId);
					send(JSON.stringify({ message: failure.data.message }));
				} catch (error) {
					if (isRedirect(error)) {
						send(JSON.stringify({ location: error.location }));
					} else {
						console.error('Sentence import stream failed:', error);
						send(JSON.stringify({ message: '암기장을 저장하지 못했습니다. 다시 시도해 주세요.' }));
					}
				} finally {
					clearInterval(heartbeat);
					if (!disconnected) controller.close();
				}
			})();
		},
		cancel() {
			disconnected = true;
			clearInterval(heartbeat);
			// Finish saving even if the browser loses its connection.
		}
	});
	return new Response(body, {
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			'Cache-Control': 'no-store, no-transform',
			'X-Accel-Buffering': 'no'
		}
	});
};
