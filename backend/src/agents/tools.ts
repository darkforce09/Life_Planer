import { db } from '../db/index.js';
import { tasks, exams } from '../db/schema.js';
import { and, desc, eq, gt, ne } from 'drizzle-orm';
import { logger } from '../utils/logger.js';
import { getSensorConfig } from '../db/sensorConfigStore.js';
import { RAGQueryEngine } from '../engine/RAGQueryEngine.js';
import { syncTimeEdit } from '../sensors/TimeEditService.js';
import { syncCanvas } from '../sensors/CanvasService.js';
import { syncLadok, signUpForLadokExam } from '../sensors/LadokBot.js';
import { syncOutlook } from '../sensors/OutlookIntegrationService.js';
import { draftApologyEmail } from './EmailAgent.js';
import { requestApproval, waitForApproval } from './approvals.js';
import { recordAlert } from '../utils/alerts.js';

/**
 * The single source of truth for agent-callable capabilities. The 3 MCP servers
 * and the in-process Orchestrator/Execution agents all delegate to these
 * functions, so logic is never duplicated in agent prompts.
 *
 * Destructive tools (email send, exam signup, 2FA) route through the
 * human-in-the-loop approval queue and never commit without user consent.
 */

// ---------------------------------------------------------------------------
// mcp-postgres: controlled DB read/write
// ---------------------------------------------------------------------------

export async function getPendingTasks(limit = 10): Promise<unknown[]> {
  return db
    .select()
    .from(tasks)
    .where(ne(tasks.status, 'completed'))
    .orderBy(desc(tasks.priorityScore))
    .limit(limit);
}

export async function updateTaskStatus(taskId: string, status: string): Promise<{ ok: boolean }> {
  const isCompleted = status === 'completed';
  await db
    .update(tasks)
    .set({ status, isCompleted, completedAt: isCompleted ? new Date() : null })
    .where(eq(tasks.id, taskId));
  return { ok: true };
}

export async function logSystemEvent(message: string): Promise<{ ok: boolean }> {
  await recordAlert(message, 'info', 'agent');
  return { ok: true };
}

export async function searchKnowledgeBase(query: string, topK = 5): Promise<unknown[]> {
  const engine = new RAGQueryEngine();
  return engine.search(query, { topK });
}

// ---------------------------------------------------------------------------
// mcp-uni-sensors: trigger syncs / read sensor data
// ---------------------------------------------------------------------------

export async function triggerSync(sensor: 'timeedit' | 'canvas' | 'ladok' | 'outlook'): Promise<{ ok: boolean; message: string }> {
  switch (sensor) {
    case 'timeedit': {
      const cfg = await getSensorConfig<{ url?: string }>('timeedit');
      if (!cfg?.url) return { ok: false, message: 'TimeEdit not configured.' };
      // userId resolved internally by the sync via first user; pass placeholder if needed.
      await syncTimeEdit({ name: 'timeedit', icsUrl: cfg.url, userId: '' });
      return { ok: true, message: 'TimeEdit sync complete.' };
    }
    case 'canvas': {
      const cfg = await getSensorConfig<{ url?: string }>('canvas');
      if (!cfg?.url) return { ok: false, message: 'Canvas ICS not configured.' };
      await syncCanvas({ name: 'canvas', icsUrl: cfg.url });
      return { ok: true, message: 'Canvas sync complete.' };
    }
    case 'ladok': {
      const cfg = await getSensorConfig<{ username?: string; password?: string }>('ladok');
      if (!cfg?.username || !cfg?.password) return { ok: false, message: 'Ladok not configured.' };
      await syncLadok(cfg.username, cfg.password);
      return { ok: true, message: 'Ladok sync complete.' };
    }
    case 'outlook': {
      const cfg = await getSensorConfig<{ graphApiToken?: string }>('outlook');
      if (!cfg?.graphApiToken) return { ok: false, message: 'Outlook not configured.' };
      await syncOutlook({ name: 'outlook', graphApiToken: cfg.graphApiToken });
      return { ok: true, message: 'Outlook sync complete.' };
    }
    default:
      return { ok: false, message: `Unknown sensor: ${sensor}` };
  }
}

export async function getUpcomingExams(): Promise<unknown[]> {
  return db
    .select()
    .from(exams)
    .where(and(gt(exams.examDateTime, new Date()), ne(exams.signUpStatus, 'signed_up')))
    .orderBy(exams.examDateTime);
}

// ---------------------------------------------------------------------------
// mcp-actions: communication + destructive actions (approval-gated)
// ---------------------------------------------------------------------------

export async function draftEmail(
  to: string,
  taskTitle: string,
  studentName = 'Student',
): Promise<unknown> {
  return draftApologyEmail({}, to, taskTitle, studentName);
}

/**
 * Requests human approval to send an email, then waits for the decision.
 * Returns whether sending was approved (the caller performs the actual send).
 */
export async function requestEmailSend(to: string, subject: string): Promise<{ approved: boolean; approvalId: string }> {
  const approvalId = await requestApproval('send_email', `Send email: ${subject}`, { to, subject });
  const status = await waitForApproval(approvalId);
  return { approved: status === 'approved', approvalId };
}

/**
 * Pings the Face widget to ask the user to complete a 2FA / BankID step.
 * Blocks until the user confirms they have done so.
 */
export async function requestUser2faApproval(platform: string): Promise<{ approved: boolean; approvalId: string }> {
  const approvalId = await requestApproval('request_2fa', `2FA required for ${platform}`, { platform });
  const status = await waitForApproval(approvalId);
  return { approved: status === 'approved', approvalId };
}

/**
 * Signs up for a Ladok exam after explicit human approval. The actual Playwright
 * signup runs only if the user approves.
 */
export async function signupExam(examId: string): Promise<{ ok: boolean; message: string; approvalId: string }> {
  const examRows = await db.select().from(exams).where(eq(exams.id, examId)).limit(1);
  const exam = examRows[0];
  const title = exam ? `${exam.title} (${exam.courseCode ?? ''})` : examId;

  const approvalId = await requestApproval('exam_signup', `Sign up for exam: ${title}`, { examId });
  const status = await waitForApproval(approvalId);
  if (status !== 'approved') {
    return { ok: false, message: 'Exam signup was not approved.', approvalId };
  }

  const cfg = await getSensorConfig<{ username?: string; password?: string }>('ladok');
  if (!cfg?.username || !cfg?.password) {
    return { ok: false, message: 'Ladok credentials not configured.', approvalId };
  }
  await signUpForLadokExam(examId, cfg.username, cfg.password);
  logger.info(`[TOOLS] Exam signup committed for ${examId} (approval ${approvalId}).`);
  return { ok: true, message: 'Exam signup submitted.', approvalId };
}
