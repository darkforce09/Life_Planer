import 'dotenv/config';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import postgres from 'postgres';
import { logger } from '../utils/logger.js';

/**
 * One-off migration: copies all rows from the legacy embedded PGlite store
 * (`backend/data/`) into the new Postgres instance pointed at by DATABASE_URL.
 *
 * Run AFTER the Postgres schema has been migrated (npm run db:push or the
 * bootstrap migrator), so the destination tables already exist.
 *
 * Usage: tsx src/scripts/migrate-pglite-to-postgres.ts
 */

// Order matters: parents before children to satisfy foreign keys.
const TABLES = [
  'users',
  'courses',
  'course_modules',
  'sensor_configs',
  'tasks',
  'events',
  'exams',
  'document_chunks',
] as const;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL must be set to the target Postgres instance.');
  }

  const pglite = new PGlite('./data', { extensions: { vector } });
  await pglite.waitReady;

  const pg = postgres(connectionString, { max: 1 });

  logger.info('[MIGRATE] Starting PGlite -> Postgres data copy...');

  for (const table of TABLES) {
    let rows: Record<string, unknown>[] = [];
    try {
      const result = await pglite.query(`SELECT * FROM "${table}"`);
      rows = result.rows as Record<string, unknown>[];
    } catch {
      logger.warn(`[MIGRATE] Source table "${table}" not found, skipping.`);
      continue;
    }

    if (rows.length === 0) {
      logger.info(`[MIGRATE] ${table}: 0 rows.`);
      continue;
    }

    for (const row of rows) {
      const columns = Object.keys(row);
      const values: unknown[] = [];
      const placeholders: string[] = [];

      for (const col of columns) {
        let val = row[col];
        // Legacy placeholder dates ('-') cannot be cast to the new timestamp columns.
        if (val === '-') val = null;

        // document_chunks.embedding must be re-cast to the vector type. PGlite may
        // return it as a JS array or as a "[...]" string; normalize to a vector literal
        // and bind it through a typed placeholder ($n::vector).
        if (table === 'document_chunks' && col === 'embedding' && val != null) {
          const literal = Array.isArray(val)
            ? `[${(val as number[]).join(',')}]`
            : String(val);
          values.push(literal);
          placeholders.push(`$${values.length}::vector`);
        } else {
          values.push(val);
          placeholders.push(`$${values.length}`);
        }
      }

      const colList = columns.map((c) => `"${c}"`).join(', ');
      await pg.unsafe(
        `INSERT INTO "${table}" (${colList}) VALUES (${placeholders.join(', ')}) ON CONFLICT DO NOTHING`,
        values as never[],
      );
    }

    logger.info(`[MIGRATE] ${table}: copied ${rows.length} rows.`);
  }

  await pg.end();
  await pglite.close();
  logger.info('[MIGRATE] Done. You can now retire the embedded backend/data/ store.');
}

main().catch((err) => {
  logger.error(err, '[MIGRATE] Migration failed');
  process.exit(1);
});
