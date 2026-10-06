import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { safeFetch, UnsafeUrlError } from './ssrf';
import { str, ToolInputError, type ToolDef } from './types';

const MAX_CHARS = 24_000;

export function htmlToText(html: string, url: string): { title: string; text: string } {
  const { document } = parseHTML(html);
  for (const el of document.querySelectorAll('script,style,noscript,svg,iframe,template')) el.remove();
  let title = document.querySelector('title')?.textContent?.trim() ?? url;
  let text = '';
  try {
    const article = new Readability(document as unknown as Document).parse();
    if (article?.textContent && article.textContent.trim().length > 200) {
      title = article.title || title;
      text = article.textContent;
    }
  } catch {
    /* fall back to body text */
  }
  if (!text) text = document.body?.textContent ?? '';
  text = text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*/g, '\n\n').trim();
  return { title, text };
}

export const readUrlTool: ToolDef = {
  name: 'read_url',
  risk: 'safe',
  spec: {
    name: 'read_url',
    description: 'Fetch a public web page and return its main readable text. Use for URLs the user shares or promising search results.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'Absolute http(s) URL' } },
      required: ['url'],
    },
  },
  async run(args, ctx) {
    const url = str(args.url, 'url', 2000);
    let page;
    try {
      page = await safeFetch(url, { timeoutMs: 12_000 });
    } catch (err) {
      if (err instanceof UnsafeUrlError) throw new ToolInputError(err.message);
      throw err;
    }
    if (page.status >= 400) throw new Error(`The page returned HTTP ${page.status}`);
    const ct = page.contentType.toLowerCase();
    let title = page.url;
    let text: string;
    if (ct.includes('html') || ct.includes('xml')) ({ title, text } = htmlToText(page.body, page.url));
    else if (ct.startsWith('text/') || ct.includes('json')) text = page.body;
    else throw new ToolInputError(`Unsupported content type "${ct || 'unknown'}" (only HTML/text pages can be read)`);
    const truncated = text.length > MAX_CHARS || page.truncated;
    const n = ++ctx.sourceOffset;
    return {
      content: `[${n}] ${title}\nURL: ${page.url}\n\n${text.slice(0, MAX_CHARS)}${truncated ? '\n\n[content truncated]' : ''}`,
      summary: `Read “${title.slice(0, 80)}”`,
      sources: [{ title, url: page.url, snippet: text.slice(0, 300) }],
    };
  },
};
