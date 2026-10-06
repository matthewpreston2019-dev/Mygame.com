import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { useApp } from '@/state/app';
import { cn } from '@/lib/utils';

export function Toaster() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl border border-line bg-elevated px-4 py-2.5 text-sm shadow-xl animate-rise">
          {t.tone === 'error' ? <TriangleAlert className="size-4 shrink-0 text-danger" /> : t.tone === 'success' ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : <Info className="size-4 shrink-0 text-accent" />}
          <span className="min-w-0 flex-1">{t.message}</span>
          {t.action && (
            <button
              className={cn('shrink-0 font-semibold text-accent hover:underline')}
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button aria-label="Dismiss" className="shrink-0 text-faint hover:text-fg" onClick={() => dismiss(t.id)}>
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
