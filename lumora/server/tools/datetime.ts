import { optStr, ToolInputError, type ToolDef } from './types';

function validZone(tz: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    throw new ToolInputError(`Unknown time zone "${tz}". Use an IANA name like "Europe/Berlin".`);
  }
}

function fmt(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(d);
}

export const datetimeTool: ToolDef = {
  name: 'datetime',
  risk: 'safe',
  spec: {
    name: 'datetime',
    description:
      'Get the current date/time in a time zone, convert a date/time between time zones, or compute the difference between two dates.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['now', 'convert', 'diff'] },
        timezone: { type: 'string', description: 'IANA time zone, e.g. "America/New_York". Defaults to the user\'s zone.' },
        datetime: { type: 'string', description: 'ISO date/time for convert (e.g. 2025-03-01T15:00)' },
        to_timezone: { type: 'string', description: 'Target IANA zone for convert' },
        from: { type: 'string', description: 'Start ISO date for diff' },
        to: { type: 'string', description: 'End ISO date for diff' },
      },
      required: ['action'],
    },
  },
  async run(args, ctx) {
    const action = String(args.action ?? 'now');
    const tz = validZone(optStr(args.timezone, 64) ?? ctx.timezone);
    if (action === 'now') {
      const now = new Date();
      const text = `${fmt(now, tz)} (ISO UTC ${now.toISOString()})`;
      return { content: text, summary: `Now in ${tz}` };
    }
    if (action === 'convert') {
      const raw = optStr(args.datetime, 64);
      const to = validZone(optStr(args.to_timezone, 64) ?? 'UTC');
      if (!raw) throw new ToolInputError('"datetime" is required for convert');
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) throw new ToolInputError('Invalid datetime');
      return { content: `${raw} → ${fmt(d, to)}`, summary: `Converted to ${to}` };
    }
    if (action === 'diff') {
      const a = new Date(optStr(args.from, 64) ?? '');
      const b = new Date(optStr(args.to, 64) ?? '');
      if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) throw new ToolInputError('Invalid from/to dates');
      const ms = b.getTime() - a.getTime();
      const days = ms / 86_400_000;
      return {
        content: `Difference: ${days.toFixed(2)} days (${(ms / 3_600_000).toFixed(1)} hours, ${(days / 7).toFixed(2)} weeks)`,
        summary: `${Math.round(days)} days apart`,
      };
    }
    throw new ToolInputError('Unknown action');
  },
};
