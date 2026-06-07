import { logger } from '../utils/logger.js';
import ical from 'node-ical';
import { TimeEditEventSchema } from './schemas.js';
import { db } from '../db/index.js';
import { events, tasks, users } from '../db/schema.js';
import { calculateScore, TaskInput, PrioritizationState } from '../engine/PrioritizationEngine.js';

export type TimeEditConfig = Readonly<{
  name: string;
  icsUrl: string;
  userId: string;
}>;

export async function syncTimeEdit(config: TimeEditConfig): Promise<void> {
  logger.info(`[SENSOR-TIMEEDIT] Starting sync from ${config.icsUrl}`);
  try {
    // Ensure the demo user exists so we can map events to them
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
          // Strict runtime validation using Zod
          const parsedEvent = TimeEditEventSchema.safeParse({
            uid: ev.uid,
            summary: ev.summary,
            description: ev.description,
            start: ev.start,
            end: ev.end,
            location: ev.location,
          });

          if (!parsedEvent.success) {
            continue;
          }

          const extId = `${config.name}_${parsedEvent.data.uid}`;

          // Save to the events table
          await db.insert(events).values({
            externalId: extId,
            userId: dbUser.id,
            source: config.name,
            title: parsedEvent.data.summary,
            startTime: parsedEvent.data.start,
            endTime: parsedEvent.data.end,
            location: parsedEvent.data.location,
          }).onConflictDoUpdate({
            target: [events.source, events.externalId],
            set: {
              title: parsedEvent.data.summary,
              startTime: parsedEvent.data.start,
              endTime: parsedEvent.data.end,
              location: parsedEvent.data.location,
            }
          });

          // Also add a corresponding Task so it shows up in the React Native UI!
          const lectureImpact = 6; // lectures have medium-high impact
          const taskInput: TaskInput = {
            id: 'temp',
            deadline: parsedEvent.data.start,
            impactScore: lectureImpact,
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
            title: parsedEvent.data.summary,
            description: parsedEvent.data.description,
            deadline: parsedEvent.data.start,
            priorityScore: pScore,
            impactScore: lectureImpact,
          }).onConflictDoUpdate({
            target: [tasks.source, tasks.externalId],
            set: {
              title: parsedEvent.data.summary,
              description: parsedEvent.data.description,
              deadline: parsedEvent.data.start,
            }
          });

          logger.info(`[SENSOR-TIMEEDIT] Synced event: ${parsedEvent.data.summary}`);
          count++;
        }
      }
    }
    logger.info(`[SENSOR-TIMEEDIT] Sync complete. Processed ${count} events.`);
  } catch (error) {
    logger.error({ err: error }, '[SENSOR-TIMEEDIT] Sync failed');
    throw error;
  }
}

export async function checkTimeEditHealth(config: TimeEditConfig): Promise<boolean> {
  try {
    const res = await fetch(config.icsUrl, { method: 'HEAD' });
    return res.ok;
  } catch (e) {
    return false;
  }
}
