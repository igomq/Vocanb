import { json } from '@sveltejs/kit';

export const GET = () => json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
