import { describe, it, expect } from 'vitest';
import { TimeEditEventSchema, CanvasAssignmentSchema } from './schemas.js';

describe('Sensor Zod Schemas Validation', () => {
  it('should validate a correct TimeEdit event', () => {
    const validEvent = {
      uid: '12345',
      summary: 'Nursing Anatomy Lecture',
      start: new Date(),
      end: new Date(),
      location: 'Room 101'
    };
    
    const result = TimeEditEventSchema.safeParse(validEvent);
    expect(result.success).toBe(true);
  });

  it('should reject a TimeEdit event missing required fields', () => {
    const invalidEvent = {
      uid: '12345',
      // missing summary, start, end
    };
    
    const result = TimeEditEventSchema.safeParse(invalidEvent);
    expect(result.success).toBe(false);
  });

  it('should validate a Canvas Assignment', () => {
    const validAssignment = {
      id: '99',
      courseId: 'c1',
      title: 'Lab Report',
      dueDate: new Date(),
      pointsPossible: 100
    };

    const result = CanvasAssignmentSchema.safeParse(validAssignment);
    expect(result.success).toBe(true);
  });
});
