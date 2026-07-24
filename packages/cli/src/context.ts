import Database from 'better-sqlite3';
import { KddError, openDb, resolveDbPath, type Actor } from '@kddkit/core';

export function getActor(): Actor {
  return process.env.KDD_ACTOR === 'ai'
    ? { type: 'ai', id: process.env.KDD_SESSION }
    : { type: 'user' };
}

export function withDbAt<T>(dbPath: string, projectPath: string, fn: (db: Database.Database) => T): T {
  const db = openDb(dbPath, projectPath);
  try { return fn(db); } finally { db.close(); }
}

export function withDb<T>(fn: (db: Database.Database) => T): T {
  const { dbPath, projectPath } = resolveDbPath();
  return withDbAt(dbPath, projectPath, fn);
}

export function parseId(s: string): number {
  const n = Number(s.replace(/^#/, ''));
  if (!Number.isInteger(n) || n <= 0) throw new KddError(`invalid task id '${s}'`);
  return n;
}

export function fail(msg: string, json: boolean): never {
  if (json) console.log(JSON.stringify({ error: msg }));
  else console.error(`error: ${msg}`);
  process.exit(1);
}
