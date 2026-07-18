#!/usr/bin/env node

// src/index.ts
import { Command } from "commander";
import { readFileSync } from "fs";
import { basename, dirname } from "path";
import {
  KddError as KddError2,
  addDecision,
  addTask,
  archiveTask,
  blockTask,
  boardData,
  commentTask,
  createTrack,
  deleteTrack,
  editTask,
  editTrack,
  exportBoard,
  linkTasks,
  listProjects,
  listTracks,
  moveTask,
  openDb as openDb2,
  rebuild,
  recall,
  resolveDbPath as resolveDbPath2,
  resolveDecisionsDir,
  statusDigest,
  taskDetail,
  unarchiveTask,
  unblockTask
} from "@kddkit/core";
import { projectPool, startUi } from "@kddkit/ui";

// src/context.ts
import { KddError, openDb, resolveDbPath } from "@kddkit/core";
function getActor() {
  return process.env.KDD_ACTOR === "ai" ? { type: "ai", id: process.env.KDD_SESSION } : { type: "user" };
}
function withDb(fn) {
  const { dbPath, projectPath } = resolveDbPath();
  const db = openDb(dbPath, projectPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
function parseId(s) {
  const n = Number(s.replace(/^#/, ""));
  if (!Number.isInteger(n) || n <= 0) throw new KddError(`invalid task id '${s}'`);
  return n;
}
function fail(msg, json) {
  if (json) console.log(JSON.stringify({ error: msg }));
  else console.error(`error: ${msg}`);
  process.exit(1);
}

// src/render.ts
import {
  CAPS,
  STATUSES,
  capText as cap,
  now
} from "@kddkit/core";
import { capText } from "@kddkit/core";
function renderAge(epoch) {
  const d = now() - epoch;
  if (d < 3600) return `${Math.max(1, Math.floor(d / 60))}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}
function taskLine(t) {
  const bits = [`#${t.id}`, cap(t.title, CAPS.titleChars), `[${t.priority}]`];
  if (t.area) bits.push(`@${t.area}`);
  if (t.blocked) bits.push(`BLOCKED: ${cap(t.block_reason ?? "", CAPS.blockReasonChars)}`);
  return `  ${bits.join(" ")}`;
}
function renderBoard(b) {
  const lines = [];
  for (const s of STATUSES) {
    lines.push(`${s} (${b[s].length})`);
    const shown = b[s].slice(0, CAPS.boardRows);
    for (const t of shown) lines.push(taskLine(t));
    if (b[s].length > shown.length) {
      lines.push(`  (+${b[s].length - shown.length} more, use --status ${s})`);
    }
  }
  return lines.join("\n");
}
function renderShow(d) {
  const t = d.task;
  const lines = [
    `#${t.id} ${t.title}`,
    `status: ${t.status}${t.blocked ? ` (BLOCKED: ${t.block_reason})` : ""}  priority: ${t.priority}${t.area ? `  area: ${t.area}` : ""}${t.archived_at ? "  ARCHIVED" : ""}`
  ];
  if (t.body) lines.push("", cap(t.body, CAPS.bodyChars));
  if (d.links.length) {
    lines.push("", "links:");
    for (const l of d.links) lines.push(`  ${l.kind} #${l.id} ${cap(l.title, CAPS.titleChars)}`);
  }
  if (d.comments.length) {
    lines.push("", `comments (${d.comments.length}):`);
    const shown = d.comments.slice(-CAPS.comments);
    if (shown.length < d.comments.length) {
      lines.push(`  (${d.comments.length - shown.length} earlier omitted)`);
    }
    for (const c of shown) {
      lines.push(`  [${c.author} ${renderAge(c.created_at)} ago] ${cap(c.body, CAPS.commentChars)}`);
    }
  }
  lines.push("", "history:");
  for (const e of d.events.slice(-CAPS.events)) {
    lines.push(`  ${renderAge(e.created_at)} ago ${e.actor_type} ${e.action}${e.detail ? ` ${e.detail}` : ""}`);
  }
  return lines.join("\n");
}
function renderRecall(hits) {
  if (hits.length === 0) return "no results";
  const line = (h) => {
    const snip = h.snippet.replace(/\s+/g, " ").trim();
    if (h.kind === "decision") {
      const tag = h.superseded_by ? ` [superseded by ${h.superseded_by}]` : "";
      return `decision ${h.ref}${tag} ${cap(h.title, CAPS.recallTitleChars)} \u2014 ${snip}`;
    }
    return `task #${h.ref} [${h.status ?? "?"}] ${cap(h.title, CAPS.recallTitleChars)} \u2014 ${snip}`;
  };
  const all = hits.map(line);
  const shown = [...all];
  while (shown.length > 1 && Buffer.byteLength(shown.join("\n"), "utf8") > CAPS.recallBytes - 32) {
    shown.pop();
  }
  if (shown.length < all.length) shown.push(`(+${all.length - shown.length} more, use -k)`);
  return shown.join("\n");
}
function renderTracks(ts) {
  if (ts.length === 0) return "no tracks";
  return ts.map((t) => {
    const head = `#${t.id} ${t.name} (${t.open_tasks})${t.status === "done" ? " DONE" : ""}`;
    return t.description ? `${head}
  ${cap(t.description, CAPS.trackDescChars)}` : head;
  }).join("\n");
}
function renderStatus(d) {
  const lines = [];
  const section = (name, ts) => {
    lines.push(`${name} (${ts.length})`);
    const shown = ts.slice(0, CAPS.statusRows);
    for (const t of shown) lines.push(taskLine(t));
    if (ts.length > shown.length) lines.push(`  (+${ts.length - shown.length} more)`);
  };
  section("in_progress", d.in_progress);
  section("review", d.review);
  section("blocked", d.blocked);
  lines.push("recent:");
  for (const e of d.recent) {
    lines.push(`  ${renderAge(e.created_at)} ago ${e.actor_type} ${e.action} #${e.task_id ?? "-"}`);
  }
  return lines.join("\n");
}

// src/index.ts
var program = new Command().name("kdd").description("kanban substrate for humans and Claude");
function out(json, obj, text) {
  console.log(json ? JSON.stringify(obj) : text());
}
function readBody(opts) {
  if (opts.bodyFile) return readFileSync(opts.bodyFile, "utf8");
  if (opts.body === "-") return readFileSync(0, "utf8");
  return opts.body;
}
function run(json, fn) {
  try {
    fn();
  } catch (e) {
    fail(e instanceof KddError2 ? e.message : String(e), json);
  }
}
program.command("add").argument("<title>").option("--body <md>", 'markdown body, or "-" for stdin').option("--body-file <path>").option("--priority <p>", "low|medium|high|urgent").option("--area <area>").option("--track <id>", "track id").option("--json", "machine-readable output").action((title, o) => run(o.json, () => {
  const t = withDb((db) => addTask(
    db,
    {
      title,
      body: readBody(o),
      priority: o.priority,
      area: o.area,
      track_id: o.track ? parseId(o.track) : void 0
    },
    getActor()
  ));
  out(o.json, t, () => `#${t.id} created`);
}));
program.command("decide").argument("<title>").option("--decision <t>").option("--rationale <t>").option("--alternatives <t>").option("--outcome <t>").option("--supersedes <slug>").option("--body <md>", 'full md body, or "-" for stdin').option("--body-file <path>").option("--json").action((title, o) => run(o.json, () => {
  const r = withDb((db) => addDecision(db, resolveDecisionsDir(), {
    title,
    decision: o.decision,
    rationale: o.rationale,
    alternatives: o.alternatives,
    outcome: o.outcome,
    supersedes: o.supersedes,
    body: readBody(o)
  }));
  out(o.json, r, () => r.created ? `decided: ${r.slug}
${r.path}` : `already recorded: ${r.slug}`);
}));
program.command("board").option("--area <area>").option("--status <s>").option("--track <id>", "track id").option("--archived", "show archived tasks only").option("--json").action((o) => run(o.json, () => {
  const b = withDb((db) => boardData(
    db,
    {
      area: o.area,
      status: o.status,
      archived: o.archived,
      track_id: o.track ? parseId(o.track) : void 0
    }
  ));
  out(o.json, b, () => renderBoard(b));
}));
program.command("show").argument("<id>").option("--json").action((id, o) => run(o.json, () => {
  const d = withDb((db) => taskDetail(db, parseId(id)));
  out(o.json, d, () => renderShow(d));
}));
program.command("move").argument("<id>").argument("<status>").option("--reason <text>", "why the transition skips the matrix (ai)").option("--json").action((id, status, o) => run(o.json, () => {
  const t = withDb((db) => moveTask(db, parseId(id), status, getActor(), o.reason));
  out(o.json, t, () => `#${t.id} \u2192 ${t.status}`);
}));
program.command("edit").argument("<id>").option("--title <t>").option("--body <md>").option("--body-file <path>").option("--priority <p>").option("--area <a>").option("--track <id>", 'track id, or "none" to detach').option("--json").action((id, o) => run(o.json, () => {
  const track_id = o.track === void 0 ? void 0 : o.track === "none" ? null : parseId(o.track);
  const t = withDb((db) => editTask(
    db,
    parseId(id),
    { title: o.title, body: readBody(o), priority: o.priority, area: o.area, track_id },
    getActor()
  ));
  out(o.json, t, () => `#${t.id} updated`);
}));
program.command("comment").argument("<id>").argument("<text>").option("--json").action((id, text, o) => run(o.json, () => {
  const c = withDb((db) => commentTask(db, parseId(id), text, getActor()));
  out(o.json, c, () => `#${parseId(id)} commented`);
}));
program.command("block").argument("<id>").argument("<reason>").option("--json").action((id, reason, o) => run(o.json, () => {
  const t = withDb((db) => blockTask(db, parseId(id), reason, getActor()));
  out(o.json, t, () => `#${t.id} blocked: ${reason}`);
}));
program.command("unblock").argument("<id>").option("--json").action((id, o) => run(o.json, () => {
  const t = withDb((db) => unblockTask(db, parseId(id), getActor()));
  out(o.json, t, () => `#${t.id} unblocked`);
}));
program.command("link").argument("<from>").argument("<to>").option("--kind <k>", "link kind", "relates_to").option("--json").action((from, to, o) => run(o.json, () => {
  withDb((db) => linkTasks(db, parseId(from), parseId(to), o.kind, getActor()));
  out(o.json, { ok: true }, () => `#${parseId(from)} linked to #${parseId(to)}`);
}));
program.command("archive").argument("<id>").option("--json").action((id, o) => run(o.json, () => {
  const t = withDb((db) => archiveTask(db, parseId(id), getActor()));
  out(o.json, t, () => `#${t.id} archived`);
}));
program.command("unarchive").argument("<id>").option("--json").action((id, o) => run(o.json, () => {
  const t = withDb((db) => unarchiveTask(db, parseId(id), getActor()));
  out(o.json, t, () => `#${t.id} unarchived`);
}));
program.command("recall").argument("<query>").option("-k, --limit <n>", "max results", "10").option("--kind <kind>", "decision|task").option("--json").action((query, o) => run(o.json, () => {
  const hits = withDb((db) => recall(
    db,
    resolveDecisionsDir(),
    query,
    { k: Number(o.limit), kind: o.kind }
  ));
  out(o.json, hits, () => renderRecall(hits));
}));
program.command("rebuild").option("--json").action((o) => run(o.json, () => {
  const r = withDb((db) => rebuild(db, resolveDecisionsDir()));
  out(o.json, r, () => `rebuilt: ${r.decisions} decisions, ${r.tasks} tasks indexed`);
}));
program.command("status").option("--json").action((o) => run(o.json, () => {
  const d = withDb((db) => statusDigest(db));
  out(o.json, d, () => renderStatus(d));
}));
program.command("ui").option("--port <n>", "port", "4499").action((o) => run(false, () => {
  void uiStart(Number(o.port));
}));
async function uiStart(port) {
  const { dbPath, projectPath } = resolveDbPath2();
  const hash = basename(dirname(dbPath));
  openDb2(dbPath, projectPath).close();
  const url = `http://localhost:${port}?project=${hash}`;
  try {
    const res = await fetch(`http://localhost:${port}/api/ping`, { signal: AbortSignal.timeout(500) });
    if (res.ok && (await res.json()).kdd) {
      console.log(`kdd ui: ${url} (reusing running server)`);
      return;
    }
  } catch {
  }
  const { getDb, closeAll } = projectPool(hash);
  try {
    await startUi(getDb, port, hash);
  } catch (e) {
    closeAll();
    fail(e instanceof Error ? e.message : String(e), false);
  }
  process.on("SIGINT", () => {
    closeAll();
    process.exit(0);
  });
  console.log(`kdd ui: ${url}`);
}
var track = program.command("track").description("manage tracks (task groups)");
track.command("add").argument("<name>").option("--description <t>", '"use when\u2026" routing hint for the agent').option("--json").action((name, o) => run(o.json, () => {
  const t = withDb((db) => createTrack(db, { name, description: o.description }));
  out(o.json, t, () => `track #${t.id} ${t.name}`);
}));
track.command("ls").option("--all", "include completed tracks").option("--json").action((o) => run(o.json, () => {
  const ts = withDb((db) => listTracks(db, o.all ? {} : { status: "active" }));
  out(o.json, ts, () => renderTracks(ts));
}));
track.command("edit").argument("<id>").option("--name <t>").option("--description <t>").option("--json").action((id, o) => run(o.json, () => {
  const t = withDb((db) => editTrack(
    db,
    parseId(id),
    { name: o.name, description: o.description }
  ));
  out(o.json, t, () => `track #${t.id} updated`);
}));
track.command("done").argument("<id>").option("--json").action((id, o) => run(o.json, () => {
  const t = withDb((db) => editTrack(db, parseId(id), { status: "done" }));
  out(o.json, t, () => `track #${t.id} done`);
}));
track.command("reopen").argument("<id>").option("--json").action((id, o) => run(o.json, () => {
  const t = withDb((db) => editTrack(db, parseId(id), { status: "active" }));
  out(o.json, t, () => `track #${t.id} active`);
}));
track.command("rm").argument("<id>").option("--json").action((id, o) => run(o.json, () => {
  withDb((db) => deleteTrack(db, parseId(id)));
  out(o.json, { ok: true }, () => `track #${parseId(id)} deleted`);
}));
program.command("projects").option("--json").action((o) => run(o.json, () => {
  const ps = listProjects();
  out(o.json, ps, () => ps.length ? ps.map((p) => `${p.projectPath}
  ${p.dbPath}`).join("\n") : "no projects");
}));
program.command("export").action(() => run(true, () => {
  const dump = withDb((db) => exportBoard(db));
  console.log(JSON.stringify(dump));
}));
program.parse();
