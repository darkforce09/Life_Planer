import { db } from '../db/index.js';
import { tasks, courseModules } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { logger } from '../utils/logger.js';
import { calculateAllScores, TaskInput, PrioritizationState } from './PrioritizationEngine.js';

export async function recalculateAllTasksPriorities() {
  logger.info('[PRIORITY-ENGINE] Running global priority recalculation...');
  const allTasks = await db.select().from(tasks);
  const passedModules = await db.select().from(courseModules).where(eq(courseModules.grade, 'Pass (G)'));
  const passedModuleCodes = passedModules.map(m => m.moduleCode);

  const state: PrioritizationState = { currentDate: new Date(), passedModuleCodes };
  const taskInputs: TaskInput[] = allTasks.filter(t => t.deadline).map(t => ({
    id: t.id,
    deadline: new Date(t.deadline!),
    title: t.title || '',
    description: t.description || '',
    impactScore: t.impactScore ?? 5
  }));

  const updatedScores = calculateAllScores(taskInputs, state);

  for (const update of updatedScores) {
    await db.update(tasks).set({ priorityScore: update.priorityScore }).where(eq(tasks.id, update.id));
  }
  logger.info('[PRIORITY-ENGINE] Recalculation complete.');
}
