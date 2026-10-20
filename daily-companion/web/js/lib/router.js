// Hash router: "#/track/food" → ['track', 'food']. Hash URLs work offline and
// need no server rewrites.
import { useEffect, useState } from './preact.js';

export function currentPath() {
  const h = location.hash.replace(/^#\/?/, '');
  return h ? h.split('?')[0].split('/').filter(Boolean).map(decodeURIComponent) : ['today'];
}

export function queryParams() {
  const q = location.hash.split('?')[1] || '';
  return Object.fromEntries(new URLSearchParams(q));
}

/** Go to a route, e.g. navigate('track/food'). replace = don't add history entry. */
export function navigate(path, { replace = false } = {}) {
  const target = '#/' + String(path).replace(/^#?\/?/, '');
  if (location.hash === target) return;
  if (replace) history.replaceState(null, '', target);
  else history.pushState(null, '', target);
  dispatchEvent(new HashChangeEvent('hashchange'));
}

export function useRoute() {
  const [path, setPath] = useState(currentPath());
  useEffect(() => {
    const on = () => setPath(currentPath());
    addEventListener('hashchange', on);
    addEventListener('popstate', on);
    return () => { removeEventListener('hashchange', on); removeEventListener('popstate', on); };
  }, []);
  return path;
}
