import { ExternalLink } from 'lucide-react';
import type { Source } from '@shared/types';
import { useT } from '@/i18n';

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};

export function SourceList({ sources }: { sources: Source[] }) {
  const t = useT();
  if (!sources.length) return null;
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
        {t('sources')} <span className="font-normal normal-case tracking-normal">· retrieved by tools, not written by the AI</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {sources.map((s, i) => (
          <a
            key={`${s.url}-${i}`}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="group flex gap-2.5 rounded-xl border border-line bg-panel/60 p-2.5 transition-colors hover:border-accent/50 hover:bg-hover"
          >
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent">{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-1 text-[13px] font-medium">{s.title}</span>
              <span className="flex items-center gap-1 text-xs text-faint">
                {host(s.url)} <ExternalLink className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
              </span>
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
