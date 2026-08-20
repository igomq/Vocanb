import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const e2eDataDir = join(tmpdir(), `vocanb-e2e-${process.pid}-${Date.now()}`);

export default defineConfig({
	testDir: './tests/e2e',
	testMatch: /.*\.spec\.ts/,
	timeout: 90_000,
	fullyParallel: false,
	workers: 1,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? 'github' : 'list',
	use: { baseURL: 'http://127.0.0.1:4173' },
	webServer: {
		command: 'pnpm --config.engine-strict=false dev --host 127.0.0.1 --port 4173',
		url: 'http://127.0.0.1:4173/login',
		timeout: 120_000,
		reuseExistingServer: false,
		env: {
			DATA_DIR: e2eDataDir,
			ORIGIN: 'http://127.0.0.1:4173',
			AUTH_USERNAME: 'playwright',
			AUTH_PASSWORD_HASH:
				'scrypt$16384$8$1$cGxheXdyaWdodC10ZXN0LXNhbHQ$6ATUCqdp_fXNmjQVWAVVm-ydkiF8bjLqnFpnCk-lAApjMamZMkfG1uTpQDPsJqN3WZ_kLfzmACkIQlAtDY7nyA',
			SESSION_SECRET: 'playwright-session-secret-012345678901234567890123',
			GOOGLE_CLOUD_PROJECT: 'unused-in-smoke',
			GOOGLE_CLOUD_LOCATION: 'global',
			VERTEX_MODEL: 'gemini-3.7-flash'
		}
	},
	outputDir: 'test-results'
});
