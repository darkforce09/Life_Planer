import { db } from './index.js';
import { sensorConfigs } from './schema.js';
import { eq } from 'drizzle-orm';
import { encryptSecret, decryptSecret } from '../utils/crypto.js';

/**
 * Sensor ids whose stored config contains secrets and must be encrypted at rest.
 */
const SENSITIVE_IDS = new Set(['ladok']);

/**
 * Reads a sensor config by id, transparently decrypting sensitive entries.
 * Returns null if the config does not exist or cannot be parsed.
 */
export async function getSensorConfig<T = Record<string, unknown>>(
  id: string,
): Promise<T | null> {
  const rows = await db.select().from(sensorConfigs).where(eq(sensorConfigs.id, id));
  if (rows.length === 0) return null;

  let raw = rows[0].config;
  if (SENSITIVE_IDS.has(id)) {
    raw = decryptSecret(raw);
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Upserts a sensor config by id, encrypting the payload for sensitive ids.
 */
export async function setSensorConfig(id: string, value: unknown): Promise<void> {
  let payload = JSON.stringify(value);
  if (SENSITIVE_IDS.has(id)) {
    payload = encryptSecret(payload);
  }

  await db
    .insert(sensorConfigs)
    .values({ id, config: payload })
    .onConflictDoUpdate({
      target: sensorConfigs.id,
      set: { config: payload, updatedAt: new Date() },
    });
}
