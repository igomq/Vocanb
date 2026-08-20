import { describe, expect, it, vi } from 'vitest';
import { handle, handleError } from './hooks.server';

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

	it('adds browser security headers to public responses', async () => {
		const response = await handle({
			event: {
				url: new URL('http://localhost/login'),
				locals: {},
				cookies: { get: () => undefined }
			} as never,
			resolve: (() => new Response('ok')) as never
		});

		expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
	});
});

describe('server error logging', () => {
	it('logs request context and the original error without exposing it to the user', () => {
		const error = new Error('disk failed');
		const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		expect(
			handleError({
				error,
				event: {
					request: new Request('http://localhost/app/v/123?/upload', {
						method: 'POST',
						headers: { 'cf-ray': 'test-ray' }
					}),
					url: new URL('http://localhost/app/v/123?/upload'),
					route: { id: '/app/v/[id]' }
				},
				status: 500,
				message: 'Internal Error'
			} as never)
		).toEqual({ message: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
		expect(logged).toHaveBeenCalledWith(
			'Unhandled server error:',
			{
				method: 'POST',
				path: '/app/v/123',
				route: '/app/v/[id]',
				status: 500,
				message: 'Internal Error',
				requestId: 'test-ray'
			},
			error
		);
		logged.mockRestore();
	});
});
