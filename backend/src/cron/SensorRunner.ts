import cron from 'node-cron';
import { logger } from '../utils/logger.js';
import { TimeEditService } from '../sensors/TimeEditService.js';
import { CanvasLMSService } from '../sensors/CanvasLMSService.js';
import { StudyGuideAgent } from '../agents/StudyGuideAgent.js';
import { EmailAgent } from '../agents/EmailAgent.js';
import { db } from '../db/index.js';
import { tasks } from '../db/schema.js';
import { desc, lt } from 'drizzle-orm';

// Schedule to run every hour at the top of the hour
export function startSensorCron() {
  logger.info('[CRON] Initializing Sensor & Agent Cron Jobs...');

  cron.schedule('0 * * * *', async () => {
    logger.info('[CRON] Executing scheduled system cycle...');
    
    // --- 1. SENSORS (Data Ingestion) ---
    const timeEdit = new TimeEditService('https://cloud.timeedit.net/miun/web/student/ri62l1vQ7140Y3QQZ1Zw1d795o5tZ21Z5y6YQYQ6n2560X10k6800Z51555Et7FB087010C65o227BCQ6410EDB0449moD9F93B6.ics', 'user-1');
    const canvas = new CanvasLMSService('https://miun.instructure.com/login/canvas');

    try {
      await timeEdit.sync();
      await canvas.sync();
    } catch (error) {
      logger.error('[CRON] Sensor sync failed:', error);
    }

    // --- 2. AGENTS (Automated Action) ---
    try {
      // Analyze DB for missed deadlines
      const now = new Date();
      // Only email for critical missed tasks
      const missedTasks = await db.select().from(tasks).where(lt(tasks.deadline, now));
      
      const emailAgent = new EmailAgent();
      for (const task of missedTasks) {
        if (task.priorityScore > 80) { 
          await emailAgent.draftApologyEmail('dr.smith@miun.se', task.title, 'Student');
        }
      }

      // Analyze DB for upcoming High Priority Exams
      const upcomingCritical = await db.select().from(tasks).orderBy(desc(tasks.priorityScore)).limit(1);
      if (upcomingCritical.length > 0 && upcomingCritical[0].priorityScore > 80) {
        const guideAgent = new StudyGuideAgent();
        await guideAgent.generateGuide('Target Course', upcomingCritical[0].title);
      }
    } catch (error) {
      logger.error('[CRON] Agent execution failed:', error);
    }
  });
  
  logger.info('[CRON] Sensor & Agent Cron scheduled successfully.');
}
