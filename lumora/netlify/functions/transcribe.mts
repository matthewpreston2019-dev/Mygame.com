import type { Config } from '@netlify/functions';
import { requireUser } from '../../server/auth';
import { env } from '../../server/env';
import { assertSameOrigin, errorResponse, HttpError, json } from '../../server/http';
import { checkQuota } from '../../server/limits';

// Optional speech-to-text fallback (Whisper via Groq or OpenAI) for browsers without the Web Speech API.
const MAX_AUDIO = 4_000_000;

export default async (req: Request) => {
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'bad_request', 'Method not allowed');
    assertSameOrigin(req);
    const user = await requireUser(req);
    const provider = env.transcriptionProvider;
    if (!provider) throw new HttpError(501, 'no_provider', 'Server transcription is not configured (needs GROQ_API_KEY or OPENAI_API_KEY).');
    await checkQuota(user.id);
    const type = req.headers.get('content-type') ?? '';
    if (!/^audio\/(webm|ogg|mp4|mpeg|wav|x-m4a|m4a)/.test(type)) throw new HttpError(415, 'bad_request', 'Unsupported audio format.');
    const audio = await req.arrayBuffer();
    if (audio.byteLength > MAX_AUDIO) throw new HttpError(413, 'too_large', 'Recording is too long.');
    const ext = type.includes('webm') ? 'webm' : type.includes('ogg') ? 'ogg' : type.includes('wav') ? 'wav' : type.includes('mpeg') ? 'mp3' : 'm4a';
    const form = new FormData();
    form.append('file', new Blob([audio], { type }), `speech.${ext}`);
    form.append('model', provider.model);
    const lang = new URL(req.url).searchParams.get('lang');
    if (lang && /^[a-z]{2}$/.test(lang)) form.append('language', lang);
    const res = await fetch(`${provider.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${provider.key}` },
      body: form,
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) {
      console.error('[lumora] transcription failed', res.status, (await res.text()).slice(0, 300));
      throw new HttpError(502, 'provider_error', 'Transcription failed. Please try again.', true);
    }
    const data = (await res.json()) as { text?: string };
    return json({ text: data.text ?? '' });
  } catch (err) {
    return errorResponse(err);
  }
};

export const config: Config = { path: '/api/transcribe' };
