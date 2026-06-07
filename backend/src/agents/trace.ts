import { db } from '../db/index.js';
import { agentTraces } from '../db/schema.js';
import { desc, eq } from 'drizzle-orm';
import { logger } from '../utils/logger.js';

export type TraceKind = 'prompt' | 'tool_call' | 'tool_result' | 'decision' | 'response' | 'error';

/**
 * Records a single agent-trace entry (prompt / tool call / decision / etc.).
 * Never throws so it is safe to call from anywhere inside an agent loop.
 */
export async function recordTrace(
  runId: string,
  agent: string,
  kind: TraceKind,
  content: unknown,
): Promise<void> {
  const text = typeof content === 'string' ? content : JSON.stringify(content);
  try {
    await db.insert(agentTraces).values({ runId, agent, kind, content: text });
  } catch (error) {
    logger.error({ err: error }, '[TRACE] Failed to persist agent trace');
  }
}

export async function getTracesForRun(runId: string) {
  return db.select().from(agentTraces).where(eq(agentTraces.runId, runId)).orderBy(agentTraces.createdAt);
}

export async function getRecentTraces(limit = 100) {
  return db.select().from(agentTraces).orderBy(desc(agentTraces.createdAt)).limit(limit);
}
