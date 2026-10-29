// Google: Gmail (send briefings and approved emails) and YouTube (channel stats, private uploads).
//
// Uses your own free Google Cloud OAuth client. The refresh token is stored server-side only.
// Nothing is sent or uploaded without an approval, except briefings emailed to your own address.
import { getSecret, setSecret, deleteSecret, getSettings, updateSettings, FUNCTIONS_URL, HttpError, log } from './db.ts';
import { rawEmail } from './logic.ts';

const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.upload',
];
const REDIRECT = `${FUNCTIONS_URL}/google/callback`;
export const googleRedirectUri = REDIRECT;

// ── Connecting ──────────────────────────────────────────

export async function saveClient(clientId: string, clientSecret: string) {
  if (!/\.apps\.googleusercontent\.com$/.test(clientId.trim())) throw new HttpError(400, 'The Client ID should end in .apps.googleusercontent.com');
  if (clientSecret.trim().length < 10) throw new HttpError(400, 'The Client secret looks too short');
  await setSecret('google_client', JSON.stringify({ id: clientId.trim(), secret: clientSecret.trim() }));
  const s = await getSettings();
  await updateSettings({ google: { ...s.google, clientSaved: true } });
}

/** The Google consent page the owner opens to connect their account. */
export async function authUrl() {
  const client = await clientOrThrow();
  const state = crypto.randomUUID();
  await setSecret('google_state', `${state}|${Date.now() + 10 * 60_000}`);
  const s = await getSettings();
  const params = new URLSearchParams({
    client_id: client.id,
    redirect_uri: REDIRECT,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    login_hint: s.owner_email,
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/** Google redirects here after consent. Swap the code for a refresh token, then return to the app. */
export async function callback(url: URL) {
  const s = await getSettings();
  const back = (status: string) => Response.redirect(`${s.app_url || 'https://app.netlify.com'}?google=${status}`, 302);
  const [state, expires] = ((await getSecret('google_state')) ?? '').split('|');
  if (!state || url.searchParams.get('state') !== state || Date.now() > Number(expires)) return back('expired');
  await deleteSecret('google_state');
  if (url.searchParams.get('error')) return back('cancelled');

  const client = await clientOrThrow();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: url.searchParams.get('code') ?? '', client_id: client.id, client_secret: client.secret, redirect_uri: REDIRECT, grant_type: 'authorization_code' }),
  });
  const data = await res.json();
  if (!res.ok || !data.refresh_token) {
    await log('error', 'google.connect_failed', { error: data.error_description || data.error || 'no refresh token' });
    return back('failed');
  }
  await setSecret('google_refresh_token', data.refresh_token);
  token = { value: data.access_token, expires: Date.now() + (data.expires_in - 60) * 1000 };

  const email = JSON.parse(atob(data.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email;
  const channel = await myChannel().catch(() => null);
  await updateSettings({ google: { connected: true, clientSaved: true, email, channel: channel && { id: channel.id, title: channel.snippet.title }, scopes: data.scope?.split(' ') ?? [] } });
  await log('info', 'google.connected', { email, channel: channel?.snippet?.title ?? null });
  return back('connected');
}

export async function disconnect() {
  const refresh = await getSecret('google_refresh_token');
  if (refresh) await fetch(`https://oauth2.googleapis.com/revoke?token=${refresh}`, { method: 'POST' }).catch(() => {});
  await deleteSecret('google_refresh_token');
  token = null;
  const s = await getSettings();
  await updateSettings({ google: { connected: false, clientSaved: s.google.clientSaved } });
}

async function clientOrThrow(): Promise<{ id: string; secret: string }> {
  const raw = await getSecret('google_client');
  if (!raw) throw new HttpError(400, 'Add your Google OAuth Client ID and secret first.');
  return JSON.parse(raw);
}

// ── Access tokens ───────────────────────────────────────

let token: { value: string; expires: number } | null = null;

async function accessToken() {
  if (token && Date.now() < token.expires) return token.value;
  const refresh = await getSecret('google_refresh_token');
  if (!refresh) throw new HttpError(400, 'Google is not connected. Connect it in Settings → Connections.');
  const client = await clientOrThrow();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: refresh, client_id: client.id, client_secret: client.secret, grant_type: 'refresh_token' }),
  });
  const data = await res.json();
  if (!res.ok) {
    if (data.error === 'invalid_grant') {
      const s = await getSettings();
      await updateSettings({ google: { ...s.google, connected: false, error: 'Google access expired or was revoked. Connect again.' } });
    }
    throw new HttpError(400, `Google sign-in failed: ${data.error_description || data.error}`);
  }
  token = { value: data.access_token, expires: Date.now() + (data.expires_in - 60) * 1000 };
  return token.value;
}

async function google(url: string, init: RequestInit = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json', ...init.headers } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(res.status === 401 ? 400 : 502, `Google: ${data?.error?.message || res.status}`);
  return data;
}

// ── Gmail ───────────────────────────────────────────────

export async function sendEmail(mail: { to: string; subject: string; body: string }) {
  await google('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', body: JSON.stringify({ raw: rawEmail(mail) }) });
}

// ── YouTube ─────────────────────────────────────────────

async function myChannel() {
  const data = await google('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&mine=true');
  return data.items?.[0] ?? null;
}

/** A compact text snapshot of the channel for the Content worker (costs no AI requests). */
export async function youtubeStats() {
  const channel = await myChannel();
  if (!channel) return 'No YouTube channel found on the connected Google account.';
  const st = channel.statistics;
  const uploads = channel.contentDetails.relatedPlaylists.uploads;
  const items = await google(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=10&playlistId=${uploads}`);
  const ids = (items.items ?? []).map((i: any) => i.contentDetails.videoId).join(',');
  const videos = ids ? (await google(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${ids}`)).items ?? [] : [];
  const lines = videos.map((v: any) => `- ${v.snippet.title} (${v.snippet.publishedAt.slice(0, 10)}): ${v.statistics.viewCount ?? 0} views, ${v.statistics.likeCount ?? 0} likes, ${v.statistics.commentCount ?? 0} comments`);
  return `Channel "${channel.snippet.title}": ${st.subscriberCount ?? 'hidden'} subscribers, ${st.viewCount} total views, ${st.videoCount} videos.\nLatest videos:\n${lines.join('\n') || '- none yet'}`;
}

/**
 * Start a resumable upload and return its one-time upload URL. The browser sends the video
 * straight to YouTube (no size limit from our free hosting). Videos are uploaded as private:
 * YouTube keeps uploads from personal API projects private until you publish them in YouTube Studio.
 */
export async function youtubeUploadSession(p: { title: string; description: string; tags: string[] }, file: { size: number; type: string }) {
  const s = await getSettings();
  const res = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(file.size),
      'X-Upload-Content-Type': file.type || 'video/*',
      ...(s.app_url && { Origin: new URL(s.app_url).origin }), // lets the browser upload directly (CORS)
    },
    body: JSON.stringify({
      snippet: { title: p.title, description: p.description, tags: p.tags, categoryId: '22' },
      status: { privacyStatus: 'private', selfDeclaredMadeForKids: false },
    }),
  });
  const location = res.headers.get('Location');
  if (!res.ok || !location) throw new HttpError(502, `YouTube refused the upload: ${(await res.json().catch(() => ({})))?.error?.message || res.status}`);
  return location;
}

/** Confirm an uploaded video exists on the owner's channel. */
export async function youtubeVideo(id: string) {
  const data = await google(`https://www.googleapis.com/youtube/v3/videos?part=status&id=${encodeURIComponent(id)}`);
  const video = data.items?.[0];
  if (!video) throw new HttpError(400, 'That video was not found on your channel.');
  return { privacy: video.status.privacyStatus };
}
