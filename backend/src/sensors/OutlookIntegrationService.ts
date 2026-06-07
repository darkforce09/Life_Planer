import { logger } from '../utils/logger.js';
import { db } from '../db/index.js';
import { tasks, events, users } from '../db/schema.js';
import { OutlookMessageSchema, OutlookEventSchema } from './schemas.js';
import { calculateScore, TaskInput, PrioritizationState } from '../engine/PrioritizationEngine.js';

export type OutlookConfig = Readonly<{
  name: string;
  graphApiToken: string;
}>;

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const EMAIL_IMPACT = 7;

async function graphGet<T = any>(token: string, pathAndQuery: string): Promise<T> {
  const res = await fetch(`${GRAPH_BASE}${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph API ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/**
 * Syncs actionable Outlook data into the Brain using the Microsoft Graph API:
 * - Flagged / high-importance emails become high-priority tasks.
 * - Upcoming calendar events become entries in the `events` table.
 *
 * The caller supplies a valid Graph access token (acquired out-of-band via the
 * MS identity platform and stored in sensor_configs).
 */
export async function syncOutlook(config: OutlookConfig): Promise<void> {
  logger.info('[SENSOR-OUTLOOK] Connecting to Microsoft Graph API...');
  if (!config.graphApiToken) {
    logger.warn('[SENSOR-OUTLOOK] No Graph API token provided, skipping sync.');
    return;
  }

  const userList = await db.select().from(users);
  let dbUser = userList[0];
  if (!dbUser) {
    const result = await db.insert(users).values({ email: 'student@uni.edu' }).returning();
    dbUser = result[0];
  }

  let taskCount = 0;
  let eventCount = 0;

  try {
    // --- Flagged / important emails -> tasks ---
    const messagesResponse = await graphGet<{ value: unknown[] }>(
      config.graphApiToken,
      "/me/messages?$top=25&$select=id,subject,receivedDateTime,flag,importance,bodyPreview&$orderby=receivedDateTime desc",
    );

    for (const raw of messagesResponse.value || []) {
      const parsed = OutlookMessageSchema.safeParse(raw);
      if (!parsed.success) continue;

      const msg = parsed.data;
      const isFlagged = msg.flag?.flagStatus === 'flagged';
      const isImportant = msg.importance === 'high';
      if (!isFlagged && !isImportant) continue;

      const deadline = msg.flag?.dueDateTime?.dateTime
        ? new Date(msg.flag.dueDateTime.dateTime)
        : new Date(new Date(msg.receivedDateTime).getTime() + 7 * 24 * 60 * 60 * 1000);

      const prioState: PrioritizationState = { currentDate: new Date(), passedModuleCodes: [] };
      const taskInput: TaskInput = { id: 'temp', deadline, impactScore: EMAIL_IMPACT };
      const pScore = calculateScore(taskInput, prioState);

      await db
        .insert(tasks)
        .values({
          externalId: `outlook_msg_${msg.id}`,
          userId: dbUser.id,
          source: 'outlook',
          title: `[Email] ${msg.subject}`,
          description: msg.bodyPreview || '',
          deadline,
          priorityScore: pScore,
          impactScore: EMAIL_IMPACT,
        })
        .onConflictDoUpdate({
          target: [tasks.source, tasks.externalId],
          set: { title: `[Email] ${msg.subject}`, description: msg.bodyPreview || '', deadline },
        });
      taskCount++;
    }

    // --- Upcoming calendar events -> events ---
    const eventsResponse = await graphGet<{ value: unknown[] }>(
      config.graphApiToken,
      "/me/events?$top=50&$select=id,subject,start,end,location&$orderby=start/dateTime",
    );

    for (const raw of eventsResponse.value || []) {
      const parsed = OutlookEventSchema.safeParse(raw);
      if (!parsed.success) continue;

      const ev = parsed.data;
      await db
        .insert(events)
        .values({
          externalId: `outlook_evt_${ev.id}`,
          userId: dbUser.id,
          source: 'outlook',
          title: ev.subject,
          startTime: new Date(ev.start.dateTime),
          endTime: new Date(ev.end.dateTime),
          location: ev.location?.displayName || null,
        })
        .onConflictDoUpdate({
          target: [events.source, events.externalId],
          set: {
            title: ev.subject,
            startTime: new Date(ev.start.dateTime),
            endTime: new Date(ev.end.dateTime),
            location: ev.location?.displayName || null,
          },
        });
      eventCount++;
    }

    logger.info(`[SENSOR-OUTLOOK] Sync complete. ${taskCount} email tasks, ${eventCount} events.`);
  } catch (error) {
    logger.error({ err: error }, '[SENSOR-OUTLOOK] Sync failed');
    throw error;
  }
}

/**
 * Saves an email as a draft in the Outlook Drafts folder via Graph. Drafts are
 * NOT sent automatically - sending is gated behind human-in-the-loop approval.
 * Returns the created message id, or null if no token is configured.
 */
export async function createOutlookDraft(
  config: OutlookConfig,
  to: string,
  subject: string,
  body: string,
): Promise<string | null> {
  if (!config.graphApiToken) {
    logger.warn('[AGENT-EMAIL] No Graph token; cannot create Outlook draft.');
    return null;
  }
  const res = await fetch(`${GRAPH_BASE}/me/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.graphApiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      subject,
      body: { contentType: 'Text', content: body },
      toRecipients: [{ emailAddress: { address: to } }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Graph draft creation failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const created = (await res.json()) as { id: string };
  logger.info(`[AGENT-EMAIL] Draft saved to Outlook Drafts (id=${created.id}).`);
  return created.id;
}

/** Sends an existing Outlook draft message. Caller MUST gate this behind approval. */
export async function sendOutlookDraft(config: OutlookConfig, messageId: string): Promise<void> {
  if (!config.graphApiToken) throw new Error('No Graph token configured.');
  const res = await fetch(`${GRAPH_BASE}/me/messages/${messageId}/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.graphApiToken}` },
  });
  if (!res.ok && res.status !== 202) {
    throw new Error(`Graph send failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  logger.info(`[AGENT-EMAIL] Sent Outlook message ${messageId}.`);
}

export async function checkOutlookHealth(config: OutlookConfig): Promise<boolean> {
  if (!config.graphApiToken) return false;
  try {
    await graphGet(config.graphApiToken, '/me?$select=id');
    return true;
  } catch {
    return false;
  }
}
