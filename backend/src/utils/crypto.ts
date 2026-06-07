import crypto from 'crypto';
import { logger } from './logger.js';

/**
 * Symmetric encryption for credentials stored at rest (e.g. Ladok/Miun login).
 *
 * Uses AES-256-GCM with a 32-byte key supplied via CREDENTIAL_ENCRYPTION_KEY
 * (64 hex chars; generate with `openssl rand -hex 32`).
 *
 * Stored format: `enc:v1:<iv_b64>:<tag_b64>:<ciphertext_b64>`.
 * If no key is configured, values are stored as-is and a warning is logged so
 * local development still works (NOT recommended for any shared deployment).
 */

const PREFIX = 'enc:v1:';

function getKey(): Buffer | null {
  const hex = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!hex) return null;
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY must be 32 bytes (64 hex chars).');
  }
  return key;
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  if (!key) {
    logger.warn(
      '[CRYPTO] CREDENTIAL_ENCRYPTION_KEY not set - storing credentials in PLAINTEXT.',
    );
    return plaintext;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return (
    PREFIX +
    [iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':')
  );
}

export function decryptSecret(stored: string): string {
  if (!isEncrypted(stored)) {
    // Legacy plaintext value written before encryption was enabled.
    return stored;
  }
  const key = getKey();
  if (!key) {
    throw new Error(
      'Encrypted credential found but CREDENTIAL_ENCRYPTION_KEY is not set.',
    );
  }
  const [, , ivB64, tagB64, dataB64] = stored.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
