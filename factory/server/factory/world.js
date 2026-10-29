// The shape of the factory: seven clouds (areas of work) and six specialist workers.
import { db, save, newId, now } from '../core/store.js';
import { config } from '../config.js';

export const WORKERS = {
  research: {
    name: 'Researcher',
    tier: 'standard',
    web: true,
    role: 'You research topics using web search and report verified, sourced findings.',
  },
  coding: {
    name: 'Engineer',
    tier: 'standard',
    role: 'You plan and write software: architecture, code, technical guides. Give complete, working code when code is asked for.',
  },
  content: {
    name: 'Creator',
    tier: 'standard',
    role: 'You create content: YouTube ideas, titles, scripts, editing workflows and analytics advice.',
  },
  finance: {
    name: 'Analyst',
    tier: 'standard',
    role: 'You analyse business ideas, budgets, costs and opportunities. Show numbers and state assumptions.',
  },
  automation: {
    name: 'Automator',
    tier: 'fast',
    role: 'You design automations, schedules, scripts and file-organisation plans for repetitive work.',
  },
  assistant: {
    name: 'Assistant',
    tier: 'fast',
    role: 'You are a personal assistant: tasks, reminders, plans and short daily briefings.',
  },
};

// Clouds sit on a wide ellipse around the manager core, at varied heights, so none overlap from the front.
const HEIGHTS = [0.6, -0.8, 1.4, -1.1, 0.3, 1.7, -0.3];
const CLOUDS = [
  { id: 'gaming', name: 'Gaming', color: '#8b7bff', blurb: 'Games, Minecraft servers, game ideas and development', workers: ['research', 'coding', 'content'], projects: ['Game Ideas', 'Minecraft Servers', 'Game Development'] },
  { id: 'engineering', name: 'Engineering', color: '#4f9dff', blurb: 'Websites, applications, coding projects and technical tools', workers: ['coding', 'research'], projects: ['Websites', 'Applications', 'Tools'] },
  { id: 'content', name: 'Content', color: '#ff6b8b', blurb: 'YouTube ideas, scripts, editing workflows and analytics', workers: ['content', 'research'], projects: ['YouTube Ideas', 'Scripts', 'Editing & Analytics'] },
  { id: 'finance', name: 'Finance & Business', color: '#34d399', blurb: 'Business research, budgets, costs and opportunities', workers: ['finance', 'research'], projects: ['Business Research', 'Budgets & Costs', 'Opportunities'] },
  { id: 'research', name: 'Research', color: '#22d3ee', blurb: 'Information gathering, trends and discovering opportunities', workers: ['research'], projects: ['Trends', 'Deep Dives'] },
  { id: 'automation', name: 'Automation', color: '#fbbf24', blurb: 'Scheduled tasks, file organisation and repetitive work', workers: ['automation', 'coding'], projects: ['Scheduled Jobs', 'File Organisation'] },
  { id: 'assistant', name: 'Personal Assistant', color: '#e879f9', blurb: 'Tasks, reminders and daily briefings', workers: ['assistant'], projects: ['Tasks & Reminders', 'Daily Briefings'] },
];

/** First run: create clouds, starter projects, default settings and the daily briefing. */
export function seed() {
  db.settings = {
    dailyBudgetUsd: config.defaults.dailyBudgetUsd,
    monthlyBudgetUsd: config.defaults.monthlyBudgetUsd,
    maxParallel: config.defaults.maxParallel,
    ...db.settings,
  };

  if (!db.clouds.length) {
    CLOUDS.forEach(({ projects, ...cloud }, i) => {
      const angle = Math.PI / 2 + (i / CLOUDS.length) * Math.PI * 2;
      const position = [Math.cos(angle) * 12, HEIGHTS[i % HEIGHTS.length], Math.sin(angle) * 8.5].map((n) => Math.round(n * 100) / 100);
      db.clouds.push({ ...cloud, position });
      for (const name of projects) db.projects.push({ id: newId('prj'), cloudId: cloud.id, name, createdAt: now() });
    });
  }

  if (!db.schedules.length) {
    db.schedules.push({
      id: newId('sch'),
      kind: 'briefing',
      name: 'Daily briefing',
      cloudId: 'assistant',
      projectId: db.projects.find((p) => p.name === 'Daily Briefings')?.id,
      worker: 'assistant',
      instruction: 'Write my daily briefing.',
      every: 'daily',
      at: config.defaults.briefingAt,
      enabled: true,
      lastRun: null,
      nextRun: null,
    });
  }
  save();
}
