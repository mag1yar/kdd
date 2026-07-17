import { useCallback, useEffect, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  STATUSES, getBoard, getPing, getProjects, moveTask,
  type Board as BoardData, type Project, type Status,
} from './api';
import { Board } from './components/Board';
import { NewTaskDialog } from './components/NewTaskDialog';
import { TaskDialog } from './components/TaskDialog';
import { useVersion } from './useVersion';

// git-common-dir оканчивается на /.git — показываем имя репо.
const projectName = (path: string) =>
  path.replace(/[/\\]\.git[/\\]?$/, '').split(/[/\\]/).filter(Boolean).slice(-1)[0] ?? path;

export default function App() {
  const [board, setBoard] = useState<BoardData | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const current = new URLSearchParams(location.search).get('project') ?? '';
  const version = useVersion();

  useEffect(() => {
    getProjects().then(setProjects).catch((e: Error) => toast.error(e.message));
    // нет ?project в URL → берём дефолт сервера и фиксируем в URL (select + доска синхронны)
    if (!current) getPing().then((p) => { if (p.default) location.replace(`?project=${p.default}`); }).catch(() => {});
  }, [current]);

  const refetch = useCallback(() => {
    getBoard().then(setBoard).catch((e: Error) => toast.error(e.message));
  }, []);
  useEffect(() => { refetch(); }, [refetch, version]); // поллинг: version растёт → рефетч (UI-04)

  const onMove = (taskId: number, to: Status, order: number[]) => {
    setBoard((b) => { // оптимистично: карточка в новой колонке + порядок как order
      if (!b) return b;
      const task = STATUSES.flatMap((s) => b[s]).find((t) => t.id === taskId);
      if (!task) return b;
      const next = Object.fromEntries(
        STATUSES.map((s) => [s, b[s].filter((t) => t.id !== taskId)]),
      ) as BoardData;
      const rank = new Map(order.map((id, i) => [id, i]));
      next[to] = [...next[to], { ...task, status: to }]
        .sort((a, c) => (rank.get(a.id) ?? 0) - (rank.get(c.id) ?? 0));
      return next;
    });
    moveTask(taskId, to, order)
      .catch((e: Error) => toast.error(e.message)) // refetch в finally откатит
      .finally(refetch);
  };

  if (!board) return null;
  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold">kdd</h1>
          <Select value={current} onValueChange={(id) => location.assign(`?project=${id}`)}>
            <SelectTrigger size="sm" className="w-52">
              <SelectValue placeholder="Project">
                {(v) => projectName(projects.find((p) => p.id === v)?.path ?? '')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>{projectName(p.path)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>New task</Button>
      </header>
      <main className="flex-1 overflow-auto">
        <Board board={board} onMove={onMove} onOpen={setOpenId} />
      </main>
      <TaskDialog
        id={openId} version={version}
        onClose={() => setOpenId(null)} onChanged={refetch}
      />
      <NewTaskDialog
        open={creating} onClose={() => setCreating(false)} onCreated={refetch}
      />
      <Toaster position="bottom-right" />
    </div>
  );
}
