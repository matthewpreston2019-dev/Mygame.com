import Papa from 'papaparse';
import { optStr, ToolInputError, type ToolDef } from './types';

type Row = Record<string, string>;

const toNum = (v: string | undefined): number | null => {
  if (v === undefined) return null;
  const s = v.replace(/[,\s$€£%]/g, '');
  if (s === '' || !/^-?\d*\.?\d+(e-?\d+)?$/i.test(s)) return null;
  return Number(s);
};

function stats(nums: number[]) {
  const sorted = [...nums].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const std = Math.sqrt(sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
  const q = (p: number) => sorted[Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))))];
  return { count: n, sum, mean, median, std, min: sorted[0], q1: q(0.25), q3: q(0.75), max: sorted[n - 1] };
}

const r = (x: number) => (Math.abs(x) >= 1000 ? x.toFixed(1) : Number(x.toPrecision(6)).toString());

export function analyzeCsv(csv: string, opts: { groupBy?: string; value?: string; agg?: string } = {}): string {
  const parsed = Papa.parse<Row>(csv.trim(), { header: true, skipEmptyLines: true });
  const rows = parsed.data;
  const cols = parsed.meta.fields ?? [];
  if (!rows.length || !cols.length) throw new ToolInputError('No tabular data found (expected CSV with a header row)');
  const out: string[] = [`Rows: ${rows.length}, columns: ${cols.length}`];
  for (const c of cols) {
    const values = rows.map((row) => row[c]);
    const missing = values.filter((v) => v === undefined || v === '').length;
    const nums = values.map(toNum).filter((v): v is number => v !== null);
    if (nums.length >= Math.max(1, (values.length - missing) * 0.8)) {
      const s = stats(nums);
      out.push(`- ${c} (numeric): count ${s.count}, missing ${missing}, min ${r(s.min)}, q1 ${r(s.q1)}, median ${r(s.median)}, mean ${r(s.mean)}, q3 ${r(s.q3)}, max ${r(s.max)}, std ${r(s.std)}, sum ${r(s.sum)}`);
    } else {
      const freq = new Map<string, number>();
      for (const v of values) if (v) freq.set(v, (freq.get(v) ?? 0) + 1);
      const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      out.push(`- ${c} (text): ${freq.size} unique, missing ${missing}; top: ${top.map(([k, n]) => `${k.slice(0, 40)} (${n})`).join(', ')}`);
    }
  }
  if (opts.groupBy) {
    if (!cols.includes(opts.groupBy)) throw new ToolInputError(`Unknown group_by column "${opts.groupBy}"`);
    if (opts.value && !cols.includes(opts.value)) throw new ToolInputError(`Unknown value column "${opts.value}"`);
    const agg = opts.agg ?? (opts.value ? 'sum' : 'count');
    const groups = new Map<string, number[]>();
    for (const row of rows) {
      const k = row[opts.groupBy] || '(blank)';
      const v = opts.value ? toNum(row[opts.value]) : 1;
      if (v === null) continue;
      groups.set(k, [...(groups.get(k) ?? []), v]);
    }
    const lines = [...groups.entries()].map(([k, vals]) => {
      const s = stats(vals);
      const val = agg === 'mean' ? s.mean : agg === 'min' ? s.min : agg === 'max' ? s.max : agg === 'median' ? s.median : agg === 'count' ? s.count : s.sum;
      return [k, val] as const;
    });
    lines.sort((a, b) => b[1] - a[1]);
    out.push('', `${agg}(${opts.value ?? 'rows'}) by ${opts.groupBy}:`, ...lines.slice(0, 50).map(([k, v]) => `- ${k}: ${r(v)}`));
  }
  return out.join('\n');
}

export const dataAnalysisTool: ToolDef = {
  name: 'data_analysis',
  risk: 'safe',
  spec: {
    name: 'data_analysis',
    description:
      'Compute exact descriptive statistics for CSV/tabular data (per-column count, missing, min/max, mean, median, quartiles, std, top values) and optional group-by aggregation. Reference an attached file by name (preferred) or pass CSV text.',
    parameters: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Name of an attached CSV/XLSX file' },
        csv: { type: 'string', description: 'CSV text with a header row (if no file)' },
        group_by: { type: 'string', description: 'Column to group by' },
        value_column: { type: 'string', description: 'Numeric column to aggregate' },
        agg: { type: 'string', enum: ['sum', 'mean', 'median', 'min', 'max', 'count'] },
      },
    },
  },
  async run(args, ctx) {
    const file = optStr(args.file, 300);
    let csv = file ? ctx.files.get(file) : optStr(args.csv, 2_000_000);
    if (file && csv === undefined) {
      const match = [...ctx.files.keys()].find((k) => k.toLowerCase().includes(file.toLowerCase()));
      csv = match ? ctx.files.get(match) : undefined;
    }
    if (!csv) throw new ToolInputError(file ? `No attached file named "${file}"` : 'Provide "file" or "csv"');
    // XLSX files are attached as "## Sheet: name" sections of CSV; analyse the first sheet.
    if (csv.startsWith('## Sheet:')) csv = csv.split(/^## Sheet:.*$/m)[1] ?? csv;
    const content = analyzeCsv(csv, { groupBy: optStr(args.group_by, 200), value: optStr(args.value_column, 200), agg: optStr(args.agg, 20) });
    return { content, summary: `Analysed ${file ?? 'data'}` };
  },
};
