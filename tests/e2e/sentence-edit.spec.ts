import { expect, test } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

test('corrects sentence text and memorization ranges on desktop and mobile', async ({
	page
}, testInfo) => {
	const dataDir = testInfo.config.webServer?.env?.DATA_DIR;
	if (!dataDir) throw new Error('Missing isolated E2E data directory');
	const userId = `u_${createHash('sha256').update('playwright').digest('hex').slice(0, 32)}`;
	const directory = join(dataDir, 'users', userId, 'sentence-books');
	const bookId = randomUUID();
	const passageId = randomUUID();
	const file = join(directory, `${bookId}.json`);
	const book = {
		schemaVersion: 1,
		id: bookId,
		title: '암기 범위 수정 테스트',
		sourceFileName: 'sample.pdf',
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		passages: [
			{
				id: passageId,
				order: 0,
				label: '긴 지문 제목과 암기 범위 수정',
				sourcePageStart: 1,
				sourcePageEnd: 1,
				paragraphs: [
					{
						runs: [
							{ text: 'Before. ', memorize: false },
							{ text: 'Original target.', memorize: true }
						]
					}
				],
				summary: {
					topic: '저장된 지문 정리',
					flow: ['첫째', '둘째', '셋째'],
					takeaway: '핵심 내용'
				},
				translation: [{ english: 'Before. Original target.', korean: '저장된 지문 번역' }],
				testResults: { '0:1': { status: 'correct' } },
				testResultsRevision: 0
			}
		]
	};
	book.passages.push({ ...book.passages[0], id: randomUUID(), order: 1, label: '두 번째 지문' });
	await mkdir(directory, { recursive: true });
	await writeFile(file, JSON.stringify(book));
	await page.goto('/login');
	await page.getByLabel('아이디').fill('playwright');
	await page.getByLabel('비밀번호').fill('playwright-password');
	await page.getByRole('button', { name: '로그인' }).click();
	await expect(page).toHaveURL(/\/app$/);
	await page.goto(`/app/s/${bookId}`);
	await expect(
		page.getByRole('button', { name: '본문·암기 범위 수정', exact: true })
	).toBeEnabled();
	await page.evaluate(() => {
		const animate = Element.prototype.animate;
		Element.prototype.animate = function (frames, options) {
			if (this.classList.contains('sentence-panel-content')) {
				document.documentElement.dataset.panelMotion = JSON.stringify(frames);
				document.documentElement.dataset.panelMotionCount = String(
					Number(document.documentElement.dataset.panelMotionCount || 0) + 1
				);
			}
			return animate.call(this, frames, options);
		};
	});
	const tab = (name: string) => page.getByRole('tab', { name, exact: true });
	await tab('정리').click();
	await expect(page.locator('.passage-summary-topic')).toHaveText('저장된 지문 정리');
	await expect(page.locator('html')).toHaveAttribute('data-panel-motion', /translateX\(-18px\)/);
	await tab('번역').click();
	await expect(page.locator('.translation-korean')).toHaveText('저장된 지문 번역');
	await expect(page.locator('html')).toHaveAttribute('data-panel-motion', /translateX\(18px\)/);
	await page.screenshot({
		path: testInfo.outputPath('sentence-tabs-desktop.png'),
		fullPage: true,
		animations: 'disabled'
	});
	await page.evaluate(() => {
		(document.querySelectorAll('.sentence-tab')[2] as HTMLButtonElement).click();
		(document.querySelectorAll('.sentence-tab')[1] as HTMLButtonElement).click();
	});
	await expect(tab('본문')).toHaveAttribute('aria-selected', 'true');
	await expect(page.locator('.sentence-panel-content')).toHaveCount(1);
	await expect(page.locator('.memorization-paragraph')).toHaveText('Before. Original target.');
	await page.getByRole('button', { name: '다음 ›', exact: true }).click();
	await expect(page.locator('.sentence-passage-position')).toHaveText('2 / 2');
	await expect(page.locator('html')).toHaveAttribute('data-panel-motion', /translateX\(18px\)/);
	await page.getByRole('button', { name: '‹ 이전', exact: true }).click();
	await expect(page.locator('.sentence-passage-position')).toHaveText('1 / 2');
	await expect(page.locator('html')).toHaveAttribute('data-panel-motion', /translateX\(-18px\)/);
	await page.emulateMedia({ reducedMotion: 'reduce' });
	const motionCount = await page.locator('html').getAttribute('data-panel-motion-count');
	await tab('테스트').click();
	await expect(page.locator('.sentence-test-progress')).toBeVisible();
	await expect(page.locator('html')).toHaveAttribute('data-panel-motion-count', motionCount!);
	await page.getByRole('button', { name: '다음 ›', exact: true }).click();
	await expect(page.locator('.sentence-passage-position')).toHaveText('2 / 2');
	await expect(page.locator('html')).toHaveAttribute('data-panel-motion-count', motionCount!);
	await page.getByRole('button', { name: '‹ 이전', exact: true }).click();
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await page.getByRole('button', { name: '본문·암기 범위 수정', exact: true }).click();
	const field = page.getByLabel('문단 1', { exact: true });
	const restored = 'Before. Missing sentence. Original target.';
	await field.fill(restored);
	await field.evaluate((element: HTMLTextAreaElement) => {
		element.focus();
		element.setSelectionRange(8, 25);
	});
	await page.getByRole('button', { name: '선택 부분 암기', exact: true }).click();
	await expect(page.locator('.range-preview mark').first()).toHaveText('Missing sentence.');
	await expect(page.locator('.range-preview mark').last()).toHaveText('Original target.');
	await page.screenshot({
		path: testInfo.outputPath('sentence-editor-desktop.png'),
		fullPage: true
	});
	await page.getByRole('button', { name: '수정 저장', exact: true }).click();
	await expect(page.getByRole('status')).toHaveText('본문과 암기 범위를 저장했습니다.');
	await page.reload();
	await expect(page.locator('.memorization-paragraph')).toHaveText(restored);
	await expect(
		page.getByRole('button', { name: '가려진 암기 문장 보기', exact: true })
	).toHaveCount(2);
	await page.getByRole('tab', { name: '테스트', exact: true }).click();
	await expect(page.locator('.sentence-test-progress')).toHaveText('0/2 평가');

	await page.setViewportSize({ width: 390, height: 844 });
	await page.getByRole('button', { name: '본문·암기 범위 수정', exact: true }).click();
	await field.evaluate((element: HTMLTextAreaElement) => {
		element.focus();
		element.setSelectionRange(0, element.value.length);
	});
	await page.getByRole('button', { name: '선택 부분 해제', exact: true }).click();
	await expect(page.locator('.range-preview mark')).toHaveCount(0);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true
	);
	await page.screenshot({
		path: testInfo.outputPath('sentence-editor-mobile.png'),
		fullPage: true
	});
	await page.route(`**/app/s/${bookId}/passage`, (route) =>
		route.fulfill({
			status: 503,
			contentType: 'application/json',
			body: JSON.stringify({ message: '저장 실패 테스트' })
		})
	);
	await page.getByRole('button', { name: '수정 저장', exact: true }).click();
	await expect(page.getByRole('alert')).toHaveText('저장 실패 테스트');
	await expect(field).toHaveValue(restored);
	await page.unroute(`**/app/s/${bookId}/passage`);
	await page.getByRole('button', { name: '수정 저장', exact: true }).click();
	await expect(page.getByRole('status')).toHaveText('본문과 암기 범위를 저장했습니다.');
	await page.reload();
	await expect(
		page.getByRole('button', { name: '가려진 암기 문장 보기', exact: true })
	).toHaveCount(0);
	const stored = JSON.parse(await readFile(file, 'utf8'));
	expect(stored.passages[0].paragraphs).toEqual([{ runs: [{ text: restored, memorize: false }] }]);
	await page.getByRole('button', { name: '본문·암기 범위 수정', exact: true }).click();
	await field.fill('Unsaved change.');
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: '취소', exact: true }).click();
	await expect(page.locator('.memorization-paragraph')).toHaveText(restored);
});
