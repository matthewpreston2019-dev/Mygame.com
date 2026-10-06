import { useMemo, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Archive,
  ArchiveRestore,
  Code2,
  Download,
  Folder,
  FolderInput,
  FolderPlus,
  LogOut,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Star,
  StarOff,
  Trash2,
  X,
} from 'lucide-react';
import type { Conversation } from '@/data/types';
import { data } from '@/data/store';
import { useApp } from '@/state/app';
import { useChat } from '@/state/chat';
import { exportConversation } from '@/lib/export';
import { cn, dateGroup, type DateGroup } from '@/lib/utils';
import { useT, type TKey } from '@/i18n';
import { Logo } from '@/components/Icon';
import { IconButton } from '@/components/ui/Button';
import { MenuItem, MenuLabel, MenuSeparator, Popover } from '@/components/ui/Popover';

function ConversationRow({ c, active, onOpen }: { c: Conversation; active: boolean; onOpen: () => void }) {
  const t = useT();
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(c.title);
  const patch = useApp((s) => s.patchConversation);
  const remove = useApp((s) => s.deleteConversation);
  const projects = useApp((s) => s.projects);
  const navigate = useNavigate();
  const newChat = useChat((s) => s.newChat);

  if (renaming)
    return (
      <form
        className="px-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) void patch(c.id, { title: title.trim().slice(0, 200) });
          setRenaming(false);
        }}
      >
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => setRenaming(false)}
          onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)}
          className="h-8 w-full rounded-lg border border-accent/60 bg-bg px-2 text-[13.5px] outline-none"
        />
      </form>
    );

  return (
    <div className={cn('group relative flex items-center rounded-xl transition-colors', active ? 'bg-hover' : 'hover:bg-hover/70')}>
      <button onClick={onOpen} className={cn('min-w-0 flex-1 truncate py-2 pl-3 pr-8 text-left text-[13.5px]', active ? 'text-fg' : 'text-muted group-hover:text-fg')}>
        {c.title}
      </button>
      <Popover
        align="end"
        trigger={({ toggle, ref, open }) => (
          <button
            ref={ref}
            aria-label="Conversation options"
            onClick={toggle}
            className={cn('absolute right-1.5 rounded-md p-1 text-faint hover:text-fg', open || active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 max-md:opacity-100')}
          >
            <MoreHorizontal className="size-4" />
          </button>
        )}
      >
        {(close) => (
          <>
            <MenuItem icon={<Pencil />} onClick={() => (setTitle(c.title), setRenaming(true), close())}>
              {t('rename')}
            </MenuItem>
            <MenuItem icon={c.pinned ? <StarOff /> : <Star />} onClick={() => (void patch(c.id, { pinned: !c.pinned }), close())}>
              {c.pinned ? t('unpin') : t('pin')}
            </MenuItem>
            <MenuItem icon={c.archived ? <ArchiveRestore /> : <Archive />} onClick={() => (void patch(c.id, { archived: !c.archived }), close())}>
              {c.archived ? t('unarchive') : t('archive')}
            </MenuItem>
            {projects.length > 0 && (
              <>
                <MenuLabel>{t('moveToProject')}</MenuLabel>
                {projects.map((p) => (
                  <MenuItem key={p.id} icon={<FolderInput />} active={c.projectId === p.id} onClick={() => (void patch(c.id, { projectId: p.id }), close())}>
                    {p.name}
                  </MenuItem>
                ))}
                {c.projectId && (
                  <MenuItem icon={<X />} onClick={() => (void patch(c.id, { projectId: null }), close())}>
                    {t('noProject')}
                  </MenuItem>
                )}
              </>
            )}
            <MenuSeparator />
            <MenuItem
              icon={<Download />}
              onClick={async () => {
                close();
                exportConversation(c, await data().listMessages(c.id), 'md');
              }}
            >
              {t('export')}
            </MenuItem>
            <MenuItem
              icon={<Trash2 />}
              danger
              onClick={() => {
                close();
                if (!confirm(t('deleteConfirm'))) return;
                void remove(c.id);
                if (active) {
                  newChat();
                  navigate('/');
                }
              }}
            >
              {t('delete')}
            </MenuItem>
          </>
        )}
      </Popover>
    </div>
  );
}

const GROUP_LABEL: Record<DateGroup, TKey> = { today: 'today', yesterday: 'yesterday', week: 'previous7', month: 'previous30', older: 'older' };

export function Sidebar() {
  const t = useT();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const conversations = useApp((s) => s.conversations);
  const projects = useApp((s) => s.projects);
  const activeProjectId = useApp((s) => s.activeProjectId);
  const setActiveProject = useApp((s) => s.setActiveProject);
  const session = useApp((s) => s.session);
  const sidebarOpen = useApp((s) => s.sidebarOpen);
  const setSidebar = useApp((s) => s.setSidebar);
  const openSettings = useApp((s) => s.openSettings);
  const openProject = useApp((s) => s.openProject);
  const signOut = useApp((s) => s.signOut);
  const config = useApp((s) => s.config);
  const activeId = useChat((s) => s.activeId);
  const newChat = useChat((s) => s.newChat);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return conversations.filter((c) => (showArchived ? c.archived : !c.archived) && (!needle || c.title.toLowerCase().includes(needle)) && (!activeProjectId || c.projectId === activeProjectId));
  }, [conversations, q, showArchived, activeProjectId]);

  const pinned = filtered.filter((c) => c.pinned);
  const groups = useMemo(() => {
    const g = new Map<DateGroup, Conversation[]>();
    for (const c of filtered.filter((c) => !c.pinned)) {
      const k = dateGroup(c.updatedAt);
      g.set(k, [...(g.get(k) ?? []), c]);
    }
    return [...g.entries()];
  }, [filtered]);

  const open = (id: string) => {
    navigate(`/c/${id}`);
    setSidebar(false);
  };
  const startNew = () => {
    newChat();
    navigate('/');
    setSidebar(false);
  };

  return (
    <>
      {sidebarOpen && <div className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[1px] md:hidden animate-fade-in" onClick={() => setSidebar(false)} />}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex w-[284px] flex-col border-r border-line bg-panel transition-transform duration-200 md:static md:translate-x-0',
          sidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
        )}
      >
        <div className="flex h-14 items-center gap-2 px-3">
          <Logo className="size-7" />
          <span className="flex-1 text-[15px] font-semibold tracking-tight">{config?.appName ?? 'Lumora'}</span>
          <IconButton label="Close sidebar" className="md:hidden" onClick={() => setSidebar(false)}>
            <PanelLeftClose />
          </IconButton>
        </div>

        <div className="space-y-2 px-3">
          <button
            onClick={startNew}
            className="flex h-10 w-full items-center gap-2 rounded-xl border border-line bg-bg px-3 text-[13.5px] font-medium shadow-sm transition-colors hover:bg-hover"
          >
            <Plus className="size-4" /> {t('newChat')}
            <span className="ml-auto text-[11px] text-faint">⇧⌘O</span>
          </button>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-3.5 text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('searchChats')}
              className="h-9 w-full rounded-xl bg-hover/60 pl-8 pr-3 text-[13px] outline-none placeholder:text-faint focus:bg-hover"
            />
          </div>
        </div>

        <nav className="mt-3 min-h-0 flex-1 space-y-4 overflow-y-auto px-2 pb-3">
          <section>
            <div className="flex items-center justify-between px-2 pb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">{t('projects')}</span>
              <button aria-label={t('newProject')} title={t('newProject')} className="rounded p-0.5 text-faint hover:text-fg" onClick={() => openProject('new')}>
                <FolderPlus className="size-3.5" />
              </button>
            </div>
            {projects.length === 0 && (
              <button className="w-full rounded-xl px-3 py-1.5 text-left text-[13px] text-faint hover:bg-hover/70 hover:text-muted" onClick={() => openProject('new')}>
                + {t('newProject')}
              </button>
            )}
            {projects.map((p) => (
              <div key={p.id} className={cn('group flex items-center rounded-xl', activeProjectId === p.id ? 'bg-accent/10' : 'hover:bg-hover/70')}>
                <button
                  className={cn('flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-3 text-left text-[13.5px]', activeProjectId === p.id ? 'text-fg' : 'text-muted hover:text-fg')}
                  onClick={() => {
                    setActiveProject(activeProjectId === p.id ? null : p.id);
                    newChat(activeProjectId === p.id ? null : p.id);
                    navigate('/');
                  }}
                >
                  <Folder className="size-3.5 shrink-0" style={{ color: p.color }} />
                  <span className="truncate">{p.name}</span>
                </button>
                <button aria-label="Project settings" className="mr-1.5 rounded p-1 text-faint opacity-0 hover:text-fg group-hover:opacity-100 max-md:opacity-100" onClick={() => openProject(p.id)}>
                  <Settings className="size-3.5" />
                </button>
              </div>
            ))}
          </section>

          {pinned.length > 0 && (
            <section>
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-faint">{t('pinned')}</div>
              {pinned.map((c) => (
                <ConversationRow key={c.id} c={c} active={c.id === activeId} onOpen={() => open(c.id)} />
              ))}
            </section>
          )}

          {groups.map(([g, list]) => (
            <section key={g}>
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-faint">{t(GROUP_LABEL[g])}</div>
              {list.map((c) => (
                <ConversationRow key={c.id} c={c} active={c.id === activeId} onOpen={() => open(c.id)} />
              ))}
            </section>
          ))}
          {filtered.length === 0 && <div className="px-3 py-6 text-center text-[13px] text-faint">{q ? 'No matches' : t('noChats')}</div>}
          <button className="w-full rounded-xl px-3 py-1.5 text-left text-xs text-faint hover:text-muted" onClick={() => setShowArchived((v) => !v)}>
            <Archive className="mr-1.5 inline size-3" /> {showArchived ? t('hideArchived') : t('showArchived')}
          </button>
        </nav>

        <div className="space-y-0.5 border-t border-line p-2">
          <NavLink to="/code" onClick={() => setSidebar(false)} className={({ isActive }) => cn('flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] transition-colors', isActive ? 'bg-hover text-fg' : 'text-muted hover:bg-hover/70 hover:text-fg')}>
            <Code2 className="size-4" /> {t('codeWorkspace')}
          </NavLink>
          {session?.isAdmin && (
            <NavLink to="/admin" onClick={() => setSidebar(false)} className={({ isActive }) => cn('flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] transition-colors', isActive ? 'bg-hover text-fg' : 'text-muted hover:bg-hover/70 hover:text-fg')}>
              <ShieldCheck className="size-4" /> {t('admin')}
            </NavLink>
          )}
          <button onClick={() => openSettings('general')} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] text-muted transition-colors hover:bg-hover/70 hover:text-fg">
            <Settings className="size-4" /> {t('settings')}
          </button>
          {config?.authMode !== 'none' && (
            <button onClick={() => void signOut()} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] text-muted transition-colors hover:bg-hover/70 hover:text-fg">
              <LogOut className="size-4" />
              <span className="min-w-0 flex-1 truncate text-left">{t('signOut')}</span>
              {session?.email && <span className="max-w-[110px] truncate text-[11px] text-faint">{session.email}</span>}
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
