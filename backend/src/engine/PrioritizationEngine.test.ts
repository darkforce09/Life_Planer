import { describe, it, expect } from 'vitest';
import { PrioritizationEngine } from './PrioritizationEngine.js';

describe('PrioritizationEngine', () => {
  const mockNow = new Date('2026-06-03T12:00:00Z');

  it('should score overdue tasks highly', () => {
    const score = PrioritizationEngine.calculateScore({
      id: '1',
      deadline: new Date('2026-06-02T12:00:00Z'), // 1 day overdue
      impactScore: 10
    }, mockNow);
    
    // Urgency (3.0 * 10) + Impact (10 * 5) = 30 + 50 = 80
    expect(score).toBe(80);
  });

  it('should score tasks due in 24h medium-high', () => {
    const score = PrioritizationEngine.calculateScore({
      id: '2',
      deadline: new Date('2026-06-04T00:00:00Z'), // 12 hours from now
      impactScore: 5
    }, mockNow);
    
    // Urgency (2.0 * 10) + Impact (5 * 5) = 20 + 25 = 45
    expect(score).toBe(45);
  });

  it('should score far future tasks lower', () => {
    const score = PrioritizationEngine.calculateScore({
      id: '3',
      deadline: new Date('2026-06-20T12:00:00Z'), // 17 days from now
      impactScore: 5
    }, mockNow);
    
    // Urgency (0.5 * 10) + Impact (5 * 5) = 5 + 25 = 30
    expect(score).toBe(30);
  });
});
