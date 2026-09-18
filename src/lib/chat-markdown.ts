import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt({ html: false, breaks: true }).disable('image');

export function renderChatMarkdown(text: string) {
	return markdown.render(text);
}
