import cron from 'node-cron';
import { logger } from '../utils/logger.js';
import { syncTimeEdit, TimeEditConfig } from '../sensors/TimeEditService.js';
import { syncCanvas, CanvasConfig } from '../sensors/CanvasService.js';
import { syncLadok } from '../sensors/LadokBot.js';
import { syncOutlook } from '../sensors/OutlookIntegrationService.js';
import { recalculateAllTasksPriorities } from '../engine/PrioritizationRepository.js';
import { draftApologyEmail } from '../agents/EmailAgent.js';
import { generateGuide } from '../agents/StudyGuideAgent.js';
import { db } from '../db/index.js';
import { tasks, users } from '../db/schema.js';
import { desc, lt } from 'drizzle-orm';
import { getSensorConfig } from '../db/sensorConfigStore.js';
import { PipelineRun, PipelineLockedError } from '../engine/PipelineRunService.js';
import { runOrchestrator } from '../agents/Orchestrator.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'mock-key';

function readConfig(id: string): Promise<Record<string, unknown> | null> {
  return getSensorConfig<Record<string, unknown>>(id);
}

/**
 * Runs the full ingestion + agent cycle once. Shared by the cron schedule and
 * usable for manual triggering. Reads all configuration from `sensor_configs`.
 *
 * Acquires the DB-backed run-lock so a scheduled cycle cannot run concurrently
 * with a manual deep-sync (or another cron tick), and records per-stage status.
 */
export async function runSystemCycle(): Promise<void> {
  logger.info('[CRON] Executing scheduled system cycle...');

  let run: PipelineRun;
  try {
    run = await PipelineRun.start('cron-cycle');
  } catch (error) {
    if (error instanceof PipelineLockedError) {
      logger.warn(`[CRON] Skipping cycle: ${error.message}`);
      return;
    }
    throw error;
  }

  try {
    // --- 1. SENSORS (Data Ingestion) ---
    await run.stage('sensors', async () => {
      const userList = await db.select().from(users);
      const dbUser = userList[0];

      const timeEditCfg = await readConfig('timeedit');
      if (timeEditCfg?.url && dbUser) {
        const config: TimeEditConfig = {
          name: 'timeedit',
          icsUrl: timeEditCfg.url as string,
          userId: dbUser.id,
        };
        await syncTimeEdit(config);
      } else {
        logger.warn('[CRON] TimeEdit not configured; skipping.');
      }

      const canvasCfg = await readConfig('canvas');
      if (canvasCfg?.url) {
        const config: CanvasConfig = { name: 'canvas', icsUrl: canvasCfg.url as string };
        await syncCanvas(config);
      } else {
        logger.warn('[CRON] Canvas ICS not configured; skipping.');
      }

      const ladokCfg = await readConfig('ladok');
      if (ladokCfg?.username && ladokCfg?.password) {
        await syncLadok(ladokCfg.username as string, ladokCfg.password as string);
      } else {
        logger.warn('[CRON] Ladok credentials not configured; skipping.');
      }

      const outlookCfg = await readConfig('outlook');
      if (outlookCfg?.graphApiToken) {
        await syncOutlook({ name: 'outlook', graphApiToken: outlookCfg.graphApiToken as string });
      } else {
        logger.warn('[CRON] Outlook token not configured; skipping.');
      }

      await recalculateAllTasksPriorities();
    });
  } catch (error) {
    logger.error({ err: error }, '[CRON] Sensor sync failed');
  }

  // --- 2. AGENTS (Automated Action) ---
  try {
    await run.stage('agents', async () => {
      const now = new Date();
      const missedTasks = await db.select().from(tasks).where(lt(tasks.deadline, now));

      for (const task of missedTasks) {
        if ((task.priorityScore ?? 0) > 80) {
          await draftApologyEmail({}, 'dr.smith@miun.se', task.title, 'Student');
        }
      }

      const upcomingCritical = await db
        .select()
        .from(tasks)
        .orderBy(desc(tasks.priorityScore))
        .limit(1);
      if (upcomingCritical.length > 0 && (upcomingCritical[0].priorityScore ?? 0) > 80) {
        await generateGuide({ apiKey: GEMINI_API_KEY }, 'Target Course', upcomingCritical[0].title);
      }
    });

    // --- 3. ORCHESTRATOR (autonomous brain) ---
    // Opt-in: the Orchestrator can autonomously decide to delegate destructive
    // actions (all still human-approved), so it only runs when explicitly enabled.
    if (process.env.ENABLE_ORCHESTRATOR === 'true') {
      await run.stage('orchestrator', async () => {
        await runOrchestrator('scheduled');
      });
    }

    await run.finish();
  } catch (error) {
    logger.error({ err: error }, '[CRON] Agent execution failed');
    await run.fail(error);
  }
}

/**
 * Schedules the system cycle to run hourly at the top of the hour.
 */
export function startSensorCron(): void {
  logger.info('[CRON] Initializing Sensor & Agent Cron Jobs...');
  cron.schedule('0 * * * *', () => {
    void runSystemCycle();
  });
  logger.info('[CRON] Sensor & Agent Cron scheduled successfully.');
}
