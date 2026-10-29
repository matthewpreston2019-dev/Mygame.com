// Sensitive actions (sending email, publishing, spending, deleting) are never done by a worker
// on its own. The worker prepares the action; it waits here until the owner decides.
import { db, must, now, log } from './db.ts';
import { sendEmail, youtubeVideo } from './google.ts';
import type { ApprovalRequest } from './logic.ts';

export async function createApproval(task: Record<string, any>, r: ApprovalRequest) {
  const approval = must(await db.from('approvals').insert({ task_id: task.id, cloud_id: task.cloud_id, ...r }).select().single());
  await log('info', 'approval.requested', { kind: r.kind, summary: r.summary });
  return approval;
}

/**
 * Approve or reject. Emails are sent through Gmail once approved; a YouTube upload is approved by
 * finishing the upload in the interface (see google.ts). Anything without a connector is marked
 * ready for the owner to carry out — the factory never claims it did something it didn't.
 */
export async function decide(id: string, decision: 'approve' | 'reject', extra: { videoId?: string } = {}) {
  const approval = must(await db.from('approvals').select('*').eq('id', id).single());
  if (approval.status !== 'pending') throw new Error('This was already decided.');
  let note = 'Rejected.';

  if (decision === 'approve') {
    const p = approval.payload ?? {};
    if (approval.kind === 'message' && p.to) {
      await sendEmail({ to: p.to, subject: p.subject, body: p.body });
      note = `Sent to ${p.to} from your Gmail.`;
    } else if (approval.kind === 'publish' && p.platform === 'youtube') {
      if (!extra.videoId) throw new Error('Upload the video first.');
      const video = await youtubeVideo(extra.videoId);
      note = `Uploaded to YouTube as ${video.privacy}: https://youtu.be/${extra.videoId}`;
    } else {
      note = 'Approved. No connector does this automatically, so it is ready for you to carry out.';
    }
  }

  const updated = must(await db.from('approvals').update({ status: decision === 'approve' ? 'approved' : 'rejected', note, decided_at: now() }).eq('id', id).select().single());
  await log('info', `approval.${updated.status}`, { kind: approval.kind, summary: approval.summary, note });
  return updated;
}
