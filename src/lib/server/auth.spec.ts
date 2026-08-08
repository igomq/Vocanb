import {
	createPasswordHash,
	createSessionCookie,
	loginAllowed,
	recordLoginFailure,
	resetRateLimitsForTests,
	verifyPassword,
	verifySessionCookie
} from './auth';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

beforeAll(async () => {
	process.env.AUTH_USERNAME = 'test';
	process.env.SESSION_SECRET = 'test-session-secret-with-at-least-32-characters';
	process.env.AUTH_PASSWORD_HASH = await createPasswordHash('correct horse battery staple');
});

beforeEach(() => resetRateLimitsForTests());

describe('authentication', () => {
	it('accepts the correct password and rejects a wrong password', async () => {
		expect(
			await verifyPassword('correct horse battery staple', process.env.AUTH_PASSWORD_HASH!)
		).toBe(true);
		expect(await verifyPassword('wrong', process.env.AUTH_PASSWORD_HASH!)).toBe(false);
	});

	it('verifies signed sessions and rejects tampered or expired sessions', () => {
		const userId = 'u_9f86d081884c7d659a2feaa0c55ad015';
		const cookie = createSessionCookie(userId, 1_000_000);
		expect(verifySessionCookie(cookie, 1_001_000)).toBe(userId);
		expect(verifySessionCookie(`${cookie}x`, 1_001_000)).toBeNull();
		expect(verifySessionCookie(cookie, 1_000_000 + 8 * 24 * 60 * 60 * 1000)).toBeNull();
	});

	it('limits repeated login failures', () => {
		for (let index = 0; index < 5; index += 1) recordLoginFailure('127.0.0.1', index);
		expect(loginAllowed('127.0.0.1', 100)).toBe(false);
	});
});
