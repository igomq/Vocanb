import { clearSession } from '$lib/server/auth';
import { redirect } from '@sveltejs/kit';

export const POST = ({ cookies }) => {
	clearSession(cookies);
	redirect(303, '/login');
};
