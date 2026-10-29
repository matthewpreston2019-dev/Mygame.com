// Spending limits. Every Claude call checks the budget first and records its cost after.
import { db, save } from './store.js';
import { emit } from '../http/events.js';

export class BudgetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BudgetError';
    this.retryable = false;
  }
}

function rollover() {
  const today = new Date().toISOString().slice(0, 10);
  if (db.spend.day !== today) Object.assign(db.spend, { day: today, dayUsd: 0 });
  if (db.spend.month !== today.slice(0, 7)) Object.assign(db.spend, { month: today.slice(0, 7), monthUsd: 0 });
}

export function assertCanSpend() {
  rollover();
  const { dailyBudgetUsd, monthlyBudgetUsd } = db.settings;
  if (db.spend.dayUsd >= dailyBudgetUsd) throw new BudgetError(`Daily budget of $${dailyBudgetUsd} reached. Raise it in Settings or wait until tomorrow.`);
  if (db.spend.monthUsd >= monthlyBudgetUsd) throw new BudgetError(`Monthly budget of $${monthlyBudgetUsd} reached. Raise it in Settings.`);
}

export function recordSpend(usd) {
  rollover();
  db.spend.dayUsd += usd;
  db.spend.monthUsd += usd;
  save();
  emit('spend', spendStatus());
}

export function spendStatus() {
  rollover();
  return {
    dayUsd: round(db.spend.dayUsd),
    monthUsd: round(db.spend.monthUsd),
    dailyBudgetUsd: db.settings.dailyBudgetUsd,
    monthlyBudgetUsd: db.settings.monthlyBudgetUsd,
  };
}

const round = (n) => Math.round(n * 10000) / 10000;
