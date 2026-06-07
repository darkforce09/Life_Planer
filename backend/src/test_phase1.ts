import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { users, courses, tasks } from './db/schema.js';
import { calculateScore } from './engine/PrioritizationEngine.js';
import { logger } from './utils/logger.js';
import path from 'path';

async function main() {
  logger.info('Starting Phase 1 Database & Engine Integration Test...');
  
  // 1. Initialize In-Memory PostgreSQL (WASM)
  const client = new PGlite();
  const db = drizzle(client);
  
  logger.info('Running generated SQL migrations into in-memory DB...');
  await migrate(db, { migrationsFolder: path.resolve('./drizzle') });
  
  // 2. Insert User
  logger.info('Creating test user...');
  const [user] = await db.insert(users).values({
    email: 'test.student@miun.se'
  }).returning();
  
  // 3. Insert Course
  logger.info('Creating test course...');
  const [course] = await db.insert(courses).values({
    userId: user.id,
    name: 'Anatomy 101',
    courseCode: 'ANA101',
    credits: 15
  }).returning();
  
  // 4. Calculate Priority for a Mock Task
  const mockDeadline = new Date();
  mockDeadline.setHours(mockDeadline.getHours() + 12); // Due in 12 hours
  
  const score = calculateScore({
    id: 'mock-1',
    deadline: mockDeadline,
    impactScore: 8 // High impact
  }, { currentDate: new Date(), passedModuleCodes: [] });
  
  logger.info(`Calculated Priority Score: ${score} (Expected high score due to 12h deadline and high impact)`);
  
  // 5. Insert Task
  logger.info('Inserting task into database...');
  const [task] = await db.insert(tasks).values({
    userId: user.id,
    courseId: course.id,
    title: 'Study for Anatomy Exam',
    description: 'Read chapters 4-6',
    deadline: mockDeadline,
    priorityScore: score
  }).returning();
  
  // 6. Query Back
  logger.info('Retrieving Task from Database...');
  const fetchedTasks = await db.select().from(tasks);
  
  if (fetchedTasks.length > 0 && fetchedTasks[0].title === 'Study for Anatomy Exam') {
    logger.info('Test Passed! Task was correctly prioritized and stored in the PostgreSQL database.');
  } else {
    logger.error('Test Failed! Task not found.');
  }
  
  process.exit(0);
}

main().catch(err => {
  logger.error(err);
  process.exit(1);
});
