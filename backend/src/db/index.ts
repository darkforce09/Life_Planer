import { drizzle } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import * as schema from './schema.js';

// Persistent SQLite-backed PostgreSQL store
export const client = new PGlite('./data');
export const db = drizzle(client, { schema });
