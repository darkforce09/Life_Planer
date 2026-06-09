import 'dotenv/config';
import { logger } from './utils/logger.js';
import { startApiServer } from './api/index.js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, ensureExtensions } from './db/index.js';
import { startSensorCron } from './cron/SensorRunner.js';
import { clearStaleRuns } from './engine/PipelineRunService.js';

async function bootstrap() {
  logger.info('Initializing Automated Uni Tracker Backend...');
  logger.info('Ensuring database extensions...');
  await ensureExtensions();
  logger.info('Running database migrations...');
  await migrate(db, { migrationsFolder: './drizzle' });
  await clearStaleRuns();
  logger.info('Brain Foundation systems online.');

  // Start the REST API
  startApiServer(3000);

  // Start the scheduled sensor + agent cron jobs
  startSensorCron();
}

bootstrap();
