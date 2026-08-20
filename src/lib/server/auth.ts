import { dev } from '$app/environment';
import type { Cookies } from '@sveltejs/kit';
import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { getAuthConfig } from './config';

export const SESSION_COOKIE = 'vocanb_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

type SessionPayload = { sub: string; exp: number; nonce: string };
const attempts = new Map<string, number[]>();

export function isAppPath(value: string | null | undefined): value is string {
	if (typeof value !== 'string' || !value.startsWith('/') || value.includes('\\')) return false;
	try {
		const parsed = new URL(value, 'http://local');
		if (parsed.origin !== 'http://local') return false;
		const segments = parsed.pathname
			.split('/')
			.slice(1)
			.map((segment) => decodeURIComponent(segment));
		if (segments.some((segment) => segment === '.' || segment === '..' || segment.includes('/')))
			return false;
		return parsed.pathname === '/app' || parsed.pathname.startsWith('/app/');
	} catch {
		return false;
	}
}

function scryptAsync(password: string, salt: Buffer, length: number) {
	return new Promise<Buffer>((resolve, reject) => {
		scrypt(password, salt, length, SCRYPT_OPTIONS, (error, key) =>
			error ? reject(error) : resolve(key as Buffer)
		);
	});
}

export async function createPasswordHash(password: string) {
	const salt = randomBytes(16);
	const derived = await scryptAsync(password, salt, 64);
	return `scrypt$${SCRYPT_OPTIONS.N}$${SCRYPT_OPTIONS.r}$${SCRYPT_OPTIONS.p}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, encoded: string) {
	const [algorithm, n, r, p, saltValue, hashValue] = encoded.split('$');
	if (algorithm !== 'scrypt' || !saltValue || !hashValue) return false;
	const optionsMatch =
		Number(n) === SCRYPT_OPTIONS.N &&
		Number(r) === SCRYPT_OPTIONS.r &&
		Number(p) === SCRYPT_OPTIONS.p;
	if (!optionsMatch) return false;
	try {
		const expected = Buffer.from(hashValue, 'base64url');
		const actual = await scryptAsync(
			password,
			Buffer.from(saltValue, 'base64url'),
			expected.length
		);
		return expected.length === actual.length && timingSafeEqual(expected, actual);
	} catch {
		return false;
	}
}

function sign(value: string, secret: string) {
	return createHmac('sha256', secret).update(value).digest('base64url');
}

export function createSessionCookie(userId: string, now = Date.now()) {
	const { sessionSecret } = getAuthConfig();
	const payload: SessionPayload = {
		sub: userId,
		exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
		nonce: randomBytes(16).toString('base64url')
	};
	const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
	return `v1.${body}.${sign(`v1.${body}`, sessionSecret)}`;
}

export function verifySessionCookie(cookie: string | undefined, now = Date.now()) {
	if (!cookie) return null;
	const [version, body, signature] = cookie.split('.');
	if (version !== 'v1' || !body || !signature) return null;
	const { sessionSecret, userId } = getAuthConfig();
	const expected = Buffer.from(sign(`${version}.${body}`, sessionSecret));
	const actual = Buffer.from(signature);
	if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
	try {
		const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
		if (payload.sub !== userId || payload.exp <= Math.floor(now / 1000) || !payload.nonce)
			return null;
		return payload.sub;
	} catch {
		return null;
	}
}

export function setSession(cookies: Cookies, userId: string) {
	cookies.set(SESSION_COOKIE, createSessionCookie(userId), {
		path: '/',
		httpOnly: true,
		secure: !dev,
		sameSite: 'lax',
		maxAge: SESSION_TTL_SECONDS
	});
}

export function clearSession(cookies: Cookies) {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}

export function loginAllowed(key: string, now = Date.now()) {
	const cutoff = now - 10 * 60 * 1000;
	const recent = (attempts.get(key) || []).filter((timestamp) => timestamp > cutoff);
	attempts.set(key, recent);
	return recent.length < 5;
}

export function recordLoginFailure(key: string, now = Date.now()) {
	attempts.set(key, [...(attempts.get(key) || []), now]);
}

export function clearLoginFailures(key: string) {
	attempts.delete(key);
}

export function resetRateLimitsForTests() {
	attempts.clear();
}
