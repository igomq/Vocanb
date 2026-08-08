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

export const handleError: HandleServerError = ({ error }) => {
	console.error(
		'Unhandled server error:',
		error instanceof Error ? error.message : 'unknown error'
	);
	return { message: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
};
