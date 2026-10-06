import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { SharedSnapshot } from '@/data/types';
import { useApp } from '@/state/app';
import { initSupabase, supabase } from '@/lib/supabase';
import { Logo } from '@/components/Icon';
import { Markdown } from '../chat/Markdown';
import { SourceList } from '../chat/Sources';

/** Public, read-only view of a shared conversation snapshot (Supabase mode). */
export function SharePage() {
  const { id } = useParams();
  const config = useApp((s) => s.config);
  const [snap, setSnap] = useState<SharedSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!config) return;
    if (!config.supabase) return setError('Sharing links require the Supabase backend.');
    const cfg = config.supabase;
    void (async () => (supabase() ?? (await initSupabase(cfg.url, cfg.anonKey))))().then((sb) =>
      sb
      .from('shared_conversations')
      .select('data')
      .eq('id', id ?? '')
      .maybeSingle()
      .then(({ data, error: e }) => {
        if (e || !data) setError('This shared conversation does not exist or was removed.');
        else setSnap(data.data as SharedSnapshot);
      }));
  }, [config, id]);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-8 flex items-center gap-2 text-sm text-muted">
          <Logo className="size-6" /> Shared from {config?.appName ?? 'Lumora'}
        </div>
        {error && <div className="rounded-2xl border border-line p-6 text-center text-muted">{error}</div>}
        {snap && (
          <>
            <h1 className="mb-1 text-2xl font-semibold tracking-tight">{snap.title}</h1>
            <p className="mb-8 text-xs text-faint">{new Date(snap.createdAt).toLocaleString()}</p>
            <div className="space-y-6">
              {snap.messages.map((m, i) =>
                m.role === 'user' ? (
                  <div key={i} className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-3xl rounded-br-lg bg-elevated px-4 py-2.5 ring-1 ring-line">
                    {m.content}
                  </div>
                ) : (
                  <div key={i}>
                    <Markdown content={m.content} sources={m.sources} />
                    {!!m.sources?.length && <SourceList sources={m.sources} />}
                  </div>
                ),
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
