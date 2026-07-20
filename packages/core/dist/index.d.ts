import Database from 'better-sqlite3';

declare const CAPS: {
    readonly boardRows: 8;
    readonly statusRows: 5;
    readonly statusEvents: 5;
    readonly titleChars: 50;
    readonly blockReasonChars: 40;
    readonly bodyChars: 8192;
    readonly comments: 20;
    readonly commentChars: 500;
    readonly events: 10;
    readonly recallK: 10;
    readonly recallKMax: 50;
    readonly recallSnippetTokens: 12;
    readonly recallBytes: 4096;
    readonly recallTitleChars: 60;
    readonly trackDescChars: 200;
};
declare function capText(s: string, n: number): string;

declare const now: () => number;
declare const MIGRATIONS: string[];
declare function openDb(dbPath: string, projectPath?: string): Database.Database;

declare class KddError extends Error {
}
declare function logError(db: Database.Database, source: string, message: string): void;

declare const kddHome: () => string;
declare function resolveDbPath(cwd?: string): {
    dbPath: string;
    projectPath: string;
};
declare function resolveDecisionsDir(cwd?: string): string;
declare function listProjects(): {
    dbPath: string;
    projectPath: string;
}[];

type Status = 'backlog' | 'new' | 'in_progress' | 'review' | 'done';
declare const STATUSES: Status[];
type Priority = 'low' | 'medium' | 'high' | 'urgent';
declare const PRIORITIES: Priority[];
type Actor = {
    type: 'user' | 'ai';
    id?: string;
};
declare const TRANSITIONS: Record<Status, Status[]>;
declare function checkMove(from: Status, to: Status, actor: Actor, reason?: string): {
    ok: true;
} | {
    ok: false;
    error: string;
};

interface Task {
    id: number;
    title: string;
    body: string | null;
    status: Status;
    blocked: 0 | 1;
    block_reason: string | null;
    priority: Priority;
    area: string | null;
    track_id: number | null;
    position: number;
    archived_at: number | null;
    created_at: number;
    updated_at: number;
}
interface Track {
    id: number;
    name: string;
    description: string | null;
    status: 'active' | 'done';
    created_at: number;
}
interface Criterion {
    id: number;
    task_id: number;
    text: string;
    checked_at: number | null;
    position: number;
    created_at: number;
}
interface Comment {
    id: number;
    task_id: number;
    author: string;
    body: string;
    created_at: number;
}
interface EventRow {
    id: number;
    task_id: number | null;
    actor_type: 'user' | 'ai';
    actor_id: string | null;
    action: string;
    detail: string | null;
    created_at: number;
}

declare const authorOf: (a: Actor) => string;
declare function appendEvent(db: Database.Database, taskId: number | null, actor: Actor, action: string, detail?: object): void;
declare function mustGetTask(db: Database.Database, id: number): Task;
declare function addTask(db: Database.Database, input: {
    title: string;
    body?: string;
    priority?: Priority;
    area?: string;
    track_id?: number;
    criteria?: string[];
}, actor: Actor): Task;
declare function editTask(db: Database.Database, id: number, patch: {
    title?: string;
    body?: string;
    priority?: Priority;
    area?: string;
    track_id?: number | null;
}, actor: Actor): Task;
declare function commentTask(db: Database.Database, id: number, body: string, actor: Actor): Comment;
declare function moveTask(db: Database.Database, id: number, to: string, actor: Actor, reason?: string): Task;
declare function placeTask(db: Database.Database, id: number, to: string, orderedIds: number[], actor: Actor): Task;
declare function blockTask(db: Database.Database, id: number, reason: string, actor: Actor): Task;
declare function unblockTask(db: Database.Database, id: number, actor: Actor): Task;
declare function linkTasks(db: Database.Database, fromId: number, toId: number, kind: string, actor: Actor): void;
declare function archiveTask(db: Database.Database, id: number, actor: Actor): Task;
declare function unarchiveTask(db: Database.Database, id: number, actor: Actor): Task;

declare function listCriteria(db: Database.Database, taskId: number): Criterion[];
declare function addCriterion(db: Database.Database, taskId: number, text: string, actor: Actor): Criterion;
declare function setCriterionChecked(db: Database.Database, taskId: number, id: number, checked: boolean, actor: Actor): Criterion;
declare function removeCriterion(db: Database.Database, taskId: number, id: number, actor: Actor): void;

declare function mustGetTrack(db: Database.Database, id: number): Track;
declare function createTrack(db: Database.Database, input: {
    name: string;
    description?: string;
}): Track;
declare function editTrack(db: Database.Database, id: number, patch: {
    name?: string;
    description?: string;
    status?: 'active' | 'done';
}): Track;
declare function deleteTrack(db: Database.Database, id: number): void;
declare function listTracks(db: Database.Database, opts?: {
    status?: 'active' | 'done';
}): (Track & {
    open_tasks: number;
})[];

interface DecisionInput {
    title: string;
    decision?: string;
    rationale?: string;
    alternatives?: string;
    outcome?: string;
    supersedes?: string;
    body?: string;
}
interface ParsedDecision {
    title: string;
    created: string;
    status: string;
    supersededBy: string;
    indexBody: string;
    hash: string;
}
declare function slugify(title: string): string;
declare function contentHash(title: string, body: string): string;
declare function renderDecisionBody(input: DecisionInput): string;
declare function renderDecisionMd(input: DecisionInput, created: string): string;
declare function parseDecisionMd(raw: string): ParsedDecision;
declare function addDecision(db: Database.Database, decisionsDir: string, input: DecisionInput): {
    slug: string;
    path: string;
    created: boolean;
};

declare function syncIndex(db: Database.Database, decisionsDir: string): void;
interface RecallHit {
    kind: 'decision' | 'task';
    ref: string;
    title: string;
    snippet: string;
    superseded_by: string;
    status: string | null;
}
declare function sanitizeQuery(q: string): string;
declare function recall(db: Database.Database, decisionsDir: string, query: string, opts?: {
    k?: number;
    kind?: 'decision' | 'task';
}): RecallHit[];
declare function rebuild(db: Database.Database, decisionsDir: string): {
    decisions: number;
    tasks: number;
};

declare function boardData(db: Database.Database, f?: {
    area?: string;
    status?: Status;
    archived?: boolean;
    track_id?: number;
}): Record<Status, Task[]>;
declare function taskDetail(db: Database.Database, id: number): {
    task: Task;
    criteria: Criterion[];
    comments: Comment[];
    events: EventRow[];
    links: {
        id: number;
        title: string;
        kind: string;
    }[];
};
interface TaskDetailCapped {
    task: Task;
    criteria: Criterion[];
    comments: Comment[];
    comments_total: number;
    events: EventRow[];
    events_total: number;
    links: {
        id: number;
        title: string;
        kind: string;
    }[];
}
declare function taskDetailCapped(db: Database.Database, id: number): TaskDetailCapped;
declare function statusDigest(db: Database.Database): {
    in_progress: Task[];
    review: Task[];
    blocked: Task[];
    recent: EventRow[];
};
declare function exportBoard(db: Database.Database): {
    tasks: Task[];
    comments: Comment[];
    links: unknown[];
    events: EventRow[];
};

export { type Actor, CAPS, type Comment, type Criterion, type DecisionInput, type EventRow, KddError, MIGRATIONS, PRIORITIES, type ParsedDecision, type Priority, type RecallHit, STATUSES, type Status, TRANSITIONS, type Task, type TaskDetailCapped, type Track, addCriterion, addDecision, addTask, appendEvent, archiveTask, authorOf, blockTask, boardData, capText, checkMove, commentTask, contentHash, createTrack, deleteTrack, editTask, editTrack, exportBoard, kddHome, linkTasks, listCriteria, listProjects, listTracks, logError, moveTask, mustGetTask, mustGetTrack, now, openDb, parseDecisionMd, placeTask, rebuild, recall, removeCriterion, renderDecisionBody, renderDecisionMd, resolveDbPath, resolveDecisionsDir, sanitizeQuery, setCriterionChecked, slugify, statusDigest, syncIndex, taskDetail, taskDetailCapped, unarchiveTask, unblockTask };
