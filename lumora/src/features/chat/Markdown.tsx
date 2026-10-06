import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { PluggableList } from 'unified';
import { Check, Copy, Download, FileInput, Play } from 'lucide-react';
import type { Source } from '@shared/types';
import { formatRunResult, runCode } from '@/lib/sandbox';
import { cn, copyText, downloadText } from '@/lib/utils';
import { useT } from '@/i18n';

type HastNode = { type: string; value?: string; tagName?: string; properties?: { className?: string[] }; children?: HastNode[] };
const hastText = (n?: HastNode): string => (!n ? '' : n.type === 'text' ? (n.value ?? '') : (n.children ?? []).map(hastText).join(''));

const RUNNABLE = new Set(['python', 'py', 'javascript', 'js']);
const EXT: Record<string, string> = { python: 'py', py: 'py', javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', tsx: 'tsx', html: 'html', css: 'css', json: 'json', bash: 'sh', shell: 'sh', sql: 'sql', rust: 'rs', go: 'go', java: 'java' };

export interface CodeAction {
  label: string;
  run: (code: string, lang: string) => void;
}

function CodeBlock({ code, lang, children, action }: { code: string; lang: string; children: ReactNode; action?: CodeAction }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [output, setOutput] = useState<{ text: string; ok: boolean } | null>(null);
  const [running, setRunning] = useState(false);
  const filePath = code.match(/^(?:\/\/|#|--|<!--)\s*file:\s*([^\s>]+)/)?.[1];
  return (
    <div className="group/code my-3 overflow-hidden rounded-2xl border border-line bg-[var(--code-bg)]">
      <div className="flex items-center gap-1 border-b border-line/70 py-1 pl-3.5 pr-1.5 text-xs text-muted">
        <span className="font-mono">{filePath ?? (lang || 'text')}</span>
        <span className="flex-1" />
        {action && (
          <button className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-hover hover:text-fg" onClick={() => action.run(code, lang)}>
            <FileInput className="size-3.5" /> {action.label}
          </button>
        )}
        {RUNNABLE.has(lang) && (
          <button
            className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-hover hover:text-fg disabled:opacity-50"
            disabled={running}
            title="Runs in an isolated sandbox in your browser"
            onClick={async () => {
              setRunning(true);
              const r = await runCode(lang, code);
              setOutput({ text: formatRunResult(r), ok: r.ok });
              setRunning(false);
            }}
          >
            <Play className="size-3.5" /> {running ? 'Running…' : 'Run'}
          </button>
        )}
        <button
          className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-hover hover:text-fg"
          title="Download"
          onClick={() => downloadText(code, filePath?.split('/').pop() ?? `snippet.${EXT[lang] ?? 'txt'}`)}
        >
          <Download className="size-3.5" />
        </button>
        <button
          className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-hover hover:text-fg"
          onClick={async () => {
            if (await copyText(code)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }
          }}
        >
          {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />} {copied ? t('copied') : t('copy')}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed">
        <code className={cn('hljs font-mono', lang && `language-${lang}`)}>{children}</code>
      </pre>
      {output && (
        <div className="border-t border-line/70 bg-bg/40 px-4 py-3">
          <div className={cn('mb-1 text-[11px] font-semibold uppercase tracking-wider', output.ok ? 'text-success' : 'text-danger')}>Output</div>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-mono text-[12.5px] text-muted">{output.text}</pre>
        </div>
      )}
    </div>
  );
}

/** Turns bracketed citation numbers into links (outside code). */
export function linkCitations(md: string, count: number): string {
  if (!count) return md;
  return md
    .split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g)
    .map((seg, i) => (i % 2 ? seg : seg.replace(/\[(\d{1,3})\](?![(:[])/g, (m, n) => (Number(n) >= 1 && Number(n) <= count ? `[${n}](#cite-${n})` : m))))
    .join('');
}

// Syntax highlighting and KaTeX are loaded only when a message needs them (keeps startup fast).
let hlPlugin: PluggableList[number] | null = null;
let katexPlugin: PluggableList[number] | null = null;
let hlLoading: Promise<void> | null = null;
let katexLoading: Promise<void> | null = null;
const loadHighlight = () =>
  (hlLoading ??= import('rehype-highlight').then((m) => {
    hlPlugin = [m.default, { detect: false }];
  }));
const loadKatex = () =>
  (katexLoading ??= Promise.all([import('rehype-katex'), import('katex/dist/katex.min.css')]).then(([m]) => {
    katexPlugin = [m.default, { throwOnError: false, strict: 'ignore' }];
  }));
const MATH_RE = /\$[^$\n]+\$|\$\$|\\\(|\\\[/;

function usePlugins(content: string): PluggableList {
  const needsHl = content.includes('```');
  const needsMath = MATH_RE.test(content);
  const [, force] = useState(0);
  useEffect(() => {
    if (needsHl && !hlPlugin) void loadHighlight().then(() => force((n) => n + 1));
    if (needsMath && !katexPlugin) void loadKatex().then(() => force((n) => n + 1));
  }, [needsHl, needsMath]);
  const list: PluggableList = [];
  if (needsMath && katexPlugin) list.push(katexPlugin);
  if (needsHl && hlPlugin) list.push(hlPlugin);
  return list;
}

export const Markdown = memo(function Markdown({ content, sources, codeAction }: { content: string; sources?: Source[]; codeAction?: CodeAction }) {
  const text = useMemo(() => linkCitations(content, sources?.length ?? 0), [content, sources?.length]);
  const rehypePlugins = usePlugins(content);
  const components = useMemo<Components>(
    () => ({
      pre({ node, children }) {
        const codeEl = (node as HastNode | undefined)?.children?.find((c) => c.tagName === 'code');
        const cls = codeEl?.properties?.className ?? [];
        const lang = (cls.find((c) => c.startsWith('language-')) ?? '').replace('language-', '');
        const inner = (children as { props?: { children?: ReactNode } })?.props?.children ?? children;
        return (
          <CodeBlock code={hastText(codeEl).replace(/\n$/, '')} lang={lang} action={codeAction}>
            {inner}
          </CodeBlock>
        );
      },
      a({ href, children }) {
        if (href?.startsWith('#cite-')) {
          const n = Number(href.slice(6));
          const s = sources?.[n - 1];
          return (
            <a className="citation" href={s?.url} target="_blank" rel="noopener noreferrer" title={s ? `${s.title}\n${s.url}` : undefined}>
              {n}
            </a>
          );
        }
        return (
          <a href={href} target="_blank" rel="noopener noreferrer nofollow">
            {children}
          </a>
        );
      },
      table({ children }) {
        return <table>{children}</table>;
      },
    }),
    [sources, codeAction],
  );
  return (
    <div className="prose-lumora">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
