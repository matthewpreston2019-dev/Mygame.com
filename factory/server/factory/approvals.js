// Sensitive actions (sending messages, publishing, spending, deleting) are never performed
// by workers. A worker prepares the action and asks; it waits here until you decide.
import { db, save, newId, now } from '../core/store.js';
import { emit } from '../http/events.js';
import { log } from '../core/log.js';

const KINDS = ['message', 'publish', 'spend', 'delete', 'other'];
const BLOCK = /```approval\s*\n([\s\S]*?)```/g;

/** Pull ```approval {json}``` requests out of a worker's result. */
export function extractApprovals(text) {
  const requests = [];
  const clean = text.replace(BLOCK, (_, body) => {
    try {
      const r = JSON.parse(body);
      if (r.summary) requests.push({ kind: KINDS.includes(r.kind) ? r.kind : 'other', summary: String(r.summary).slice(0, 300), details: String(r.details || '').slice(0, 4000) });
    } catch {
      /* malformed request: ignore */
    }
    return '';
  });
  return { text: clean.trim(), requests };
}

export function createApproval(task, request) {
  const approval = { id: newId('apr'), taskId: task.id, cloudId: task.cloudId, ...request, status: 'pending', note: '', createdAt: now(), decidedAt: null };
  db.approvals.push(approval);
  save();
  emit('approval', approval);
  log.info('approval.requested', { approval: approval.id, kind: approval.kind, summary: approval.summary });
  return approval;
}

/**
 * No outbound connectors (email, YouTube, payments…) are installed yet, so an approved
 * action is marked ready for you to carry out — the factory never pretends it did it.
 */
export function decide(approval, decision) {
  approval.status = decision === 'approve' ? 'approved' : 'rejected';
  approval.decidedAt = now();
  approval.note = approval.status === 'approved' ? 'Approved. No connector is set up for this action, so it is ready for you to carry out.' : 'Rejected.';
  save();
  emit('approval', approval);
  log.info(`approval.${approval.status}`, { approval: approval.id, kind: approval.kind });
  return approval;
}
