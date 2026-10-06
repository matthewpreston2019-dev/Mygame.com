// End-to-end test of the chat engine against a local mock OpenAI-compatible server (no API keys needed).
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ApiTurn, StreamEvent } from '../shared/types';

let server: Server;
const requests: Record<string, unknown>[] = [];

function sse(res: import('node:http').ServerResponse, chunks: unknown[]) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.end('data: [DONE]\n\n');
}

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.endsWith('/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'mock-small' }, { id: 'mock-vision' }] }));
      return;
    }
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      const body = JSON.parse(raw);
      requests.push(body);
      if (body.model === 'broken') {
        res.writeHead(500);
        res.end('{"error":"boom"}');
        return;
      }
      const last = body.messages[body.messages.length - 1];
      if (last.role === 'tool') {
        sse(res, [
          { choices: [{ delta: { content: 'The answer is ' } }] },
          { choices: [{ delta: { content: last.content.split('= ')[1] } , finish_reason: 'stop' }] },
          { choices: [], usage: { prompt_tokens: 20, completion_tokens: 5 } },
        ]);
      } else if (JSON.stringify(last).includes('calculate')) {
        sse(res, [
          { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'calculator', arguments: '{"expre' } }] } }] },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ssion":"6*7"}' } }] }, finish_reason: 'tool_calls' }] },
        ]);
      } else if (JSON.stringify(last).includes('run some code')) {
        sse(res, [
          { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_c', function: { name: 'run_code', arguments: '{"language":"python","code":"print(1)"}' } }] }, finish_reason: 'tool_calls' }] },
        ]);
      } else {
        sse(res, [{ choices: [{ delta: { content: 'Hello' } }] }, { choices: [{ delta: { content: ' there!' }, finish_reason: 'stop' }] }]);
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  process.env.AUTH_MODE = 'none';
  process.env.CUSTOM_OPENAI_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.CUSTOM_OPENAI_NAME = 'Mock';
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

afterAll(() => server.close());

async function chat(body: Record<string, unknown>): Promise<StreamEvent[]> {
  const { handleChat } = await import('../server/chat');
  const res = await handleChat(
    new Request('http://localhost:8888/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-lumora': '1', origin: 'http://localhost:8888' },
      body: JSON.stringify(body),
    }),
  );
  expect(res.headers.get('content-type')).toContain('ndjson');
  const text = await res.text();
  return text.trim().split('\n').map((l) => JSON.parse(l));
}

const user = (text: string): ApiTurn => ({ role: 'user', parts: [{ type: 'text', text }] });

describe('chat engine (mock provider)', () => {
  it('streams text with routing metadata', async () => {
    const ev = await chat({ turns: [user('hi')], mode: 'auto' });
    expect(ev[0]).toMatchObject({ type: 'meta', provider: 'custom', routedBy: 'auto', mode: 'general' });
    expect(ev.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta).join('')).toBe('Hello there!');
    expect(ev.at(-1)).toMatchObject({ type: 'done', next: 'stop' });
  });

  it('runs server tools and continues the loop', async () => {
    const ev = await chat({ turns: [user('please calculate 6 times 7')], mode: 'general' });
    const result = ev.find((e) => e.type === 'tool_result');
    expect(result).toMatchObject({ name: 'calculator', ok: true, summary: '6*7 = 42' });
    const done = ev.at(-1) as Extract<StreamEvent, { type: 'done' }>;
    expect(done.next).toBe('continue');
    expect(done.turns).toHaveLength(2);
    // Step 2: send the turns back
    const ev2 = await chat({ turns: [user('please calculate 6 times 7'), ...done.turns], mode: 'general', step: 1 });
    expect(ev2.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta).join('')).toBe('The answer is 42');
    expect(ev2.find((e) => e.type === 'usage')).toMatchObject({ usage: { inputTokens: 20, outputTokens: 5 } });
  });

  it('hands client tools back to the browser', async () => {
    const ev = await chat({ turns: [user('run some code')], mode: 'coding' });
    const done = ev.at(-1) as Extract<StreamEvent, { type: 'done' }>;
    expect(done.next).toBe('client_tools');
    expect(done.pendingClientCalls?.[0]).toMatchObject({ name: 'run_code', args: { language: 'python' } });
  });

  it('falls back when the requested model fails', async () => {
    const ev = await chat({ turns: [user('hi')], mode: 'general', model: 'custom:broken' });
    const metas = ev.filter((e) => e.type === 'meta');
    expect(metas.length).toBe(2);
    expect(metas[1]).toMatchObject({ fallbackFrom: 'custom:broken', model: 'mock-small' });
    expect(ev.at(-1)).toMatchObject({ type: 'done' });
  });

  it('rejects cross-site requests and invalid bodies', async () => {
    const { handleChat } = await import('../server/chat');
    const r1 = await handleChat(new Request('http://localhost:8888/api/chat', { method: 'POST', headers: { 'x-lumora': '1', origin: 'https://evil.test' }, body: '{}' }));
    expect(r1.status).toBe(403);
    const r2 = await handleChat(new Request('http://localhost:8888/api/chat', { method: 'POST', headers: { 'x-lumora': '1' }, body: '{"turns":[]}' }));
    expect(r2.status).toBe(400);
  });
});
