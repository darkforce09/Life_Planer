import { IntegrationService } from './IntegrationService.js';
import { logger } from '../utils/logger.js';
import ical from 'node-ical';
import { TimeEditEventSchema } from './schemas.js';
import { db } from '../db/index.js';
import { events, tasks, users } from '../db/schema.js';
import { PrioritizationEngine } from '../engine/PrioritizationEngine.js';

export class TimeEditService implements IntegrationService {
  public readonly name = 'timeedit';
  private icsUrl: string;
  private userId: string;

  constructor(icsUrl: string, userId: string) {
    this.icsUrl = icsUrl;
    this.userId = userId;
  }

  public async sync(): Promise<void> {
    logger.info(`[SENSOR-TIMEEDIT] Starting sync from ${this.icsUrl}`);
    try {
      // Ensure the demo user exists so we can map events to them
      const userList = await db.select().from(users);
      let dbUser = userList[0];
      if (!dbUser) {
        const result = await db.insert(users).values({ email: 'student@uni.edu' }).returning();
        dbUser = result[0];
      }

      const data = await ical.async.fromURL(this.icsUrl);
      let count = 0;
      
      for (const k in data) {
        if (Object.prototype.hasOwnProperty.call(data, k)) {
          const ev = data[k];
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

            const extId = `${this.name}_${parsedEvent.data.uid}`;

            // Save to the events table
            await db.insert(events).values({
              externalId: extId,
              userId: dbUser.id,
              source: this.name,
              title: parsedEvent.data.summary,
              startTime: parsedEvent.data.start,
              endTime: parsedEvent.data.end,
              location: parsedEvent.data.location,
            }).onConflictDoUpdate({
              target: events.externalId,
              set: {
                title: parsedEvent.data.summary,
                startTime: parsedEvent.data.start,
                endTime: parsedEvent.data.end,
                location: parsedEvent.data.location,
              }
            });

            // Also add a corresponding Task so it shows up in the React Native UI!
            const pScore = PrioritizationEngine.calculateScore({
              id: 'temp',
              deadline: parsedEvent.data.start,
              impactScore: 6, // lectures have medium-high impact
            });

            await db.insert(tasks).values({
              externalId: extId,
              userId: dbUser.id,
              source: this.name,
              title: parsedEvent.data.summary,
              description: parsedEvent.data.description,
              deadline: parsedEvent.data.start,
              priorityScore: pScore,
            }).onConflictDoUpdate({
              target: tasks.externalId,
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
      logger.error(`[SENSOR-TIMEEDIT] Sync failed:`, error);
      throw error;
    }
  }

  public async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(this.icsUrl, { method: 'HEAD' });
      return res.ok;
    } catch (e) {
      return false;
    }
  }
}
