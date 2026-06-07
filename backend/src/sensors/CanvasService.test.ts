import { describe, it, expect, beforeEach, vi } from 'vitest';

// Capture inserted task rows so we can assert on what the sensor wrote.
const state = vi.hoisted(() => ({ insertedTasks: [] as any[] }));

vi.mock('node-ical', () => ({
  default: {
    async: {
      fromURL: vi.fn(async () => ({
        a: {
          type: 'VEVENT',
          uid: 'evt-1',
          summary: 'Anatomy Assignment',
          description: 'Due soon',
          start: new Date('2026-06-10T10:00:00Z'),
        },
        // Invalid: missing summary + start -> must be skipped by Zod.
        b: { type: 'VEVENT', uid: 'evt-2' },
        // Non-event component -> ignored.
        c: { type: 'VTIMEZONE' },
      })),
    },
  },
}));

vi.mock('../db/index.js', () => {
  const insert = (_table: unknown) => ({
    values: (vals: any) => {
      state.insertedTasks.push(vals);
      return {
        onConflictDoUpdate: async () => undefined,
        returning: async () => [{ id: 'user-1' }],
      };
    },
  });
  return {
    db: {
      select: () => ({ from: async () => [{ id: 'user-1' }] }),
      insert,
    },
  };
});

import { syncCanvas } from './CanvasService.js';

describe('CanvasService ICS sync (mocked feed)', () => {
  beforeEach(() => {
    state.insertedTasks.length = 0;
  });

  it('ingests valid VEVENTs and skips invalid ones', async () => {
    await syncCanvas({ name: 'canvas', icsUrl: 'https://example.com/feed.ics' });

    // Only the one valid event should produce a task insert.
    expect(state.insertedTasks).toHaveLength(1);
    const task = state.insertedTasks[0];
    expect(task.externalId).toBe('canvas_evt-1');
    expect(task.source).toBe('canvas');
    expect(task.title).toContain('Anatomy Assignment');
    expect(task.impactScore).toBe(8);
  });

  it('skips sync gracefully when no ICS URL is configured', async () => {
    await syncCanvas({ name: 'canvas', icsUrl: '' });
    expect(state.insertedTasks).toHaveLength(0);
  });
});
