import { useEffect, useState } from 'react';
import { Pencil, Send } from 'lucide-react';
import Markdown from 'react-markdown';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  PRIORITIES, addComment, editTask, getTask,
  type Priority, type Task, type TaskDetail,
} from '../api';

export function TaskDialog({ id, version, onClose, onChanged }: {
  id: number | null; version: number; onClose: () => void; onChanged: () => void;
}) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState('');

  useEffect(() => {
    if (id === null) { setDetail(null); setEditing(false); return; }
    getTask(id).then(setDetail).catch((e: Error) => toast.error(e.message));
  }, [id, version]); // version: изменения из CLI подтягиваются в открытый диалог

  if (id === null || !detail) return null;
  const { task, comments } = detail;

  const submitComment = () => {
    if (!comment.trim()) return;
    addComment(task.id, comment)
      .then(() => { setComment(''); onChanged(); return getTask(task.id).then(setDetail); })
      .catch((e: Error) => toast.error(e.message));
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-muted-foreground">#{task.id}</span>
            <span className="truncate">{task.title}</span>
            <Badge variant="secondary">{task.status}</Badge>
          </DialogTitle>
        </DialogHeader>

        {editing ? (
          <EditForm
            task={task}
            onSaved={() => { setEditing(false); onChanged(); getTask(task.id).then(setDetail); }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div className="flex flex-col gap-2">
            <Prose>{task.body ?? ''}</Prose>
            <div>
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 border-t pt-3">
          {comments.map((c) => (
            <div
              key={c.id}
              className={cn('rounded-md border p-2 text-sm', c.author !== 'user' && 'bg-muted')}
            >
              <div className="flex items-center gap-2 pb-1 text-xs text-muted-foreground">
                {c.author !== 'user' && <Badge variant="outline">ai</Badge>}
                <span>{c.author}</span>
                <span>{new Date(c.created_at * 1000).toLocaleString()}</span>
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
              <Button size="sm" onClick={submitComment}>
                <Send /> Send
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
  const [priority, setPriority] = useState<Priority>(task.priority);
  const save = () => {
    editTask(task.id, { title, body, priority })
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
      <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectGroup>
        </SelectContent>
      </Select>
      <div className="flex gap-2">
        <Button size="sm" onClick={save}>Save</Button>
        <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
