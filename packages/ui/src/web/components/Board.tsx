import {
  DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { STATUSES, type Board as BoardData, type Priority, type Status, type Task } from '../api';

const PRIORITY_VARIANT: Record<Priority, 'default' | 'secondary' | 'destructive' | 'outline'> =
  { urgent: 'destructive', high: 'default', medium: 'secondary', low: 'outline' };

export function Board({ board, onMove, onOpen }: {
  board: BoardData;
  onMove: (taskId: number, to: Status) => void;
  onOpen: (id: number) => void;
}) {
  // distance 5px: иначе клик по карточке считается драгом и onClick не срабатывает
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const onDragEnd = (e: DragEndEvent) => {
    const to = e.over?.id as Status | undefined;
    if (to) onMove(Number(e.active.id), to);
  };
  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex items-start gap-4 p-4">
        {STATUSES.map((s) => <Column key={s} status={s} tasks={board[s]} onOpen={onOpen} />)}
      </div>
    </DndContext>
  );
}

function Column({ status, tasks, onOpen }: {
  status: Status; tasks: Task[]; onOpen: (id: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={cn('w-64 shrink-0 rounded-lg bg-muted/50 p-2', isOver && 'ring-2 ring-ring')}
    >
      <div className="flex items-center justify-between px-1 pb-2 text-sm font-medium">
        <span>{status}</span>
        <span className="text-muted-foreground">{tasks.length}</span>
      </div>
      <div className="flex min-h-8 flex-col gap-2">
        {tasks.map((t) => <TaskCard key={t.id} task={t} onOpen={onOpen} />)}
      </div>
    </div>
  );
}

function TaskCard({ task, onOpen }: { task: Task; onOpen: (id: number) => void }) {
  const { setNodeRef, attributes, listeners, transform, isDragging } =
    useDraggable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
      className={cn(
        'cursor-grab rounded-md border bg-card p-2 text-sm shadow-sm',
        isDragging && 'relative z-10 opacity-70',
      )}
      onClick={() => onOpen(task.id)}
    >
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">#{task.id}</span>
        <Badge variant={PRIORITY_VARIANT[task.priority]}>{task.priority}</Badge>
        {task.blocked === 1 && <Badge variant="destructive">blocked</Badge>}
      </div>
      <div className="pt-1">{task.title}</div>
    </div>
  );
}
