import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { diffLines } from 'diff';
import JSZip from 'jszip';
import {
  ArrowUp,
  Bot,
  ChevronRight,
  Download,
  File as FileIcon,
  FilePlus,
  Folder,
  Loader2,
  Menu,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { ApiTurn, ContentPart } from '@shared/types';
import { codeStore } from '@/data/store';
import type { CodeFile } from '@/data/types';
import { useApp } from '@/state/app';
import { streamChat } from '@/lib/chatClient';
import { formatRunResult, runCode } from '@/lib/sandbox';
import { cn, downloadBlob, downloadText, languageForPath } from '@/lib/utils';
import { useT } from '@/i18n';
import { Button, IconButton } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Markdown } from '../chat/Markdown';

const Editor = lazy(() => import('./Editor'));

const STARTER: CodeFile[] = [
  {
    path: 'main.py',
    content: '# Welcome to the Lumora code workspace!\n# Edit files, run Python/JavaScript in a browser sandbox, and ask the AI for help.\n\ndef fib(n: int) -> list[int]:\n    seq = [0, 1]\n    while len(seq) < n:\n        seq.append(seq[-1] + seq[-2])\n    return seq[:n]\n\nprint(fib(10))\n',
    updatedAt: Date.now(),
  },
  { path: 'web/app.js', content: "const greet = (name) => `Hello, ${name}!`;\nconsole.log(greet('Lumora'));\n", updatedAt: Date.now() },
];

interface TreeNode {
  name: string;
  path: string;
  children?: TreeNode[];
}

function buildTree(files: CodeFile[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', children: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join('/');
      let child = node.children!.find((c) => c.name === part);
      if (!child) {
        child = { name: part, path, ...(i < parts.length - 1 ? { children: [] } : {}) };
        node.children!.push(child);
      }
      node = child;
    });
  }
  const sort = (n: TreeNode[]): TreeNode[] =>
    n.sort((a, b) => (!!b.children === !!a.children ? a.name.localeCompare(b.name) : a.children ? -1 : 1)).map((x) => (x.children ? { ...x, children: sort(x.children) } : x));
  return sort(root.children!);
}

function Tree({ nodes, active, onOpen, depth = 0 }: { nodes: TreeNode[]; active: string | null; onOpen: (p: string) => void; depth?: number }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  return (
    <ul>
      {nodes.map((n) => (
        <li key={n.path}>
          <button
            onClick={() => (n.children ? setCollapsed((c) => (c.has(n.path) ? (c.delete(n.path), new Set(c)) : new Set(c.add(n.path)))) : onOpen(n.path))}
            className={cn('flex w-full items-center gap-1.5 rounded-lg py-1 pr-2 text-left text-[13px]', active === n.path ? 'bg-hover text-fg' : 'text-muted hover:bg-hover/70 hover:text-fg')}
            style={{ paddingLeft: 8 + depth * 14 }}
          >
            {n.children ? (
              <>
                <ChevronRight className={cn('size-3.5 transition-transform', !collapsed.has(n.path) && 'rotate-90')} />
                <Folder className="size-3.5 text-accent" />
              </>
            ) : (
              <FileIcon className="ml-5 size-3.5 text-faint" />
            )}
            <span className="truncate">{n.name}</span>
          </button>
          {n.children && !collapsed.has(n.path) && <Tree nodes={n.children} active={active} onOpen={onOpen} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

function DiffView({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => diffLines(before, after), [before, after]);
  return (
    <pre className="overflow-auto font-mono text-[12.5px] leading-relaxed">
      {parts.map((p, i) =>
        p.value
          .replace(/\n$/, '')
          .split('\n')
          .map((line, j) => (
            <div key={`${i}-${j}`} className={cn('px-4', p.added && 'bg-success/15 text-success', p.removed && 'bg-danger/10 text-danger line-through decoration-danger/40')}>
              <span className="mr-3 inline-block w-3 select-none opacity-60">{p.added ? '+' : p.removed ? '−' : ' '}</span>
              {line || ' '}
            </div>
          )),
      )}
    </pre>
  );
}

interface AiMsg {
  role: 'user' | 'assistant';
  content: string;
  error?: string;
}

export function CodeWorkspace() {
  const t = useT();
  const [files, setFiles] = useState<CodeFile[]>([]);
  const [tabs, setTabs] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [output, setOutput] = useState<{ text: string; ok: boolean } | null>(null);
  const [running, setRunning] = useState(false);
  const [aiOpen, setAiOpen] = useState(true);
  const [treeOpen, setTreeOpen] = useState(false);
  const [ai, setAi] = useState<AiMsg[]>([]);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [includeAll, setIncludeAll] = useState(false);
  const [proposal, setProposal] = useState<{ path: string; code: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const setSidebar = useApp((s) => s.setSidebar);
  const toast = useApp((s) => s.toast);
  const settings = useApp((s) => s.settings);

  useEffect(() => {
    void codeStore.list().then(async (list) => {
      if (!list.length) {
        await codeStore.replaceAll(STARTER);
        list = STARTER;
      }
      setFiles(list);
      setTabs([list[0].path]);
      setActive(list[0].path);
    });
  }, []);

  const current = files.find((f) => f.path === active);

  const save = useCallback((path: string, content: string) => {
    const f = { path, content, updatedAt: Date.now() };
    setFiles((cur) => (cur.some((x) => x.path === path) ? cur.map((x) => (x.path === path ? f : x)) : [...cur, f].sort((a, b) => a.path.localeCompare(b.path))));
    void codeStore.save(f);
  }, []);

  const open = (path: string) => {
    setActive(path);
    setTabs((cur) => (cur.includes(path) ? cur : [...cur, path]));
    setTreeOpen(false);
  };

  const closeTab = (path: string) => {
    setTabs((cur) => {
      const next = cur.filter((p) => p !== path);
      if (active === path) setActive(next[next.length - 1] ?? null);
      return next;
    });
  };

  const newFile = () => {
    const path = prompt_('New file path (e.g. src/utils.py)');
    if (!path) return;
    if (files.some((f) => f.path === path)) return open(path);
    save(path, '');
    open(path);
  };

  const remove = (path: string) => {
    if (!confirm(`Delete ${path}?`)) return;
    setFiles((cur) => cur.filter((f) => f.path !== path));
    void codeStore.remove(path);
    closeTab(path);
  };

  const run = async () => {
    if (!current) return;
    const lang = languageForPath(current.path);
    if (!['python', 'javascript'].includes(lang)) return toast('Only Python and JavaScript files can run in the browser sandbox.', { tone: 'error' });
    setRunning(true);
    setOutput({ text: lang === 'python' ? 'Starting Python (first run downloads ~10 MB)…' : 'Running…', ok: true });
    const r = await runCode(lang, current.content);
    setOutput({ text: formatRunResult(r), ok: r.ok });
    setRunning(false);
  };

  const downloadZip = async () => {
    const zip = new JSZip();
    for (const f of files) zip.file(f.path, f.content);
    downloadBlob(await zip.generateAsync({ type: 'blob' }), 'lumora-project.zip');
  };

  const uploadFiles = async (list: FileList) => {
    for (const f of Array.from(list)) {
      if (f.size > 2_000_000) {
        toast(`${f.name} is too large for the editor (2 MB max).`, { tone: 'error' });
        continue;
      }
      const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      save(path, await f.text());
    }
  };

  const ask = async () => {
    const q = prompt.trim();
    if (!q || busy) return;
    setPrompt('');
    const contextFiles = includeAll ? files : current ? [current] : [];
    const parts: ContentPart[] = [
      ...contextFiles.map((f) => ({ type: 'file' as const, name: f.path, mime: 'text/plain', text: f.content.slice(0, 150_000) })),
      { type: 'text', text: `${q}\n\n(Workspace files: ${files.map((f) => f.path).join(', ')}${current ? `. Currently open: ${current.path}` : ''}. When proposing changes to a file, output the complete new file in one code block whose first line is a comment like "// file: path" or "# file: path".)` },
    ];
    const history: ApiTurn[] = ai.slice(-8).map((m) => (m.role === 'user' ? { role: 'user', parts: [{ type: 'text', text: m.content }] } : { role: 'assistant', text: m.content }));
    const msgs: AiMsg[] = [...ai, { role: 'user', content: q }, { role: 'assistant', content: '' }];
    setAi(msgs);
    setBusy(true);
    abort.current = new AbortController();
    try {
      for await (const ev of streamChat(
        { turns: [...history, { role: 'user', parts }], mode: 'coding', tools: [], memoryEnabled: false, instructions: settings.instructions, language: settings.replyLanguage, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
        abort.current.signal,
      )) {
        if (ev.type === 'text') setAi((cur) => cur.map((m, i) => (i === cur.length - 1 ? { ...m, content: m.content + ev.delta } : m)));
        if (ev.type === 'error') setAi((cur) => cur.map((m, i) => (i === cur.length - 1 ? { ...m, error: ev.message } : m)));
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setAi((cur) => cur.map((m, i) => (i === cur.length - 1 ? { ...m, error: (err as Error).message } : m)));
    } finally {
      setBusy(false);
    }
  };

  const codeAction = useMemo(
    () => ({
      label: 'Apply',
      run: (code: string) => {
        const header = code.match(/^(?:\/\/|#|--|<!--)\s*file:\s*([^\s>]+).*\n?/);
        const path = header?.[1] ?? active ?? 'untitled.txt';
        setProposal({ path, code: header ? code.slice(header[0].length) : code });
      },
    }),
    [active],
  );

  const tree = useMemo(() => buildTree(files), [files]);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3">
        <IconButton label="Menu" className="md:hidden" onClick={() => setSidebar(true)}>
          <Menu />
        </IconButton>
        <IconButton label="Files" className="lg:hidden" onClick={() => setTreeOpen((v) => !v)}>
          <Folder />
        </IconButton>
        <h1 className="text-[14px] font-semibold">{t('codeWorkspace')}</h1>
        <span className="hidden text-xs text-faint sm:inline">· files are stored in this browser</span>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={downloadZip}>
          <span className="hidden sm:inline">ZIP</span>
        </Button>
        <Button size="sm" variant={running ? 'secondary' : 'primary'} icon={running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} onClick={run} disabled={!current || running}>
          Run
        </Button>
        <IconButton label="Toggle AI assistant" onClick={() => setAiOpen((v) => !v)}>
          {aiOpen ? <PanelRightClose /> : <PanelRightOpen />}
        </IconButton>
      </header>
      <div className="relative flex min-h-0 flex-1">
        {/* File tree */}
        <aside className={cn('z-10 w-60 shrink-0 flex-col border-r border-line bg-panel max-lg:absolute max-lg:inset-y-0 max-lg:left-0 max-lg:shadow-xl', treeOpen ? 'flex' : 'hidden lg:flex')}>
          <div className="flex items-center gap-1 px-2 py-2">
            <span className="flex-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-faint">Explorer</span>
            <IconButton size="sm" label="New file" onClick={newFile}>
              <FilePlus />
            </IconButton>
            <IconButton size="sm" label="Upload files" onClick={() => uploadRef.current?.click()}>
              <Upload />
            </IconButton>
            <input ref={uploadRef} type="file" multiple hidden onChange={(e) => e.target.files && (void uploadFiles(e.target.files), (e.target.value = ''))} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
            <Tree nodes={tree} active={active} onOpen={open} />
          </div>
        </aside>

        {/* Editor */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-line bg-panel/50">
            {tabs.map((p) => (
              <div key={p} className={cn('group flex items-center gap-1.5 border-r border-line pl-3 pr-1.5 text-[12.5px]', active === p ? 'bg-bg text-fg' : 'text-muted hover:text-fg')}>
                <button onClick={() => setActive(p)} className="max-w-[160px] truncate">
                  {p.split('/').pop()}
                </button>
                <button aria-label={`Close ${p}`} onClick={() => closeTab(p)} className="rounded p-0.5 opacity-60 hover:bg-hover hover:opacity-100">
                  <X className="size-3" />
                </button>
              </div>
            ))}
            {current && (
              <div className="ml-auto flex items-center gap-0.5 px-1.5">
                <IconButton size="sm" label="Download file" onClick={() => downloadText(current.content, current.path.split('/').pop()!)}>
                  <Download />
                </IconButton>
                <IconButton size="sm" label="Delete file" onClick={() => remove(current.path)}>
                  <Trash2 />
                </IconButton>
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {current ? (
              <Suspense fallback={<div className="p-6 text-sm text-muted">Loading editor…</div>}>
                <Editor key={current.path} path={current.path} value={current.content} onChange={(v) => save(current.path, v)} />
              </Suspense>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-faint">Open a file from the explorer</div>
            )}
          </div>
          {output && (
            <div className="max-h-[35%] shrink-0 overflow-auto border-t border-line bg-panel">
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className={cn('text-[11px] font-semibold uppercase tracking-wider', output.ok ? 'text-success' : 'text-danger')}>Output</span>
                <IconButton size="sm" label="Close output" onClick={() => setOutput(null)}>
                  <X />
                </IconButton>
              </div>
              <pre className="whitespace-pre-wrap px-3 pb-3 font-mono text-[12.5px] text-muted">{output.text}</pre>
            </div>
          )}
        </section>

        {/* AI panel */}
        {aiOpen && (
          <aside className="flex w-full shrink-0 flex-col border-l border-line bg-panel max-md:absolute max-md:inset-0 max-md:z-20 md:w-[380px]">
            <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
              <Bot className="size-4 text-accent" />
              <span className="flex-1 text-[13px] font-semibold">AI coding assistant</span>
              <IconButton size="sm" label="Close" className="md:hidden" onClick={() => setAiOpen(false)}>
                <X />
              </IconButton>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
              {ai.length === 0 && (
                <div className="space-y-2 text-sm text-muted">
                  <p>Ask about the open file or the whole project. Code suggestions have an Apply button that shows a diff before changing your file.</p>
                  {['Explain this file', 'Find bugs in this file', 'Refactor this for readability', 'Write unit tests for this'].map((s) => (
                    <button key={s} onClick={() => setPrompt(s)} className="block w-full rounded-xl border border-line px-3 py-2 text-left text-[13px] hover:bg-hover">
                      {s}
                    </button>
                  ))}
                </div>
              )}
              {ai.map((m, i) =>
                m.role === 'user' ? (
                  <div key={i} className="ml-8 rounded-2xl bg-elevated px-3 py-2 text-[13.5px] ring-1 ring-line">
                    {m.content}
                  </div>
                ) : (
                  <div key={i} className="text-[13.5px]">
                    {m.content ? <Markdown content={m.content} codeAction={codeAction} /> : busy && i === ai.length - 1 ? <Loader2 className="size-4 animate-spin text-accent" /> : null}
                    {m.error && <div className="mt-2 rounded-xl border border-danger/30 bg-danger/5 p-2.5 text-xs text-danger">{m.error}</div>}
                  </div>
                ),
              )}
            </div>
            <div className="border-t border-line p-2.5">
              <label className="mb-1.5 flex items-center gap-2 px-1 text-xs text-muted">
                <input type="checkbox" className="accent-[var(--accent)]" checked={includeAll} onChange={(e) => setIncludeAll(e.target.checked)} />
                Include all {files.length} files as context (otherwise only the open file)
              </label>
              <div className="flex items-end gap-2 rounded-2xl border border-line bg-bg p-1.5 focus-within:border-accent/60">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void ask();
                    }
                  }}
                  rows={2}
                  placeholder="Ask about your code…"
                  className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-1 text-[13.5px] outline-none placeholder:text-faint"
                />
                {busy ? (
                  <button aria-label="Stop" onClick={() => abort.current?.abort()} className="flex size-8 items-center justify-center rounded-full bg-fg text-bg">
                    <Square className="size-3 fill-current" />
                  </button>
                ) : (
                  <button aria-label="Send" disabled={!prompt.trim()} onClick={() => void ask()} className="flex size-8 items-center justify-center rounded-full bg-gradient-accent text-white disabled:opacity-30">
                    <ArrowUp className="size-4" />
                  </button>
                )}
              </div>
            </div>
          </aside>
        )}
      </div>

      <Dialog
        open={!!proposal}
        onClose={() => setProposal(null)}
        title={proposal ? `Apply changes to ${proposal.path}` : ''}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setProposal(null)}>
              Discard
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (!proposal) return;
                save(proposal.path, proposal.code);
                open(proposal.path);
                setProposal(null);
                toast(`Updated ${proposal.path}`, { tone: 'success' });
              }}
            >
              Accept changes
            </Button>
          </>
        }
      >
        {proposal && (
          <div className="py-3">
            {!files.some((f) => f.path === proposal.path) && <div className="px-4 pb-2 text-xs text-muted">This will create a new file.</div>}
            <DiffView before={files.find((f) => f.path === proposal.path)?.content ?? ''} after={proposal.code} />
          </div>
        )}
      </Dialog>
    </div>
  );
}

// window.prompt wrapper (kept separate so the state variable named `prompt` doesn't shadow it)
function prompt_(message: string): string | null {
  const v = window.prompt(message);
  return v ? v.trim().replace(/^\/+/, '').replace(/\.\.+/g, '.') : null;
}
