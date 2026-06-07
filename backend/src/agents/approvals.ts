import { db } from '../db/index.js';
import { approvals } from '../db/schema.js';
import { desc, eq } from 'drizzle-orm';
import { logger } from '../utils/logger.js';

export type ApprovalAction = 'exam_signup' | 'send_email' | 'request_2fa';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

/** Creates a pending approval and returns its id. */
export async function requestApproval(
  action: ApprovalAction,
  title: string,
  details: Record<string, unknown> = {},
): Promise<string> {
  const inserted = await db
    .insert(approvals)
    .values({ action, title, details: JSON.stringify(details) })
    .returning();
  logger.info(`[APPROVAL] Created pending approval ${inserted[0].id} for "${action}": ${title}`);
  return inserted[0].id;
}

export async function getApprovalStatus(id: string): Promise<ApprovalStatus | null> {
  const rows = await db.select().from(approvals).where(eq(approvals.id, id)).limit(1);
  return (rows[0]?.status as ApprovalStatus) ?? null;
}

export async function resolveApproval(id: string, approved: boolean): Promise<void> {
  await db
    .update(approvals)
    .set({ status: approved ? 'approved' : 'rejected', resolvedAt: new Date() })
    .where(eq(approvals.id, id));
}

export async function getPendingApprovals() {
  return db
    .select()
    .from(approvals)
    .where(eq(approvals.status, 'pending'))
    .orderBy(desc(approvals.createdAt));
}

export async function getRecentApprovals(limit = 50) {
  return db.select().from(approvals).orderBy(desc(approvals.createdAt)).limit(limit);
}

/**
 * Blocks until an approval is resolved or the timeout elapses. Used by the
 * Execution agent before any destructive commit. Returns the final status
 * ('rejected' on timeout to fail safe).
 */
export async function waitForApproval(
  id: string,
  { timeoutMs = 5 * 60_000, pollMs = 3000 }: { timeoutMs?: number; pollMs?: number } = {},
): Promise<ApprovalStatus> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await getApprovalStatus(id);
    if (status && status !== 'pending') return status;
    if (Date.now() > deadline) {
      logger.warn(`[APPROVAL] Approval ${id} timed out; failing safe (rejected).`);
      await resolveApproval(id, false);
      return 'rejected';
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
