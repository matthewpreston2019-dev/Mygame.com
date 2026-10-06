import { ShieldCheck } from 'lucide-react';
import { useChat } from '@/state/chat';
import { useT } from '@/i18n';
import { Button } from '@/components/ui/Button';

export function PermissionCard() {
  const t = useT();
  const permission = useChat((s) => s.permission);
  if (!permission) return null;
  const { call, resolve } = permission;
  const code = String(call.args.code ?? '');
  const language = String(call.args.language ?? 'python');
  return (
    <div className="mb-3 overflow-hidden rounded-2xl border border-warn/40 bg-warn/5 animate-rise">
      <div className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium">
        <ShieldCheck className="size-4 text-warn" /> {t('codeRunRequest')}
      </div>
      <pre className="max-h-64 overflow-auto border-y border-warn/20 bg-[var(--code-bg)] p-3.5 font-mono text-[12.5px] leading-relaxed">
        <span className="mb-1 block text-[11px] uppercase tracking-wider text-faint">{language}</span>
        {code}
      </pre>
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <span className="mr-auto text-xs text-muted">Runs isolated in your browser: no network, no access to your files or this page.</span>
        <Button size="sm" variant="ghost" onClick={() => resolve('deny')}>
          {t('deny')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => resolve('always')}>
          {t('alwaysAllow')}
        </Button>
        <Button size="sm" variant="primary" onClick={() => resolve('once')}>
          {t('allowOnce')}
        </Button>
      </div>
    </div>
  );
}
