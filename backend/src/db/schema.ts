import { pgTable, text, integer, timestamp, boolean, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const courses = pgTable('courses', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  name: text('name').notNull(),
  courseCode: text('course_code').notNull(),
  credits: integer('credits'),
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
  source: text('source').default('system'),
  externalId: text('external_id').unique(),
  title: text('title').notNull(),
  description: text('description'),
  deadline: timestamp('deadline').notNull(),
  priorityScore: integer('priority_score').default(0),
  isCompleted: boolean('is_completed').default(false),
  createdAt: timestamp('created_at').defaultNow(),
});

export const events = pgTable('events', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  courseId: uuid('course_id').references(() => courses.id),
  source: text('source').default('system'),
  externalId: text('external_id').unique(),
  title: text('title').notNull(),
  startTime: timestamp('start_time').notNull(),
  endTime: timestamp('end_time').notNull(),
  location: text('location'),
});
