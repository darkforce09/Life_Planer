import 'dotenv/config';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, ensureExtensions, client } from '../db/index.js';
import { logger } from '../utils/logger.js';

/**
 * Standalone migration runner: ensures the pgvector extension exists, then
 * applies all Drizzle migrations. Used by CI and for manual provisioning.
 */
async function main() {
  logger.info('[MIGRATE] Ensuring extensions...');
  await ensureExtensions();
  logger.info('[MIGRATE] Running migrations...');
  await migrate(db, { migrationsFolder: './drizzle' });
  logger.info('[MIGRATE] Done.');
  await client.end();
}

main().catch((err) => {
  logger.error(err, '[MIGRATE] Failed');
  process.exit(1);
});
