import { SESSION_COOKIE, verifySessionCookie } from '$lib/server/auth';
import { redirect, type Handle, type HandleServerError } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.userId = verifySessionCookie(event.cookies.get(SESSION_COOKIE));
	if (event.url.pathname.startsWith('/app') && !event.locals.userId) {
		const next = `${event.url.pathname}${event.url.search}`;
		redirect(303, `/login?next=${encodeURIComponent(next)}`);
	}
	return resolve(event);
};

export const handleError: HandleServerError = ({ error, event, status, message }) => {
	console.error(
		'Unhandled server error:',
		{
			method: event.request.method,
			path: event.url.pathname,
			route: event.route.id,
			status,
			message,
			requestId:
				event.request.headers.get('cf-ray') ??
				event.request.headers.get('x-request-id') ??
				undefined
		},
		error
	);
	return { message: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
};
