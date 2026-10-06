// Browser-side file processing. Files are parsed locally; only the extracted text (or a downscaled
// image) is sent to the AI provider with your message. Originals are never uploaded anywhere.

import type { Attachment } from '@/data/types';
import { uid } from './utils';

export const MAX_TEXT_CHARS = 400_000;
const IMAGE_MAX_SIDE = 1600;

const TEXT_EXT =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|ya?ml|toml|ini|cfg|conf|log|env\.example|html?|css|scss|less|js|mjs|cjs|jsx|ts|tsx|py|rb|php|java|kt|kts|scala|go|rs|c|h|cc|cpp|hpp|cs|swift|m|sh|bash|zsh|ps1|sql|graphql|gql|vue|svelte|astro|lua|r|dart|ex|exs|erl|hs|clj|pl|tex|rst|adoc|dockerfile|gradle|makefile|cmake|proto|tf|hcl|ipynb)$/i;

export class FileRejectedError extends Error {}

function clipText(text: string): { text: string; truncated: boolean } {
  return text.length > MAX_TEXT_CHARS ? { text: text.slice(0, MAX_TEXT_CHARS), truncated: true } : { text, truncated: false };
}

async function bitmapToBase64(file: File): Promise<{ data: string; mime: string }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const keepPng = file.type === 'image/png' && file.size < 1_500_000;
  if (!keepPng) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const mime = keepPng ? 'image/png' : 'image/jpeg';
  const url = canvas.toDataURL(mime, 0.86);
  return { data: url.slice(url.indexOf(',') + 1), mime };
}

async function pdfText(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const pages: string[] = [];
  let total = 0;
  for (let i = 1; i <= doc.numPages && total < MAX_TEXT_CHARS; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let line = '';
    const lines: string[] = [];
    for (const item of content.items as { str?: string; hasEOL?: boolean }[]) {
      line += item.str ?? '';
      if (item.hasEOL) {
        lines.push(line);
        line = '';
      }
    }
    if (line) lines.push(line);
    const text = lines.join('\n').trim();
    pages.push(`--- Page ${i} ---\n${text}`);
    total += text.length;
  }
  await task.destroy();
  return pages.join('\n\n');
}

async function docxText(file: File): Promise<string> {
  const mammoth = (await import('mammoth')).default;
  const res = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return res.value;
}

async function xlsxText(file: File): Promise<string> {
  const { default: readXlsxFile } = await import('read-excel-file/browser');
  const sheets = await readXlsxFile(file);
  const csvCell = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return sheets.map((s) => `## Sheet: ${s.sheet}\n` + s.data.map((row) => row.map(csvCell).join(',')).join('\n')).join('\n\n');
}

export function isImage(file: File) {
  return /^image\/(png|jpe?g|webp|gif|bmp)$/.test(file.type);
}

export async function processFile(file: File, maxBytes: number): Promise<Attachment> {
  if (file.size > maxBytes) throw new FileRejectedError(`${file.name} is larger than ${(maxBytes / 1e6).toFixed(0)} MB.`);
  if (file.size === 0) throw new FileRejectedError(`${file.name} is empty.`);
  const base = { id: uid(), name: file.name, size: file.size };
  if (isImage(file)) {
    const { data, mime } = await bitmapToBase64(file);
    return { ...base, kind: 'image', mime, data, note: 'Resized in your browser and sent to a vision-capable model.' };
  }
  if (/^image\//.test(file.type)) throw new FileRejectedError(`${file.name}: this image format isn't supported. Use PNG, JPEG, WebP or GIF.`);
  const name = file.name.toLowerCase();
  let raw: string;
  let mime = file.type || 'text/plain';
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    raw = await pdfText(file);
    mime = 'application/pdf';
    if (!raw.replace(/--- Page \d+ ---/g, '').trim())
      throw new FileRejectedError(`${file.name} has no extractable text (it may be a scanned PDF). Try uploading page screenshots instead.`);
  } else if (name.endsWith('.docx')) {
    raw = await docxText(file);
    mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  } else if (name.endsWith('.xlsx')) {
    raw = await xlsxText(file);
    mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  } else if (TEXT_EXT.test(name) || file.type.startsWith('text/') || file.type === 'application/json' || !name.includes('.')) {
    raw = await file.text();
    if (/\u0000/.test(raw.slice(0, 2000))) throw new FileRejectedError(`${file.name} looks like a binary file.`);
  } else {
    throw new FileRejectedError(`${file.name}: unsupported file type. Supported: PDF, DOCX, XLSX, CSV, TXT, Markdown, JSON, code files and images.`);
  }
  const { text, truncated } = clipText(raw);
  return {
    ...base,
    kind: 'file',
    mime,
    text,
    truncated,
    note: `Text extracted in your browser (${text.length.toLocaleString()} characters${truncated ? ', truncated' : ''}). Only this text is sent with your message.`,
  };
}
