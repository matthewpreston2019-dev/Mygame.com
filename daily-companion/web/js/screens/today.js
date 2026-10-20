// =============================================================================
// Today tab: your day at a glance — plan timeline with "now", progress rings,
// quests, and the right card at the right time (sleep log in the morning,
// check-in and tomorrow's planning in the evening).
// =============================================================================

import { html, useEffect, useState } from '../lib/preact.js';
import * as store from '../lib/store.js';
import { t, fmtNum, fmtDate, fmtDuration, getLang, ltr } from '../lib/i18n.js';
import { useClock } from '../lib/clock.js';
import { navigate } from '../lib/router.js';
import { toMinutes, addDays } from '../shared/time.js';
import { blockName, splitName } from '../shared/names.js';
import { Ring, Bar } from '../components/common.js';
import { Icon } from '../components/icons.js';
import { toggleQuest, questTitle } from '../lib/quests.js';
import { answerCheckin } from '../lib/checkin.js';
import { getTimer, startTimer, stopTimer, elapsedMin, onTimerChange } from '../lib/study-timer.js';
import { openAddFood } from './track/food.js';
import { openStepsEntry } from './track/steps.js';
import { openSleepLog } from './track/sleep.js';
import { openDayPlanner, dayTypeLabel } from './planner.js';
import { toast } from '../lib/ui.js';

export function TodayScreen() {
  const { date, minutes } = useClock();
  const s = store.settings();
  const stats = store.stats();
  const plan = stats.planFor(date);
  const day = stats.day(date);
  const lang = getLang();
  const templates = store.rows('workout_templates');
  const quests = stats.questsFor(date).filter((q) => q.applicable);
  const doneCount = quests.filter((q) => q.done).length;
  const streak = stats.streak(date);
  const lvl = stats.level;

  const hour = Math.floor(minutes / 60);
  const greeting = hour < 12 ? t('today.morning') : hour < 18 ? t('today.afternoon') : t('today.evening');
  const checkinAt = toMinutes(s.schedule.checkinAt);
  const showSleepCard = !day.sleep && minutes < 14 * 60;
  const c = day.checkin;
  const checkinOpen = minutes >= checkinAt - 60 && (!c || c.studied == null || c.trained == null);
  const showTomorrow = minutes >= 17 * 60;

  return html`<div class="screen">
    <div class="screen-head">
      <div class="grow">
        <div class="small muted">${fmtDate(date, 'long')}</div>
        <h1 class="title">${greeting}</h1>
      </div>
      <button class="badge ${plan.overridden ? 'gold' : 'sage'}" style="border:0;height:30px;padding:0 12px" onClick=${() => openDayPlanner(date)}>
        ${dayTypeLabel(plan.type)}${plan.overridden ? ' ✎' : ''}
      </button>
    </div>


    <!-- Level + streak -->
    <button class="card accent" style="width:100%;text-align:start;color:inherit;display:block" onClick=${() => navigate('profile')}>
      <div class="row between">
        <div class="hero"><div>
          <div class="lvl">${t('profile.level')} <b>${lvl.level}</b> · ${fmtNum(lvl.xp)} XP</div>
        </div></div>
        <div class="row" style="gap:12px">
          <span class="bold">🔥 ${streak}</span>
          <span class="badge gold">${doneCount}/${quests.length}</span>
        </div>
      </div>
      <div class="mt-8"><${Bar} value=${lvl.progress} gold thin /></div>
    </button>

    <!-- Progress rings -->
    <div class="card">
      <div class="rings">
        <${RingStat} label=${t('today.study')} value=${plan.studyGoal ? day.studyMin / plan.studyGoal : day.studyMin > 0 ? 1 : 0}
          main=${fmtDuration(day.studyMin)} sub=${plan.studyGoal ? `/ ${fmtDuration(plan.studyGoal)}` : t('today.noGoal')} onClick=${() => navigate('track/study')} />
        <${RingStat} label=${t('steps.title')} value=${(day.steps || 0) / s.targets.steps}
          main=${day.steps == null ? '–' : fmtNum(day.steps)} sub=${`/ ${fmtNum(s.targets.steps)}`} onClick=${() => openStepsEntry(date)} />
        <${RingStat} label="kcal" value=${day.kcal / s.targets.kcal} over=${day.kcal > s.targets.kcal * 1.1}
          main=${fmtNum(day.kcal)} sub=${`/ ${fmtNum(s.targets.kcal)}`} onClick=${() => navigate('track/food')} />
        <${RingStat} label=${t('food.protein')} value=${day.protein / s.targets.protein}
          main=${`${fmtNum(Math.round(day.protein))} g`} sub=${`/ ${s.targets.protein} g`} onClick=${() => navigate('track/food')} />
      </div>
    </div>

    ${showSleepCard && html`<button class="card gold" style="width:100%;text-align:start;color:inherit;display:block;margin-top:12px" onClick=${() => openSleepLog(date)}>
      <div class="row"><span style="font-size:26px">😴</span><div class="grow"><div class="bold">${t('sleep.howDidYouSleep')}</div><div class="small muted">${t('sleep.logPrompt')}</div></div><${Icon} name="chev" class="chev" /></div>
    </button>`}

    <${StudyTimerCard} plan=${plan} day=${day} />

    ${checkinOpen && html`<${CheckinCard} date=${date} plan=${plan} checkin=${c} splitLabel=${plan.gym ? splitName(plan.gym, templates, lang) : null} />`}

    <!-- Plan -->
    <div class="section-title">${t('today.plan')}<button class="link-btn" onClick=${() => openDayPlanner(date)}>${t('today.changeToday')}</button></div>
    <div class="card">
      ${plan.note && html`<div class="banner" style="margin-bottom:14px">📝 <span class="grow">${plan.note}</span></div>`}
      ${(plan.exam || plan.examTomorrow || plan.gymCatchUp || plan.gymMoved || plan.trimmed) && html`<div class="col mb-12" style="gap:6px">
        ${plan.examTomorrow && html`<span class="badge danger">📝 ${t('plan.examTomorrow', { subject: plan.examTomorrow.subject || t('plan.exam') })}</span>`}
        ${plan.exam && html`<span class="badge danger">🎯 ${t('plan.examToday', { subject: plan.exam.subject || t('plan.exam'), time: plan.exam.time || '' })}</span>`}
        ${plan.gymCatchUp && html`<span class="badge gold">🏋️ ${t('plan.catchUp')}</span>`}
        ${plan.gymMoved && html`<span class="badge gold">${t('plan.gymMoved')}</span>`}
        ${plan.trimmed && !plan.gymMoved && html`<span class="badge">${t('plan.trimmed')}</span>`}
      </div>`}
      <${Timeline} plan=${plan} minutes=${minutes} day=${day} templates=${templates} lang=${lang} />
    </div>

    <!-- Quests -->
    <div class="section-title">${t('today.quests')}<span class="faint" style="text-transform:none;letter-spacing:0">${doneCount}/${quests.length}</span></div>
    ${quests.length
      ? html`<div class="list">${quests.map((q) => html`<${QuestRow} q=${q} date=${date} />`)}</div>`
      : html`<div class="card"><p class="muted small center">${t('today.noQuests')}</p></div>`}

    <!-- Quick actions -->
    <div class="section-title">${t('today.quickAdd')}</div>
    <div class="grid-2">
      <button class="btn" onClick=${() => openAddFood(date)}><${Icon} name="food" />${t('food.add')}</button>
      <button class="btn" onClick=${() => navigate('track/workout')}><${Icon} name="dumbbell" />${t('workout.start')}</button>
      <button class="btn" onClick=${() => openStepsEntry(date)}><${Icon} name="steps" />${t('steps.log')}</button>
      <button class="btn" onClick=${() => navigate('track/study')}><${Icon} name="book" />${t('study.log')}</button>
    </div>

    ${showTomorrow && html`<${TomorrowCard} date=${addDays(date, 1)} />`}
  </div>`;
}

function RingStat({ label, value, main, sub, onClick, over }) {
  return html`<button class="ring-stat" onClick=${onClick}>
    <${Ring} value=${value} size=${66} stroke=${6} color=${over ? 'var(--danger)' : 'var(--sage)'}>
      <span class="n">${main}<small>${sub}</small></span>
    </${Ring}>
    <span class="l">${label}</span>
  </button>`;
}

function Timeline({ plan, minutes, day, templates, lang }) {
  const blocks = plan.blocks.filter((b) => b.kind !== 'school' || minutes < b.endMin);
  if (!blocks.length) return html`<p class="muted small">${t('today.emptyPlan')}</p>`;
  return html`<div class="timeline">
    ${blocks.map((b) => {
      const isNow = b.startMin <= minutes && minutes < b.endMin;
      const past = b.endMin <= minutes && !isNow;
      const done = (b.kind === 'gym' && day.workouts.length > 0) || (b.kind === 'study' && plan.studyGoal > 0 && day.studyMin >= plan.studyGoal);
      let sub = '';
      if (b.kind === 'gym') sub = splitName(b.split, templates, lang) + (b.catchUp ? ` · ${t('plan.catchUpShort')}` : '');
      if (b.kind === 'study') sub = fmtDuration(b.minutes) + (b.focus ? ` · ${t('plan.prepFor', { subject: b.focus })}` : '');
      if (b.kind === 'exam') sub = b.subject;
      if (b.endMin > b.startMin && b.kind !== 'winddown') sub = [sub, ltr(`${b.start}–${b.end}`)].filter(Boolean).join(' · ');
      return html`<div class=${`tl ${isNow ? 'now' : ''} ${past ? 'past' : ''} ${done ? 'done' : ''}`}>
        <div class="t">${b.start}</div>
        <div class="rail"><div class="node"></div></div>
        <div class="c"><div class="name">${blockName(b, plan.type, lang)}${done ? ' ✓' : ''}${isNow ? html` <span class="badge gold" style="height:20px;font-size:11px">${t('today.now')}</span>` : ''}</div>
          ${sub && html`<div class="sub">${sub}</div>`}</div>
      </div>`;
    })}
  </div>`;
}

function QuestRow({ q, date }) {
  const auto = q.quest.kind !== 'manual';
  const title = questTitle(q.quest, true);
  const onClick = () => {
    if (!auto) return toggleQuest(q.quest, date);
    // Auto quests complete from your data — take you to the right place.
    const go = { study: 'track/study', steps: null, workout: 'track/workout', protein: 'track/food' }[q.quest.kind];
    if (q.quest.kind === 'steps') return openStepsEntry(date);
    if (go) navigate(go);
  };
  let detail = '';
  if (q.quest.kind === 'study') detail = `${fmtDuration(q.value)} / ${fmtDuration(q.target)}`;
  if (q.quest.kind === 'steps') detail = `${fmtNum(q.value)} / ${fmtNum(q.target)}`;
  if (q.quest.kind === 'protein') detail = `${fmtNum(Math.round(q.value))} / ${q.target} g`;
  return html`<button class=${`quest ${q.done ? 'done' : ''} ${auto ? 'auto' : ''}`} onClick=${onClick} aria-pressed=${q.done}>
    <span class="check"><${Icon} name="check" /></span>
    <span class="emoji">${q.quest.emoji}</span>
    <span class="grow">
      <div class="label">${title}</div>
      ${detail && !q.done && html`<${Bar} value=${q.progress} thin />`}
      ${detail && html`<div class="tiny faint mt-4">${detail}</div>`}
    </span>
    <span class="xp">+${q.quest.xp}</span>
  </button>`;
}

function StudyTimerCard({ plan, day }) {
  const [, tick] = useState(0);
  useEffect(() => onTimerChange(() => tick((x) => x + 1)), []);
  const timer = getTimer();
  useEffect(() => {
    if (!timer) return;
    const iv = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(iv);
  }, [!!timer]);
  if (!timer) return null;
  const sec = Math.floor(elapsedMin(timer) * 60);
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
  const clock = `${hh ? hh + ':' : ''}${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return html`<div class="card gold" style="margin-top:12px">
    <div class="row">
      <span style="font-size:26px">📚</span>
      <div class="grow"><div class="small muted">${t('study.running')}${timer.subject ? ` · ${timer.subject}` : ''}</div>
        <div class="bold tnum" style="font-size:26px">${clock}</div></div>
      <button class="btn primary" onClick=${() => { const m = stopTimer(); if (m) toast(t('study.saved', { d: fmtDuration(m) })); }}><${Icon} name="stop" />${t('study.stop')}</button>
    </div>
    ${plan.studyGoal > 0 && html`<div class="mt-8"><${Bar} value=${(day.studyMin + sec / 60) / plan.studyGoal} gold thin /></div>`}
  </div>`;
}

function CheckinCard({ date, plan, checkin, splitLabel }) {
  const q = (field, label) => {
    const v = checkin?.[field];
    return html`<div class="row between mt-12">
      <span class="label">${label}</span>
      <div class="row" style="gap:8px">
        <button class=${`btn small ${v === true ? 'pine' : ''}`} onClick=${() => answerCheckin(date, field, true)}>${t('common.yes')}</button>
        <button class=${`btn small ${v === false ? 'danger' : ''}`} onClick=${() => answerCheckin(date, field, false)}>${t('common.no')}</button>
      </div>
    </div>`;
  };
  return html`<div class="card gold" style="margin-top:12px">
    <div class="row"><span style="font-size:24px">✅</span><div class="grow"><div class="bold">${t('checkin.title')}</div><div class="small muted">${t('checkin.subtitle')}</div></div></div>
    ${q('studied', t('checkin.studied'))}
    ${q('trained', splitLabel ? t('checkin.trainedSplit', { split: splitLabel }) : t('checkin.trained'))}
  </div>`;
}

function TomorrowCard({ date }) {
  const stats = store.stats();
  const plan = stats.planFor(date);
  const lang = getLang();
  const templates = store.rows('workout_templates');
  const first = plan.blocks.find((b) => ['relax', 'gym', 'study', 'exam'].includes(b.kind));
  return html`<div class="section-title">${t('today.tomorrow')}</div>
    <button class="card" style="width:100%;text-align:start;color:inherit;display:block" onClick=${() => openDayPlanner(date)}>
      <div class="row">
        <span class="li-icon">🗓️</span>
        <div class="grow">
          <div class="bold">${fmtDate(date, 'weekdayLong')} · ${dayTypeLabel(plan.type)}</div>
          <div class="small muted">
            ${[plan.exam && `📝 ${plan.exam.subject || t('plan.exam')} ${plan.exam.time || ''}`.trim(),
              plan.gym && `🏋️ ${splitName(plan.gym, templates, lang)}`,
              plan.studyGoal > 0 && `📚 ${fmtDuration(plan.studyGoal)}`,
              first && plan.freeFrom && t('today.freeFrom', { time: plan.freeFrom })].filter(Boolean).join(' · ') || t('today.nothingPlanned')}
          </div>
        </div>
        <span class="btn small">${t('today.planIt')}</span>
      </div>
    </button>`;
}
