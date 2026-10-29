// Scheduled work: the daily briefing and recurring jobs. The database decides what is due
// (take_due_schedules); this turns each due schedule into a task and starts the pool.
import { db, must, log } from './db.ts';
import { dispatch } from './pool.ts';

export async function tick() {
  const due = must(await db.rpc('take_due_schedules')) as Record<string, any>[];
  for (const s of due) await runSchedule(s);
  await dispatch();
}

export async function runSchedule(s: Record<string, any>) {
  const task = must(
    await db
      .from('tasks')
      .insert({
        schedule_id: s.id,
        cloud_id: s.cloud_id,
        project_id: s.project_id,
        worker: s.worker,
        title: `${s.name} · ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`,
        instruction: s.kind === 'briefing' ? briefingInstruction : await recurringInstruction(s),
        tier: 'fast',
      })
      .select()
      .single(),
  );
  await log('info', 'schedule.fired', { name: s.name, task: task.id });
  return task;
}

// The worker replaces {{briefing}} with live data (finished work, failures, approvals, usage).
const briefingInstruction = 'Write my daily briefing: a short greeting, then only what matters today. Under 200 words. {{briefing}}';

/** Recurring jobs report only what is new since the last run, so updates stay short and useful. */
async function recurringInstruction(s: Record<string, any>) {
  const last = must(await db.from('tasks').select('summary').eq('schedule_id', s.id).eq('status', 'done').order('finished_at', { ascending: false }).limit(1))[0];
  return `${s.instruction}\n\n${last ? `Last run found: ${last.summary}\nReport only what is new or changed since then.` : 'This is the first run.'} If nothing meaningful changed, reply with one line saying so.`;
}
