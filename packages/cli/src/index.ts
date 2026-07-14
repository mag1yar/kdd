#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import {
  KddError, addTask, archiveTask, blockTask, boardData, commentTask, editTask,
  exportBoard, linkTasks, listProjects, moveTask, statusDigest, taskDetail,
  unarchiveTask, unblockTask, type Status,
} from '@kddkit/core';
import { fail, getActor, parseId, withDb } from './context.js';
import { renderBoard, renderShow, renderStatus } from './render.js';

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

program.command('add')
  .argument('<title>')
  .option('--body <md>', 'markdown body, or "-" for stdin')
  .option('--body-file <path>')
  .option('--priority <p>', 'low|medium|high|urgent')
  .option('--area <area>')
  .option('--json', 'machine-readable output')
  .action((title, o) => run(o.json, () => {
    const t = withDb((db) => addTask(db,
      { title, body: readBody(o), priority: o.priority, area: o.area }, getActor()));
    out(o.json, t, () => `#${t.id} created`);
  }));

program.command('board')
  .option('--area <area>')
  .option('--status <s>')
  .option('--archived', 'show archived tasks only')
  .option('--json')
  .action((o) => run(o.json, () => {
    const b = withDb((db) => boardData(db,
      { area: o.area, status: o.status as Status | undefined, archived: o.archived }));
    out(o.json, b, () => renderBoard(b));
  }));

program.command('show')
  .argument('<id>')
  .option('--json')
  .action((id, o) => run(o.json, () => {
    const d = withDb((db) => taskDetail(db, parseId(id)));
    out(o.json, d, () => renderShow(d));
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
  .option('--json')
  .action((id, o) => run(o.json, () => {
    const t = withDb((db) => editTask(db, parseId(id),
      { title: o.title, body: readBody(o), priority: o.priority, area: o.area }, getActor()));
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

program.command('status')
  .option('--json')
  .action((o) => run(o.json, () => {
    const d = withDb((db) => statusDigest(db));
    out(o.json, d, () => renderStatus(d));
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
