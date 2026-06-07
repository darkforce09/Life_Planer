import { logger } from '../utils/logger.js';
import ical from 'node-ical';
import { db } from '../db/index.js';
import { tasks, users } from '../db/schema.js';
import { calculateScore, TaskInput, PrioritizationState } from '../engine/PrioritizationEngine.js';
import { CanvasIcsEventSchema } from './schemas.js';

export type CanvasConfig = Readonly<{
  name: string;
  icsUrl: string;
}>;

export async function syncCanvas(config: CanvasConfig): Promise<void> {
  logger.info(`[SENSOR-CANVAS] Starting sync from ${config.icsUrl}`);
  if (!config.icsUrl) {
      logger.warn('[SENSOR-CANVAS] No ICS URL provided, skipping sync.');
      return;
  }

  try {
    const userList = await db.select().from(users);
    let dbUser = userList[0];
    if (!dbUser) {
      const result = await db.insert(users).values({ email: 'student@uni.edu' }).returning();
      dbUser = result[0];
    }

    const data = await ical.async.fromURL(config.icsUrl);
    let count = 0;

    for (const k in data) {
      if (Object.prototype.hasOwnProperty.call(data, k)) {
        const ev = data[k] as any;
        if (ev.type === 'VEVENT') {
          // Strict runtime validation; we do not trust the external feed.
          const parsed = CanvasIcsEventSchema.safeParse({
            uid: ev.uid,
            summary: ev.summary,
            description: ev.description,
            start: ev.start,
          });
          if (!parsed.success) {
            logger.warn(`[SENSOR-CANVAS] Skipping invalid VEVENT (uid: ${ev.uid ?? 'unknown'}).`);
            continue;
          }

          const extId = `canvas_${parsed.data.uid}`;
          const summary = parsed.data.summary;
          const description = parsed.data.description || '';
          const deadline = parsed.data.start;

          const canvasImpact = 8;
          const taskInput: TaskInput = {
            id: 'temp',
            deadline: deadline,
            impactScore: canvasImpact,
          };
          const prioState: PrioritizationState = {
            currentDate: new Date(),
            passedModuleCodes: []
          };
          const pScore = calculateScore(taskInput, prioState);

          await db.insert(tasks).values({
            externalId: extId,
            userId: dbUser.id,
            source: config.name,
            title: `[Canvas] ${summary}`,
            description: description,
            deadline: deadline,
            priorityScore: pScore,
            impactScore: canvasImpact,
          }).onConflictDoUpdate({
            target: [tasks.source, tasks.externalId],
            set: {
              title: `[Canvas] ${summary}`,
              description: description,
              deadline: deadline,
            }
          });

          logger.info(`[SENSOR-CANVAS] Synced item: ${summary}`);
          count++;
        }
      }
    }

    logger.info(`[SENSOR-CANVAS] Sync complete. Processed ${count} items.`);
  } catch (error) {
    logger.error({ err: error }, `[SENSOR-CANVAS] Sync failed`);
    throw error;
  }
}

export async function checkCanvasHealth(config: CanvasConfig): Promise<boolean> {
  if (!config.icsUrl) return false;
  try {
    const res = await fetch(config.icsUrl, { method: 'HEAD' });
    return res.ok;
  } catch (e) {
    return false;
  }
}
