import { describe, it, expect } from 'vitest';
import { l2normalize, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from './embed.js';

describe('embed helpers', () => {
  it('uses the current GA Gemini embedding model and matching dimensions', () => {
    expect(EMBEDDING_MODEL).toBe('gemini-embedding-001');
    expect(EMBEDDING_DIMENSIONS).toBe(768);
  });

  it('l2-normalizes a vector to unit length', () => {
    const normalized = l2normalize([3, 4]); // magnitude 5
    expect(normalized[0]).toBeCloseTo(0.6, 6);
    expect(normalized[1]).toBeCloseTo(0.8, 6);
    const magnitude = Math.sqrt(normalized.reduce((s, v) => s + v * v, 0));
    expect(magnitude).toBeCloseTo(1, 6);
  });

  it('handles a zero vector without dividing by zero', () => {
    expect(l2normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });
});
