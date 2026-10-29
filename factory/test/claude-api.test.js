// The live Claude path, against a local mock of the Messages API (no real calls, no cost).
// Checks request shapes, model tiers, web search, structured outputs, cost tracking and approvals.
import './setup.js';
import http from 'node:http';

const requests = [];
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const params = JSON.parse(body);
    requests.push({ headers: req.headers, params });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(reply(params)));
  });
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${mock.address().port}`;
process.env.ANTHROPIC_API_KEY = 'test-key';
delete process.env.FACTORY_DEMO;

function reply(params) {
  const schema = params.output_config?.format?.schema;
  let text;
  if (schema?.properties?.tasks) {
    text = JSON.stringify({
      reply: 'On it — three workers are starting.',
      tasks: [
        { title: 'Minecraft trends', cloud: 'gaming', project: 'Minecraft Servers', worker: 'research', instruction: 'Research Minecraft server trends', needs: [], tier: 'standard', skill: '' },
        { title: 'Merch business case', cloud: 'finance', project: 'Merch', worker: 'finance', instruction: 'Analyse selling game merch using the trends', needs: [0], tier: 'standard', skill: '' },
        { title: 'Launch email', cloud: 'assistant', project: 'Tasks & Reminders', worker: 'assistant', instruction: 'Draft an email to my supplier', needs: [], tier: 'fast', skill: '' },
      ],
      schedules: [{ name: 'Weekly trends', cloud: 'research', project: 'Trends', worker: 'research', instruction: 'Scan gaming trends', every: 'weekly', at: '09:00' }],
    });
  } else if (schema?.properties?.ok) {
    text = JSON.stringify({ ok: true, summary: 'Looks complete.', issues: [] });
  } else if (params.messages[0].content.includes('Draft an email')) {
    text = 'Here is the draft.\n```approval\n{"kind":"message","summary":"Email supplier about merch","details":"Hello…"}\n```';
  } else {
    text = `## Result\nDone: ${params.messages[0].content.split('\n')[0]}`;
  }
  return {
    id: 'msg_test', type: 'message', role: 'assistant', model: params.model, stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
    usage: { input_tokens: 1000, output_tokens: 500, server_tool_use: params.tools ? { web_search_requests: 2 } : undefined },
  };
}

const test = (await import('node:test')).default;
const assert = (await import('node:assert/strict')).default;
const { db, load } = await import('../server/core/store.js');
const { seed } = await import('../server/factory/world.js');
const { handleMessage } = await import('../server/factory/manager.js');
const { until } = await import('./setup.js');

load();
seed();

test('a chat message runs end to end against the Claude API', async () => {
  const msg = await handleMessage('Research Minecraft trends, then a merch business case, and draft an email to my supplier');
  assert.equal(msg.text, 'On it — three workers are starting.');
  const tasks = msg.taskIds.map((id) => db.tasks.find((t) => t.id === id));
  await until(() => tasks.every((t) => t.status === 'done'));

  // Planner and verifier use the economical model; research gets web search on the standard model.
  const planner = requests[0].params;
  assert.equal(planner.model, 'claude-haiku-5-5');
  assert.equal(planner.output_config.format.type, 'json_schema');
  assert.match(requests[0].headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  const research = requests.find((r) => r.params.tools);
  assert.equal(research.params.model, 'claude-sonnet-5-5');
  assert.equal(research.params.tools[0].type, 'web_search_20260209');
  assert.ok(requests.every((r) => r.params.temperature === undefined && !r.params.thinking), 'no removed parameters sent');

  // The dependent task received the research result.
  const merch = requests.find((r) => r.params.messages[0].content.startsWith('Task: Merch business case'));
  assert.match(merch.params.messages[0].content, /Results shared by other workers/);

  // New project created in the right place; schedule created; approval requested, not executed.
  assert.ok(db.projects.some((p) => p.cloudId === 'finance' && p.name === 'Merch'));
  assert.ok(db.schedules.some((s) => s.name === 'Weekly trends' && s.every === 'weekly'));
  const approval = db.approvals.find((a) => a.kind === 'message');
  assert.equal(approval.status, 'pending');

  // Spend is tracked (haiku + sonnet + 2 web searches > 0).
  assert.ok(db.spend.dayUsd > 0.02);
  assert.ok(tasks.every((t) => t.verified === true && t.costUsd > 0));
});

test.after(() => mock.close());
