import { describe, expect, it } from 'vitest';
import { handle } from './hooks.server';

describe('route protection', () => {
	it('redirects unauthenticated application requests to login', async () => {
		await expect(
			handle({
				event: {
					url: new URL('http://localhost/app/v/123'),
					locals: {},
					cookies: { get: () => undefined }
				} as never,
				resolve: (() => new Response('ok')) as never
			})
		).rejects.toMatchObject({ status: 303, location: '/login?next=%2Fapp%2Fv%2F123' });
	});
});
