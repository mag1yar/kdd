import type Database from 'better-sqlite3';
import { now } from './db.js';

export class KddError extends Error {}

export function logError(db: Database.Database, source: string, message: string): void {
  db.prepare(`INSERT INTO errors (source, message, created_at) VALUES (?, ?, ?)`)
    .run(source, message, now());
}
