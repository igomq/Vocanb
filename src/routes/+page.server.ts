import { redirect } from '@sveltejs/kit';

export const load = ({ locals }) => redirect(303, locals.userId ? '/app' : '/login');
