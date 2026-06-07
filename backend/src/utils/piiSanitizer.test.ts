import { describe, it, expect } from 'vitest';
import { sanitizeForLLM, sanitize } from './piiSanitizer.js';

describe('piiSanitizer', () => {
  it('redacts Swedish personnummer in various formats', () => {
    expect(sanitize('My number is 19900101-1234.')).toContain('[REDACTED_PERSONNUMMER]');
    expect(sanitize('900101-1234')).toBe('[REDACTED_PERSONNUMMER]');
    expect(sanitize('199001011234')).toBe('[REDACTED_PERSONNUMMER]');
  });

  it('redacts password and token assignments', () => {
    const out = sanitize('password: hunter2 and api_key=AIzaSyABCDEFs');
    expect(out).toContain('[REDACTED_SECRET]');
    expect(out).not.toContain('hunter2');
  });

  it('redacts email addresses', () => {
    expect(sanitize('contact me at john.doe@miun.se')).toContain('[REDACTED_EMAIL]');
  });

  it('redacts long API keys', () => {
    expect(sanitize('AIzaSyD1234567890abcdefghijklmnop')).toContain('[REDACTED');
  });

  it('counts redactions and leaves clean text untouched', () => {
    const clean = sanitizeForLLM('A perfectly normal sentence about sepsis treatment.');
    expect(clean.redactions).toBe(0);
    expect(clean.text).toBe('A perfectly normal sentence about sepsis treatment.');
  });

  it('handles empty input safely', () => {
    expect(sanitizeForLLM('').redactions).toBe(0);
    expect(sanitize('')).toBe('');
  });
});
