import { db } from '../db/index.js';
import { pipelineRuns } from '../db/schema.js';
import { and, eq, desc, inArray } from 'drizzle-orm';
import { logger } from '../utils/logger.js';
import { recordAlert } from '../utils/alerts.js';

interface StageRecord {
  name: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

/** Thrown when a run cannot start because another run holds the lock. */
export class PipelineLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PipelineLockedError';
  }
}

// Pipeline types that must not overlap (they drive Playwright bots / heavy AI).
const EXCLUSIVE_TYPES = ['deep-sync', 'cron-cycle', 'sensor-sync'];

/**
 * Tracks a single pipeline run: persists per-stage start/finish/error to the
 * `pipeline_runs` table and enforces a DB-backed run-lock so overlapping
 * deep-sync / cron / manual runs cannot clobber each other.
 */
export class PipelineRun {
  private runId!: string;
  private stages: StageRecord[] = [];

  private constructor(public readonly type: string) {}

  /**
   * Acquires the run-lock and creates a new run row. Throws PipelineLockedError
   * if another exclusive pipeline is already running.
   */
  static async start(type: string): Promise<PipelineRun> {
    const active = await db
      .select()
      .from(pipelineRuns)
      .where(and(eq(pipelineRuns.status, 'running'), inArray(pipelineRuns.type, EXCLUSIVE_TYPES)));

    if (active.length > 0) {
      throw new PipelineLockedError(
        `A pipeline run (${active[0].type}) is already in progress since ${active[0].startedAt}.`,
      );
    }

    const run = new PipelineRun(type);
    const inserted = await db
      .insert(pipelineRuns)
      .values({ type, status: 'running', stages: '[]' })
      .returning();
    run.runId = inserted[0].id;
    logger.info(`[PIPELINE] Started run ${run.runId} (${type})`);
    return run;
  }

  private async persist(extra: Partial<typeof pipelineRuns.$inferInsert> = {}) {
    await db
      .update(pipelineRuns)
      .set({ stages: JSON.stringify(this.stages), ...extra })
      .where(eq(pipelineRuns.id, this.runId));
  }

  /**
   * Runs a single named stage, recording start/finish/error. Re-throws on error
   * after marking the stage failed and raising an alert.
   */
  async stage<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const record: StageRecord = { name, status: 'running', startedAt: new Date().toISOString() };
    this.stages.push(record);
    await this.persist({ currentStage: name });
    logger.info(`[PIPELINE] (${this.type}) stage start: ${name}`);

    try {
      const result = await fn();
      record.status = 'completed';
      record.finishedAt = new Date().toISOString();
      await this.persist();
      logger.info(`[PIPELINE] (${this.type}) stage done: ${name}`);
      return result;
    } catch (error) {
      record.status = 'failed';
      record.finishedAt = new Date().toISOString();
      record.error = error instanceof Error ? error.message : String(error);
      await this.persist();
      await recordAlert(
        `Pipeline "${this.type}" failed at stage "${name}": ${record.error}`,
        'critical',
        this.type,
      );
      throw error;
    }
  }

  async finish(): Promise<void> {
    await this.persist({ status: 'completed', finishedAt: new Date(), currentStage: null });
    logger.info(`[PIPELINE] Completed run ${this.runId} (${this.type})`);
  }

  async fail(error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.persist({ status: 'failed', finishedAt: new Date(), error: message });
    logger.error(`[PIPELINE] Run ${this.runId} (${this.type}) failed: ${message}`);
  }
}

export async function getRecentPipelineRuns(limit = 20) {
  return db.select().from(pipelineRuns).orderBy(desc(pipelineRuns.startedAt)).limit(limit);
}
