import { useState } from 'react';
import { Brain, Calculator, ChevronDown, Clock, CloudSun, Code2, Database, FileJson, Globe, Loader2, Search, ShieldAlert, XCircle, CheckCircle2, Ban } from 'lucide-react';
import type { ToolActivity as Activity } from '@/data/types';
import { cn } from '@/lib/utils';

const META: Record<string, { label: string; icon: typeof Search }> = {
  web_search: { label: 'Web search', icon: Search },
  read_url: { label: 'Read page', icon: Globe },
  calculator: { label: 'Calculator', icon: Calculator },
  datetime: { label: 'Date & time', icon: Clock },
  weather: { label: 'Weather', icon: CloudSun },
  json_tool: { label: 'JSON', icon: FileJson },
  data_analysis: { label: 'Data analysis', icon: Database },
  run_code: { label: 'Code sandbox', icon: Code2 },
  remember: { label: 'Memory', icon: Brain },
};

function argPreview(a: Activity): string {
  const args = a.args ?? {};
  if (typeof args.query === 'string') return `“${args.query}”`;
  if (typeof args.url === 'string') return args.url;
  if (typeof args.expression === 'string') return args.expression;
  if (typeof args.location === 'string') return args.location;
  if (typeof args.fact === 'string') return args.fact;
  if (typeof args.language === 'string') return args.language;
  if (typeof args.file === 'string') return args.file;
  return '';
}

export function ToolActivityList({ tools }: { tools: Activity[] }) {
  const [open, setOpen] = useState(false);
  const running = tools.some((t) => t.status === 'running' || t.status === 'awaiting');
  const last = tools[tools.length - 1];
  return (
    <div className="mb-3 overflow-hidden rounded-2xl border border-line bg-panel/60">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px] text-muted hover:text-fg">
        {running ? <Loader2 className="size-3.5 animate-spin text-accent" /> : <CheckCircle2 className="size-3.5 text-success" />}
        <span className="min-w-0 flex-1 truncate">
          {running ? `${META[last.name]?.label ?? last.name}: ${last.summary ?? argPreview(last)}` : `Used ${tools.length} tool${tools.length > 1 ? 's' : ''}`}
        </span>
        <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ul className="space-y-1 border-t border-line px-3.5 py-2.5">
          {tools.map((t) => {
            const M = META[t.name] ?? { label: t.name, icon: Code2 };
            return (
              <li key={t.id} className="text-[13px]">
                <div className="flex items-center gap-2">
                  <M.icon className="size-3.5 shrink-0 text-faint" />
                  <span className="font-medium">{M.label}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">{t.summary ?? argPreview(t)}</span>
                  {t.status === 'running' && <Loader2 className="size-3.5 animate-spin text-accent" />}
                  {t.status === 'awaiting' && <ShieldAlert className="size-3.5 text-warn" />}
                  {t.status === 'error' && <XCircle className="size-3.5 text-danger" />}
                  {t.status === 'denied' && <Ban className="size-3.5 text-faint" />}
                  {t.status === 'done' && t.durationMs !== undefined && <span className="text-xs text-faint">{Math.round(t.durationMs)} ms</span>}
                </div>
                {t.output && <pre className="ml-5.5 mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-bg/60 p-2 font-mono text-[12px] text-muted">{t.output}</pre>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
