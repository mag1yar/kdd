// src/db.ts
import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
var now = () => Math.floor(Date.now() / 1e3);
var MIGRATIONS = [
  `
  CREATE TABLE tasks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    title        TEXT NOT NULL,
    body         TEXT,
    status       TEXT NOT NULL DEFAULT 'new'
                 CHECK (status IN ('backlog','new','in_progress','review','done')),
    blocked      INTEGER NOT NULL DEFAULT 0,
    block_reason TEXT,
    priority     TEXT NOT NULL DEFAULT 'medium'
                 CHECK (priority IN ('low','medium','high','urgent')),
    area         TEXT,
    position     INTEGER NOT NULL DEFAULT 0,
    archived_at  INTEGER,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );
  CREATE TABLE comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    INTEGER NOT NULL REFERENCES tasks(id),
    author     TEXT NOT NULL,
    body       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE task_links (
    from_id INTEGER NOT NULL REFERENCES tasks(id),
    to_id   INTEGER NOT NULL REFERENCES tasks(id),
    kind    TEXT NOT NULL DEFAULT 'relates_to',
    PRIMARY KEY (from_id, to_id, kind)
  );
  CREATE TABLE events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    INTEGER REFERENCES tasks(id),
    actor_type TEXT NOT NULL CHECK (actor_type IN ('user','ai')),
    actor_id   TEXT,
    action     TEXT NOT NULL CHECK (action IN
               ('created','moved','edited','commented','blocked','unblocked','linked','archived','unarchived')),
    detail     TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT, message TEXT, created_at INTEGER NOT NULL
  );
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE INDEX idx_tasks_status ON tasks(status);
  CREATE INDEX idx_comments_task ON comments(task_id, created_at);
  CREATE INDEX idx_events_task ON events(task_id, created_at);
  `,
  `
  CREATE TABLE decisions (
    slug          TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    path          TEXT NOT NULL,
    content_hash  TEXT NOT NULL,
    created       TEXT,
    superseded_by TEXT
  );
  CREATE INDEX idx_decisions_hash ON decisions(content_hash);
  CREATE VIRTUAL TABLE search_index USING fts5(
    kind UNINDEXED,
    ref UNINDEXED,
    title,
    body,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  INSERT OR IGNORE INTO meta (key, value) VALUES ('fts_last_event_id', '0');
  `
];
function openDb(dbPath, projectPath) {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  const from = db.pragma("user_version", { simple: true });
  for (let i = from; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
  if (from === 0 && projectPath) {
    db.prepare(`INSERT OR IGNORE INTO meta (key, value) VALUES ('project_path', ?)`).run(projectPath);
  }
  return db;
}

// src/errors.ts
var KddError = class extends Error {
};
function logError(db, source, message) {
  db.prepare(`INSERT INTO errors (source, message, created_at) VALUES (?, ?, ?)`).run(source, message, now());
}

// src/paths.ts
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import Database2 from "better-sqlite3";
var kddHome = () => process.env.KDD_HOME ?? join(homedir(), ".kdd");
function resolveDbPath(cwd = process.cwd()) {
  if (process.env.KDD_DB) return { dbPath: process.env.KDD_DB, projectPath: cwd };
  let common;
  try {
    common = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
  } catch {
    throw new KddError("not in a git repository (kdd resolves its store via git)");
  }
  const hash = createHash("sha256").update(common).digest("hex").slice(0, 16);
  return { dbPath: join(kddHome(), hash, "kdd.db"), projectPath: common };
}
function resolveDecisionsDir(cwd = process.cwd()) {
  if (process.env.KDD_DECISIONS_DIR) return process.env.KDD_DECISIONS_DIR;
  let top;
  try {
    top = execFileSync(
      "git",
      ["rev-parse", "--show-toplevel"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
  } catch {
    throw new KddError("not in a git repository (kdd resolves .planning via git)");
  }
  return join(top, ".planning", "decisions");
}
function listProjects() {
  const home = kddHome();
  if (!existsSync(home)) return [];
  const out = [];
  for (const entry of readdirSync(home, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dbPath = join(home, entry.name, "kdd.db");
    if (!existsSync(dbPath)) continue;
    try {
      const db = new Database2(dbPath, { readonly: true });
      const row = db.prepare(`SELECT value FROM meta WHERE key='project_path'`).get();
      db.close();
      out.push({ dbPath, projectPath: row?.value ?? "(unknown)" });
    } catch {
    }
  }
  return out;
}

// src/state.ts
var STATUSES = ["backlog", "new", "in_progress", "review", "done"];
var PRIORITIES = ["low", "medium", "high", "urgent"];
var TRANSITIONS = {
  backlog: ["new"],
  new: ["backlog", "in_progress"],
  in_progress: ["new", "review"],
  review: ["in_progress", "done"],
  done: ["review"]
};
function checkMove(from, to, actor, reason) {
  if (from === to) return { ok: false, error: `task is already in ${to}` };
  if (actor.type === "user") return { ok: true };
  if (TRANSITIONS[from].includes(to)) return { ok: true };
  if (reason) return { ok: true };
  return {
    ok: false,
    error: `invalid transition ${from} \u2192 ${to} for ai; allowed: ${TRANSITIONS[from].join(", ")}; pass --reason if user requested a skip`
  };
}

// src/ops.ts
var authorOf = (a) => a.type === "ai" ? `ai:${a.id ?? "?"}` : "user";
function appendEvent(db, taskId, actor, action, detail) {
  db.prepare(
    `INSERT INTO events (task_id, actor_type, actor_id, action, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    taskId,
    actor.type,
    actor.id ?? null,
    action,
    detail ? JSON.stringify(detail) : null,
    now()
  );
}
function mustGetTask(db, id) {
  const t = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
  if (!t) throw new KddError(`task #${id} not found`);
  return t;
}
function checkPriority(p) {
  if (!PRIORITIES.includes(p)) {
    throw new KddError(`invalid priority '${p}'; allowed: ${PRIORITIES.join(", ")}`);
  }
}
function addTask(db, input, actor) {
  const priority = input.priority ?? "medium";
  checkPriority(priority);
  if (!input.title.trim()) throw new KddError("title must not be empty");
  return db.transaction(() => {
    const ts = now();
    const r = db.prepare(
      `INSERT INTO tasks (title, body, priority, area, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.title,
      input.body ?? null,
      priority,
      input.area ?? null,
      nextPosition(db, "new"),
      ts,
      ts
    );
    const id = Number(r.lastInsertRowid);
    appendEvent(db, id, actor, "created");
    return mustGetTask(db, id);
  })();
}
function editTask(db, id, patch, actor) {
  if (patch.priority !== void 0) checkPriority(patch.priority);
  const fields = Object.keys(patch).filter((k) => patch[k] !== void 0);
  if (fields.length === 0) throw new KddError("nothing to edit");
  return db.transaction(() => {
    mustGetTask(db, id);
    const sets = fields.map((f) => `${f} = ?`).join(", ");
    db.prepare(`UPDATE tasks SET ${sets}, updated_at = ? WHERE id = ?`).run(...fields.map((f) => patch[f]), now(), id);
    appendEvent(db, id, actor, "edited", { fields });
    return mustGetTask(db, id);
  })();
}
function commentTask(db, id, body, actor) {
  if (!body.trim()) throw new KddError("comment must not be empty");
  return db.transaction(() => {
    mustGetTask(db, id);
    const r = db.prepare(
      `INSERT INTO comments (task_id, author, body, created_at) VALUES (?, ?, ?, ?)`
    ).run(id, authorOf(actor), body, now());
    appendEvent(db, id, actor, "commented");
    return db.prepare(`SELECT * FROM comments WHERE id = ?`).get(Number(r.lastInsertRowid));
  })();
}
function checkStatus(s) {
  if (!STATUSES.includes(s)) {
    throw new KddError(`invalid status '${s}'; allowed: ${STATUSES.join(", ")}`);
  }
}
function nextPosition(db, status) {
  return db.prepare(
    `SELECT COALESCE(MAX(position), -1) + 1 AS p
     FROM tasks WHERE status = ? AND archived_at IS NULL`
  ).get(status).p;
}
function moveTask(db, id, to, actor, reason) {
  checkStatus(to);
  return db.transaction(() => {
    const t = mustGetTask(db, id);
    const res = checkMove(t.status, to, actor, reason);
    if (!res.ok) throw new KddError(res.error);
    db.prepare(`UPDATE tasks SET status = ?, position = ?, updated_at = ? WHERE id = ?`).run(to, nextPosition(db, to), now(), id);
    appendEvent(
      db,
      id,
      actor,
      "moved",
      reason ? { from: t.status, to, reason } : { from: t.status, to }
    );
    if (reason) {
      db.prepare(
        `INSERT INTO comments (task_id, author, body, created_at) VALUES (?, ?, ?, ?)`
      ).run(id, authorOf(actor), reason, now());
    }
    return mustGetTask(db, id);
  })();
}
function placeTask(db, id, to, orderedIds, actor) {
  checkStatus(to);
  return db.transaction(() => {
    const t = mustGetTask(db, id);
    if (t.status !== to) {
      const res = checkMove(t.status, to, actor);
      if (!res.ok) throw new KddError(res.error);
      appendEvent(db, id, actor, "moved", { from: t.status, to });
    }
    const setPos = db.prepare(`UPDATE tasks SET position = ? WHERE id = ?`);
    orderedIds.forEach((tid, i) => setPos.run(i, tid));
    db.prepare(`UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?`).run(to, now(), id);
    return mustGetTask(db, id);
  })();
}
function blockTask(db, id, reason, actor) {
  if (!reason.trim()) throw new KddError("block reason must not be empty");
  return db.transaction(() => {
    mustGetTask(db, id);
    db.prepare(`UPDATE tasks SET blocked = 1, block_reason = ?, updated_at = ? WHERE id = ?`).run(reason, now(), id);
    appendEvent(db, id, actor, "blocked", { reason });
    return mustGetTask(db, id);
  })();
}
function unblockTask(db, id, actor) {
  return db.transaction(() => {
    mustGetTask(db, id);
    db.prepare(`UPDATE tasks SET blocked = 0, block_reason = NULL, updated_at = ? WHERE id = ?`).run(now(), id);
    appendEvent(db, id, actor, "unblocked");
    return mustGetTask(db, id);
  })();
}
function linkTasks(db, fromId, toId, kind, actor) {
  db.transaction(() => {
    mustGetTask(db, fromId);
    mustGetTask(db, toId);
    const r = db.prepare(
      `INSERT OR IGNORE INTO task_links (from_id, to_id, kind) VALUES (?, ?, ?)`
    ).run(fromId, toId, kind);
    if (r.changes > 0) appendEvent(db, fromId, actor, "linked", { to: toId, kind });
  })();
}
function archiveTask(db, id, actor) {
  return db.transaction(() => {
    mustGetTask(db, id);
    db.prepare(`UPDATE tasks SET archived_at = ?, updated_at = ? WHERE id = ?`).run(now(), now(), id);
    appendEvent(db, id, actor, "archived");
    return mustGetTask(db, id);
  })();
}
function unarchiveTask(db, id, actor) {
  return db.transaction(() => {
    mustGetTask(db, id);
    db.prepare(`UPDATE tasks SET archived_at = NULL, updated_at = ? WHERE id = ?`).run(now(), id);
    appendEvent(db, id, actor, "unarchived");
    return mustGetTask(db, id);
  })();
}

// src/decisions.ts
import { createHash as createHash2 } from "crypto";
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync, writeFileSync } from "fs";
import { join as join2 } from "path";
function slugify(title) {
  const s = title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
  return s || "untitled";
}
var normalize = (s) => s.replace(/\r\n/g, "\n").trim();
function contentHash(title, body) {
  return createHash2("sha256").update(`${normalize(title)}
${normalize(body)}`).digest("hex");
}
function renderDecisionBody(input) {
  if (input.body !== void 0) return normalize(input.body);
  const sec = (name, v) => `## ${name}
${normalize(v ?? "") || "-"}`;
  return [
    sec("Decision", input.decision),
    sec("Rationale", input.rationale),
    sec("Alternatives", input.alternatives),
    sec("Supersedes", input.supersedes),
    sec("Outcome", input.outcome)
  ].join("\n\n");
}
function renderDecisionMd(input, created) {
  return `---
created: ${created}
status: active
superseded_by:
---
# ${input.title.trim()}

${renderDecisionBody(input)}
`;
}
function parseDecisionMd(raw) {
  const text = raw.replace(/\r\n/g, "\n");
  const fm = {};
  let rest = text;
  if (text.startsWith("---\n")) {
    const end = text.indexOf("\n---\n", 4);
    if (end !== -1) {
      for (const line of text.slice(4, end).split("\n")) {
        const m = line.match(/^(\w+):\s*(.*)$/);
        if (m) fm[m[1]] = m[2].trim();
      }
      rest = text.slice(end + 5);
    }
  }
  const tm = rest.match(/^# (.+)$/m);
  const title = tm ? tm[1].trim() : "";
  const indexBody = tm ? rest.slice(rest.indexOf(tm[0]) + tm[0].length).trim() : rest.trim();
  return {
    title,
    created: fm.created ?? "",
    status: fm.status || "active",
    supersededBy: fm.superseded_by ?? "",
    indexBody,
    hash: contentHash(title, indexBody)
  };
}
function supersede(db, dir, oldSlug, newSlug) {
  const p = join2(dir, `${oldSlug}.md`);
  if (!existsSync2(p)) throw new KddError(`decision '${oldSlug}' not found`);
  let raw = readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  if (raw.startsWith("---\n") && /^status:/m.test(raw)) {
    raw = raw.replace(/^status:.*$/m, "status: superseded").replace(/^superseded_by:.*$/m, `superseded_by: ${newSlug}`);
  } else {
    const doc = parseDecisionMd(raw);
    raw = `---
created: ${doc.created}
status: superseded
superseded_by: ${newSlug}
---
${raw}`;
  }
  writeFileSync(p, raw);
  db.prepare(`UPDATE decisions SET superseded_by = ? WHERE slug = ?`).run(newSlug, oldSlug);
}
function addDecision(db, decisionsDir, input) {
  if (!input.title.trim()) throw new KddError("title must not be empty");
  if (input.body !== void 0 && [input.decision, input.rationale, input.alternatives, input.outcome].some((v) => v !== void 0)) {
    throw new KddError("--body is mutually exclusive with section flags");
  }
  const body = renderDecisionBody(input);
  const hash = contentHash(input.title, body);
  const dup = db.prepare(`SELECT slug, path FROM decisions WHERE content_hash = ?`).get(hash);
  if (dup) return { slug: dup.slug, path: dup.path, created: false };
  const date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const base = `${date}-${slugify(input.title)}`;
  let slug = base;
  const taken = (s) => existsSync2(join2(decisionsDir, `${s}.md`)) || !!db.prepare(`SELECT 1 FROM decisions WHERE slug = ?`).get(s);
  for (let i = 2; taken(slug); i++) slug = `${base}-${i}`;
  const path = join2(decisionsDir, `${slug}.md`);
  return db.transaction(() => {
    if (input.supersedes) supersede(db, decisionsDir, input.supersedes, slug);
    mkdirSync2(decisionsDir, { recursive: true });
    writeFileSync(path, renderDecisionMd(input, date));
    db.prepare(
      `INSERT INTO decisions (slug, title, path, content_hash, created, superseded_by)
       VALUES (?, ?, ?, ?, ?, NULL)`
    ).run(slug, input.title.trim(), path, hash, date);
    db.prepare(
      `INSERT INTO search_index (kind, ref, title, body) VALUES ('decision', ?, ?, ?)`
    ).run(slug, input.title.trim(), body);
    return { slug, path, created: true };
  })();
}

// src/recall.ts
import { existsSync as existsSync3, readFileSync as readFileSync2, readdirSync as readdirSync2 } from "fs";
import { join as join3 } from "path";
function syncIndex(db, decisionsDir) {
  db.transaction(() => {
    const files = existsSync3(decisionsDir) ? readdirSync2(decisionsDir).filter((f) => f.endsWith(".md")) : [];
    const inDb = new Map(
      db.prepare(`SELECT slug, content_hash, superseded_by FROM decisions`).all().map((r) => [r.slug, r])
    );
    const seen = /* @__PURE__ */ new Set();
    for (const f of files) {
      const slug = f.slice(0, -3);
      seen.add(slug);
      const path = join3(decisionsDir, f);
      const doc = parseDecisionMd(readFileSync2(path, "utf8"));
      const title = doc.title || slug;
      const supersededBy = doc.status === "superseded" ? doc.supersededBy || "?" : doc.supersededBy || null;
      const row = inDb.get(slug);
      if (row && row.content_hash === doc.hash && (row.superseded_by ?? null) === (supersededBy ?? null)) continue;
      db.prepare(`DELETE FROM search_index WHERE kind='decision' AND ref = ?`).run(slug);
      db.prepare(
        `INSERT OR REPLACE INTO decisions (slug, title, path, content_hash, created, superseded_by)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(slug, title, path, doc.hash, doc.created || null, supersededBy);
      db.prepare(
        `INSERT INTO search_index (kind, ref, title, body) VALUES ('decision', ?, ?, ?)`
      ).run(slug, title, doc.indexBody);
    }
    for (const slug of inDb.keys()) {
      if (seen.has(slug)) continue;
      db.prepare(`DELETE FROM decisions WHERE slug = ?`).run(slug);
      db.prepare(`DELETE FROM search_index WHERE kind='decision' AND ref = ?`).run(slug);
    }
    const last = Number(
      db.prepare(`SELECT value FROM meta WHERE key='fts_last_event_id'`).get()?.value ?? "0"
    );
    const max = db.prepare(`SELECT MAX(id) AS m FROM events`).get().m ?? 0;
    if (max <= last) return;
    const ids = db.prepare(
      `SELECT DISTINCT task_id AS id FROM events WHERE id > ? AND task_id IS NOT NULL`
    ).all(last);
    const getTask = db.prepare(`SELECT * FROM tasks WHERE id = ?`);
    const getComments = db.prepare(`SELECT body FROM comments WHERE task_id = ? ORDER BY id`);
    for (const { id } of ids) {
      db.prepare(`DELETE FROM search_index WHERE kind='task' AND ref = ?`).run(String(id));
      const t = getTask.get(id);
      if (!t || t.archived_at) continue;
      const body = [t.body ?? "", ...getComments.all(id).map((c) => c.body)].filter(Boolean).join("\n");
      db.prepare(
        `INSERT INTO search_index (kind, ref, title, body) VALUES ('task', ?, ?, ?)`
      ).run(String(id), t.title, body);
    }
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('fts_last_event_id', ?)`).run(String(max));
  })();
}
function sanitizeQuery(q) {
  const tokens = q.split(/\s+/).filter(Boolean).map((t) => `"${t.replace(/"/g, '""')}"`);
  if (tokens.length === 0) throw new KddError("empty query");
  return tokens.join(" ");
}
function recall(db, decisionsDir, query, opts = {}) {
  if (opts.kind && opts.kind !== "decision" && opts.kind !== "task") {
    throw new KddError(`invalid kind '${opts.kind}'; allowed: decision, task`);
  }
  syncIndex(db, decisionsDir);
  return db.prepare(`
    SELECT search_index.kind AS kind, search_index.ref AS ref,
      search_index.title AS title,
      snippet(search_index, 3, '', '', '...', 12) AS snippet,
      COALESCE(d.superseded_by, '') AS superseded_by,
      t.status AS status
    FROM search_index
    LEFT JOIN decisions d ON search_index.kind = 'decision' AND d.slug = search_index.ref
    LEFT JOIN tasks t ON search_index.kind = 'task' AND t.id = CAST(search_index.ref AS INTEGER)
    WHERE search_index MATCH @q
      AND (@kind IS NULL OR search_index.kind = @kind)
    ORDER BY (COALESCE(d.superseded_by, '') <> ''),
      bm25(search_index, 0, 0, 3.0, 1.0)
    LIMIT @k
  `).all({ q: sanitizeQuery(query), kind: opts.kind ?? null, k: opts.k ?? 10 });
}
function rebuild(db, decisionsDir) {
  db.transaction(() => {
    db.exec(`DELETE FROM search_index; DELETE FROM decisions;`);
    db.prepare(`INSERT OR REPLACE INTO meta (key, value) VALUES ('fts_last_event_id', '0')`).run();
  })();
  syncIndex(db, decisionsDir);
  return {
    decisions: db.prepare(`SELECT COUNT(*) c FROM decisions`).get().c,
    tasks: db.prepare(`SELECT COUNT(*) c FROM search_index WHERE kind='task'`).get().c
  };
}

// src/queries.ts
var PRIORITY_ORDER = `CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`;
function boardData(db, f = {}) {
  const where = [f.archived ? "archived_at IS NOT NULL" : "archived_at IS NULL"];
  const params = [];
  if (f.area) {
    where.push("area = ?");
    params.push(f.area);
  }
  if (f.status) {
    where.push("status = ?");
    params.push(f.status);
  }
  const rows = db.prepare(
    `SELECT * FROM tasks WHERE ${where.join(" AND ")}
     ORDER BY position, ${PRIORITY_ORDER}, created_at`
  ).all(...params);
  const out = Object.fromEntries(STATUSES.map((s) => [s, []]));
  for (const r of rows) out[r.status].push(r);
  return out;
}
function taskDetail(db, id) {
  const task = mustGetTask(db, id);
  const comments = db.prepare(
    `SELECT * FROM comments WHERE task_id = ? ORDER BY created_at, id`
  ).all(id);
  const events = db.prepare(
    `SELECT * FROM events WHERE task_id = ? ORDER BY created_at, id`
  ).all(id);
  const links = db.prepare(
    `SELECT t.id, t.title, l.kind FROM task_links l
     JOIN tasks t ON t.id = CASE WHEN l.from_id = ? THEN l.to_id ELSE l.from_id END
     WHERE l.from_id = ? OR l.to_id = ?`
  ).all(id, id, id);
  return { task, comments, events, links };
}
function statusDigest(db) {
  const active = `archived_at IS NULL`;
  const q = (w) => db.prepare(
    `SELECT * FROM tasks WHERE ${active} AND ${w}
     ORDER BY ${PRIORITY_ORDER}, created_at`
  ).all();
  return {
    in_progress: q(`status = 'in_progress'`),
    review: q(`status = 'review'`),
    blocked: q(`blocked = 1`),
    recent: db.prepare(
      `SELECT * FROM events ORDER BY id DESC LIMIT 5`
    ).all()
  };
}
function exportBoard(db) {
  return {
    tasks: db.prepare(`SELECT * FROM tasks ORDER BY id`).all(),
    comments: db.prepare(`SELECT * FROM comments ORDER BY id`).all(),
    links: db.prepare(`SELECT * FROM task_links`).all(),
    events: db.prepare(`SELECT * FROM events ORDER BY id`).all()
  };
}
export {
  KddError,
  MIGRATIONS,
  PRIORITIES,
  STATUSES,
  TRANSITIONS,
  addDecision,
  addTask,
  appendEvent,
  archiveTask,
  authorOf,
  blockTask,
  boardData,
  checkMove,
  commentTask,
  contentHash,
  editTask,
  exportBoard,
  kddHome,
  linkTasks,
  listProjects,
  logError,
  moveTask,
  mustGetTask,
  now,
  openDb,
  parseDecisionMd,
  placeTask,
  rebuild,
  recall,
  renderDecisionBody,
  renderDecisionMd,
  resolveDbPath,
  resolveDecisionsDir,
  sanitizeQuery,
  slugify,
  statusDigest,
  syncIndex,
  taskDetail,
  unarchiveTask,
  unblockTask
};
