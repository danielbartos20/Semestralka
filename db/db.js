import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import 'dotenv/config';
import * as schema from './schema.js';

export const sqlite = new Database(process.env.DATABASE_URL);
export const db = drizzle(sqlite, { schema });

