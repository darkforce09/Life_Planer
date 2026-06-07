import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

/**
 * Connection string for the Postgres instance (see docker-compose.yml).
 * Falls back to the local Docker credentials so `npm run dev` works out of the box.
 */
const connectionString =
  process.env.DATABASE_URL ||
  'postgres://admin:password123@localhost:5432/life_planner';

/**
 * Shared postgres-js client. A single pooled client is reused across the
 * process; long-running migrations create their own short-lived client.
 */
export const client = postgres(connectionString, { max: 10 });

export const db = drizzle(client, { schema });

/**
 * Ensures required Postgres extensions exist before migrations run.
 * pgvector backs the `document_chunks.embedding` column used by the RAG system.
 */
export async function ensureExtensions(): Promise<void> {
  await client`CREATE EXTENSION IF NOT EXISTS vector`;
}
