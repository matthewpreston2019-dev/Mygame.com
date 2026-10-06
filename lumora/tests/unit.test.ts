import { describe, expect, it } from 'vitest';
import { routeRequest } from '../shared/router';
import { calculate } from '../server/tools/calculator';
import { isPrivateIp, assertPublicUrl } from '../server/tools/ssrf';
import { queryPath } from '../server/tools/jsonTool';
import { analyzeCsv } from '../server/tools/dataAnalysis';
import { htmlToText } from '../server/tools/readUrl';
import { toAnthropicMessages } from '../server/providers/anthropic';
import { toOpenAIMessages } from '../server/providers/openaiCompatible';
import { toGeminiContents } from '../server/providers/gemini';
import { readSSE } from '../server/providers/sse';
import { tierModelFor } from '../server/providers/registry';
import type { ApiTurn, ModelInfo } from '../shared/types';

const t = (text: string) => [{ type: 'text' as const, text }];

describe('auto router', () => {
  it.each([
    ['Fix this Python error: TypeError: NoneType', 'coding'],
    ['Explain photosynthesis', 'study'],
    ['Write me a professional email to my landlord', 'writing'],
    ['Research the best laptop for students', 'research'],
    ['Help me plan my week', 'planner'],
    ['Brainstorm names for a bakery', 'creative'],
    ['Analyze this dataset for trends', 'analysis'],
    ['Explícame la fotosíntesis', 'study'],
    ['Écris un courriel professionnel', 'writing'],
    ['hi there', 'general'],
  ])('%s → %s', (text, mode) => {
    expect(routeRequest(t(text)).mode).toBe(mode);
  });
  it('detects vision and file signals', () => {
    const r = routeRequest([{ type: 'text', text: 'what is this' }, { type: 'image', mediaType: 'image/png', data: 'AAAA' }]);
    expect(r.needsVision).toBe(true);
    expect(routeRequest([{ type: 'text', text: 'look' }, { type: 'file', name: 'app.py', mime: 'text/x-python', text: 'print(1)' }]).mode).toBe('coding');
  });
  it('uses a fast tier for short general questions', () => {
    expect(routeRequest(t('hello!')).tier).toBe('fast');
  });
});

describe('calculator', () => {
  it('evaluates math and units', () => {
    expect(calculate('2 + 3 * 4')).toBe('14');
    expect(calculate('sqrt(16)')).toBe('4');
    expect(calculate('5 km to m')).toBe('5000 m');
  });
  it('blocks dangerous functions', () => {
    expect(() => calculate('import({}, {})')).toThrow();
    expect(() => calculate('evaluate("1+1")')).toThrow();
    expect(() => calculate('1:100000000')).toThrow();
  });
});

describe('ssrf guard', () => {
  it('flags private ranges', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1'])
      expect(isPrivateIp(ip)).toBe(true);
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) expect(isPrivateIp(ip)).toBe(false);
  });
  it('rejects bad URLs', async () => {
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow();
    await expect(assertPublicUrl('http://127.0.0.1/')).rejects.toThrow();
    await expect(assertPublicUrl('http://localhost:3000/')).rejects.toThrow();
    await expect(assertPublicUrl('http://user:pw@example.com/')).rejects.toThrow();
  });
});

describe('json + data tools', () => {
  it('queries paths', () => {
    const data = { items: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }], meta: { 'x-y': 3 } };
    expect(queryPath(data, 'items[1].name')).toBe('b');
    expect(queryPath(data, 'items[*].id')).toEqual([1, 2]);
    expect(queryPath(data, '$.meta["x-y"]')).toBe(3);
  });
  it('analyzes csv', () => {
    const out = analyzeCsv('city,sales\nA,10\nB,20\nA,30\n', { groupBy: 'city', value: 'sales' });
    expect(out).toContain('Rows: 3');
    expect(out).toContain('mean 20');
    expect(out).toContain('- A: 40');
  });
  it('extracts readable text from html', () => {
    const { title, text } = htmlToText('<html><head><title>Hi</title><script>evil()</script></head><body><p>Hello world</p></body></html>', 'https://x.test');
    expect(title).toBe('Hi');
    expect(text).toContain('Hello world');
    expect(text).not.toContain('evil');
  });
});

const history: ApiTurn[] = [
  { role: 'user', parts: [{ type: 'text', text: 'weather?' }, { type: 'image', mediaType: 'image/png', data: 'AAAA' }] },
  { role: 'assistant', text: 'Let me check.', toolCalls: [{ id: 'call:1', name: 'weather', args: { location: 'Paris' } }] },
  { role: 'tool', results: [{ id: 'call:1', name: 'weather', content: 'Sunny' }] },
  { role: 'assistant', text: 'It is sunny.' },
  { role: 'user', parts: [{ type: 'file', name: 'a.txt', mime: 'text/plain', text: 'file body' }, { type: 'text', text: 'summarize' }] },
];

describe('provider message conversion', () => {
  it('anthropic: pairs tool_use with tool_result and sanitizes ids', () => {
    const m = toAnthropicMessages(history, 'claude-x');
    expect(m.map((x) => x.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    const a = m[1].content as { type: string; id?: string }[];
    expect(a[1]).toMatchObject({ type: 'tool_use', id: 'call_1' });
    expect((m[2].content as { type: string; tool_use_id?: string }[])[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'call_1' });
    // Merges tool result + next user content into one user message when adjacent
    expect(JSON.stringify(m[4])).toContain('attached_file');
  });
  it('anthropic: replays native blocks only for the same model', () => {
    const native: ApiTurn = { role: 'assistant', text: 'x', native: { provider: 'anthropic', model: 'm1', blocks: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: 'x' }] } };
    expect(JSON.stringify(toAnthropicMessages([history[0], native], 'm1'))).toContain('signature');
    expect(JSON.stringify(toAnthropicMessages([history[0], native], 'm2'))).not.toContain('signature');
  });
  it('openai: emits tool messages and data URLs', () => {
    const m = toOpenAIMessages('sys', history);
    expect(m[0]).toEqual({ role: 'system', content: 'sys' });
    expect(JSON.stringify(m[1])).toContain('data:image/png;base64,AAAA');
    expect(m[2]).toMatchObject({ role: 'assistant', tool_calls: [{ id: 'call:1', function: { name: 'weather' } }] });
    expect(m[3]).toEqual({ role: 'tool', tool_call_id: 'call:1', content: 'Sunny' });
  });
  it('gemini: maps roles and function responses', () => {
    const c = toGeminiContents(history, 'gemini-x');
    expect(c[0].parts[1]).toEqual({ inlineData: { mimeType: 'image/png', data: 'AAAA' } });
    expect(c[1].role).toBe('model');
    expect(c[1].parts[1]).toMatchObject({ functionCall: { name: 'weather' } });
    expect(c[2].parts[0]).toMatchObject({ functionResponse: { name: 'weather', response: { content: 'Sunny' } } });
  });
});

describe('sse parser', () => {
  it('parses split chunks', async () => {
    const enc = new TextEncoder();
    const chunks = ['data: {"a":', '1}\n\nevent: x\ndata: two\n', '\ndata: [DONE]\n\n'];
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    });
    const out = [];
    for await (const e of readSSE(body)) out.push(e);
    expect(out).toEqual([{ event: undefined, data: '{"a":1}' }, { event: 'x', data: 'two' }, { event: undefined, data: '[DONE]' }]);
  });
});

describe('tier selection', () => {
  const mk = (p: string, ids: string[]): ModelInfo[] => ids.map((m) => ({ id: `${p}:${m}`, provider: p, model: m, label: m, vision: true }));
  it('picks anthropic families by name, newest first', () => {
    const models = mk('anthropic', ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5', 'claude-opus-4-8', 'claude-sonnet-4-6']);
    expect(tierModelFor('anthropic', models, 'fast')?.model).toBe('claude-haiku-4-5');
    expect(tierModelFor('anthropic', models, 'balanced')?.model).toBe('claude-sonnet-5-5');
    expect(tierModelFor('anthropic', models, 'powerful')?.model).toBe('claude-opus-5-5');
  });
  it('picks gemini by version and prefers stable', () => {
    const models = mk('gemini', ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-3.0-pro-preview']);
    expect(tierModelFor('gemini', models, 'fast')?.model).toBe('gemini-2.5-flash-lite');
    expect(tierModelFor('gemini', models, 'balanced')?.model).toBe('gemini-2.5-flash');
    expect(tierModelFor('gemini', models, 'powerful')?.model).toBe('gemini-2.5-pro');
  });
});
