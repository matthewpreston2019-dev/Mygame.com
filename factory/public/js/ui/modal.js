// One <dialog> reused for every modal: results, settings, confirmations.
import { h, fill, icon } from './dom.js';

const dialog = () => document.getElementById('modal');

export function openModal({ title, subtitle, body, small = false, onClose }) {
  const d = dialog();
  d.className = `modal${small ? ' small' : ''}`;
  fill(d,
    h('div', { class: 'modal-head' },
      h('div', {}, h('h2', {}, title), subtitle ? h('div', { class: 'muted' }, subtitle) : null),
      h('button', { class: 'icon-btn ghost', title: 'Close', onclick: () => d.close() }, icon('close')),
    ),
    h('div', { class: 'modal-body' }, body),
  );
  d.onclose = () => onClose?.();
  d.onclick = (e) => e.target === d && d.close(); // click outside
  if (!d.open) d.showModal();
  return { close: () => d.close(), body: d.querySelector('.modal-body') };
}

/** Ask before anything destructive. Resolves true / false. */
export function confirmAction(title, message, confirmLabel = 'Confirm') {
  return new Promise((resolve) => {
    let answer = false;
    const m = openModal({
      title,
      small: true,
      onClose: () => resolve(answer),
      body: h('div', {},
        h('p', { class: 'muted', style: { margin: 0 } }, message),
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'),
          h('button', { class: 'btn primary', onclick: () => { answer = true; m.close(); } }, confirmLabel),
        ),
      ),
    });
  });
}
