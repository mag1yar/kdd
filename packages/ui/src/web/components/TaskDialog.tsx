import { useEffect, useState, type ReactNode } from 'react';
import { Ban, Link2, Pencil, Send } from 'lucide-react';
import Markdown from 'react-markdown';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  PRIORITIES, STATUSES, addComment, blockTask, editTask, getTask, moveTask, unblockTask,
  type EventRow, type Priority, type Status, type Task, type TaskDetail, type Track,
} from '../api';

const STATUS_LABEL: Record<Status, string> = {
  backlog: 'Backlog', new: 'New', in_progress: 'In Progress', review: 'Review', done: 'Done',
};
const fmtDate = (ts: number) => new Date(ts * 1000).toLocaleString();

function fmtEvent(e: EventRow): string {
  const d = e.detail ? (JSON.parse(e.detail) as Record<string, unknown>) : null;
  switch (e.action) {
    case 'created': return 'created task';
    case 'moved': return `moved ${d?.from} → ${d?.to}`;
    case 'blocked': return `blocked: ${d?.reason}`;
    case 'unblocked': return 'unblocked';
    case 'linked': return `linked #${d?.to} (${d?.kind})`;
    case 'commented': return 'commented';
    default: return e.action;
  }
}
const actorLabel = (e: EventRow) => (e.actor_type === 'ai' ? `ai:${e.actor_id}` : 'user');

export function TaskDialog({ id, version, tracks, onClose, onChanged }: {
  id: number | null; version: number; tracks: Track[];
  onClose: () => void; onChanged: () => void;
}) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState('');
  const [tab, setTab] = useState<'comments' | 'history'>('comments');

  const reload = () => getTask(id!).then(setDetail).catch((e: Error) => toast.error(e.message));
  useEffect(() => {
    if (id === null) { setDetail(null); setEditing(false); return; }
    getTask(id).then(setDetail).catch((e: Error) => toast.error(e.message));
  }, [id, version]); // version: изменения из CLI подтягиваются в открытый диалог

  if (id === null || !detail) return null;
  const { task, comments, events, links } = detail;
  const after = () => { onChanged(); return reload(); };

  const submitComment = () => {
    if (!comment.trim()) return;
    addComment(task.id, comment)
      .then(() => { setComment(''); return after(); })
      .catch((e: Error) => toast.error(e.message));
  };
  const changeStatus = (to: Status) => {
    if (to === task.status) return;
    moveTask(task.id, to).then(after).catch((e: Error) => toast.error(e.message));
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-muted-foreground">#{task.id}</span>
            <span className="truncate">{task.title}</span>
            {task.blocked === 1 && <Badge variant="destructive">blocked</Badge>}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-6 sm:grid-cols-[1fr_13rem]">
          {/* main */}
          <div className="flex min-w-0 flex-col gap-4">
            {editing ? (
              <EditForm
                task={task}
                onSaved={() => { setEditing(false); return after(); }}
                onCancel={() => setEditing(false)}
              />
            ) : (
              <div className="flex flex-col gap-2">
                <Prose>{task.body ?? '_no description_'}</Prose>
                <div>
                  <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                    <Pencil /> Edit
                  </Button>
                </div>
              </div>
            )}

            <Tabs
              value={tab}
              onValueChange={(v) => setTab(v as 'comments' | 'history')}
              className="border-t pt-3"
            >
              <TabsList variant="line">
                <TabsTrigger value="comments">Comments <span className="text-muted-foreground">{comments.length}</span></TabsTrigger>
                <TabsTrigger value="history">History <span className="text-muted-foreground">{events.length}</span></TabsTrigger>
              </TabsList>

              <TabsContent value="comments" className="flex flex-col gap-2 pt-2">
                {comments.map((c) => (
                  <div
                    key={c.id}
                    className={cn('rounded-md border p-2 text-sm', c.author !== 'user' && 'bg-muted')}
                  >
                    <div className="flex items-center gap-2 pb-1 text-xs text-muted-foreground">
                      {c.author !== 'user' && <Badge variant="outline">ai</Badge>}
                      <span>{c.author}</span>
                      <span>{fmtDate(c.created_at)}</span>
                    </div>
                    <Prose>{c.body}</Prose>
                  </div>
                ))}
                <div className="rounded-md border focus-within:ring-1 focus-within:ring-ring">
                  <Textarea
                    rows={2}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Comment... (Enter to send, Shift+Enter newline)"
                    className="min-h-9 resize-none border-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitComment(); }
                    }}
                  />
                  <div className="flex justify-end p-1.5 pt-0">
                    <Button size="sm" onClick={submitComment}><Send /> Send</Button>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="history" className="pt-2">
                <ol className="flex flex-col gap-2 text-sm">
                  {events.length === 0 && <li className="text-muted-foreground">no history</li>}
                  {events.map((e) => (
                    <li key={e.id} className="flex items-baseline gap-2">
                      <span className="text-muted-foreground">{fmtDate(e.created_at)}</span>
                      <span className="font-medium">{actorLabel(e)}</span>
                      <span>{fmtEvent(e)}</span>
                    </li>
                  ))}
                </ol>
              </TabsContent>
            </Tabs>
          </div>

          {/* details rail */}
          <aside className="flex flex-col gap-4 text-sm">
            <Field label="Status">
              <Select value={task.status} onValueChange={(v) => changeStatus(v as Status)}>
                <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field label="Priority">
              <Select
                value={task.priority}
                onValueChange={(v) => editTask(task.id, { priority: v as Priority })
                  .then(after).catch((e: Error) => toast.error(e.message))}
              >
                <SelectTrigger className="h-8 w-full capitalize"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <BlockedField task={task} onChanged={after} />

            {tracks.length > 0 && (
              <Field label="Track">
                <Select
                  value={task.track_id === null ? 'none' : String(task.track_id)}
                  onValueChange={(v) =>
                    editTask(task.id, { track_id: v === 'none' ? null : Number(v) })
                      .then(after).catch((e: Error) => toast.error(e.message))}
                >
                  <SelectTrigger className="h-8 w-full">
                    <SelectValue placeholder="No track">
                      {(v) => (v === 'none' ? 'No track'
                        : tracks.find((t) => t.id === Number(v))?.name ?? '')}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No track</SelectItem>
                    {tracks.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}

            {task.area && <Field label="Area"><span>{task.area}</span></Field>}

            <Field label="Related">
              {links.length === 0
                ? <span className="text-muted-foreground">none</span>
                : (
                  <ul className="flex flex-col gap-1">
                    {links.map((l) => (
                      <li key={l.id} className="flex items-center gap-1 truncate">
                        <Link2 className="size-3 shrink-0 text-muted-foreground" />
                        <span className="text-muted-foreground">#{l.id}</span>
                        <span className="truncate">{l.title}</span>
                      </li>
                    ))}
                  </ul>
                )}
            </Field>

            <Field label="Created"><span className="text-muted-foreground">{fmtDate(task.created_at)}</span></Field>
            <Field label="Updated"><span className="text-muted-foreground">{fmtDate(task.updated_at)}</span></Field>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function BlockedField({ task, onChanged }: { task: Task; onChanged: () => void }) {
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const block = () => {
    if (!reason.trim()) return;
    blockTask(task.id, reason).then(() => { setReason(''); setOpen(false); onChanged(); })
      .catch((e: Error) => toast.error(e.message));
  };
  return (
    <Field label="Blocked">
      {task.blocked === 1 ? (
        <div className="flex flex-col gap-1">
          <span className="text-destructive">{task.block_reason}</span>
          <Button
            size="sm" variant="outline"
            onClick={() => unblockTask(task.id).then(onChanged).catch((e: Error) => toast.error(e.message))}
          >
            Unblock
          </Button>
        </div>
      ) : open ? (
        <div className="flex flex-col gap-1">
          <Input
            autoFocus value={reason} placeholder="reason" className="h-8"
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') block(); }}
          />
          <div className="flex gap-1">
            <Button size="sm" onClick={block}>Block</Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Ban /> Block</Button>
      )}
    </Field>
  );
}

function Prose({ children }: { children: string }) {
  // prose даёт светло-серый body по умолчанию — принудительно foreground + видимый inline-code
  return (
    <div
      className={cn(
        'prose prose-sm max-w-none text-foreground',
        'prose-headings:text-foreground prose-strong:text-foreground prose-a:text-foreground',
        'prose-p:my-1 prose-p:text-foreground prose-li:text-foreground prose-li:my-0.5',
        'prose-blockquote:text-muted-foreground prose-pre:my-1',
        'prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:text-foreground',
        'prose-code:before:content-[""] prose-code:after:content-[""]',
        // code внутри pre — без inline-рамки (иначе бокс-в-боксе)
        '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-inherit',
      )}
    >
      <Markdown>{children}</Markdown>
    </div>
  );
}

function EditForm({ task, onSaved, onCancel }: {
  task: Task; onSaved: () => void; onCancel: () => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [body, setBody] = useState(task.body ?? '');
  const save = () => {
    editTask(task.id, { title, body })
      .then(onSaved)
      .catch((e: Error) => toast.error(e.message));
  };
  return (
    <div className="flex flex-col gap-2">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      <Textarea
        rows={8} value={body} placeholder="markdown body"
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex gap-2">
        <Button size="sm" onClick={save}>Save</Button>
        <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
