import { beforeEach, describe, expect, it } from 'vitest';
import { authMode, checkPassword, createSessionToken, getUser, verifySessionToken } from '../server/auth';

describe('auth', () => {
  beforeEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.AUTH_MODE;
    process.env.APP_PASSWORD = 'correct horse';
    process.env.SESSION_SECRET = 'test-secret';
  });
  it('selects password mode when APP_PASSWORD is set', () => {
    expect(authMode()).toBe('password');
  });
  it('verifies passwords in constant time', () => {
    expect(checkPassword('correct horse')).toBe(true);
    expect(checkPassword('wrong')).toBe(false);
  });
  it('signs and verifies sessions, rejecting tampering and expiry', () => {
    const tok = createSessionToken();
    expect(verifySessionToken(tok)).toEqual({ sub: 'owner' });
    expect(verifySessionToken(tok.slice(0, -2) + 'xx')).toBeNull();
    expect(verifySessionToken(createSessionToken('owner', -1))).toBeNull();
    process.env.SESSION_SECRET = 'other';
    expect(verifySessionToken(tok)).toBeNull();
  });
  it('reads the session cookie', async () => {
    const tok = createSessionToken();
    const req = new Request('https://x.test/api/chat', { headers: { cookie: `a=b; lumora_session=${tok}` } });
    expect(await getUser(req)).toMatchObject({ id: 'owner', isAdmin: true });
    expect(await getUser(new Request('https://x.test/api/chat'))).toBeNull();
  });
});
