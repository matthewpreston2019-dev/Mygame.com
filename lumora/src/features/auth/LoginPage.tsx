import { useState } from 'react';
import { Lock } from 'lucide-react';
import { useApp } from '@/state/app';
import { postJson } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { useT } from '@/i18n';
import { Logo } from '@/components/Icon';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';

export function LoginPage() {
  const t = useT();
  const config = useApp((s) => s.config);
  const refresh = useApp((s) => s.refreshSession);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  if (config?.authMode === 'locked')
    return (
      <Shell>
        <div className="space-y-3 text-sm text-muted">
          <p className="font-medium text-fg">Authentication is not configured.</p>
          <p>
            To protect your API keys, this deployment refuses all requests until you set either <code className="text-fg">APP_PASSWORD</code> (single owner) or the Supabase variables
            (<code className="text-fg">SUPABASE_URL</code>, <code className="text-fg">SUPABASE_ANON_KEY</code>, <code className="text-fg">ALLOWED_EMAILS</code>) in Netlify → Environment variables, then redeploy.
          </p>
        </div>
      </Shell>
    );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (config?.authMode === 'password') {
        await postJson('/api/auth/login', { password });
        await refresh();
      } else {
        const sb = supabase();
        if (!sb) throw new Error('Supabase is not initialised');
        if (mode === 'signup') {
          const { error, data } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } });
          if (error) throw error;
          if (!data.session) setMsg({ text: 'Check your inbox to confirm your email, then sign in.' });
        } else {
          const { error } = await sb.auth.signInWithPassword({ email, password });
          if (error) throw error;
        }
        await refresh();
        const s = useApp.getState().session;
        if (mode === 'signin' && !s?.authenticated) setMsg({ text: "Signed in, but this account isn't on the allow-list (ALLOWED_EMAILS).", error: true });
      }
    } catch (err) {
      setMsg({ text: (err as Error).message || 'Sign-in failed', error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <form onSubmit={submit} className="space-y-4">
        {config?.authMode === 'supabase' && (
          <Field label={t('email')}>
            <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        )}
        <Field label={t('password')}>
          <Input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required minLength={config?.authMode === 'supabase' ? 8 : 1} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {msg && <p className={msg.error ? 'text-sm text-danger' : 'text-sm text-success'}>{msg.text}</p>}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} icon={<Lock className="size-4" />}>
          {mode === 'signup' ? t('signUp') : t('signIn')}
        </Button>
        {config?.authMode === 'supabase' && (
          <>
            {config.supabase?.oauthProviders.map((p) => (
              <Button
                key={p}
                type="button"
                variant="outline"
                size="lg"
                className="w-full capitalize"
                onClick={() => void supabase()?.auth.signInWithOAuth({ provider: p as 'google', options: { redirectTo: location.origin } })}
              >
                {t('continueWith', { provider: p })}
              </Button>
            ))}
            <button type="button" className="w-full text-center text-sm text-muted hover:text-fg" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
              {mode === 'signin' ? 'No account yet? Create one' : 'Have an account? Sign in'}
            </button>
          </>
        )}
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const config = useApp((s) => s.config);
  return (
    <div className="aurora flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-3xl border border-line bg-panel/90 p-7 shadow-2xl backdrop-blur animate-rise">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo className="mb-3 size-11" />
          <h1 className="text-xl font-semibold tracking-tight">{config?.appName ?? 'Lumora'}</h1>
          <p className="mt-1 text-sm text-muted">Your personal AI workspace</p>
        </div>
        {children}
      </div>
    </div>
  );
}
