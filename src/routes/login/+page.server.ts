import {
	clearLoginFailures,
	isAppPath,
	loginAllowed,
	recordLoginFailure,
	setSession,
	verifyPassword
} from '$lib/server/auth';
import { getAuthConfig } from '$lib/server/config';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.userId) redirect(303, '/app');
	return {
		next: isAppPath(url.searchParams.get('next')) ? url.searchParams.get('next') : '/app'
	};
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		const key = getClientAddress();
		if (!loginAllowed(key)) return fail(429, { message: '잠시 후 다시 시도해 주세요.' });
		const data = await request.formData();
		const username = String(data.get('username') || '').trim();
		const password = String(data.get('password') || '');
		const next = String(data.get('next') || '/app');
		const config = getAuthConfig();
		const passwordMatches = await verifyPassword(password, config.passwordHash);
		if (username !== config.username || !passwordMatches) {
			recordLoginFailure(key);
			return fail(400, { message: '아이디 또는 비밀번호가 올바르지 않습니다.', username });
		}
		clearLoginFailures(key);
		setSession(cookies, config.userId);
		redirect(303, isAppPath(next) ? next : '/app');
	}
};
