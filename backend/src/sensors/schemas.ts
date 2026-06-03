import { z } from 'zod';

// We do not trust external data. Everything must pass these strict schemas.

export const TimeEditEventSchema = z.object({
  uid: z.string(),
  summary: z.string(),
  description: z.string().optional(),
  start: z.date(),
  end: z.date(),
  location: z.string().optional(),
});

export const CanvasAssignmentSchema = z.object({
  id: z.string(),
  courseId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  dueDate: z.date(),
  pointsPossible: z.number().optional(),
});
