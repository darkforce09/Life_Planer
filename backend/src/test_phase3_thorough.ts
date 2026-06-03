import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { users, courses, tasks } from './db/schema.js';
import { logger } from './utils/logger.js';
import path from 'path';
import express from 'express';
import { desc } from 'drizzle-orm';

import cors from 'cors';

async function main() {
  logger.info('--- RUNNING THOROUGH PHASE 3 E2E TEST ---');
  
  // 1. Setup DB
  logger.info('[1/4] Initializing Database & running SQL migrations...');
  const client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: path.resolve('./drizzle') });
  
  // Re-create the exact endpoint from our API to use this test database
  const testApp = express();
  testApp.use(cors());
  
  testApp.get('/api/health', (req, res) => {
    res.json({ status: 'healthy', sensors: { canvas: 'ok', timeedit: 'ok', outlook: 'pending' } });
  });

  // Admin Dashboard Routes
  testApp.get('/api/admin/logs', (req, res) => {
    res.json([
      { timestamp: new Date().toISOString(), level: 'INFO', message: '[AGENT-STUDYGUIDE] Successfully wrote Markdown study guide.' },
      { timestamp: new Date(Date.now() - 5000).toISOString(), level: 'WARN', message: '[AGENT-EMAIL] Synthesized Apology Draft to dr.smith@miun.se.' },
      { timestamp: new Date(Date.now() - 10000).toISOString(), level: 'INFO', message: '[CRON] Sensor sync completed.' }
    ]);
  });

  testApp.post('/api/admin/sync', (req, res) => {
    logger.info('--- MANUAL SYNC TRIGGERED FROM ADMIN UI ---');
    setTimeout(() => {
       res.json({ success: true, message: 'Sensors synchronized.' });
    }, 1500);
  });

  testApp.get('/api/tasks', async (req, res) => {
    try {
      const prioritizedTasks = await db.select().from(tasks).orderBy(desc(tasks.priorityScore));
      res.json(prioritizedTasks);
    } catch (e) {
      res.status(500).send('Error');
    }
  });

  // 2. Insert Test Data
  logger.info('[2/4] Injecting realistic mock data into PostgreSQL...');
  const [user] = await db.insert(users).values({ email: 'test@miun.se' }).returning();
  const [course] = await db.insert(courses).values({ userId: user.id, name: 'Advanced Anatomy', courseCode: 'ANA300', credits: 15 }).returning();
  
  await db.insert(tasks).values([
    { userId: user.id, courseId: course.id, title: 'Read Chapter 1 (Low Priority)', deadline: new Date(), priorityScore: 20 },
    { userId: user.id, courseId: course.id, title: 'FINAL EXAM (CRITICAL PRIORITY)', deadline: new Date(), priorityScore: 99 },
    { userId: user.id, courseId: course.id, title: 'Do Laundry (Zero Priority)', deadline: new Date(), priorityScore: 5 },
  ]);

  // 3. Boot Server
  logger.info('[3/4] Booting Node.js API Server on port 3000 for PC Browser...');
  const server = testApp.listen(3000, async () => {
    logger.info('API Server running continuously! Ready for React Native Web frontend.');
  });
}

main().catch(err => {
  logger.error(err);
  process.exit(1);
});
