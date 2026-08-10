import { expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test('covers the core vocabulary flow without Vertex', async ({ page }) => {
	const title = `Playwright vocabulary ${Date.now()}`;
	await page.goto('/login');
	await page.getByLabel('아이디').fill('playwright');
	await page.getByLabel('비밀번호').fill('playwright-password');
	await page.getByRole('button', { name: '로그인' }).click();
	await expect(page).toHaveURL(/\/app$/);

	await page.getByRole('button', { name: '단어장 만들기', exact: true }).click();
	await expect(page).toHaveURL(/\/app\?create=1$/);
	await expect(page.locator('dialog[aria-labelledby="create-title"]')).toBeVisible();
	await page.getByLabel('단어장 이름').fill(title);
	await page.getByRole('button', { name: '단어장 만들기', exact: true }).last().click();
	await expect(page).toHaveURL(/\/app\/v\/[0-9a-f-]{36}$/);
	const vocabularyId = new URL(page.url()).pathname.split('/').at(-1)!;

	const invalidImage = {
		name: 'invalid.jpg',
		mimeType: 'image/jpeg',
		buffer: Buffer.from('not an image')
	};
	const progressDialog = page.locator('dialog[aria-labelledby="ocr-progress-title"]');

	let releaseUpload!: () => void;
	const uploadHeld = new Promise<void>((resolve) => (releaseUpload = resolve));
	let resolveUploadIntercepted!: () => void;
	const uploadIntercepted = new Promise<void>((resolve) => (resolveUploadIntercepted = resolve));
	const uploadPath = new URL(page.url()).pathname;
	const uploadRoute = `**${uploadPath}**`;
	await page.route(uploadRoute, async (route) => {
		const request = route.request();
		const requestUrl = new URL(request.url());
		if (
			request.method() === 'POST' &&
			requestUrl.pathname === uploadPath &&
			requestUrl.searchParams.has('/upload')
		) {
			resolveUploadIntercepted();
			await uploadHeld;
			await route.continue();
			return;
		}
		await route.fallback();
	});
	try {
		await page.locator('#photo-upload').setInputFiles(invalidImage);
		await page.getByRole('button', { name: '사진 분석' }).click();
		await uploadIntercepted;
		await expect(progressDialog).toBeVisible();
		await expect(page.locator('#ocr-progress-description')).toContainText(
			'1장의 사진에서 단어를 읽고 저장하는 중'
		);
		const pendingUrl = page.url();
		await page.goBack({ timeout: 2_000 }).catch(() => undefined);
		await expect(page).toHaveURL(pendingUrl);
	} finally {
		releaseUpload();
	}
	await expect(page.locator('.message-error').last()).toContainText(
		/손상되었거나|분석 연결이 중단되었습니다/
	);
	await page.unroute(uploadRoute);
	await progressDialog.getByRole('button', { name: '닫기' }).click();

	await page.getByRole('button', { name: '＋ 단어 추가', exact: true }).click();
	const wordDialog = page.locator('dialog[aria-labelledby="word-dialog-title"]');
	await wordDialog.getByLabel('영어').fill('apple');
	await wordDialog.getByLabel('한국어 뜻').fill('사과');
	await wordDialog.getByLabel(/품사/).fill('명');
	await wordDialog.getByRole('button', { name: '단어 추가', exact: true }).click();
	await expect(page.locator('.word-row').filter({ hasText: 'apple' })).toContainText('명');
	await page.getByRole('button', { name: '＋ 단어 추가', exact: true }).click();
	await wordDialog.getByLabel('영어').fill('run');
	await wordDialog.getByLabel('한국어 뜻').fill('달리다');
	await wordDialog.getByLabel(/품사/).fill('동');
	await wordDialog.getByRole('button', { name: '단어 추가', exact: true }).click();

	await page.getByRole('button', { name: '테스트', exact: true }).first().click();
	const testDialog = page.locator('dialog[aria-labelledby="test-settings-title"]');
	await testDialog.getByLabel('한국어 → 영어').check();
	await testDialog.getByRole('button', { name: '테스트 시작' }).click();
	await expect(page).toHaveURL(/\/test\/[0-9a-f-]{36}$/);
	const reverseRows = page.locator('.test-row');
	await expect(reverseRows.nth(0).locator('.test-prompt .part-of-speech')).toHaveText('명');
	await reverseRows.nth(0).getByRole('button', { name: '정답 보기' }).click();
	await expect(reverseRows.nth(0).locator('.answer-text .part-of-speech')).toHaveCount(0);
	await reverseRows.nth(0).getByRole('button', { name: '맞음', exact: true }).click();
	await reverseRows.nth(1).getByRole('button', { name: '정답 보기' }).click();
	await reverseRows.nth(1).getByRole('button', { name: '맞음', exact: true }).click();
	await page.getByRole('button', { name: '테스트 완료' }).click();
	await expect(page).toHaveURL(new RegExp(`/app/v/${vocabularyId}\\?completed=1$`));

	await page.getByRole('button', { name: '테스트', exact: true }).first().click();
	await testDialog.getByLabel('영어 → 한국어').check();
	await testDialog.getByRole('button', { name: '테스트 시작' }).click();
	const forwardRows = page.locator('.test-row');
	await expect(forwardRows.nth(0).locator('.test-prompt .part-of-speech')).toHaveCount(0);
	await forwardRows.nth(0).getByRole('button', { name: '정답 보기' }).click();
	await expect(forwardRows.nth(0).locator('.answer-text .part-of-speech')).toHaveText('명');
	const correct = forwardRows.nth(0).locator('button[value="correct"]');
	await correct.click();
	await expect(correct).toHaveClass(/is-selected/);
	await forwardRows.nth(1).getByRole('button', { name: '정답 보기' }).click();
	await forwardRows.nth(1).getByRole('button', { name: '틀림', exact: true }).click();
	await page.getByRole('button', { name: '테스트 완료' }).click();
	await expect(page).toHaveURL(new RegExp(`/app/v/${vocabularyId}\\?completed=1$`));

	await page.getByRole('button', { name: '테스트', exact: true }).first().click();
	await testDialog.getByLabel('최근 결과 선택').check();
	await testDialog.getByLabel('틀린 단어').check();
	await testDialog.getByRole('button', { name: '테스트 시작' }).click();
	await expect(page).toHaveURL(/\/test\/[0-9a-f-]{36}$/);
	const recentResultRows = page.locator('.test-row');
	await expect(recentResultRows).toHaveCount(1);
	await expect(recentResultRows.first().locator('.test-prompt')).toHaveText('run');
	await page.getByRole('button', { name: '나가기' }).click();
	await page.getByRole('link', { name: '나가기' }).click();
	await expect(page).toHaveURL(new RegExp(`/app/v/${vocabularyId}$`));

	await page.getByRole('button', { name: '연속 학습', exact: true }).click();
	const continuousDialog = page.locator('dialog[aria-labelledby="continuous-settings-title"]');
	await continuousDialog.getByLabel('한 묶음 단어 수').fill('1');
	await continuousDialog.getByLabel('하루 누적 단어 수').fill('2');
	await continuousDialog.getByLabel('목록 (최대 5개)').check();
	await continuousDialog.getByRole('button', { name: '연속 학습 시작' }).click();
	await expect(page.locator('.study-word-list')).toBeVisible();
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: '연속 학습 취소' }).click();
	await page.waitForLoadState('networkidle');
	await expect(page.getByRole('button', { name: '연속 학습', exact: true })).toBeVisible();
	await page.getByRole('button', { name: '연속 학습', exact: true }).click();
	await continuousDialog.getByLabel('한 묶음 단어 수').fill('1');
	await continuousDialog.getByLabel('하루 누적 단어 수').fill('2');
	await continuousDialog.getByLabel('목록 (최대 5개)').check();
	await continuousDialog.getByRole('button', { name: '연속 학습 시작' }).click();

	await expect(page.getByRole('heading', { name: '이번 묶음 암기' })).toBeVisible();
	await expect(page.locator('.study-word-list')).toBeVisible();
	await page.getByRole('button', { name: '이 범위 테스트하기' }).click();
	await testDialog.getByRole('button', { name: '테스트 시작' }).click();
	await expect(page).toHaveURL(/\/test\/[0-9a-f-]{36}$/);
	let rows = page.locator('.test-row');
	await expect(rows).toHaveCount(1);
	await rows.nth(0).getByRole('button', { name: '정답 보기' }).click();
	await rows.nth(0).getByRole('button', { name: '맞음', exact: true }).click();
	await page.getByRole('button', { name: '테스트 완료' }).click();
	await expect(page).toHaveURL(new RegExp(`/app/v/${vocabularyId}\\?continuous=1$`));

	await expect(page.locator('.study-word-list')).toBeVisible();
	await page.getByRole('button', { name: '이 범위 테스트하기' }).click();
	await testDialog.getByRole('button', { name: '테스트 시작' }).click();
	await expect(page).toHaveURL(/\/test\/[0-9a-f-]{36}$/);
	rows = page.locator('.test-row');
	await expect(rows).toHaveCount(1);
	await rows.nth(0).getByRole('button', { name: '정답 보기' }).click();
	await rows.nth(0).getByRole('button', { name: '맞음', exact: true }).click();
	await page.getByRole('button', { name: '테스트 완료' }).click();
	await expect(page).toHaveURL(/\/test\/[0-9a-f-]{36}$/);

	rows = page.locator('.test-row');
	await expect(rows).toHaveCount(2);
	for (let index = 0; index < 2; index += 1) {
		await rows.nth(index).getByRole('button', { name: '정답 보기' }).click();
		await rows.nth(index).getByRole('button', { name: '맞음', exact: true }).click();
	}
	await page.getByRole('button', { name: '테스트 완료' }).click();
	await expect(page).toHaveURL(new RegExp(`/app/v/${vocabularyId}\\?completed=1$`));
	await expect(page.getByRole('region', { name: '연속 학습 완료' })).toBeVisible();

	await page.locator('summary.filter-summary').click();
	await page.getByLabel('맞은 단어').check();
	await page.getByLabel('틀린 단어').check();
	await page.getByRole('button', { name: '선택', exact: true }).click();
	await page.getByRole('button', { name: '전체 선택' }).click();
	page.once('dialog', (dialog) => dialog.accept());
	await page.getByRole('button', { name: /삭제 2/ }).click();

	const deleteVocabulary = page.getByRole('button', { name: `${title} 단어장 삭제` });
	page.once('dialog', (dialog) => dialog.dismiss());
	await deleteVocabulary.click();
	await expect(page.locator('a.sidebar-link').filter({ hasText: title })).toBeVisible();
	page.once('dialog', (dialog) => dialog.accept());
	await deleteVocabulary.click();
	await expect(page).toHaveURL(/\/app$/);
});
