// =============================================================================
// Sign in / create account / recover with your recovery code.
// The account is created by the `account` Edge Function so no confirmation
// email is needed; only the first account can ever be created (it's your app).
// =============================================================================

import { html, useState } from '../lib/preact.js';
import { supa, callFunction } from '../lib/supa.js';
import { t } from '../lib/i18n.js';
import { Seg, Field, SheetFrame } from '../components/common.js';
import { Icon } from '../components/icons.js';
import { openSheet, copyText, toast } from '../lib/ui.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function AuthScreen() {
  const [mode, setMode] = useState('signin'); // signin | signup | recover
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);

  const emailErr = touched && !EMAIL_RE.test(email.trim()) ? t('auth.badEmail') : '';
  const pwErr = touched && password.length < 8 ? t('auth.shortPassword') : '';
  const codeErr = touched && mode === 'recover' && code.replace(/[^a-z0-9]/gi, '').length < 12 ? t('auth.badCode') : '';

  async function submit(e) {
    e.preventDefault();
    setTouched(true);
    setError('');
    if (!EMAIL_RE.test(email.trim()) || password.length < 8) return;
    if (mode === 'recover' && code.replace(/[^a-z0-9]/gi, '').length < 12) return;
    if (!navigator.onLine) { setError(t('auth.offline')); return; }
    setBusy(true);
    try {
      const em = email.trim().toLowerCase();
      if (mode === 'signup') {
        const res = await callFunction('account', { body: { action: 'signup', email: em, password } });
        await showRecoveryCode(res.recoveryCode);
      } else if (mode === 'recover') {
        await callFunction('account', { body: { action: 'recover', email: em, code, password } });
        toast(t('auth.passwordChanged'));
      }
      const { error: err } = await supa.auth.signInWithPassword({ email: em, password });
      if (err) throw err;
      // App root switches to the signed-in view via onAuthStateChange.
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  function messageFor(err) {
    if (err.offline) return t('auth.offline');
    if (err.code === 'signups_closed') return t('auth.closed');
    if (err.code === 'bad_code') return t('auth.wrongCode');
    if (err.code === 'weak_password') return t('auth.shortPassword');
    if (/invalid login credentials/i.test(err.message)) return t('auth.wrongPassword');
    if (/rate limit|too many/i.test(err.message) || err.status === 429) return t('auth.rateLimited');
    return t('auth.genericError');
  }

  const switchMode = (m) => { setMode(m); setError(''); setTouched(false); };

  return html`<main class="app no-tabs"><div class="auth screen">
    <div class="brand">
      <img src="icons/icon-192.png" alt="" width="84" height="84" />
      <h1>Daily Companion</h1>
      <p>${t('auth.tagline')}</p>
    </div>

    ${mode !== 'recover' && html`<${Seg} value=${mode} onChange=${switchMode}
      options=${[{ value: 'signin', label: t('auth.signIn') }, { value: 'signup', label: t('auth.createAccount') }]} />`}
    ${mode === 'recover' && html`<div class="card mb-12"><h2 class="bold">${t('auth.recoverTitle')}</h2><p class="muted small mt-4">${t('auth.recoverText')}</p></div>`}

    <form class="mt-16" onSubmit=${submit} novalidate>
      <${Field} label=${t('auth.email')} error=${emailErr}>
        <input type="email" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false"
          value=${email} onInput=${(e) => setEmail(e.currentTarget.value)} placeholder="you@example.com" />
      </${Field}>
      ${mode === 'recover' && html`<${Field} label=${t('auth.recoveryCode')} error=${codeErr}>
        <input autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" value=${code}
          onInput=${(e) => setCode(e.currentTarget.value)} placeholder="XXXX-XXXX-XXXX-XXXX" />
      </${Field}>`}
      <${Field} label=${mode === 'signin' ? t('auth.password') : t('auth.newPassword')} error=${pwErr}
        hint=${mode !== 'signin' ? t('auth.passwordHint') : ''}>
        <div class="row" style="gap:8px">
          <input class="input grow" type=${show ? 'text' : 'password'} autocomplete=${mode === 'signin' ? 'current-password' : 'new-password'}
            value=${password} onInput=${(e) => setPassword(e.currentTarget.value)} />
          <button type="button" class="icon-btn" aria-label=${show ? t('auth.hide') : t('auth.show')} onClick=${() => setShow(!show)}>
            <${Icon} name=${show ? 'eyeOff' : 'eye'} />
          </button>
        </div>
      </${Field}>

      ${error && html`<div class="banner danger"><${Icon} name="info" /><span class="grow">${error}</span></div>`}

      <button class="btn primary block" type="submit" disabled=${busy}>
        ${busy ? html`<span class="spinner"></span>` : mode === 'signin' ? t('auth.signIn') : mode === 'signup' ? t('auth.createAccount') : t('auth.resetPassword')}
      </button>
    </form>

    <div class="center mt-16">
      ${mode === 'recover'
        ? html`<button class="link-btn" onClick=${() => switchMode('signin')}>${t('auth.backToSignIn')}</button>`
        : html`<button class="link-btn" onClick=${() => switchMode('recover')}>${t('auth.forgot')}</button>`}
    </div>
    <p class="center faint tiny mt-24">${t('auth.privacy')}</p>
  </div></main>`;
}

/** Shown once after creating the account (and when you make a new code in Settings). */
export function showRecoveryCode(code) {
  return openSheet(({ close }) => html`<${SheetFrame} title=${t('auth.saveCodeTitle')} close=${close}
      footer=${html`<button class="btn primary block" onClick=${() => close(true)}>${t('auth.savedIt')}</button>`}>
      <p class="muted mb-12">${t('auth.saveCodeText')}</p>
      <div class="copy-box mb-12"><code style="font-size:17px;color:var(--gold);letter-spacing:.05em">${code}</code>
        <button class="btn small" onClick=${() => copyText(code, t('common.copied'))}><${Icon} name="copy" />${t('common.copy')}</button>
      </div>
      <p class="faint small">${t('auth.saveCodeWhere')}</p>
    </${SheetFrame}>`, { locked: true });
}
