import { memo, useState } from 'react';
import { AlertTriangle, Check, Copy, FileText, Pencil, RefreshCw, Volume2, VolumeX, Shuffle, ArrowRight, Square } from 'lucide-react';
import type { Message } from '@/data/types';
import { useApp } from '@/state/app';
import { useChat } from '@/state/chat';
import { speak, stopSpeaking, ttsSupported } from '@/lib/voice';
import { cn, copyText, formatBytes } from '@/lib/utils';
import { useT } from '@/i18n';
import { IconButton, Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Field';
import { Logo } from '@/components/Icon';
import { Markdown, type CodeAction } from './Markdown';
import { SourceList } from './Sources';
import { ToolActivityList } from './ToolActivity';
import { PermissionCard } from './PermissionCard';

function Attachments({ m }: { m: Message }) {
  if (!m.attachments?.length) return null;
  return (
    <div className="mb-2 flex flex-wrap justify-end gap-2">
      {m.attachments.map((a) =>
        a.kind === 'image' && a.data ? (
          <img key={a.id} src={`data:${a.mime};base64,${a.data}`} alt={a.name} className="max-h-48 max-w-[240px] rounded-2xl border border-line object-cover" />
        ) : (
          <div key={a.id} className="flex max-w-[260px] items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2 text-left" title={a.note}>
            <FileText className="size-4 shrink-0 text-accent" />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium">{a.name}</span>
              <span className="block text-[11px] text-faint">
                {formatBytes(a.size)}
                {a.truncated ? ' · truncated' : ''}
              </span>
            </span>
          </div>
        ),
      )}
    </div>
  );
}

function UserMessage({ m }: { m: Message }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content);
  const [copied, setCopied] = useState(false);
  const streaming = useChat((s) => !!s.streamingId);
  const editAndResend = useChat((s) => s.editAndResend);
  if (editing)
    return (
      <div className="ml-auto w-full max-w-[85%] animate-fade-in">
        <Textarea autoGrow value={draft} onChange={(e) => setDraft(e.target.value)} className="bg-panel" />
        <div className="mt-2 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            {t('cancel')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!draft.trim()}
            onClick={() => {
              setEditing(false);
              void editAndResend(m.id, draft.trim());
            }}
          >
            {t('send')}
          </Button>
        </div>
      </div>
    );
  return (
    <div className="group flex flex-col items-end animate-rise">
      <Attachments m={m} />
      {m.content && (
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-3xl rounded-br-lg bg-elevated px-4 py-2.5 text-[15px] leading-relaxed shadow-sm ring-1 ring-line/80">
          {m.content}
        </div>
      )}
      <div className="mt-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-sm:opacity-100">
        <IconButton
          size="sm"
          label={t('copy')}
          onClick={async () => {
            if (await copyText(m.content)) {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }
          }}
        >
          {copied ? <Check className="text-success" /> : <Copy />}
        </IconButton>
        <IconButton size="sm" label={t('edit')} disabled={streaming} onClick={() => (setDraft(m.content), setEditing(true))}>
          <Pencil />
        </IconButton>
      </div>
    </div>
  );
}

function AssistantMessage({ m, isLast, codeAction }: { m: Message; isLast: boolean; codeAction?: CodeAction }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const regenerate = useChat((s) => s.regenerate);
  const send = useChat((s) => s.send);
  const streamingId = useChat((s) => s.streamingId);
  const permission = useChat((s) => s.permission);
  const voice = useApp((s) => s.settings.voice);
  const streaming = streamingId === m.id;
  const busy = !!streamingId;
  const meta = m.meta;

  return (
    <div className="group flex gap-3 animate-rise">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl border border-line bg-panel">
        <Logo className={cn('size-5', streaming && 'animate-pulse')} />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        {meta?.model && (
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs text-faint">
            <span className="rounded-md bg-hover px-1.5 py-0.5 font-medium text-muted">{meta.modeLabel}</span>
            {meta.routedBy === 'auto' && <span title={meta.reason}>auto</span>}
            <span>·</span>
            <span className="truncate" title={`${meta.provider}:${meta.model}`}>
              {meta.model}
            </span>
            {meta.fallbackFrom && (
              <span className="flex items-center gap-1 text-warn" title={`Fell back from ${meta.fallbackFrom}`}>
                <Shuffle className="size-3" /> fallback
              </span>
            )}
          </div>
        )}
        {!!m.tools?.length && <ToolActivityList tools={m.tools} />}
        {permission && permission.messageId === m.id && <PermissionCard />}
        {m.content ? (
          <Markdown content={m.content} sources={m.sources} codeAction={codeAction} />
        ) : streaming ? (
          <div className="flex h-7 items-center gap-1.5" aria-label={t('thinking')}>
            {[0, 1, 2].map((i) => (
              <span key={i} className="size-1.5 rounded-full bg-accent animate-pulse-dot" style={{ animationDelay: `${i * 0.18}s` }} />
            ))}
          </div>
        ) : null}
        {!!m.sources?.length && !streaming && <SourceList sources={m.sources} />}

        {m.status === 'error' && m.error && (
          <div className="mt-3 rounded-2xl border border-danger/30 bg-danger/5 p-3.5">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-medium">{m.error.message}</div>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" icon={<RefreshCw className="size-3.5" />} onClick={() => regenerate(m.id)} disabled={busy}>
                    {t('retry')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => document.dispatchEvent(new CustomEvent('lumora:open-model-picker'))}>
                    {t('changeModel')}
                  </Button>
                  {m.error.code === 'no_provider' && (
                    <Button size="sm" variant="ghost" onClick={() => useApp.getState().openSettings('account')}>
                      Setup help
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        {(m.status === 'stopped' || m.meta?.stopReason === 'max_tokens') && isLast && !busy && (
          <div className="mt-3 flex items-center gap-2 text-xs text-muted">
            <Square className="size-3" /> {m.status === 'stopped' ? 'Stopped' : t('limitReached')}
            <button className="flex items-center gap-1 font-medium text-accent hover:underline" onClick={() => send(t('continue'), [])}>
              {t('continue')} <ArrowRight className="size-3" />
            </button>
          </div>
        )}

        {!streaming && m.content && (
          <div className="mt-1.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 max-sm:opacity-100">
            <IconButton
              size="sm"
              label={t('copy')}
              onClick={async () => {
                if (await copyText(m.content)) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }
              }}
            >
              {copied ? <Check className="text-success" /> : <Copy />}
            </IconButton>
            <IconButton size="sm" label={t('regenerate')} disabled={busy} onClick={() => regenerate(m.id)}>
              <RefreshCw />
            </IconButton>
            {ttsSupported() && (
              <IconButton
                size="sm"
                label={speaking ? t('stopReading') : t('readAloud')}
                onClick={() => {
                  if (speaking) {
                    stopSpeaking();
                    setSpeaking(false);
                  } else {
                    setSpeaking(true);
                    speak(m.content, { voiceURI: voice.voiceURI, rate: voice.rate, onEnd: () => setSpeaking(false) });
                  }
                }}
              >
                {speaking ? <VolumeX /> : <Volume2 />}
              </IconButton>
            )}
            {meta?.usage?.outputTokens ? (
              <span className="ml-2 text-[11px] text-faint" title="Tokens used (input / output)">
                {meta.usage.inputTokens?.toLocaleString() ?? '?'} / {meta.usage.outputTokens.toLocaleString()} tokens
              </span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

export const MessageItem = memo(function MessageItem({ m, isLast, codeAction }: { m: Message; isLast: boolean; codeAction?: CodeAction }) {
  return m.role === 'user' ? <UserMessage m={m} /> : <AssistantMessage m={m} isLast={isLast} codeAction={codeAction} />;
});
