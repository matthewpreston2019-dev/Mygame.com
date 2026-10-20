// Settings → Quests: turn quests on/off, edit XP, days and names, add your own.
import { html, useState } from '../../lib/preact.js';
import * as store from '../../lib/store.js';
import { t } from '../../lib/i18n.js';
import { SheetFrame, Toggle, Field, confirmDialog } from '../../components/common.js';
import { Icon } from '../../components/icons.js';
import { openSheet, toast } from '../../lib/ui.js';
import { questTitle } from '../../lib/quests.js';
import { WEEK_ORDER, weekdayLabel } from './schedule.js';
import { num } from '../onboarding.js';

function QuestsSheet({ close }) {
  const quests = store.rows('quests').slice().sort((a, b) => a.sort - b.sort);
  return html`<${SheetFrame} title=${t('settings.quests')} close=${close}
    footer=${html`<button class="btn primary block" onClick=${() => openQuestEditor(null)}><${Icon} name="plus" />${t('quests.add')}</button>`}>
    <p class="small muted mb-12">${t('quests.explain')}</p>
    <div class="list">
      ${quests.map((q) => html`<div class="li">
        <span style="font-size:22px;width:28px;text-align:center">${q.emoji}</span>
        <button class="grow" style="border:0;background:none;padding:0;text-align:start;color:inherit" onClick=${() => openQuestEditor(q)}>
          <div class="label">${questTitle(q)}</div>
          <div class="sub">${q.xp} XP · ${t(`quests.kind.${q.kind}`)}</div>
        </button>
        <${Toggle} label=${questTitle(q)} checked=${q.active} onChange=${(v) => store.put('quests', { id: q.id, active: v })} />
      </div>`)}
    </div>
  </${SheetFrame}>`;
}

function QuestEditor({ quest, close }) {
  const isNew = !quest;
  const [f, setF] = useState({
    title: quest ? questTitle(quest) : '',
    emoji: quest?.emoji || '⭐',
    xp: quest?.xp ?? 10,
    days: (quest?.days || [0, 1, 2, 3, 4, 5, 6]).map(Number),
  });
  const [errors, setErrors] = useState({});
  const kind = quest?.kind || 'manual';
  const followsSchedule = kind === 'study' || kind === 'workout';

  function save() {
    const e = {};
    const title = f.title.trim();
    if (!title) e.title = t('validate.required');
    if (title.length > 80) e.title = t('validate.tooLong', { n: 80 });
    const xp = num(f.xp);
    if (!(Number.isInteger(xp) && xp >= 0 && xp <= 500)) e.xp = t('validate.range', { min: 0, max: 500 });
    if (!followsSchedule && f.days.length === 0) e.days = t('quests.pickDay');
    setErrors(e);
    if (Object.keys(e).length) return;
    // Built-in quests keep their translated name unless you actually renamed them.
    const renamed = quest?.key ? (title !== questTitle({ ...quest, title: null }) ? title : null) : title;
    const sortMax = Math.max(0, ...store.rows('quests').map((q) => q.sort));
    store.put('quests', {
      ...(quest ? { id: quest.id } : { kind: 'manual', active: true, sort: sortMax + 1 }),
      title: renamed,
      emoji: [...(f.emoji.trim() || '⭐')].slice(0, 2).join(''),
      xp,
      days: [...f.days].sort(),
    });
    toast(t('common.saved'));
    close();
  }

  async function del() {
    if (!(await confirmDialog({ title: t('quests.delete'), text: t('quests.deleteText'), ok: t('common.delete'), danger: true }))) return;
    store.remove('quests', { id: quest.id });
    close();
  }

  const toggleDay = (wd) => setF({ ...f, days: f.days.includes(wd) ? f.days.filter((x) => x !== wd) : [...f.days, wd] });

  return html`<${SheetFrame} title=${isNew ? t('quests.add') : t('quests.edit')} close=${close}
    footer=${html`<button class="btn primary block" onClick=${save}>${t('common.save')}</button>`}>
    <div class="row" style="align-items:flex-start">
      <${Field} label=${t('quests.emoji')}><input style="width:64px;text-align:center;font-size:22px" value=${f.emoji} onInput=${(e) => setF({ ...f, emoji: e.currentTarget.value })} /></${Field}>
      <div class="grow"><${Field} label=${t('quests.name')} error=${errors.title}>
        <input value=${f.title} maxlength="80" placeholder=${t('quests.namePlaceholder')} onInput=${(e) => setF({ ...f, title: e.currentTarget.value })} /></${Field}></div>
    </div>
    <${Field} label="XP" error=${errors.xp}><input inputmode="numeric" value=${f.xp} onInput=${(e) => setF({ ...f, xp: e.currentTarget.value })} /></${Field}>
    ${followsSchedule
      ? html`<p class="small muted">${t('quests.followsSchedule')}</p>`
      : html`<div class="field"><span class="field-label">${t('quests.days')}</span>
          <div class="chips">${WEEK_ORDER.map((wd) => html`<button class=${`chip ${f.days.includes(wd) ? 'active' : ''}`} onClick=${() => toggleDay(wd)}>${weekdayLabel(wd)}</button>`)}</div>
          ${errors.days && html`<div class="error small" style="color:var(--danger)">${errors.days}</div>`}
        </div>`}
    ${kind !== 'manual' && html`<p class="small faint">${t(`quests.autoHint.${kind}`)}</p>`}
    ${quest && !quest.key && html`<button class="btn danger block mt-16" onClick=${del}><${Icon} name="trash" />${t('quests.delete')}</button>`}
  </${SheetFrame}>`;
}

const openQuestEditor = (quest) => openSheet(({ close }) => html`<${QuestEditor} quest=${quest} close=${close} />`);
export const openQuestsSheet = () => openSheet(({ close }) => html`<${QuestsSheet} close=${close} />`);
