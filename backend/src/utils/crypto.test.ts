import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encryptSecret, decryptSecret, isEncrypted } from './crypto.js';

const TEST_KEY = 'a'.repeat(64); // 32 bytes in hex

describe('crypto (credential encryption at rest)', () => {
  const original = process.env.CREDENTIAL_ENCRYPTION_KEY;

  afterEach(() => {
    if (original === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    else process.env.CREDENTIAL_ENCRYPTION_KEY = original;
  });

  describe('with a key configured', () => {
    beforeEach(() => {
      process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
    });

    it('round-trips a secret', () => {
      const plaintext = JSON.stringify({ username: 'student', password: 'hunter2' });
      const encrypted = encryptSecret(plaintext);
      expect(isEncrypted(encrypted)).toBe(true);
      expect(encrypted).not.toContain('hunter2');
      expect(decryptSecret(encrypted)).toBe(plaintext);
    });

    it('produces different ciphertext for the same input (random IV)', () => {
      const a = encryptSecret('same');
      const b = encryptSecret('same');
      expect(a).not.toBe(b);
      expect(decryptSecret(a)).toBe('same');
      expect(decryptSecret(b)).toBe('same');
    });

    it('still decrypts legacy plaintext values', () => {
      expect(decryptSecret('legacy-plaintext')).toBe('legacy-plaintext');
    });
  });

  describe('without a key configured', () => {
    beforeEach(() => {
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    });

    it('returns plaintext unchanged (dev fallback)', () => {
      expect(encryptSecret('plain')).toBe('plain');
      expect(isEncrypted('plain')).toBe(false);
    });
  });
});
