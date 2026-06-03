/**
 * PrioritizationEngine
 * Calculates a dynamic priority score for a task based on urgency (deadline) and impact.
 */

export interface TaskInput {
  id: string;
  deadline: Date;
  impactScore?: number; // 1 (low) to 10 (high)
}

export class PrioritizationEngine {
  /**
   * Calculates the priority score.
   * Score = (Urgency Multiplier * 10) + (Impact Score * 5)
   * 
   * Urgency Multiplier:
   * - Overdue: 3.0
   * - Due in < 24h: 2.0
   * - Due in < 3 days: 1.5
   * - Due in < 7 days: 1.0
   * - Later: 0.5
   */
  public static calculateScore(task: TaskInput, currentDate: Date = new Date()): number {
    const timeDiffMs = task.deadline.getTime() - currentDate.getTime();
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

    const baseImpact = task.impactScore || 5; // Default medium impact
    
    // Calculate final score and round it
    const rawScore = (urgencyMultiplier * 10) + (baseImpact * 5);
    return Math.round(rawScore);
  }
}
