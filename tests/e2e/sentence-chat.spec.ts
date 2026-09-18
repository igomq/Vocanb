import { expect, test } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

test('streams Markdown, handles interruptions, and isolates passage conversations', async ({
	page
}, testInfo) => {
	const dataDir = testInfo.config.webServer?.env?.DATA_DIR;
	if (!dataDir) throw new Error('Missing isolated E2E directory');
	const userId = `u_${createHash('sha256').update('playwright').digest('hex').slice(0, 32)}`;
	const directory = join(dataDir, 'users', userId, 'sentence-books');
	const bookId = randomUUID();
	await mkdir(directory, { recursive: true });
	await writeFile(
		join(directory, `${bookId}.json`),
		JSON.stringify({
			schemaVersion: 1,
			id: bookId,
			title: '채팅 테스트',
			sourceFileName: 'sample.pdf',
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			passages: [0, 1].map((order) => ({
				id: randomUUID(),
				order,
				label: `Passage ${order + 1}`,
				sourcePageStart: 1,
				sourcePageEnd: 1,
				paragraphs: [{ runs: [{ text: 'A sentence to study.', memorize: true }] }],
				summary: null,
				translation: null,
				testResults: {},
				testResultsRevision: 0
			}))
		})
	);
	await page.goto('/login');
	await page.getByLabel('아이디').fill('playwright');
	await page.getByLabel('비밀번호').fill('playwright-password');
	await page.getByRole('button', { name: '로그인' }).click();
	await expect(page).toHaveURL(/\/app$/);
	await page.goto(`/app/s/${bookId}`);
	// This control is enabled by the page's hydration effect.
	await expect(
		page.getByRole('button', { name: '본문·암기 범위 수정', exact: true })
	).toBeEnabled();

	// A held browser stream proves rendering happens before the response finishes.
	// Provider and endpoint streaming are checked independently in the unit suite.
	await page.evaluate(() => {
		const original = window.fetch.bind(window);
		window.fetch = async (input, init) => {
			if (!String(input).endsWith('/chat')) return original(input, init);
			const question = JSON.parse(String(init?.body)).messages.at(-1).content;
			const encoder = new TextEncoder();
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					const send = (event: object) =>
						controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
					const finish = () => {
						if (question === '연결 오류') {
							controller.close();
							return;
						}
						send({
							type: 'delta',
							text:
								'\n\n- 예문입니다.\n\n```text\n' +
								'long_code_'.repeat(30) +
								'\n```\n\n| 단어 | 뜻 |\n| --- | --- |\n| cat | 고양이 |\n\n[문서](https://example.com)\n\n<script>alert(1)</script>\n\n[위험](javascript:alert(1))'
						});
						send({ type: 'done' });
						controller.close();
					};
					window.addEventListener('finish-chat', finish, { once: true });
					init?.signal?.addEventListener(
						'abort',
						() => {
							window.removeEventListener('finish-chat', finish);
							document.documentElement.dataset.chatAborted = 'true';
							controller.error(new DOMException('Aborted', 'AbortError'));
						},
						{ once: true }
					);
					send({ type: 'delta', text: '### 단어 설명\n\n**첫 답변**' });
				}
			});
			return new Response(stream, { headers: { 'content-type': 'application/x-ndjson' } });
		};
	});

	await page.getByRole('button', { name: 'AI에게 질문하기', exact: true }).click();
	await expect(page.getByRole('region', { name: 'AI 지문 채팅' })).toBeVisible();
	const question = page.getByLabel('지문에 대한 질문');
	const send = page.getByRole('button', { name: '전송', exact: true });
	await question.fill('단어 설명');
	await send.click();
	await expect(page.locator('.sentence-chat-markdown strong')).toHaveText('첫 답변');
	await expect(question).toBeDisabled();
	await expect(page.locator('.sentence-chat-thinking')).toHaveText('답변 작성 중…');
	await page.evaluate(() => window.dispatchEvent(new Event('finish-chat')));
	await expect(question).toBeEnabled();
	const markdown = page.locator('.sentence-chat-markdown').last();
	await expect(markdown.locator('li')).toHaveText('예문입니다.');
	await expect(markdown.locator('table')).toContainText('고양이');
	await expect(markdown.locator('pre code')).toContainText('long_code_');
	await expect(markdown.locator('script, a[href^="javascript:"]')).toHaveCount(0);
	await page.screenshot({ path: testInfo.outputPath('chat-desktop.png'), fullPage: true });
	await page.setViewportSize({ width: 390, height: 844 });
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true
	);
	expect(
		await page
			.locator('.sentence-chat-messages')
			.evaluate((element) => element.scrollWidth <= element.clientWidth)
	).toBe(true);
	await page.screenshot({ path: testInfo.outputPath('chat-mobile.png'), fullPage: true });

	await question.fill('연결 오류');
	await send.click();
	await expect(page.locator('.sentence-chat-markdown')).toHaveCount(2);
	await page.evaluate(() => window.dispatchEvent(new Event('finish-chat')));
	await expect(page.getByRole('alert')).toContainText('연결이 중간에 끊겼습니다');
	await expect(page.locator('.sentence-chat-markdown').last()).toContainText('첫 답변');
	await expect(question).toBeEnabled();

	await question.fill('늦은 응답');
	await send.click();
	await expect(question).toBeDisabled();
	await page.getByRole('button', { name: '채팅 닫기', exact: true }).click();
	await page.getByRole('button', { name: '다음 ›', exact: true }).click();
	await expect(page.locator('html')).toHaveAttribute('data-chat-aborted', 'true');
	await page.getByRole('button', { name: 'AI에게 질문하기', exact: true }).click();
	await expect(page.locator('.sentence-chat-message')).toHaveCount(0);
	await expect(question).toBeEnabled();
	await question.fill('새 지문 질문');
	await send.click();
	await expect(page.locator('.sentence-chat-markdown')).toHaveCount(1);
	await page.evaluate(() => window.dispatchEvent(new Event('finish-chat')));
	await expect(question).toBeEnabled();
	await expect(page.locator('.sentence-chat-message.from-user')).toHaveText('새 지문 질문');
});
