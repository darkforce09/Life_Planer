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

// Canvas ICS VEVENT shape (Canvas exposes deadlines as calendar events).
export const CanvasIcsEventSchema = z.object({
  uid: z.string(),
  summary: z.string(),
  description: z.string().optional(),
  start: z.date(),
});

// Microsoft Graph message (subset we consume).
export const OutlookMessageSchema = z.object({
  id: z.string(),
  subject: z.string().nullish().transform((v) => v ?? '(no subject)'),
  receivedDateTime: z.string(),
  flag: z
    .object({
      flagStatus: z.string().optional(),
      dueDateTime: z.object({ dateTime: z.string() }).nullish(),
    })
    .nullish(),
  importance: z.string().optional(),
  bodyPreview: z.string().optional(),
});

// Microsoft Graph calendar event (subset we consume).
export const OutlookEventSchema = z.object({
  id: z.string(),
  subject: z.string().nullish().transform((v) => v ?? '(no subject)'),
  start: z.object({ dateTime: z.string() }),
  end: z.object({ dateTime: z.string() }),
  location: z.object({ displayName: z.string().optional() }).nullish(),
});
