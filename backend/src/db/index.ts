import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

/**
 * Connection string for the Postgres instance (see docker-compose.yml).
 * Falls back to the local Docker credentials so `npm run dev` works out of the box.
 */
const rawConnectionString =
  process.env.DATABASE_URL ||
  'postgres://admin:password123@localhost:5432/life_planner';

/**
 * Force UTC for every pooled connection. Our `timestamp` columns are naive;
 * without this, Postgres interprets them in the server/session timezone
 * (e.g. Europe/Stockholm) and ICS event times shift by ±2 hours on read.
 */
function withUtcTimezone(url: string): string {
  if (/timezone=/i.test(url) || /TimeZone/i.test(url)) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}options=${encodeURIComponent('-c TimeZone=UTC')}`;
}

const connectionString = withUtcTimezone(rawConnectionString);

/**
 * Naive `timestamp` columns are stored as UTC wall-clock values. postgres-js
 * defaults to parsing them in the Node process timezone (e.g. Europe/Stockholm),
 * which shifts ICS event times by ±2 hours on read. Treat them as UTC instead.
 */
const utcTimestampTypes = {
  date: {
    to: 1184,
    from: [1082, 1114, 1184, 1115] as number[],
    serialize: (value: Date) => value.toISOString(),
    parse: (value: string) => {
      if (value.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(value)) return new Date(value);
      return new Date(value.replace(' ', 'T') + 'Z');
    },
  },
};

/**
 * Shared postgres-js client. A single pooled client is reused across the
 * process; long-running migrations create their own short-lived client.
 */
export const client = postgres(connectionString, { max: 10, types: utcTimestampTypes });

export const db = drizzle(client, { schema });

/**
 * Ensures required Postgres extensions exist before migrations run.
 * pgvector backs the `document_chunks.embedding` column used by the RAG system.
 */
export async function ensureExtensions(): Promise<void> {
  await client`CREATE EXTENSION IF NOT EXISTS vector`;
}
