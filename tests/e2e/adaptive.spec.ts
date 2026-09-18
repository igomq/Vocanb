import { expect, test } from '@playwright/test';

async function login(page: import('@playwright/test').Page) {
	await page.goto('/login');
	await page.getByLabel('아이디').fill('playwright');
	await page.getByLabel('비밀번호').fill('playwright-password');
	await page.getByRole('button', { name: '로그인' }).click();
	await expect(page).toHaveURL(/\/app$/);
}

async function createVocabWithWords(page: import('@playwright/test').Page) {
	const title = `Adaptive vocabulary ${Date.now()}`;
	await page.getByRole('button', { name: '학습장 추가', exact: false }).first().click();
	const createDialog = page.locator('dialog[aria-labelledby="study-create-title"]');
	await expect(createDialog).toBeVisible();
	await page.getByRole('button', { name: /사진에서 단어와 뜻을 추출/ }).click();
	await page.getByLabel('단어장 이름').fill(title);
	await page.getByRole('button', { name: '단어장 만들기', exact: true }).last().click();
	await expect(page).toHaveURL(/\/app\/v\/[0-9a-f-]{36}$/);
	for (const [english, meaning] of [
		['apple', '사과'],
		['run', '달리다']
	] as const) {
		await page.getByRole('button', { name: '＋ 단어 추가', exact: true }).click();
		const wordDialog = page.locator('dialog[aria-labelledby="word-dialog-title"]');
		await wordDialog.getByLabel('영어').fill(english);
		await wordDialog.getByLabel('한국어 뜻').fill(meaning);
		await wordDialog.getByRole('button', { name: '단어 추가', exact: true }).click();
		await expect(page.locator('.word-row').filter({ hasText: english })).toBeVisible();
	}
}

async function answerOne(page: import('@playwright/test').Page) {
	const reveal = page.getByRole('button', { name: '정답 보기' });
	const confirm = page.getByRole('button', { name: '확인' });
	const unknown = page.getByRole('button', { name: '모름' });
	const done = page.getByRole('heading', { name: '평가를 모두 마쳤습니다' });
	await expect(reveal.or(confirm).or(unknown).or(done)).toBeVisible();
	if (await done.isVisible()) return 'done';
	if (await reveal.isVisible()) {
		const typed = page.locator('input[name="typedAnswer"]');
		if (await typed.isVisible()) await typed.fill('apple');
		await reveal.click();
		await page.getByRole('button', { name: '맞음', exact: true }).click();
		return 'answered';
	}
	if (await confirm.isVisible()) {
		await page.getByLabel('답').fill('x');
		await confirm.click();
		return 'answered';
	}
	await unknown.click();
	return 'answered';
}

test('recommended learning can be started and completed on mobile and desktop', async ({
	page
}) => {
	await login(page);
	await createVocabWithWords(page);
	await page.goto('/app');
	const dashboard = page.getByRole('region', { name: '추천 학습' });
	await expect(dashboard).toContainText('오늘 추천 학습');
	await dashboard.getByRole('button', { name: '시작' }).click();
	await expect(page).toHaveURL(/\/app\/learn/);

	for (let step = 0; step < 8; step += 1) {
		const status = await answerOne(page);
		if (status === 'done') break;
	}
	await expect(page.getByRole('button', { name: '학습 완료' })).toBeEnabled();
	await page.getByRole('button', { name: '학습 완료' }).click();
	await expect(page).toHaveURL(/learned=1/);
	await expect(page.getByRole('status')).toContainText('추천 학습을 완료했습니다');

	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/app');
	await expect(page.getByRole('region', { name: '추천 학습' })).toBeVisible();
	expect(
		await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
	).toBe(true);
});
