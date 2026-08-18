import { isAppPath, SESSION_COOKIE, verifySessionCookie } from '$lib/server/auth';
import { dev } from '$app/environment';
import { redirect, type Handle, type HandleServerError } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.userId = verifySessionCookie(event.cookies.get(SESSION_COOKIE));
	if (isAppPath(event.url.pathname) && !event.locals.userId) {
		const next = `${event.url.pathname}${event.url.search}`;
		redirect(303, `/login?next=${encodeURIComponent(next)}`);
	}
	const response = await resolve(event);
	response.headers.set(
		'Content-Security-Policy',
		"default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'"
	);
	response.headers.set('X-Content-Type-Options', 'nosniff');
	if (!dev)
		response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	return response;
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
