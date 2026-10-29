// Sign-in screen. Only the owner's email can use the factory.
// First time (or a forgotten password): choose a password with the one-time setup code.
import { h, fill } from './dom.js';
import { sb, api } from '../api.js';
import { OWNER_EMAIL } from '../config.js';

const el = () => document.getElementById('auth');

export function showAuth() {
  el().classList.remove('hidden');
  render('signin');
}

export const hideAuth = () => el().classList.add('hidden');

function render(mode, message = '') {
  const email = h('input', { class: 'input', type: 'email', value: OWNER_EMAIL, autocomplete: 'username', required: true });
  const password = h('input', { class: 'input', type: 'password', autocomplete: mode === 'setup' ? 'new-password' : 'current-password', minlength: mode === 'setup' ? 8 : null, required: true });
  const code = h('input', { class: 'input mono', placeholder: 'e.g. 3F9A1C07BD', autocomplete: 'one-time-code', required: true });
  const error = h('p', { class: 'auth-error' }, message);
  const button = h('button', { class: 'btn primary', type: 'submit', style: { width: '100%' } }, mode === 'setup' ? 'Set password & sign in' : 'Sign in');

  const submit = async (e) => {
    e.preventDefault();
    button.disabled = true;
    error.textContent = '';
    try {
      if (mode === 'setup') await api('setup', { email: email.value, password: password.value, code: code.value });
      const { error: err } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
      if (err) throw new Error(err.message === 'Invalid login credentials' ? 'Wrong email or password.' : err.message);
      // main.js reacts to the new session and loads the factory.
    } catch (err) {
      error.textContent = err.message;
      button.disabled = false;
    }
  };

  fill(el(),
    h('form', { class: 'auth-card', onsubmit: submit },
      h('div', { class: 'auth-mark' }),
      h('h1', {}, 'Worker Factory'),
      h('p', { class: 'muted' }, mode === 'setup' ? 'Choose your password with the setup code Claude gave you.' : 'Sign in to your factory.'),
      h('label', { class: 'field' }, h('span', {}, 'Email'), email),
      mode === 'setup' ? h('label', { class: 'field' }, h('span', {}, 'Setup code'), code) : null,
      h('label', { class: 'field' }, h('span', {}, mode === 'setup' ? 'New password (8+ characters)' : 'Password'), password),
      error,
      button,
      h('button', { class: 'auth-switch', type: 'button', onclick: () => render(mode === 'setup' ? 'signin' : 'setup') },
        mode === 'setup' ? 'I already have a password' : 'First time, or forgot your password? Use your setup code'),
    ),
  );
  (mode === 'setup' ? code : password).focus();
}
