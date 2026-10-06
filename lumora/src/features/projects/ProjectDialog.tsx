import { useEffect, useRef, useState } from 'react';
import { FileText, Trash2, Upload } from 'lucide-react';
import { MODE_ORDER, MODES } from '@shared/modes';
import type { ModeId } from '@shared/types';
import { data } from '@/data/store';
import type { Project, ProjectFile } from '@/data/types';
import { useApp } from '@/state/app';
import { FileRejectedError, isImage, processFile } from '@/lib/files';
import { formatBytes, uid } from '@/lib/utils';
import { useT } from '@/i18n';
import { Dialog } from '@/components/ui/Dialog';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';

const COLORS = ['#8b7bff', '#5b8cff', '#2fd4c4', '#3dd68c', '#f5a524', '#ff6369', '#e879f9'];

export function ProjectDialog() {
  const t = useT();
  const id = useApp((s) => s.projectDialog);
  const projects = useApp((s) => s.projects);
  const models = useApp((s) => s.models);
  const customModes = useApp((s) => s.modes);
  const config = useApp((s) => s.config);
  const { openProject, saveProject, deleteProject, toast } = useApp.getState();
  const existing = projects.find((p) => p.id === id);
  const [draft, setDraft] = useState<Project | null>(null);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!id) return setDraft(null);
    const now = Date.now();
    setDraft(existing ?? { id: uid(), name: '', instructions: '', color: COLORS[Math.floor(Math.random() * COLORS.length)], createdAt: now, updatedAt: now });
    if (existing) void data().listProjectFiles(existing.id).then(setFiles);
    else setFiles([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!id || !draft) return null;
  const set = (p: Partial<Project>) => setDraft({ ...draft, ...p });
  const close = () => openProject(null);

  const upload = async (list: FileList) => {
    setBusy(true);
    if (!projects.some((p) => p.id === draft.id)) await saveProject({ ...draft, name: draft.name.trim() || 'Untitled project' });
    for (const f of Array.from(list)) {
      try {
        if (isImage(f)) throw new FileRejectedError(`${f.name}: project files must be documents, data or code (attach images to messages instead).`);
        const a = await processFile(f, config?.limits.maxFileBytes ?? 10_000_000);
        const pf: ProjectFile = { id: uid(), projectId: draft.id, name: a.name, mime: a.mime, size: a.size, text: a.text ?? '', createdAt: Date.now() };
        await data().saveProjectFile(pf);
        setFiles((cur) => [...cur, pf]);
      } catch (err) {
        toast(err instanceof FileRejectedError ? err.message : `Could not read ${f.name}`, { tone: 'error' });
      }
    }
    setBusy(false);
  };

  return (
    <Dialog
      open
      onClose={close}
      title={existing ? draft.name || t('projects') : t('newProject')}
      size="md"
      footer={
        <>
          {existing && (
            <Button
              variant="ghost"
              className="mr-auto text-danger"
              icon={<Trash2 className="size-4" />}
              onClick={() => {
                if (!confirm('Delete this project? Its conversations are kept.')) return;
                void deleteProject(existing.id);
                close();
              }}
            >
              {t('delete')}
            </Button>
          )}
          <Button variant="ghost" onClick={close}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!draft.name.trim()}
            onClick={() => {
              void saveProject({ ...draft, name: draft.name.trim(), updatedAt: Date.now() });
              close();
            }}
          >
            {t('save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4 p-5">
        <Field label={t('projectName')}>
          <div className="flex gap-2">
            <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} placeholder="e.g. School, Business, Side project" />
          </div>
        </Field>
        <div className="flex gap-2">
          {COLORS.map((c) => (
            <button key={c} aria-label={`Color ${c}`} onClick={() => set({ color: c })} className="size-6 rounded-full ring-offset-2 ring-offset-panel transition-transform hover:scale-110" style={{ background: c, boxShadow: draft.color === c ? `0 0 0 2px ${c}` : undefined }} />
          ))}
        </div>
        <Field label={t('projectInstructions')} hint="Applied to every chat in this project.">
          <Textarea value={draft.instructions} onChange={(e) => set({ instructions: e.target.value })} maxLength={8000} placeholder="Context, goals, tone, constraints…" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('preferredMode')}>
            <Select value={draft.preferredMode ?? ''} onChange={(e) => set({ preferredMode: (e.target.value || undefined) as ModeId | undefined })}>
              <option value="">Default</option>
              <option value="auto">Auto</option>
              {MODE_ORDER.map((m) => (
                <option key={m} value={m}>
                  {MODES[m].label}
                </option>
              ))}
              {customModes.map((m) => (
                <option key={m.id} value={`custom:${m.id}`}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('preferredModel')}>
            <Select value={draft.preferredModel ?? ''} onChange={(e) => set({ preferredModel: e.target.value || undefined })}>
              <option value="">Automatic</option>
              {models?.providers.map((p) => (
                <optgroup key={p.id} label={p.label}>
                  {p.models.slice(0, 80).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-medium">{t('files')}</span>
            <input ref={input} type="file" multiple hidden onChange={(e) => e.target.files && (void upload(e.target.files), (e.target.value = ''))} />
            <Button size="sm" icon={<Upload className="size-3.5" />} loading={busy} onClick={() => input.current?.click()} disabled={!draft.name.trim() && !existing}>
              {t('upload')}
            </Button>
          </div>
          <p className="mb-2 text-xs text-muted">Project files are added as context to every chat in this project (text is extracted in your browser; up to ~200k characters in total).</p>
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {files.length === 0 && <li className="p-3 text-center text-xs text-faint">No files yet</li>}
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-2.5 p-2.5">
                <FileText className="size-4 text-accent" />
                <span className="min-w-0 flex-1 truncate text-sm">{f.name}</span>
                <span className="text-xs text-faint">{formatBytes(f.size)}</span>
                <IconButton
                  size="sm"
                  label={t('delete')}
                  onClick={async () => {
                    await data().deleteProjectFile(f.id);
                    setFiles((cur) => cur.filter((x) => x.id !== f.id));
                  }}
                >
                  <Trash2 />
                </IconButton>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Dialog>
  );
}
