// =============================================================================
// In-memory stand-in for the Supabase HTTP API, used only by the browser tests
// (tests/e2e/run.mjs) when the real project can't be reached from the test
// machine. Implements just what the app uses: password sign-in, PostgREST
// select/upsert/update, one RPC, and the account/push Edge Functions.
// Behaviour mirrors the real schema: server-set updated_at, unique keys,
// user_id scoping (like RLS), and new-user seeding (like handle_new_user).
// =============================================================================

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

export function createMockSupabase() {
  const db = {};             // table → array of rows
  const users = [];          // { id, email, password }
  let clock = Date.now();
  const now = () => new Date(++clock).toISOString();
  const T = (name) => (db[name] ||= []);

  const CONFLICT = {
    profiles: ['user_id'], quest_log: ['user_id', 'quest_id', 'date'], steps: ['user_id', 'date'],
    weights: ['user_id', 'date'], day_plans: ['user_id', 'date'], sleep_logs: ['user_id', 'date'],
    checkins: ['user_id', 'date'], push_subscriptions: ['endpoint'],
  };

  function seedUser(u) {
    T('profiles').push({ user_id: u.id, settings: {}, steps_token: 'tok' + u.id.slice(0, 8), updated_at: now(), deleted: false });
    const q = (key, emoji, xp, kind, days, sort) => ({ id: crypto.randomUUID(), user_id: u.id, key, title: null, emoji, xp, kind, days, sort, active: true, updated_at: now(), deleted: false });
    T('quests').push(
      q('pushups', '💪', 10, 'manual', [0, 1, 2, 3, 4, 5, 6], 1), q('study', '📚', 30, 'study', [0, 1, 2, 3, 4, 5, 6], 2),
      q('steps', '👟', 20, 'steps', [0, 1, 2, 3, 4, 5, 6], 3), q('gym', '🏋️', 40, 'workout', [1, 3, 5], 4),
      q('protein', '🥩', 15, 'protein', [0, 1, 2, 3, 4, 5, 6], 5),
    );
    const tpl = (key, ex, sort) => ({ id: crypto.randomUUID(), user_id: u.id, key, name: null, exercises: ex, sort, updated_at: now(), deleted: false });
    T('workout_templates').push(
      tpl('upper', [{ id: 'bench', sets: 3, reps: '6-8' }, { id: 'row', sets: 3, reps: '8-10' }, { id: 'ohp', sets: 3, reps: '8-10' }], 1),
      tpl('lower', [{ id: 'squat', sets: 3, reps: '6-8' }, { id: 'rdl', sets: 3, reps: '8-10' }], 2),
    );
  }

  function session(u) {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: u.id, email: u.email, role: 'authenticated', exp, aud: 'authenticated' })}.sig`;
    return {
      access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'r-' + u.id,
      user: { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
    };
  }
  const userFromAuth = (h) => {
    const tok = (h.authorization || '').replace(/^Bearer /, '');
    try { const p = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString()); return users.find((u) => u.id === p.sub); } catch { return null; }
  };

  // PostgREST filter subset: col=eq.x, col=gt.x, col=in.(a,b)
  function applyFilters(rows, params) {
    for (const [k, v] of params) {
      if (['select', 'order', 'limit', 'on_conflict', 'columns'].includes(k)) continue;
      const [op, ...rest] = v.split('.');
      const val = rest.join('.');
      if (op === 'eq') rows = rows.filter((r) => String(r[k]) === val);
      if (op === 'gt') rows = rows.filter((r) => String(r[k]) > val);
      if (op === 'in') { const set = val.replace(/^\(|\)$/g, '').split(','); rows = rows.filter((r) => set.includes(String(r[k]))); }
    }
    return rows;
  }

  const json = (status, body, headers = {}) => ({ status, body: body === undefined ? '' : JSON.stringify(body), headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', ...headers } });

  /** Handle one request. Returns { status, body, headers }. */
  async function handle(method, url, headers, bodyText) {
    const u = new URL(url);
    const path = u.pathname;
    if (method === 'OPTIONS') return json(200, {}, { 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' });
    const body = bodyText ? JSON.parse(bodyText) : null;

    // ---- auth
    if (path === '/auth/v1/token') {
      const usr = users.find((x) => x.email === body.email && x.password === body.password);
      if (!usr) return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 'invalid_credentials' });
      return json(200, session(usr));
    }
    if (path === '/auth/v1/user') {
      const usr = userFromAuth(headers);
      if (!usr) return json(401, { msg: 'invalid JWT' });
      if (method === 'PUT') { if (body.password) usr.password = body.password; }
      return json(200, session(usr).user);
    }
    if (path === '/auth/v1/logout') return { status: 204, body: '', headers: { 'access-control-allow-origin': '*' } };

    // ---- functions
    if (path === '/functions/v1/account') {
      if (body.action === 'signup') {
        if (users.length) return json(403, { error: 'Sign-ups are closed', code: 'signups_closed' });
        if (String(body.password).length < 8) return json(400, { error: 'weak', code: 'weak_password' });
        const usr = { id: crypto.randomUUID(), email: body.email, password: body.password };
        users.push(usr);
        seedUser(usr);
        return json(200, { ok: true, recoveryCode: 'ABCD-EFGH-JKMN-PQRS' });
      }
      if (body.action === 'new_recovery_code') return json(200, { ok: true, recoveryCode: 'WXYZ-2345-6789-ABCD' });
      return json(400, { error: 'Unknown action' });
    }
    if (path === '/functions/v1/push') {
      if (method === 'GET') return json(200, { publicKey: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U' });
      return json(200, { sent: 1, failed: 0 });
    }

    // ---- database
    const usr = userFromAuth(headers);
    if (path.startsWith('/rest/v1/rpc/regenerate_steps_token')) {
      const p = T('profiles').find((r) => r.user_id === usr.id);
      p.steps_token = 'new' + Math.random().toString(36).slice(2); p.updated_at = now();
      return json(200, p.steps_token);
    }
    if (path.startsWith('/rest/v1/')) {
      if (!usr) return json(401, { message: 'JWT expired' });
      const table = path.slice('/rest/v1/'.length);
      const rows = T(table);
      if (method === 'GET') {
        let out = applyFilters(rows.filter((r) => r.user_id === usr.id), u.searchParams);
        out = out.slice().sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)));
        const limit = Number(u.searchParams.get('limit') || 1000);
        return json(200, out.slice(0, limit));
      }
      if (method === 'POST') {
        const list = Array.isArray(body) ? body : [body];
        const conflict = (u.searchParams.get('on_conflict') || (CONFLICT[table] || ['id']).join(',')).split(',');
        for (const inRow of list) {
          const row = { ...inRow, user_id: inRow.user_id || usr.id };
          if (row.user_id !== usr.id) return json(403, { message: 'new row violates row-level security policy' });
          const existing = rows.find((r) => conflict.every((c) => String(r[c]) === String(row[c])));
          if (existing) Object.assign(existing, row, { updated_at: now() });
          else rows.push({ deleted: false, ...(conflict.includes('id') || table === 'push_subscriptions' ? { id: row.id || crypto.randomUUID() } : {}), ...row, updated_at: now(), created_at: row.created_at || now() });
        }
        return { status: 201, body: '', headers: { 'access-control-allow-origin': '*' } };
      }
      if (method === 'PATCH') {
        for (const r of applyFilters(rows.filter((x) => x.user_id === usr.id), u.searchParams)) Object.assign(r, body, { updated_at: now() });
        return { status: 204, body: '', headers: { 'access-control-allow-origin': '*' } };
      }
    }
    return json(404, { message: 'not found: ' + path });
  }

  return { handle, db, users, T, now };
}
