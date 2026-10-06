import { str, ToolInputError, type ToolDef } from './types';

/** Evaluates a simple path like `a.b[0].c`, `items[*].name` or `$.data.list`. */
export function queryPath(data: unknown, path: string): unknown {
  const tokens: (string | number | '*')[] = [];
  const re = /\[(\*|\d+|"[^"]*"|'[^']*')\]|\.?([^.[\]]+)/g;
  let m: RegExpExecArray | null;
  const p = path.trim().replace(/^\$\.?/, '');
  while ((m = re.exec(p))) {
    if (m[1] !== undefined) {
      const t = m[1];
      tokens.push(t === '*' ? '*' : /^\d+$/.test(t) ? Number(t) : t.slice(1, -1));
    } else if (m[2] !== undefined) tokens.push(m[2] === '*' ? '*' : m[2]);
  }
  let current: unknown[] = [data];
  let wildcard = false;
  for (const tok of tokens) {
    const next: unknown[] = [];
    for (const v of current) {
      if (v === null || typeof v !== 'object') continue;
      if (tok === '*') {
        wildcard = true;
        next.push(...(Array.isArray(v) ? v : Object.values(v)));
      } else {
        const val = (v as Record<string | number, unknown>)[tok];
        if (val !== undefined) next.push(val);
      }
    }
    current = next;
  }
  return wildcard ? current : current[0];
}

function describe(v: unknown, depth = 0): string {
  if (Array.isArray(v)) return `array(${v.length})${v.length && depth < 2 ? ` of ${describe(v[0], depth + 1)}` : ''}`;
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (depth >= 2) return `object{${keys.length} keys}`;
    return `{ ${keys.slice(0, 30).map((k) => `${k}: ${describe((v as Record<string, unknown>)[k], depth + 1)}`).join(', ')}${keys.length > 30 ? ', …' : ''} }`;
  }
  return v === null ? 'null' : typeof v;
}

export const jsonTool: ToolDef = {
  name: 'json_tool',
  risk: 'safe',
  spec: {
    name: 'json_tool',
    description:
      'Process JSON: validate (with error position), describe its structure, query a path (e.g. "items[*].name"), pretty-format or minify. Provide the JSON text directly or the name of an attached .json file.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['validate', 'structure', 'query', 'format', 'minify'] },
        json: { type: 'string', description: 'JSON text (omit if using file)' },
        file: { type: 'string', description: 'Name of an attached JSON file' },
        path: { type: 'string', description: 'Path for query, e.g. "data.users[0].email" or "items[*].id"' },
      },
      required: ['action'],
    },
  },
  async run(args, ctx) {
    const action = String(args.action);
    const fileName = typeof args.file === 'string' ? args.file : undefined;
    const raw = fileName ? ctx.files.get(fileName) : (args.json as string | undefined);
    if (fileName && raw === undefined) throw new ToolInputError(`No attached file named "${fileName}"`);
    const text = str(raw, 'json', 2_000_000);
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (action === 'validate') return { content: `Invalid JSON: ${msg}`, summary: 'Invalid JSON' };
      throw new ToolInputError(`Invalid JSON: ${msg}`);
    }
    const cap = (s: string) => (s.length > 20_000 ? s.slice(0, 20_000) + '\n…[truncated]' : s);
    switch (action) {
      case 'validate':
        return { content: `Valid JSON. Structure: ${describe(data)}`, summary: 'Valid JSON' };
      case 'structure':
        return { content: describe(data), summary: 'Described JSON structure' };
      case 'query': {
        const path = str(args.path, 'path', 500);
        const result = queryPath(data, path);
        return { content: cap(JSON.stringify(result, null, 2) ?? 'undefined'), summary: `Queried ${path}` };
      }
      case 'format':
        return { content: cap(JSON.stringify(data, null, 2)), summary: 'Formatted JSON' };
      case 'minify':
        return { content: cap(JSON.stringify(data)), summary: 'Minified JSON' };
      default:
        throw new ToolInputError('Unknown action');
    }
  },
};
