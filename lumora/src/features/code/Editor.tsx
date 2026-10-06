import { useEffect, useMemo, useState } from 'react';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';

function langFor(path: string) {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (['js', 'mjs', 'cjs', 'jsx'].includes(ext)) return [javascript({ jsx: true })];
  if (['ts', 'tsx'].includes(ext)) return [javascript({ jsx: ext === 'tsx', typescript: true })];
  if (ext === 'py') return [python()];
  if (['html', 'htm', 'svelte', 'vue'].includes(ext)) return [html()];
  if (['css', 'scss', 'less'].includes(ext)) return [css()];
  if (ext === 'json') return [json()];
  if (['md', 'markdown'].includes(ext)) return [markdown()];
  return [];
}

function useDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

export default function Editor({ path, value, onChange }: { path: string; value: string; onChange: (v: string) => void }) {
  const dark = useDark();
  const extensions = useMemo(
    () => [...langFor(path), EditorView.lineWrapping, EditorView.theme({ '&': { fontSize: '13px', height: '100%' }, '.cm-scroller': { fontFamily: 'var(--font-mono)' } })],
    [path],
  );
  return <CodeMirror value={value} onChange={onChange} extensions={extensions} theme={dark ? oneDark : 'light'} height="100%" className="h-full" basicSetup={{ foldGutter: true, highlightActiveLine: true }} />;
}
