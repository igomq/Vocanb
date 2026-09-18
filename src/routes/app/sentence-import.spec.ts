import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SENTENCE_PDF_MAX_BYTES } from '$lib/sentence-domain';
import { listSentenceBooks } from '$lib/server/sentence-storage';
import { actions } from './+page.server';
import { POST } from './s/import/+server';

vi.mock('$lib/server/sentence-ai', () => ({
	sentenceImportProvider: { extract: vi.fn() }
}));

import { sentenceImportProvider } from '$lib/server/sentence-ai';

const userId = 'u_0123456789abcdef0123456789abcdef';
let directory: string;

function pdfFile(
	name = 'sample.pdf',
	content = '%PDF-1.4 mock',
	type = 'application/pdf',
	size?: number
) {
	return new File([Buffer.alloc(size ?? content.length, content)], name, { type });
}

async function importPdf(file: File | null, title?: string) {
	const form = new FormData();
	if (file) form.append('pdf', file);
	if (title !== undefined) form.append('title', title);
	return actions.importSentenceBook!({
		request: new Request('http://localhost', { method: 'POST', body: form }),
		locals: { userId }
	} as never);
}

function providerResponse(overrides = {}) {
	return {
		passages: [
			{
				sourceOrder: 0,
				label: '1. 24.6.20. (3강-5)',
				sourcePageStart: 1,
				sourcePageEnd: 3,
				paragraphs: [
					{
						runs: [
							{ text: 'Most people resist ', memorize: false },
							{ text: 'the idea', memorize: true }
						]
					}
				]
			}
		],
		...overrides
	};
}

beforeEach(async () => {
	directory = await mkdtemp(join(tmpdir(), 'vocanb-sentence-action-'));
	process.env.DATA_DIR = directory;
});

afterEach(async () => {
	vi.clearAllMocks();
	await rm(directory, { recursive: true, force: true });
});

describe('sentence book import action', () => {
	it('rejects a missing PDF file', async () => {
		const result = await importPdf(null);
		expect(result).toMatchObject({ status: 400, data: { message: 'PDF 파일을 선택해 주세요.' } });
		expect(await listSentenceBooks(userId)).toEqual([]);
	});

	it('rejects empty and non-PDF files', async () => {
		expect(await importPdf(pdfFile('empty.pdf', ''))).toMatchObject({
			status: 400,
			data: { message: 'PDF 파일을 선택해 주세요.' }
		});
		expect(await importPdf(pdfFile('photo.png', 'not a pdf', 'image/png'))).toMatchObject({
			status: 400,
			data: { message: 'PDF 파일만 업로드할 수 있습니다.' }
		});
	});

	it('rejects content that lacks PDF magic bytes even with a pdf MIME type', async () => {
		expect(await importPdf(pdfFile('fake.pdf', 'hello world'))).toMatchObject({
			status: 400,
			data: { message: 'PDF 파일만 업로드할 수 있습니다.' }
		});
		expect(await listSentenceBooks(userId)).toEqual([]);
	});

	it('rejects oversized PDFs', async () => {
		expect(
			await importPdf(pdfFile('big.pdf', '%PDF-', 'application/pdf', SENTENCE_PDF_MAX_BYTES + 1))
		).toMatchObject({
			status: 400,
			data: { message: 'PDF 파일이 너무 큽니다.' }
		});
	});

	it('creates a book and redirects on provider success', async () => {
		vi.mocked(sentenceImportProvider.extract).mockResolvedValue(providerResponse());
		await expect(importPdf(pdfFile('보정고2 부교재.pdf'), '보정고2 부교재')).rejects.toMatchObject({
			status: 303
		});
		const books = await listSentenceBooks(userId);
		expect(books).toHaveLength(1);
		expect(books[0].title).toBe('보정고2 부교재');
		expect(books[0].sourceFileName).toBe('보정고2 부교재.pdf');
		expect(books[0].passages).toHaveLength(1);
	});

	it('derives the title from the file name when omitted', async () => {
		vi.mocked(sentenceImportProvider.extract).mockResolvedValue(providerResponse());
		await expect(importPdf(pdfFile('보정고2 부교재 1-4 8월 20일.pdf'))).rejects.toMatchObject({
			status: 303
		});
		expect((await listSentenceBooks(userId))[0].title).toBe('보정고2 부교재 1-4 8월 20일');
	});

	it('leaves no partial book when the provider fails', async () => {
		vi.mocked(sentenceImportProvider.extract).mockRejectedValue(
			new Error('PDF를 분석하지 못했습니다. 잠시 후 다시 시도해 주세요.')
		);
		const result = await importPdf(pdfFile('broken.pdf'));
		expect(result).toMatchObject({ status: 502 });
		expect(await listSentenceBooks(userId)).toEqual([]);
	});

	it('stores nothing when the provider returns no passages', async () => {
		vi.mocked(sentenceImportProvider.extract).mockResolvedValue(providerResponse({ passages: [] }));
		const result = await importPdf(pdfFile('empty-content.pdf'));
		expect(result).toMatchObject({ status: 422 });
		expect(await listSentenceBooks(userId)).toEqual([]);
	});
});

describe('sentence book delete action', () => {
	it('deletes the book and redirects to the sentence home', async () => {
		vi.mocked(sentenceImportProvider.extract).mockResolvedValue(providerResponse());
		await expect(importPdf(pdfFile('지울 책.pdf'))).rejects.toMatchObject({ status: 303 });
		const [book] = await listSentenceBooks(userId);

		const form = new FormData();
		form.append('id', book!.id);
		await expect(
			actions.deleteSentenceBook!({
				request: new Request('http://localhost', { method: 'POST', body: form }),
				locals: { userId }
			} as never)
		).rejects.toMatchObject({ status: 303 });
		expect(await listSentenceBooks(userId)).toEqual([]);
	});
});

describe('streamed sentence import', () => {
	it('keeps a slow analysis alive and returns the saved book after 300 seconds', async () => {
		vi.useFakeTimers();
		let finish!: (value: ReturnType<typeof providerResponse>) => void;
		vi.mocked(sentenceImportProvider.extract).mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				})
		);
		const form = new FormData();
		form.append('pdf', pdfFile());
		const request = new Request('http://localhost/app/s/import', { method: 'POST', body: form });
		const response = await POST({ request, locals: { userId } } as never);
		const reader = response.body!.getReader();
		try {
			expect(response.headers.get('X-Accel-Buffering')).toBe('no');
			expect(response.headers.get('Cache-Control')).toContain('no-store');
			const decoder = new TextDecoder();
			expect(decoder.decode((await reader.read()).value)).toBe('\n');
			await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
			for (let seconds = 0; seconds < 315; seconds += 15) {
				await vi.advanceTimersByTimeAsync(15_000);
				expect(decoder.decode((await reader.read()).value)).toBe('\n');
			}
			finish(providerResponse());
			const result = JSON.parse(decoder.decode((await reader.read()).value));
			expect((await reader.read()).done).toBe(true);
			const [book] = await listSentenceBooks(userId);
			expect(result.location).toBe(`/app/s/${book.id}`);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			await reader.cancel();
			vi.useRealTimers();
		}
	});

	it('finishes saving after a reader disconnect and clears its heartbeat', async () => {
		vi.useFakeTimers();
		let finish!: (value: ReturnType<typeof providerResponse>) => void;
		vi.mocked(sentenceImportProvider.extract).mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				})
		);
		const form = new FormData();
		form.append('pdf', pdfFile());
		const response = await POST({
			request: new Request('http://localhost/app/s/import', { method: 'POST', body: form }),
			locals: { userId }
		} as never);
		try {
			await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
			await response.body!.cancel();
			expect(vi.getTimerCount()).toBe(0);
			finish(providerResponse());
			await vi.waitFor(async () => expect(await listSentenceBooks(userId)).toHaveLength(1));
		} finally {
			vi.useRealTimers();
		}
	});

	it('returns provider errors in the body and rejects unauthenticated requests', async () => {
		vi.mocked(sentenceImportProvider.extract).mockRejectedValue(
			new Error('PDF 분석 시간이 초과되었습니다.')
		);
		const form = new FormData();
		form.append('pdf', pdfFile());
		const request = new Request('http://localhost/app/s/import', { method: 'POST', body: form });
		const unauthorized = await POST({ request: request.clone(), locals: {} } as never);
		expect(unauthorized.status).toBe(401);
		expect(sentenceImportProvider.extract).not.toHaveBeenCalled();
		const response = await POST({ request, locals: { userId } } as never);
		expect(await response.json()).toEqual({ message: 'PDF 분석 시간이 초과되었습니다.' });
		expect(await listSentenceBooks(userId)).toEqual([]);
	});
});
