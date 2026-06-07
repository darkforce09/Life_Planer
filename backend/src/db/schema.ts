import { pgTable, text, integer, timestamp, boolean, uuid, vector, uniqueIndex } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const courses = pgTable('courses', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  name: text('name'),
  courseCode: text('course_code').notNull().unique(),
  credits: integer('credits'),
  isCompleted: boolean('is_completed').default(false),
});

export const courseModules = pgTable('course_modules', {
  id: uuid('id').defaultRandom().primaryKey(),
  courseId: uuid('course_id').references(() => courses.id).notNull(),
  moduleCode: text('module_code').notNull(), // e.g., '1000', '1001'
  name: text('name').notNull(), // e.g., 'Individual work placement'
  credits: text('credits'),
  grade: text('grade'), // e.g., 'Pass (G)', 'Fail (U)', 'Not specified'
  examinationDate: timestamp('examination_date'),
});

export const sensorConfigs = pgTable('sensor_configs', {
  id: text('id').primaryKey(),
  config: text('config').notNull(), // JSON string
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const tasks = pgTable('tasks', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  courseId: uuid('course_id').references(() => courses.id),
  source: text('source').notNull().default('system'),
  externalId: text('external_id'),
  title: text('title').notNull(),
  description: text('description'),
  deadline: timestamp('deadline').notNull(),
  priorityScore: integer('priority_score').default(0),
  // 'pending' | 'in_progress' | 'completed' | 'cancelled'
  status: text('status').notNull().default('pending'),
  isCompleted: boolean('is_completed').default(false),
  completedAt: timestamp('completed_at'),
  // Per-source impact weight used by the prioritization engine (1-10).
  impactScore: integer('impact_score').notNull().default(5),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  uniqueIndex('tasks_source_external_id_unique').on(table.source, table.externalId),
]);

export const events = pgTable('events', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  courseId: uuid('course_id').references(() => courses.id),
  source: text('source').notNull().default('system'),
  externalId: text('external_id'),
  title: text('title').notNull(),
  startTime: timestamp('start_time').notNull(),
  endTime: timestamp('end_time').notNull(),
  location: text('location'),
}, (table) => [
  uniqueIndex('events_source_external_id_unique').on(table.source, table.externalId),
]);

export const exams = pgTable('exams', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  courseCode: text('course_code'),
  title: text('title').notNull(),
  examDate: text('exam_date'), // raw scraped value (Swedish formatting preserved)
  examDateTime: timestamp('exam_date_time'), // parsed timestamp for reliable sorting/filtering
  courseName: text('course_name'),
  place: text('place'),
  signUpStatus: text('sign_up_status'),     // 'not_signed_up', 'signed_up', 'past'
  signUpPeriod: text('sign_up_period'),
  examType: text('exam_type'),
  scope: text('scope'),
  moduleName: text('module_name'),
  externalId: text('external_id').unique(),
  scrapedAt: timestamp('scraped_at').defaultNow(),
});

export const documentChunks = pgTable('document_chunks', {
  id: uuid('id').defaultRandom().primaryKey(),
  filePath: text('file_path').notNull(),
  courseFolder: text('course_folder'),
  content: text('content').notNull(),
  embedding: vector('embedding', { dimensions: 768 }),
  createdAt: timestamp('created_at').defaultNow(),
});

/**
 * Tracks long-running pipeline executions (deep-sync, scheduled cron cycle) so
 * the System Health view can surface real per-stage progress and failures, and
 * so a DB-backed run-lock can prevent overlapping runs.
 */
export const pipelineRuns = pgTable('pipeline_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  type: text('type').notNull(), // 'deep-sync' | 'cron-cycle' | 'sensor-sync'
  status: text('status').notNull().default('running'), // 'running' | 'completed' | 'failed'
  currentStage: text('current_stage'),
  // [{ name, status, startedAt, finishedAt, error }]
  stages: text('stages').notNull().default('[]'),
  error: text('error'),
  startedAt: timestamp('started_at').defaultNow(),
  finishedAt: timestamp('finished_at'),
});

/**
 * User-facing alerts (e.g. a scraper broke because a site changed its UI).
 * Surfaced in the System Health view and optionally pushed via email.
 */
export const alerts = pgTable('alerts', {
  id: uuid('id').defaultRandom().primaryKey(),
  severity: text('severity').notNull().default('warning'), // 'info' | 'warning' | 'critical'
  source: text('source'),
  message: text('message').notNull(),
  acknowledged: boolean('acknowledged').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow(),
});

/**
 * Human-in-the-loop approvals. Any destructive agent action (exam signup,
 * sending an email, 2FA prompt) creates a pending approval that the user must
 * resolve from the Face widget before the action commits.
 */
export const approvals = pgTable('approvals', {
  id: uuid('id').defaultRandom().primaryKey(),
  action: text('action').notNull(), // 'exam_signup' | 'send_email' | 'request_2fa'
  title: text('title').notNull(),
  details: text('details'), // JSON string with action-specific payload
  status: text('status').notNull().default('pending'), // 'pending' | 'approved' | 'rejected'
  createdAt: timestamp('created_at').defaultNow(),
  resolvedAt: timestamp('resolved_at'),
});

/**
 * Agent-trace log: prompts, tool calls, tool results, and decisions for each
 * agent run, surfaced in the System Health view for transparency/debugging.
 */
export const agentTraces = pgTable('agent_traces', {
  id: uuid('id').defaultRandom().primaryKey(),
  runId: text('run_id').notNull(),
  agent: text('agent').notNull(), // 'orchestrator' | 'execution' | 'email'
  kind: text('kind').notNull(), // 'prompt' | 'tool_call' | 'tool_result' | 'decision' | 'response' | 'error'
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});
