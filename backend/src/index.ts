import { logger } from './utils/logger.js';
import { startApiServer } from './api/index.js';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { db } from './db/index.js';

async function bootstrap() {
  logger.info('Initializing Automated Uni Tracker Backend...');
  logger.info('Running database migrations...');
  await migrate(db, { migrationsFolder: './drizzle' });
  logger.info('Brain Foundation systems online.');

  // Start the REST API
  startApiServer(3000);
}

bootstrap();
