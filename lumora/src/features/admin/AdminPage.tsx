import { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock, Coins, Menu, RefreshCw, Wrench, XCircle } from 'lucide-react';
import type { TierMap } from '@shared/types';
import { apiJson } from '@/lib/api';
import { useApp } from '@/state/app';
import { cn } from '@/lib/utils';
import { Button, IconButton } from '@/components/ui/Button';

interface AdminData {
  authMode: string;
  search: { provider: string | null };
  transcription: boolean;
  providers: { id: string; label: string; ok: boolean; latencyMs: number; modelCount: number; error?: string }[];
  tiers: TierMap;
  usageToday: { requests: number; inputTokens: number; outputTokens: number };
  limits: Record<string, number | boolean | string>;
  stats: { requests: number; errors: number; toolFailures: number; p50LatencyMs: number; p95LatencyMs: number; inputTokens: number; outputTokens: number };
  events: { ts: number; kind: string; provider?: string; model?: string; mode?: string; latencyMs?: number; inputTokens?: number; outputTokens?: number; tool?: string; ok?: boolean; code?: string; detail?: string }[];
}

function Stat({ icon: I, label, value, tone }: { icon: typeof Activity; label: string; value: string | number; tone?: 'danger' | 'warn' }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-4">
      <div className="flex items-center gap-2 text-xs text-muted">
        <I className="size-3.5" /> {label}
      </div>
      <div className={cn('mt-1.5 text-2xl font-semibold tabular-nums', tone === 'danger' && 'text-danger', tone === 'warn' && 'text-warn')}>{value}</div>
    </div>
  );
}

export function AdminPage() {
  const [d, setD] = useState<AdminData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'error' | 'tool' | 'request'>('all');
  const setSidebar = useApp((s) => s.setSidebar);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setD(await apiJson<AdminData>('/api/admin'));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void load(), [load]);
  const events = d?.events.filter((e) => filter === 'all' || e.kind === filter) ?? [];
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3 sm:px-5">
        <IconButton label="Menu" className="md:hidden" onClick={() => setSidebar(true)}>
          <Menu />
        </IconButton>
        <h1 className="flex-1 text-[15px] font-semibold">Admin & diagnostics</h1>
        <Button size="sm" variant="outline" icon={<RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />} onClick={load}>
          Refresh
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
          {err && <div className="rounded-2xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">{err}</div>}
          {!d && !err && <div className="text-sm text-muted">Loading…</div>}
          {d && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat icon={Activity} label="Requests (48h)" value={d.stats.requests} />
                <Stat icon={Clock} label="Latency p50 / p95" value={`${(d.stats.p50LatencyMs / 1000).toFixed(1)}s / ${(d.stats.p95LatencyMs / 1000).toFixed(1)}s`} />
                <Stat icon={Coins} label="Tokens in / out (48h)" value={`${(d.stats.inputTokens / 1000).toFixed(1)}k / ${(d.stats.outputTokens / 1000).toFixed(1)}k`} />
                <Stat icon={AlertTriangle} label="Errors · tool failures" value={`${d.stats.errors} · ${d.stats.toolFailures}`} tone={d.stats.errors ? 'danger' : undefined} />
              </div>

              <section className="rounded-2xl border border-line bg-panel">
                <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">Providers</h2>
                <ul className="divide-y divide-line">
                  {d.providers.length === 0 && <li className="p-4 text-sm text-muted">No providers configured.</li>}
                  {d.providers.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                      {p.ok ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-danger" />}
                      <span className="font-medium">{p.label}</span>
                      <span className="text-muted">{p.modelCount} models</span>
                      <span className="text-muted">{p.latencyMs} ms</span>
                      {p.error && <span className="w-full truncate text-xs text-danger sm:w-auto sm:flex-1">{p.error}</span>}
                    </li>
                  ))}
                </ul>
              </section>

              <div className="grid gap-4 lg:grid-cols-2">
                <section className="rounded-2xl border border-line bg-panel p-4 text-sm">
                  <h2 className="mb-3 font-semibold">Routing (tier → model)</h2>
                  <dl className="grid grid-cols-[120px_1fr] gap-y-1.5">
                    {(['fast', 'balanced', 'powerful', 'vision', 'longContext'] as const).map((k) => (
                      <div key={k} className="contents">
                        <dt className="text-muted">{k}</dt>
                        <dd className="truncate font-mono text-[12.5px]">{d.tiers[k] ?? '—'}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
                <section className="rounded-2xl border border-line bg-panel p-4 text-sm">
                  <h2 className="mb-3 font-semibold">Configuration & limits</h2>
                  <dl className="grid grid-cols-[170px_1fr] gap-y-1.5">
                    <dt className="text-muted">Auth mode</dt>
                    <dd>{d.authMode}</dd>
                    <dt className="text-muted">Search</dt>
                    <dd>{d.search.provider ?? 'not configured'}</dd>
                    <dt className="text-muted">Transcription</dt>
                    <dd>{d.transcription ? 'enabled' : 'browser only'}</dd>
                    <dt className="text-muted">Your usage today</dt>
                    <dd>
                      {d.usageToday.requests} requests · {(d.usageToday.inputTokens + d.usageToday.outputTokens).toLocaleString()} tokens
                    </dd>
                    {Object.entries(d.limits).map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-muted">{k}</dt>
                        <dd className="font-mono text-[12.5px]">{String(v)}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              </div>

              <section className="rounded-2xl border border-line bg-panel">
                <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
                  <h2 className="mr-auto text-sm font-semibold">Recent events</h2>
                  {(['all', 'request', 'error', 'tool'] as const).map((f) => (
                    <button key={f} onClick={() => setFilter(f)} className={cn('rounded-lg px-2.5 py-1 text-xs', filter === f ? 'bg-hover font-medium' : 'text-muted hover:bg-hover/70')}>
                      {f}
                    </button>
                  ))}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[12.5px]">
                    <thead className="text-muted">
                      <tr className="border-b border-line">
                        <th className="px-4 py-2 font-medium">Time</th>
                        <th className="px-2 py-2 font-medium">Kind</th>
                        <th className="px-2 py-2 font-medium">Provider / model</th>
                        <th className="px-2 py-2 font-medium">Latency</th>
                        <th className="px-2 py-2 font-medium">Tokens</th>
                        <th className="px-4 py-2 font-medium">Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {events.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-4 py-6 text-center text-muted">
                            No events yet.
                          </td>
                        </tr>
                      )}
                      {events.map((e, i) => (
                        <tr key={i} className="border-b border-line/60 last:border-0">
                          <td className="whitespace-nowrap px-4 py-2 text-muted">{new Date(e.ts).toLocaleString()}</td>
                          <td className="px-2 py-2">
                            <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5', e.kind === 'error' ? 'bg-danger/10 text-danger' : e.kind === 'tool' ? 'bg-warn/10 text-warn' : 'bg-hover')}>
                              {e.kind === 'tool' && <Wrench className="size-3" />}
                              {e.kind}
                            </span>
                          </td>
                          <td className="max-w-[240px] truncate px-2 py-2 font-mono">{e.provider ? `${e.provider}:${e.model}` : (e.tool ?? '—')}</td>
                          <td className="px-2 py-2 tabular-nums">{e.latencyMs ? `${(e.latencyMs / 1000).toFixed(2)}s` : '—'}</td>
                          <td className="px-2 py-2 tabular-nums">{e.inputTokens || e.outputTokens ? `${e.inputTokens ?? 0} / ${e.outputTokens ?? 0}` : '—'}</td>
                          <td className="max-w-[360px] truncate px-4 py-2 text-muted" title={e.detail}>
                            {e.code ? `${e.code}: ` : ''}
                            {e.detail ?? (e.mode ? `mode ${e.mode}` : '')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
