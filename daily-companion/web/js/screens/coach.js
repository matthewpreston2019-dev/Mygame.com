// =============================================================================
// Coach tab: a chat-style feed of everything the coach has sent you (plans,
// reminders, check-ins, summaries), with quick answers right in the chat —
// plus a Reports view with today's summary and weekly reports.
// =============================================================================

import { html, useEffect, useState } from '../lib/preact.js';
import * as store from '../lib/store.js';
import { t, fmtDate, fmtDuration, fmtNum, fmtClock, getLang } from '../lib/i18n.js';
import { useClock } from '../lib/clock.js';
import { navigate } from '../lib/router.js';
import { addDays, weekStart } from '../shared/time.js';
import { summaryText, weeklyText, planText, coachText } from '../shared/coach.js';
import { Seg, Bar, Empty } from '../components/common.js';
import { Icon } from '../components/icons.js';
import { answerCheckin, nextMessageTime } from '../lib/checkin.js';
import { openDayPlanner } from './planner.js';
import { openStudyEntry } from './track/study.js';
import { toast, haptic } from '../lib/ui.js';

export function CoachScreen({ path }) {
  // The view comes from the address (#/coach or #/coach/reports), so links like
  // "Open report" or a tapped notification always switch to the right view.
  const view = path[1] === 'reports' ? 'reports' : 'feed';
  return html`<div class="screen">
    <div class="screen-head">
      <div class="coach-head grow">
        <div class="coach-avatar"><img src="icons/icon-192.png" alt="" /></div>
        <div><h1 class="title" style="font-size:26px">${t('tabs.coach')}</h1><p class="subtitle">${t('coach.subtitle')}</p></div>
      </div>
    </div>
    <${Seg} value=${view} onChange=${(v) => navigate(v === 'reports' ? 'coach/reports' : 'coach', { replace: true })}
      options=${[{ value: 'feed', label: t('coach.feed') }, { value: 'reports', label: t('coach.reports') }]} />
    <div class="mt-16">${view === 'feed' ? html`<${Feed} />` : html`<${Reports} />`}</div>
  </div>`;
}

// ---- Feed ------------------------------------------------------------------------

function Feed() {
  const { date: today, tz } = useClock();
  const lang = getLang();
  const messages = store.rows('coach_messages')
    .filter((m) => m.date >= addDays(today, -45))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const count = messages.length;
  // All unread coach messages, also ones older than the 45 days shown here —
  // otherwise those would keep the tab dot and app badge lit forever.
  const unread = store.rows('coach_messages').filter((m) => m.kind === 'coach' && !m.read_at);

  // Open at the newest message; follow new ones as they arrive. The feed is the
  // end of the page, so we scroll to the very bottom: the page's bottom padding
  // keeps the last message and the chips above the tab bar. It waits one frame
  // so it runs after the app's "new tab → scroll to top".
  useEffect(() => {
    const raf = requestAnimationFrame(() => scrollTo(0, document.documentElement.scrollHeight));
    return () => cancelAnimationFrame(raf);
  }, [count]);

  // Seeing the feed marks coach messages as read (clears the badge).
  useEffect(() => {
    if (!unread.length) return;
    const timer = setTimeout(() => {
      const now = new Date().toISOString();
      for (const m of unread) store.put('coach_messages', { id: m.id, read_at: now });
    }, 800);
    return () => clearTimeout(timer);
  }, [count, unread.length]);

  // Ask the coach for a summary right now (written locally, saved to the feed).
  function askSummary() {
    const ctx = { lang, settings: store.settings(), stats: store.stats(), date: today, templates: store.rows('workout_templates') };
    const at = nextMessageTime();
    store.put('coach_messages', { date: today, key: `me:ask:${at}`, kind: 'me', body: t('coach.askSummary'), data: { type: 'ask' }, created_at: new Date(at).toISOString(), read_at: new Date(at).toISOString() });
    store.put('coach_messages', { date: today, key: `summary:ask:${at}`, kind: 'coach', body: summaryText(store.stats().summary(today), ctx), data: { type: 'summary' }, created_at: new Date(at + 1).toISOString(), read_at: new Date(at + 1).toISOString() });
    haptic();
  }
  function askPlan() {
    const ctx = { lang, settings: store.settings(), stats: store.stats(), date: today, templates: store.rows('workout_templates') };
    const at = nextMessageTime();
    store.put('coach_messages', { date: today, key: `me:plan:${at}`, kind: 'me', body: t('coach.askPlan'), data: { type: 'ask' }, created_at: new Date(at).toISOString(), read_at: new Date(at).toISOString() });
    store.put('coach_messages', { date: today, key: `plan:ask:${at}`, kind: 'coach', body: planText(store.stats().planFor(today), ctx), data: { type: 'plan' }, created_at: new Date(at + 1).toISOString(), read_at: new Date(at + 1).toISOString() });
    haptic();
  }

  let lastDate = null;
  return html`
    <div class="chat">
      ${messages.length === 0 && html`<div class="msg coach">${t('coach.welcome')}</div>`}
      ${messages.map((m) => {
        const sep = m.date !== lastDate ? html`<div class="day-sep">${m.date === today ? t('common.today') : m.date === addDays(today, -1) ? t('common.yesterday') : fmtDate(m.date, 'short')}</div>` : null;
        lastDate = m.date;
        return html`${sep}<${Message} m=${m} today=${today} tz=${tz} />`;
      })}
    </div>
    <div class="chips mt-16">
      <button class="chip" onClick=${askPlan}>📋 ${t('coach.askPlan')}</button>
      <button class="chip" onClick=${askSummary}>📊 ${t('coach.askSummary')}</button>
      <button class="chip" onClick=${() => openDayPlanner(addDays(today, 1))}>🗓️ ${t('coach.planTomorrow')}</button>
      <button class="chip" onClick=${() => openStudyEntry(today)}>📚 ${t('study.log')}</button>
    </div>`;
}

function Message({ m, today, tz }) {
  const type = m.data?.type;
  const actions = [];
  if (m.kind === 'coach' && type === 'checkin') actions.push(html`<${CheckinButtons} date=${m.date} />`);
  if (m.kind === 'coach' && type === 'checkin' && m.date === today) {
    actions.push(html`<div class="actions"><button class="btn small" onClick=${() => openDayPlanner(addDays(today, 1))}>🗓️ ${t('coach.planTomorrow')}</button></div>`);
  }
  if (m.kind === 'coach' && type === 'reply' && m.data.field === 'studied' && m.data.value === true && m.date === today && store.stats().day(today).studyMin === 0) {
    actions.push(html`<${QuickStudy} date=${today} />`);
  }
  if (m.kind === 'coach' && type === 'study_end' && m.data.openTimer && m.date === today) {
    actions.push(html`<div class="actions"><button class="btn small" onClick=${() => openStudyEntry(today)}>📚 ${t('study.log')}</button></div>`);
  }
  if (m.kind === 'coach' && type === 'gym' && m.date === today) {
    actions.push(html`<div class="actions"><button class="btn small" onClick=${() => navigate('track/workout')}>🏋️ ${t('workout.start')}</button></div>`);
  }
  if (m.kind === 'coach' && type === 'weekly') {
    actions.push(html`<div class="actions"><button class="btn small" onClick=${() => navigate('coach/reports')}>📊 ${t('coach.openReport')}</button></div>`);
  }
  return html`<div class=${`msg ${m.kind === 'me' ? 'me' : 'coach'} ${m.kind === 'coach' && !m.read_at ? 'unread' : ''}`}>
    ${m.body}${actions}
    <span class="when">${fmtClock(m.created_at, tz)}</span>
  </div>`;
}

function CheckinButtons({ date }) {
  const c = store.find('checkins', { date });
  const plan = store.stats().planFor(date);
  const q = (field, label) => {
    const v = c?.[field];
    return html`<div class="q">${label}</div>
      <div class="actions" style="margin-top:6px">
        <button class=${`btn small ${v === true ? 'pine' : ''}`} onClick=${() => answerCheckin(date, field, true)}>${t('common.yes')}</button>
        <button class=${`btn small ${v === false ? 'danger' : ''}`} onClick=${() => answerCheckin(date, field, false)}>${t('common.no')}</button>
      </div>`;
  };
  return html`${q('studied', t('checkin.studied'))}${q('trained', plan.gym ? t('checkin.trained') : t('checkin.trainedOptional'))}`;
}

function QuickStudy({ date }) {
  return html`<div class="actions">
    ${[30, 45, 60, 90, 120].map((m) => html`<button class="btn small" onClick=${() => {
      store.put('study_sessions', { date, minutes: m, source: 'checkin' });
      toast(t('study.saved', { d: fmtDuration(m) }));
    }}>${fmtDuration(m)}</button>`)}
  </div>`;
}

// ---- Reports -----------------------------------------------------------------------

function Reports() {
  const { date: today } = useClock();
  // How many weeks back you're looking (0 = this week). Storing the offset
  // instead of a date keeps "this week" correct when a new week starts while
  // the app stays open.
  const [back, setBack] = useState(0);
  const ws = addDays(weekStart(today), -7 * back);
  const s = store.settings();
  const stats = store.stats();
  const lang = getLang();
  const r = stats.week(ws, today);
  const sm = stats.summary(today);
  const ctx = { lang, settings: s, stats, date: today, templates: store.rows('workout_templates') };
  const verdict = weeklyText(r, ctx).split('\n').filter(Boolean).pop();
  const isCurrent = back === 0;

  // over = show the bar red (used for kcal: more than 10% above target).
  const metric = (emoji, label, value, ratio, sub, over) => html`<div class="li" style="align-items:flex-start;padding-top:12px;padding-bottom:12px">
    <span style="font-size:20px;width:26px;text-align:center">${emoji}</span>
    <div class="grow">
      <div class="row between"><span class="label">${label}</span><span class="bold tnum">${value}</span></div>
      ${ratio != null && html`<div class="mt-8"><${Bar} value=${ratio} over=${over} thin /></div>`}
      ${sub && html`<div class="tiny faint mt-4">${sub}</div>`}
    </div>
  </div>`;

  return html`
    <div class="section-title" style="margin-top:0">${t('coach.today')}</div>
    <div class="list">
      ${metric('📚', t('today.study'), sm.studyGoal ? `${fmtDuration(sm.studyMin)} / ${fmtDuration(sm.studyGoal)}` : fmtDuration(sm.studyMin), sm.studyGoal ? sm.studyMin / sm.studyGoal : null)}
      ${sm.gymPlanned && metric('🏋️', t('track.workout'), sm.gymDone ? '✅' : '—', null)}
      ${metric('🍽', 'kcal', `${fmtNum(sm.kcal)} / ${fmtNum(sm.kcalTarget)}`, sm.kcal / sm.kcalTarget, sm.foodsLogged ? null : t('report.noFoodYet'), sm.kcal > sm.kcalTarget * 1.1)}
      ${metric('🥩', t('food.protein'), `${fmtNum(Math.round(sm.protein))} / ${sm.proteinTarget} g`, sm.protein / sm.proteinTarget)}
      ${metric('👟', t('steps.title'), sm.steps == null ? '–' : `${fmtNum(sm.steps)} / ${fmtNum(sm.stepsGoal)}`, sm.steps == null ? null : sm.steps / sm.stepsGoal, sm.steps == null ? t('report.noStepsYet') : null)}
      ${metric('⚡', t('today.quests'), `${sm.quests.done}/${sm.quests.applicable}`, sm.quests.applicable ? sm.quests.ratio : null)}
    </div>

    <div class="section-title">${t('coach.week')}</div>
    <div class="cal-nav">
      <button class="icon-btn" aria-label=${t('common.previous')} onClick=${() => setBack(back + 1)}><${Icon} name="back" class="flip" /></button>
      <div class="grow center bold">${fmtDate(ws, 'dayMonth')} – ${fmtDate(addDays(ws, 6), 'dayMonth')}${isCurrent ? html`<div class="tiny faint" style="font-weight:500">${t('report.soFar')}</div>` : ''}</div>
      <button class="icon-btn" aria-label=${t('common.next')} disabled=${isCurrent} style=${isCurrent ? 'opacity:.3' : ''} onClick=${() => setBack(Math.max(0, back - 1))}><${Icon} name="chev" class="flip" /></button>
    </div>
    ${r.daysCounted === 0
      ? html`<${Empty} emoji="📊" text=${t('report.future')} />`
      : html`
      <div class="card gold mb-12"><p class="pre">${verdict}</p></div>
      <div class="list">
        ${metric('📚', t('today.study'), `${fmtDuration(r.study.minutes)} / ${fmtDuration(r.study.goal)}`, r.study.goal ? r.study.minutes / r.study.goal : null, t('report.daysOnTarget', { n: r.study.daysHit, total: r.study.daysPlanned }))}
        ${metric('🏋️', t('report.gym'), `${r.gym.done}/${r.gym.planned}`, r.gym.planned ? r.gym.done / r.gym.planned : null)}
        ${metric('🍽', t('report.avgKcal'), r.food.avgKcal == null ? '–' : `${fmtNum(r.food.avgKcal)} / ${fmtNum(r.food.kcalTarget)}`, r.food.avgKcal == null ? null : r.food.avgKcal / r.food.kcalTarget, t('report.loggedDays', { n: r.food.loggedDays, total: r.daysCounted }), r.food.avgKcal > r.food.kcalTarget * 1.1)}
        ${metric('🥩', t('report.avgProtein'), r.food.avgProtein == null ? '–' : `${fmtNum(r.food.avgProtein)} / ${r.food.proteinTarget} g`, r.food.avgProtein == null ? null : r.food.avgProtein / r.food.proteinTarget, r.food.loggedDays ? t('report.daysOnTarget', { n: r.food.proteinDaysHit, total: r.food.loggedDays }) : null)}
        ${metric('👟', t('report.avgSteps'), r.steps.avg == null ? '–' : `${fmtNum(r.steps.avg)} / ${fmtNum(r.steps.goal)}`, r.steps.avg == null ? null : r.steps.avg / r.steps.goal, t('report.daysOnTarget', { n: r.steps.daysHit, total: r.steps.loggedDays }))}
        ${metric('😴', t('sleep.score'), r.sleep.score == null ? '–' : `${r.sleep.score}/100`, r.sleep.score == null ? null : r.sleep.score / 100, r.sleep.score == null ? t('sleep.needMore', { n: r.sleep.nights }) : t('sleep.avgBed', { time: r.sleep.avgBed }))}
        ${r.weight.change != null && metric('⚖️', t('report.weight'), `${r.weight.change > 0 ? '+' : ''}${fmtNum(r.weight.change, 1)} kg`, null, t('report.weightNow', { kg: fmtNum(r.weight.latest, 1) }))}
        ${metric('🔥', t('profile.streak'), String(r.streak), null, t('report.goodDays', { n: r.quests.goodDays, total: r.quests.days }))}
      </div>
      <button class="btn block mt-12" onClick=${() => {
        const at = nextMessageTime();
        store.put('coach_messages', { date: today, key: `weekly:ask:${at}`, kind: 'coach', body: weeklyText(r, ctx), data: { type: 'weekly', week: ws }, created_at: new Date(at).toISOString(), read_at: new Date(at).toISOString() });
        toast(t('report.sentToFeed'));
      }}><${Icon} name="coach" />${t('report.toFeed')}</button>`}`;
}

export { coachText };
