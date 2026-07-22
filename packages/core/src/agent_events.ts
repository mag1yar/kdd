import type Database from 'better-sqlite3';
import { now } from './db.js';

export type AgentEventKind = 'run_start' | 'text' | 'tool_start' | 'tool_finish' | 'error' | 'run_end';

export interface AgentEvent {
  id: number; task_id: number; worker_id: string;
  kind: AgentEventKind; name: string | null; detail: string | null; created_at: number;
}

export interface ParsedEvent { kind: AgentEventKind; name?: string; detail?: object }

// Парсит одну NDJSON-строку `claude -p --output-format stream-json`.
// Одно assistant-сообщение может нести несколько content-блоков → 0+ событий.
// Неизвестное/битое → []. НИКОГДА не бросает (битый JSON = []).
// run_end воркер эмитит из exit-кода, не из stream (result → []): убитый воркер всё равно закроет ран.
export function parseClaudeStreamLine(line: string): ParsedEvent[] {
  const s = line.trim();
  if (!s) return [];
  let msg: any;
  try { msg = JSON.parse(s); } catch { return []; }
  if (msg?.type === 'assistant' && Array.isArray(msg.message?.content)) {
    const out: ParsedEvent[] = [];
    for (const b of msg.message.content) {
      if (b?.type === 'text' && typeof b.text === 'string') out.push({ kind: 'text', detail: { text: b.text } });
      else if (b?.type === 'tool_use') out.push({ kind: 'tool_start', name: b.name, detail: { input: b.input } });
      // thinking и прочее — шум для feed, пропускаем
    }
    return out;
  }
  if (msg?.type === 'user' && Array.isArray(msg.message?.content)) {
    const out: ParsedEvent[] = [];
    for (const b of msg.message.content) {
      if (b?.type === 'tool_result') out.push({ kind: 'tool_finish', detail: { output: b.content, isError: !!b.is_error } });
    }
    return out;
  }
  return [];
}

export function appendAgentEvent(
  db: Database.Database, taskId: number, workerId: string,
  kind: AgentEventKind, opts?: { name?: string; detail?: object },
): number {
  return db.transaction(() => {
    const r = db.prepare(
      `INSERT INTO agent_events (task_id, worker_id, kind, name, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(taskId, workerId, kind, opts?.name ?? null,
      opts?.detail ? JSON.stringify(opts.detail) : null, now());
    return Number(r.lastInsertRowid);
  })();
}

export function listAgentEvents(
  db: Database.Database, taskId: number, opts?: { sinceId?: number; limit?: number },
): AgentEvent[] {
  return db.prepare(
    `SELECT * FROM agent_events WHERE task_id = ? AND id > ? ORDER BY id LIMIT ?`,
  ).all(taskId, opts?.sinceId ?? 0, opts?.limit ?? 500) as AgentEvent[];
}
