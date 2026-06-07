import { db } from '../db/index.js';
import { alerts } from '../db/schema.js';
import { desc } from 'drizzle-orm';
import { logger } from './logger.js';

export type AlertSeverity = 'info' | 'warning' | 'critical';

/**
 * Records a user-facing alert (e.g. a scraper broke). Surfaced via /api/alerts
 * and the System Health view. Never throws so it is safe to call from catch blocks.
 */
export async function recordAlert(
  message: string,
  severity: AlertSeverity = 'warning',
  source?: string,
): Promise<void> {
  try {
    logger.warn(`[ALERT:${severity}]${source ? ` (${source})` : ''} ${message}`);
    await db.insert(alerts).values({ message, severity, source });
  } catch (error) {
    logger.error({ err: error }, '[ALERT] Failed to persist alert');
  }
}

export async function getRecentAlerts(limit = 50) {
  return db.select().from(alerts).orderBy(desc(alerts.createdAt)).limit(limit);
}
