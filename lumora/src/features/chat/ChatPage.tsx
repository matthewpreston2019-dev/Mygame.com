import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowDown, Download, FolderOpen, Menu, MoreHorizontal, Share2, Upload } from 'lucide-react';
import { MODE_ORDER, MODES } from '@shared/modes';
import { data } from '@/data/store';
import { useApp } from '@/state/app';
import { useChat } from '@/state/chat';
import { exportConversation, snapshotHtml } from '@/lib/export';
import { copyText, downloadText, safeFilename } from '@/lib/utils';
import { useT } from '@/i18n';
import { IconButton } from '@/components/ui/Button';
import { MenuItem, MenuSeparator, Popover } from '@/components/ui/Popover';
import { Logo, ModeIcon } from '@/components/Icon';
import { Composer, type ComposerHandle } from './Composer';
import { MessageItem } from './MessageItem';

function Welcome({ onPick }: { onPick: (text: string) => void }) {
  const t = useT();
  const name = useApp((s) => (s.settings.instructions.enabled ? s.settings.instructions.name : undefined));
  const mode = useChat((s) => s.mode);
  const setMode = useChat((s) => s.setMode);
  const project = useApp((s) => s.projects.find((p) => p.id === s.activeProjectId));
  const builtIn = mode !== 'auto' && !mode.startsWith('custom:') ? MODES[mode as keyof typeof MODES] : null;
  const suggestions = builtIn ? builtIn.suggestions : [MODES.coding.suggestions[0], MODES.study.suggestions[0], MODES.writing.suggestions[0], MODES.planner.suggestions[0]];
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 pt-[12vh] text-center animate-fade-in">
      <Logo className="mb-5 size-12 drop-shadow-[0_6px_24px_rgba(139,123,255,0.45)]" />
      <h1 className="text-[28px] font-semibold tracking-tight sm:text-[34px]">
        <span className="text-gradient">{t('welcomeTitle', { name: name ? `, ${name}` : '' })}</span>
      </h1>
      <p className="mt-2 max-w-lg text-[15px] text-muted">{project ? `Project · ${project.name}` : t('welcomeSubtitle')}</p>
      <div className="mt-7 flex max-w-2xl flex-wrap justify-center gap-2">
        {MODE_ORDER.map((id) => (
          <button
            key={id}
            onClick={() => setMode(mode === id ? 'auto' : id)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
              mode === id ? 'border-accent/60 bg-accent/10 text-fg' : 'border-line text-muted hover:bg-hover hover:text-fg'
            }`}
          >
            <ModeIcon name={MODES[id].icon} className="size-3.5" /> {MODES[id].label}
          </button>
        ))}
      </div>
      <div className="mt-6 grid w-full max-w-2xl gap-2 sm:grid-cols-2">
        {suggestions.map((s) => (
          <button key={s} onClick={() => onPick(s)} className="rounded-2xl border border-line bg-panel/50 px-4 py-3 text-left text-sm text-muted transition-colors hover:border-accent/40 hover:bg-hover hover:text-fg">
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ChatPage() {
  const t = useT();
  const { id } = useParams();
  const navigate = useNavigate();
  const composer = useRef<ComposerHandle>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [dragging, setDragging] = useState(false);

  const messages = useChat((s) => s.messages);
  const activeId = useChat((s) => s.activeId);
  const loading = useChat((s) => s.loading);
  const openConversation = useChat((s) => s.openConversation);
  const newChat = useChat((s) => s.newChat);
  const conversations = useApp((s) => s.conversations);
  const conv = conversations.find((c) => c.id === activeId);
  const project = useApp((s) => s.projects.find((p) => p.id === (conv?.projectId ?? s.activeProjectId)));
  const setSidebar = useApp((s) => s.setSidebar);
  const config = useApp((s) => s.config);
  const toast = useApp((s) => s.toast);

  // Route ↔ state sync
  useEffect(() => {
    if (id && id !== activeId) void openConversation(id);
    if (!id && activeId && !useChat.getState().streamingId) newChat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    if (activeId && activeId !== id) navigate(`/c/${activeId}`, { replace: !id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  useEffect(() => {
    document.title = conv ? `${conv.title} · ${config?.appName ?? 'Lumora'}` : (config?.appName ?? 'Lumora');
  }, [conv, config]);

  // Stick to bottom while streaming if the user hasn't scrolled up.
  const last = messages[messages.length - 1];
  const permission = useChat((s) => s.permission);
  useEffect(() => {
    const el = scroller.current;
    if (el && atBottom) el.scrollTop = el.scrollHeight;
  }, [last?.content, last?.tools?.length, last?.status, messages.length, atBottom, permission]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  const share = async () => {
    if (!conv) return;
    const snapshot = { title: conv.title, createdAt: Date.now(), messages: messages.map(({ role, content, sources, meta }) => ({ role, content, sources, meta })) };
    try {
      const shareId = await data().createShare(snapshot);
      if (shareId) {
        const url = `${location.origin}/share/${shareId}`;
        await copyText(url);
        toast(t('shareLinkCopied'), { tone: 'success' });
      } else {
        downloadText(snapshotHtml(snapshot), `${safeFilename(conv.title)}.html`, 'text/html');
        toast(t('shareDownloaded'), { tone: 'success' });
      }
    } catch {
      toast('Could not create a share link.', { tone: 'error' });
    }
  };

  return (
    <div
      className="relative flex h-full min-w-0 flex-1 flex-col"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) composer.current?.addFiles(e.dataTransfer.files);
      }}
    >
      <header className="flex h-14 shrink-0 items-center gap-2 px-3 sm:px-4">
        <IconButton label="Menu" className="md:hidden" onClick={() => setSidebar(true)}>
          <Menu />
        </IconButton>
        <div className="min-w-0 flex-1">
          {conv && <div className="truncate text-[14px] font-medium">{conv.title}</div>}
          {project && (
            <div className="flex items-center gap-1 text-xs text-faint">
              <FolderOpen className="size-3" /> {project.name}
            </div>
          )}
        </div>
        {conv && messages.length > 0 && (
          <>
            <IconButton label={t('share')} onClick={share}>
              <Share2 />
            </IconButton>
            <Popover
              align="end"
              trigger={({ toggle, ref }) => (
                <IconButton ref={ref} label={t('export')} onClick={toggle}>
                  <MoreHorizontal />
                </IconButton>
              )}
            >
              {(close) => (
                <>
                  <MenuItem icon={<Download />} onClick={() => (exportConversation(conv, messages, 'md'), close())}>
                    {t('export')} · Markdown
                  </MenuItem>
                  <MenuItem icon={<Download />} onClick={() => (exportConversation(conv, messages, 'json'), close())}>
                    {t('export')} · JSON
                  </MenuItem>
                  <MenuItem icon={<Download />} onClick={() => (exportConversation(conv, messages, 'html'), close())}>
                    {t('export')} · HTML
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem icon={<Upload />} onClick={() => (share(), close())}>
                    {t('share')}
                  </MenuItem>
                </>
              )}
            </Popover>
          </>
        )}
      </header>

      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 && !loading ? (
          <Welcome onPick={(s) => composer.current?.setText(s)} />
        ) : (
          <div className="mx-auto w-full max-w-3xl space-y-7 px-4 pb-8 pt-4">
            {messages.map((m, i) => (
              <MessageItem key={m.id} m={m} isLast={i === messages.length - 1} />
            ))}
          </div>
        )}
      </div>

      {!atBottom && messages.length > 0 && (
        <button
          aria-label="Scroll to bottom"
          onClick={() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })}
          className="absolute bottom-36 left-1/2 z-10 flex size-9 -translate-x-1/2 items-center justify-center rounded-full border border-line bg-elevated shadow-lg animate-fade-in"
        >
          <ArrowDown className="size-4" />
        </button>
      )}

      <div className="mx-auto w-full max-w-3xl shrink-0 px-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:px-4">
        <Composer ref={composer} autoFocus />
        <p className="mt-2 text-center text-[11px] text-faint">AI can make mistakes. Check important information. Attached files are processed in your browser.</p>
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-3xl border-2 border-dashed border-accent/60 bg-bg/80 backdrop-blur-sm">
          <div className="text-center">
            <Upload className="mx-auto mb-2 size-8 text-accent" />
            <div className="font-medium">{t('dropFiles')}</div>
            <div className="mt-1 text-xs text-muted">PDF, DOCX, XLSX, CSV, TXT, JSON, Markdown, code, images</div>
          </div>
        </div>
      )}
    </div>
  );
}
