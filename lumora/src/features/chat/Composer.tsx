import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ArrowUp, FileText, Headphones, ImageIcon, Loader2, Mic, MicOff, Paperclip, Square, X } from 'lucide-react';
import type { Attachment } from '@/data/types';
import { useApp } from '@/state/app';
import { useChat } from '@/state/chat';
import { FileRejectedError, processFile } from '@/lib/files';
import { listen, speak, stopSpeaking, sttSupport, ttsSupported, type Listener } from '@/lib/voice';
import { cn, formatBytes } from '@/lib/utils';
import { useT } from '@/i18n';
import { ModePicker, ModelPicker, ToolsMenu } from './Pickers';

export interface ComposerHandle {
  addFiles(files: FileList | File[]): void;
  focus(): void;
  setText(text: string): void;
}

export const Composer = forwardRef<ComposerHandle, { autoFocus?: boolean }>(function Composer({ autoFocus }, ref) {
  const t = useT();
  const [text, setText] = useState('');
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [processing, setProcessing] = useState(0);
  const [interim, setInterim] = useState('');
  const [listening, setListening] = useState(false);
  const [voiceChat, setVoiceChat] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const listener = useRef<Listener | null>(null);
  const voiceChatRef = useRef(false);

  const send = useChat((s) => s.send);
  const stop = useChat((s) => s.stop);
  const streaming = useChat((s) => !!s.streamingId);
  const setOnDone = useChat((s) => s.setOnAssistantDone);
  const config = useApp((s) => s.config);
  const settings = useApp((s) => s.settings);
  const toast = useApp((s) => s.toast);
  const stt = sttSupport(!!config?.transcription);
  const maxFiles = config?.limits.maxFiles ?? 8;
  const maxBytes = config?.limits.maxFileBytes ?? 10_000_000;

  const addFiles = useCallback(
    async (list: FileList | File[]) => {
      const files = Array.from(list);
      if (atts.length + files.length > maxFiles) {
        toast(`You can attach up to ${maxFiles} files per message.`, { tone: 'error' });
        return;
      }
      setProcessing((n) => n + files.length);
      for (const f of files) {
        try {
          const a = await processFile(f, maxBytes);
          setAtts((cur) => [...cur, a]);
        } catch (err) {
          toast(err instanceof FileRejectedError ? err.message : `Could not read ${f.name}.`, { tone: 'error' });
        } finally {
          setProcessing((n) => n - 1);
        }
      }
    },
    [atts.length, maxFiles, maxBytes, toast],
  );

  useImperativeHandle(ref, () => ({ addFiles, focus: () => ta.current?.focus(), setText: (s) => (setText(s), ta.current?.focus()) }), [addFiles]);

  // Auto-grow
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.4)) + 'px';
  }, [text, interim]);

  useEffect(() => {
    if (autoFocus && window.matchMedia('(pointer: fine)').matches) ta.current?.focus();
  }, [autoFocus]);

  const submit = useCallback(
    (override?: string) => {
      const value = (override ?? text).trim();
      if ((!value && !atts.length) || streaming || processing) return;
      void send(value, atts);
      setText('');
      setAtts([]);
    },
    [text, atts, streaming, processing, send],
  );

  const startListening = useCallback(() => {
    if (!stt) return;
    stopSpeaking();
    setListening(true);
    listener.current = listen({
      mode: stt,
      lang: settings.replyLanguage !== 'auto' ? settings.replyLanguage : undefined,
      onInterim: setInterim,
      onFinal: (final) => {
        setInterim('');
        if (voiceChatRef.current) submit(final);
        else setText((cur) => (cur ? cur + ' ' : '') + final);
      },
      onError: (msg) => toast(msg, { tone: 'error' }),
      onEnd: () => {
        setListening(false);
        setInterim('');
        listener.current = null;
      },
    });
  }, [stt, settings.replyLanguage, submit, toast]);

  // Voice conversation: speak each finished answer, then listen again.
  useEffect(() => {
    voiceChatRef.current = voiceChat;
    if (!voiceChat && !settings.voice.autoSpeak) {
      setOnDone(null);
      return;
    }
    setOnDone((m) => {
      if (!m.content) return;
      speak(m.content, {
        voiceURI: settings.voice.voiceURI,
        rate: settings.voice.rate,
        onEnd: () => voiceChatRef.current && startListening(),
      });
    });
    return () => setOnDone(null);
  }, [voiceChat, settings.voice, setOnDone, startListening]);

  const canSend = (text.trim() || atts.length) && !processing;

  return (
    <div className="w-full">
      <div
        className={cn(
          'relative rounded-[26px] border border-line bg-panel shadow-[0_8px_30px_-12px_rgba(0,0,0,0.25)] transition-[border-color,box-shadow] focus-within:border-accent/50 focus-within:shadow-[0_8px_40px_-12px_color-mix(in_oklab,var(--accent)_45%,transparent)]',
        )}
      >
        {(atts.length > 0 || processing > 0) && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {atts.map((a) => (
              <div key={a.id} className="group relative flex items-center gap-2 rounded-xl border border-line bg-bg py-1.5 pl-1.5 pr-7" title={a.note}>
                {a.kind === 'image' && a.data ? (
                  <img src={`data:${a.mime};base64,${a.data}`} alt="" className="size-9 rounded-lg object-cover" />
                ) : (
                  <span className="flex size-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    {a.kind === 'image' ? <ImageIcon className="size-4" /> : <FileText className="size-4" />}
                  </span>
                )}
                <span className="max-w-[150px]">
                  <span className="block truncate text-[12.5px] font-medium">{a.name}</span>
                  <span className="block text-[11px] text-faint">
                    {formatBytes(a.size)}
                    {a.truncated && ' · truncated'}
                  </span>
                </span>
                <button aria-label="Remove attachment" className="absolute right-1.5 top-1.5 rounded-full p-0.5 text-faint hover:bg-hover hover:text-fg" onClick={() => setAtts((cur) => cur.filter((x) => x.id !== a.id))}>
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
            {processing > 0 && (
              <div className="flex items-center gap-2 rounded-xl border border-dashed border-line px-3 text-xs text-muted">
                <Loader2 className="size-3.5 animate-spin" /> Reading {processing} file{processing > 1 ? 's' : ''} locally…
              </div>
            )}
          </div>
        )}
        <textarea
          ref={ta}
          rows={1}
          value={interim ? (text ? text + ' ' : '') + interim : text}
          onChange={(e) => setText(e.target.value)}
          placeholder={listening ? 'Listening…' : t('askAnything')}
          aria-label={t('askAnything')}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files);
            if (files.length) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && (settings.enterToSend ? !e.metaKey : e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          className="block max-h-[40vh] min-h-[52px] w-full resize-none bg-transparent px-4.5 pb-1 pt-3.5 text-[15px] leading-relaxed outline-none placeholder:text-faint"
        />
        <div className="flex min-w-0 items-center gap-1.5 px-2.5 pb-2.5 pt-1">
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => e.target.files && (void addFiles(e.target.files), (e.target.value = ''))} />
          <button
            aria-label={t('attach')}
            title={`${t('attach')} — files are read in your browser; only extracted text is sent`}
            onClick={() => fileInput.current?.click()}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-fg"
          >
            <Paperclip className="size-[18px]" />
          </button>
          <ModePicker />
          <ModelPicker />
          <ToolsMenu />
          <span className="flex-1" />
          {stt && ttsSupported() && (
            <button
              aria-label={t('voiceConversation')}
              title={t('voiceConversation')}
              onClick={() => {
                const next = !voiceChat;
                setVoiceChat(next);
                if (next) startListening();
                else {
                  listener.current?.stop();
                  stopSpeaking();
                }
              }}
              className={cn('hidden size-8 shrink-0 items-center justify-center rounded-full transition-colors sm:flex', voiceChat ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-hover hover:text-fg')}
            >
              <Headphones className="size-[18px]" />
            </button>
          )}
          {stt && (
            <button
              aria-label={t('voice')}
              title={t('voice')}
              onClick={() => (listening ? listener.current?.stop() : startListening())}
              className={cn('flex size-8 shrink-0 items-center justify-center rounded-full transition-colors', listening ? 'bg-danger/15 text-danger' : 'text-muted hover:bg-hover hover:text-fg')}
            >
              {listening ? <MicOff className="size-[18px]" /> : <Mic className="size-[18px]" />}
            </button>
          )}
          {streaming ? (
            <button aria-label={t('stop')} title={t('stop')} onClick={stop} className="flex size-9 shrink-0 items-center justify-center rounded-full bg-fg text-bg transition-transform hover:scale-105">
              <Square className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              aria-label={t('send')}
              title={t('send')}
              disabled={!canSend}
              onClick={() => submit()}
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-accent text-white shadow-md transition-[transform,opacity] hover:scale-105 disabled:scale-100 disabled:opacity-30 disabled:shadow-none"
            >
              <ArrowUp className="size-[18px]" strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
