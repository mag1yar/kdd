#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import {
  KddError, addCriterion, addDecision, addTask, archiveTask, blockTask, boardData, commentTask,
  createTrack, deleteTrack, editTask, editTrack, exportBoard, linkTasks, listCriteria,
  listProjects, listTracks, moveTask, openDb, rebuild, recall, removeCriterion, resolveDbPath,
  resolveDecisionsDir, setCriterionChecked, statusDigest,
  taskDetail, taskDetailCapped, unarchiveTask, unblockTask, type Status,
} from '@kddkit/core';
import { projectPool, startUi } from '@kddkit/ui';
import { fail, getActor, parseId, withDb } from './context.js';
import {
  renderBoard, renderCriteria, renderRecall, renderShow, renderStatus, renderTracks,
} from './render.js';

const program = new Command()
  .name('kdd')
  .description('kanban substrate for humans and Claude');

function out(json: boolean, obj: unknown, text: () => string): void {
  console.log(json ? JSON.stringify(obj) : text());
}

function readBody(opts: { body?: string; bodyFile?: string }): string | undefined {
  if (opts.bodyFile) return readFileSync(opts.bodyFile, 'utf8');
  if (opts.body === '-') return readFileSync(0, 'utf8'); // stdin
  return opts.body;
}

function run(json: boolean, fn: () => void): void {
  try { fn(); } catch (e) {
    fail(e instanceof KddError ? e.message : String(e), json);
  }
}

const collect = (v: string, acc: string[]): string[] => [...acc, v];

program.command('add')
  .argument('<title>')
  .option('--body <md>', 'markdown body, or "-" for stdin')
  .option('--body-file <path>')
  .option('--priority <p>', 'low|medium|high|urgent')
  .option('--area <area>')
  .option('--track <id>', 'track id')
  .option('--criterion <text>', 'acceptance criterion (repeatable)', collect, [])
  .option('--json', 'machine-readable output')
  .action((title, o) => run(o.json, () => {
    const t = withDb((db) => addTask(db,
      { title, body: readBody(o), priority: o.priority, area: o.area,
        track_id: o.track ? parseId(o.track) : undefined,
        criteria: o.criterion.length ? o.criterion : undefined }, getActor()));
    out(o.json, t, () => `#${t.id} created`);
  }));

program.command('decide')
  .argument('<title>')
  .option('--decision <t>').option('--rationale <t>').option('--alternatives <t>')
  .option('--outcome <t>').option('--supersedes <slug>')
  .option('--body <md>', 'full md body, or "-" for stdin')
  .option('--body-file <path>')
  .option('--json')
  .action((title, o) => run(o.json, () => {
    const r = withDb((db) => addDecision(db, resolveDecisionsDir(), {
      title, decision: o.decision, rationale: o.rationale,
      alternatives: o.alternatives, outcome: o.outcome,
      supersedes: o.supersedes, body: readBody(o),
    }));
    out(o.json, r, () =>
      r.created ? `decided: ${r.slug}\n${r.path}` : `already recorded: ${r.slug}`);
  }));

program.command('board')
  .option('--area <area>')
  .option('--status <s>')
  .option('--track <id>', 'track id')
  .option('--archived', 'show archived tasks only')
  .option('--json')
  .action((o) => run(o.json, () => {
    const b = withDb((db) => boardData(db,
      { area: o.area, status: o.status as Status | undefined, archived: o.archived,
        track_id: o.track ? parseId(o.track) : undefined }));
    out(o.json, b, () => renderBoard(b));
  }));

program.command('show')
  .argument('<id>')
  .option('--json')
  .action((id, o) => run(o.json, () => {
    // --json остаётся полным дампом; текст идёт через капы core
    if (o.json) { out(true, withDb((db) => taskDetail(db, parseId(id))), () => ''); return; }
    console.log(renderShow(withDb((db) => taskDetailCapped(db, parseId(id)))));
  }));

program.command('move')
  .argument('<id>').argument('<status>')
  .option('--reason <text>', 'why the transition skips the matrix (ai)')
  .option('--json')
  .action((id, status, o) => run(o.json, () => {
    const t = withDb((db) => moveTask(db, parseId(id), status, getActor(), o.reason));
    out(o.json, t, () => `#${t.id} → ${t.status}`);
  }));

program.command('edit')
  .argument('<id>')
  .option('--title <t>').option('--body <md>').option('--body-file <path>')
  .option('--priority <p>').option('--area <a>')
  .option('--track <id>', 'track id, or "none" to detach')
  .option('--json')
  .action((id, o) => run(o.json, () => {
    const track_id = o.track === undefined ? undefined : o.track === 'none' ? null : parseId(o.track);
    const t = withDb((db) => editTask(db, parseId(id),
      { title: o.title, body: readBody(o), priority: o.priority, area: o.area, track_id },
      getActor()));
    out(o.json, t, () => `#${t.id} updated`);
  }));

program.command('comment')
  .argument('<id>').argument('<text>')
  .option('--json')
  .action((id, text, o) => run(o.json, () => {
    const c = withDb((db) => commentTask(db, parseId(id), text, getActor()));
    out(o.json, c, () => `#${parseId(id)} commented`);
  }));

program.command('block')
  .argument('<id>').argument('<reason>')
  .option('--json')
  .action((id, reason, o) => run(o.json, () => {
    const t = withDb((db) => blockTask(db, parseId(id), reason, getActor()));
    out(o.json, t, () => `#${t.id} blocked: ${reason}`);
  }));

program.command('unblock')
  .argument('<id>')
  .option('--json')
  .action((id, o) => run(o.json, () => {
    const t = withDb((db) => unblockTask(db, parseId(id), getActor()));
    out(o.json, t, () => `#${t.id} unblocked`);
  }));

program.command('link')
  .argument('<from>').argument('<to>')
  .option('--kind <k>', 'link kind', 'relates_to')
  .option('--json')
  .action((from, to, o) => run(o.json, () => {
    withDb((db) => linkTasks(db, parseId(from), parseId(to), o.kind, getActor()));
    out(o.json, { ok: true }, () => `#${parseId(from)} linked to #${parseId(to)}`);
  }));

program.command('archive')
  .argument('<id>')
  .option('--json')
  .action((id, o) => run(o.json, () => {
    const t = withDb((db) => archiveTask(db, parseId(id), getActor()));
    out(o.json, t, () => `#${t.id} archived`);
  }));

program.command('unarchive')
  .argument('<id>')
  .option('--json')
  .action((id, o) => run(o.json, () => {
    const t = withDb((db) => unarchiveTask(db, parseId(id), getActor()));
    out(o.json, t, () => `#${t.id} unarchived`);
  }));

program.command('recall')
  .argument('<query>')
  .option('-k, --limit <n>', 'max results', '10')
  .option('--kind <kind>', 'decision|task')
  .option('--json')
  .action((query, o) => run(o.json, () => {
    const hits = withDb((db) => recall(db, resolveDecisionsDir(), query,
      { k: Number(o.limit), kind: o.kind }));
    out(o.json, hits, () => renderRecall(hits));
  }));

program.command('rebuild')
  .option('--json')
  .action((o) => run(o.json, () => {
    const r = withDb((db) => rebuild(db, resolveDecisionsDir()));
    out(o.json, r, () => `rebuilt: ${r.decisions} decisions, ${r.tasks} tasks indexed`);
  }));

program.command('status')
  .option('--json')
  .action((o) => run(o.json, () => {
    const d = withDb((db) => statusDigest(db));
    out(o.json, d, () => renderStatus(d));
  }));

program.command('ui')
  .option('--port <n>', 'port', '4499')
  .action((o) => run(false, () => { void uiStart(Number(o.port)); }));

// Один сервер на все проекты: если kdd-ui уже поднят на порту — переиспользуем,
// печатаем URL с ?project=<этот-hash>. Иначе поднимаем сервер здесь.
async function uiStart(port: number): Promise<void> {
  const { dbPath, projectPath } = resolveDbPath();
  const hash = basename(dirname(dbPath));
  openDb(dbPath, projectPath).close(); // создаём/мигрируем базу → проект виден в /api/projects
  const url = `http://localhost:${port}?project=${hash}`;
  try {
    const res = await fetch(`http://localhost:${port}/api/ping`, { signal: AbortSignal.timeout(500) });
    if (res.ok && ((await res.json()) as { kdd?: boolean }).kdd) {
      console.log(`kdd ui: ${url} (reusing running server)`);
      return;
    }
  } catch { /* сервера нет — поднимаем свой */ }
  const { getDb, closeAll } = projectPool(hash);
  try {
    await startUi(getDb, port, hash);
  } catch (e) {
    closeAll();
    fail(e instanceof Error ? e.message : String(e), false);
  }
  process.on('SIGINT', () => { closeAll(); process.exit(0); });
  console.log(`kdd ui: ${url}`);
}

const criteria = program.command('criteria').description('acceptance criteria on tasks');

criteria.command('add')
  .argument('<taskId>').argument('<text>')
  .option('--json')
  .action((taskId, text, o) => run(o.json, () => {
    const c = withDb((db) => addCriterion(db, parseId(taskId), text, getActor()));
    out(o.json, c, () => `#${c.task_id} criterion ${c.id} added`);
  }));

criteria.command('check')
  .argument('<taskId>').argument('<id>')
  .option('--json')
  .action((taskId, id, o) => run(o.json, () => {
    const c = withDb((db) =>
      setCriterionChecked(db, parseId(taskId), parseId(id), true, getActor()));
    out(o.json, c, () => `#${c.task_id} criterion ${c.id} checked`);
  }));

criteria.command('uncheck')
  .argument('<taskId>').argument('<id>')
  .option('--json')
  .action((taskId, id, o) => run(o.json, () => {
    const c = withDb((db) =>
      setCriterionChecked(db, parseId(taskId), parseId(id), false, getActor()));
    out(o.json, c, () => `#${c.task_id} criterion ${c.id} unchecked`);
  }));

criteria.command('rm')
  .argument('<taskId>').argument('<id>')
  .option('--json')
  .action((taskId, id, o) => run(o.json, () => {
    withDb((db) => removeCriterion(db, parseId(taskId), parseId(id), getActor()));
    out(o.json, { ok: true }, () => `#${parseId(taskId)} criterion ${parseId(id)} removed`);
  }));

criteria.command('ls')
  .argument('<taskId>')
  .option('--json')
  .action((taskId, o) => run(o.json, () => {
    const cs = withDb((db) => listCriteria(db, parseId(taskId)));
    out(o.json, cs, () => renderCriteria(cs));
  }));

const track = program.command('track').description('manage tracks (task groups)');

track.command('add')
  .argument('<name>')
  .option('--description <t>', '"use when…" routing hint for the agent')
  .option('--json')
  .action((name, o) => run(o.json, () => {
    const t = withDb((db) => createTrack(db, { name, description: o.description }));
    out(o.json, t, () => `track #${t.id} ${t.name}`);
  }));

track.command('ls')
  .option('--all', 'include completed tracks')
  .option('--json')
  .action((o) => run(o.json, () => {
    const ts = withDb((db) => listTracks(db, o.all ? {} : { status: 'active' }));
    out(o.json, ts, () => renderTracks(ts));
  }));

track.command('edit')
  .argument('<id>')
  .option('--name <t>').option('--description <t>')
  .option('--json')
  .action((id, o) => run(o.json, () => {
    const t = withDb((db) => editTrack(db, parseId(id),
      { name: o.name, description: o.description }));
    out(o.json, t, () => `track #${t.id} updated`);
  }));

track.command('done')
  .argument('<id>')
  .option('--json')
  .action((id, o) => run(o.json, () => {
    const t = withDb((db) => editTrack(db, parseId(id), { status: 'done' }));
    out(o.json, t, () => `track #${t.id} done`);
  }));

track.command('reopen')
  .argument('<id>')
  .option('--json')
  .action((id, o) => run(o.json, () => {
    const t = withDb((db) => editTrack(db, parseId(id), { status: 'active' }));
    out(o.json, t, () => `track #${t.id} active`);
  }));

track.command('rm')
  .argument('<id>')
  .option('--json')
  .action((id, o) => run(o.json, () => {
    withDb((db) => deleteTrack(db, parseId(id))); // задачи отцепляются, память остаётся
    out(o.json, { ok: true }, () => `track #${parseId(id)} deleted`);
  }));

program.command('projects')
  .option('--json')
  .action((o) => run(o.json, () => {
    const ps = listProjects();
    out(o.json, ps, () =>
      ps.length ? ps.map((p) => `${p.projectPath}\n  ${p.dbPath}`).join('\n') : 'no projects');
  }));

program.command('export')
  .action(() => run(true, () => {
    const dump = withDb((db) => exportBoard(db));
    console.log(JSON.stringify(dump));
  }));

program.parse();
