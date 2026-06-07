/**
 * PrioritizationEngine
 * Calculates a dynamic priority score for a task based on urgency (deadline) and impact.
 */

import { db } from '../db/index.js';
import { tasks, courseModules } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger.js';

/**
 * PrioritizationEngine
 * Calculates a dynamic priority score for a task based on urgency (deadline) and impact.
 * Pure functional core mapped for future Rust port.
 */

export type TaskInput = Readonly<{
  id: string;
  deadline: Date;
  impactScore?: number; // 1 (low) to 10 (high)
  title?: string;
  description?: string;
}>;

export type PrioritizationState = Readonly<{
  currentDate: Date;
  passedModuleCodes: ReadonlyArray<string>;
}>;

export type TaskScoreUpdate = Readonly<{
  id: string;
  priorityScore: number;
}>;

export function calculateScore(task: TaskInput, state: PrioritizationState): number {
  // Zero out score if task matches passed sub-modules
  if (state.passedModuleCodes.some(code => task.title?.includes(code) || task.description?.includes(code))) {
    return 0;
  }

  const timeDiffMs = task.deadline.getTime() - state.currentDate.getTime();
  const hoursRemaining = timeDiffMs / (1000 * 60 * 60);
  
  let urgencyMultiplier = 0.5;
  
  if (hoursRemaining < 0) {
    urgencyMultiplier = 3.0; // Overdue
  } else if (hoursRemaining <= 24) {
    urgencyMultiplier = 2.0;
  } else if (hoursRemaining <= 72) {
    urgencyMultiplier = 1.5;
  } else if (hoursRemaining <= 168) {
    urgencyMultiplier = 1.0;
  }

  const baseImpact = task.impactScore || 5; 
  
  const rawScore = (urgencyMultiplier * 10) + (baseImpact * 5);
  return Math.round(rawScore);
}

export function calculateAllScores(tasks: ReadonlyArray<TaskInput>, state: PrioritizationState): ReadonlyArray<TaskScoreUpdate> {
  return tasks.map(task => ({
    id: task.id,
    priorityScore: calculateScore(task, state)
  }));
}
