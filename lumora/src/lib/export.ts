import type { Conversation, Message, SharedSnapshot } from '@/data/types';
import { downloadText, safeFilename } from './utils';

export function toMarkdown(c: Pick<Conversation, 'title'>, messages: Pick<Message, 'role' | 'content' | 'sources' | 'meta' | 'attachments'>[]): string {
  const lines = [`# ${c.title}`, '', `_Exported from Lumora on ${new Date().toLocaleString()}_`, ''];
  for (const m of messages) {
    lines.push(m.role === 'user' ? '## You' : `## Assistant${m.meta?.model ? ` (${m.meta.model})` : ''}`, '');
    if (m.attachments?.length) lines.push(`_Attachments: ${m.attachments.map((a) => a.name).join(', ')}_`, '');
    lines.push(m.content, '');
    if (m.sources?.length) {
      lines.push('**Sources**', '');
      m.sources.forEach((s, i) => lines.push(`${i + 1}. [${s.title}](${s.url})`));
      lines.push('');
    }
  }
  return lines.join('\n');
}

export function exportConversation(c: Conversation, messages: Message[], format: 'md' | 'json' | 'html') {
  const name = safeFilename(c.title);
  if (format === 'md') return downloadText(toMarkdown(c, messages), `${name}.md`, 'text/markdown');
  if (format === 'json') {
    const slim = messages.map(({ role, content, createdAt, sources, meta, attachments }) => ({
      role,
      content,
      createdAt: new Date(createdAt).toISOString(),
      sources,
      model: meta?.model,
      provider: meta?.provider,
      mode: meta?.mode,
      attachments: attachments?.map((a) => ({ name: a.name, mime: a.mime, size: a.size })),
    }));
    return downloadText(JSON.stringify({ title: c.title, exportedAt: new Date().toISOString(), messages: slim }, null, 2), `${name}.json`, 'application/json');
  }
  return downloadText(snapshotHtml({ title: c.title, createdAt: Date.now(), messages }), `${name}.html`, 'text/html');
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** A self-contained, script-free HTML page (used to share conversations without a server). */
export function snapshotHtml(s: SharedSnapshot): string {
  const body = s.messages
    .map(
      (m) => `<section class="${m.role}"><h3>${m.role === 'user' ? 'You' : 'Assistant'}</h3><pre>${esc(m.content)}</pre>${
        m.sources?.length ? `<ol>${m.sources.map((x) => `<li><a href="${esc(x.url)}" rel="noopener noreferrer">${esc(x.title)}</a></li>`).join('')}</ol>` : ''
      }</section>`,
    )
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(s.title)}</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 16px;color:#16161f;background:#f7f7fa}section{background:#fff;border:1px solid #e3e3ec;border-radius:14px;padding:4px 18px;margin:14px 0}section.user{background:#efeefe}h3{font-size:13px;color:#6d5dfc;text-transform:uppercase;letter-spacing:.06em}pre{white-space:pre-wrap;font:inherit}a{color:#6d5dfc}</style></head><body><h1>${esc(s.title)}</h1>${body}<p style="color:#888;font-size:13px">Shared from Lumora · ${new Date(s.createdAt).toLocaleString()}</p></body></html>`;
}
