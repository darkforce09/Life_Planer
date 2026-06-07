import { describe, it, expect } from 'vitest';
import { calculateScore } from './PrioritizationEngine.js';

describe('PrioritizationEngine', () => {
  const mockNow = new Date('2026-06-03T12:00:00Z');

  it('should score overdue tasks highly', () => {
    const score = calculateScore({
      id: '1',
      deadline: new Date('2026-06-02T12:00:00Z'), // 1 day overdue
      impactScore: 10
    }, { currentDate: mockNow, passedModuleCodes: [] });
    
    // Urgency (3.0 * 10) + Impact (10 * 5) = 30 + 50 = 80
    expect(score).toBe(80);
  });

  it('should score tasks due in 24h medium-high', () => {
    const score = calculateScore({
      id: '2',
      deadline: new Date('2026-06-04T00:00:00Z'), // 12 hours from now
      impactScore: 5
    }, { currentDate: mockNow, passedModuleCodes: [] });
    
    // Urgency (2.0 * 10) + Impact (5 * 5) = 20 + 25 = 45
    expect(score).toBe(45);
  });

  it('should score far future tasks lower', () => {
    const score = calculateScore({
      id: '3',
      deadline: new Date('2026-06-20T12:00:00Z'), // 17 days from now
      impactScore: 5
    }, { currentDate: mockNow, passedModuleCodes: [] });
    
    // Urgency (0.5 * 10) + Impact (5 * 5) = 5 + 25 = 30
    expect(score).toBe(30);
  });

  it('should zero out the score for tasks matching a passed module code (title)', () => {
    const score = calculateScore({
      id: '4',
      deadline: new Date('2026-06-02T12:00:00Z'), // overdue, would otherwise score high
      impactScore: 10,
      title: 'Examination for MV038G - Sepsis',
    }, { currentDate: mockNow, passedModuleCodes: ['MV038G'] });

    expect(score).toBe(0);
  });

  it('should zero out the score when a passed module code matches the description', () => {
    const score = calculateScore({
      id: '5',
      deadline: new Date('2026-06-04T00:00:00Z'),
      impactScore: 8,
      title: 'Some task',
      description: 'Covers module 1001 content',
    }, { currentDate: mockNow, passedModuleCodes: ['1001'] });

    expect(score).toBe(0);
  });

  it('should NOT zero out when no passed module code matches', () => {
    const score = calculateScore({
      id: '6',
      deadline: new Date('2026-06-02T12:00:00Z'),
      impactScore: 10,
      title: 'Examination for MV038G',
    }, { currentDate: mockNow, passedModuleCodes: ['MV999X'] });

    expect(score).toBe(80);
  });
});
