import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

function required(name: string) {
	const value = (process.env[name] || env[name])?.trim();
	if (!value) throw new Error(`${name} 환경 변수가 필요합니다.`);
	return value;
}

export function getAuthConfig() {
	const sessionSecret = required('SESSION_SECRET');
	if (sessionSecret.length < 32) throw new Error('SESSION_SECRET은 32자 이상이어야 합니다.');
	const username = required('AUTH_USERNAME');
	return {
		username,
		passwordHash: required('AUTH_PASSWORD_HASH'),
		sessionSecret,
		userId: `u_${createHash('sha256').update(username).digest('hex').slice(0, 32)}`
	};
}

export function getDataDir() {
	const configured = (process.env.DATA_DIR || env.DATA_DIR)?.trim();
	if (!configured && !dev) throw new Error('production에서는 DATA_DIR이 필요합니다.');
	return resolve(configured || './data');
}

export function getVertexConfig() {
	const location =
		(process.env.GOOGLE_CLOUD_LOCATION || env.GOOGLE_CLOUD_LOCATION)?.trim() || 'global';
	const model = (process.env.VERTEX_MODEL || env.VERTEX_MODEL)?.trim() || 'gemini-3.6-flash';
	if (location !== 'global') throw new Error('GOOGLE_CLOUD_LOCATION은 global이어야 합니다.');
	if (model !== 'gemini-3.6-flash') throw new Error('VERTEX_MODEL은 gemini-3.6-flash여야 합니다.');
	return { project: required('GOOGLE_CLOUD_PROJECT'), location, model };
}
