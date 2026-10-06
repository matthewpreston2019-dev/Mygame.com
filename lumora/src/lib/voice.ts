// Voice I/O. Speech-to-text uses the browser's Web Speech API when available (Chrome, Edge, Safari),
// otherwise records audio and transcribes it on the server (needs GROQ_API_KEY or OPENAI_API_KEY).
// Text-to-speech uses the browser's built-in speechSynthesis voices (free, on-device where supported).

import { api } from './api';

type SR = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

const SpeechRecognitionCtor = (): (new () => SR) | undefined =>
  (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition;

export const sttSupport = (serverTranscription: boolean): 'browser' | 'server' | null =>
  SpeechRecognitionCtor() ? 'browser' : serverTranscription && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices ? 'server' : null;

export const ttsSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

export interface Listener {
  stop(): void;
}

export function listen(opts: {
  mode: 'browser' | 'server';
  lang?: string;
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (msg: string) => void;
  onEnd: () => void;
}): Listener {
  if (opts.mode === 'browser') {
    const Ctor = SpeechRecognitionCtor()!;
    const rec = new Ctor();
    rec.lang = opts.lang || navigator.language;
    rec.continuous = false;
    rec.interimResults = true;
    let finalText = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      opts.onInterim((finalText + interim).trim());
    };
    rec.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') opts.onError(e.error === 'not-allowed' ? 'Microphone permission was denied.' : `Speech recognition error: ${e.error}`);
    };
    rec.onend = () => {
      if (finalText.trim()) opts.onFinal(finalText.trim());
      opts.onEnd();
    };
    rec.start();
    return { stop: () => rec.stop() };
  }

  // Server transcription: record until stop() (or 60s), then upload.
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let stopped = false;
  const chunks: Blob[] = [];
  const timer = setTimeout(() => recorder?.state === 'recording' && recorder.stop(), 60_000);
  navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((s) => {
      stream = s;
      if (stopped) return s.getTracks().forEach((t) => t.stop());
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
      recorder = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = async () => {
        clearTimeout(timer);
        stream?.getTracks().forEach((t) => t.stop());
        try {
          opts.onInterim('Transcribing…');
          const type = (recorder?.mimeType || 'audio/webm').split(';')[0];
          const lang = (opts.lang || navigator.language).slice(0, 2);
          const res = await api(`/api/transcribe?lang=${encodeURIComponent(lang)}`, { method: 'POST', body: new Blob(chunks, { type }), headers: { 'Content-Type': type } });
          const { text } = (await res.json()) as { text: string };
          if (text.trim()) opts.onFinal(text.trim());
          else opts.onInterim('');
        } catch (err) {
          opts.onError((err as Error).message);
        } finally {
          opts.onEnd();
        }
      };
      recorder.start();
      opts.onInterim('Listening… tap the mic again to finish');
    })
    .catch(() => {
      opts.onError('Microphone permission was denied.');
      opts.onEnd();
    });
  return {
    stop: () => {
      stopped = true;
      if (recorder?.state === 'recording') recorder.stop();
    },
  };
}

export function markdownToSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' (code omitted) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\d+\]/g, '')
    .replace(/[#>*_~|]/g, '')
    .replace(/\$\$?[^$]+\$\$?/g, ' (formula) ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function voices(): SpeechSynthesisVoice[] {
  return ttsSupported() ? speechSynthesis.getVoices() : [];
}

export function speak(text: string, opts: { voiceURI?: string; rate?: number; lang?: string; onEnd?: () => void } = {}) {
  if (!ttsSupported()) return;
  speechSynthesis.cancel();
  const clean = markdownToSpeech(text);
  // Chrome stops long utterances; speak sentence groups sequentially.
  const parts = clean.match(/[^.!?。！？]+[.!?。！？]*\s*/g)?.reduce<string[]>((acc, s) => {
    if (acc.length && (acc[acc.length - 1] + s).length < 220) acc[acc.length - 1] += s;
    else acc.push(s);
    return acc;
  }, []) ?? [clean];
  const voice = voices().find((v) => v.voiceURI === opts.voiceURI);
  parts.forEach((p, i) => {
    const u = new SpeechSynthesisUtterance(p);
    if (voice) u.voice = voice;
    else if (opts.lang) u.lang = opts.lang;
    u.rate = opts.rate ?? 1;
    if (i === parts.length - 1 && opts.onEnd) u.onend = () => opts.onEnd?.();
    speechSynthesis.speak(u);
  });
}

export const stopSpeaking = () => ttsSupported() && speechSynthesis.cancel();
