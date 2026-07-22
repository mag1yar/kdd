import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { getFeed, type AgentEvent } from '../api';
import { fmtOutput, mergeFeed } from '../lib/feed';

const fmtDate = (ts: number) => new Date(ts * 1000).toLocaleTimeString();

function Row({ e }: { e: AgentEvent }) {
  const d = e.detail ? (JSON.parse(e.detail) as Record<string, any>) : null;
  if (e.kind === 'run_start') return <li className="text-xs text-muted-foreground border-t pt-1">run started · {fmtDate(e.created_at)}</li>;
  // exit 0 = успех (muted); ненулевой ИЛИ null (спавн-фейл/сигнал) = провал (red)
  if (e.kind === 'run_end') return <li className={cn('text-xs border-t pt-1', d?.exitCode === 0 ? 'text-muted-foreground' : 'text-destructive')}>run ended · exit {d?.exitCode ?? 'killed'}</li>;
  if (e.kind === 'text') return <li className="text-sm whitespace-pre-wrap">{d?.text}</li>;
  if (e.kind === 'tool_start') return <li className="text-sm font-mono">▸ {e.name} <span className="text-muted-foreground">{truncate(JSON.stringify(d?.input))}</span></li>;
  if (e.kind === 'tool_finish') return <li className={cn('text-sm font-mono pl-3', d?.isError && 'text-destructive')}>{truncate(fmtOutput(d?.output))}</li>;
  if (e.kind === 'error') return <li className="text-sm text-destructive">error: {d?.message}</li>;
  return null;
}
const truncate = (s: string, n = 120) => (s && s.length > n ? s.slice(0, n) + '…' : s);

export function AgentFeed({ taskId }: { taskId: number }) {
  const [feed, setFeed] = useState<AgentEvent[]>([]);
  const last = useRef(0);
  useEffect(() => {
    setFeed([]); last.current = 0;
    let alive = true;
    const poll = () => getFeed(taskId, last.current).then((rows) => {
      if (!alive || !rows.length) return;
      last.current = Math.max(last.current, ...rows.map((r) => r.id));
      setFeed((prev) => mergeFeed(prev, rows));
    }).catch(() => {});
    poll();
    // ponytail: poll-forever пока диалог открыт — Tier1-ceiling (localhost single-user);
    // живой стрим/reconnect — Tier2 (#18)
    const t = setInterval(poll, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [taskId]);

  if (!feed.length) return <p className="pt-2 text-sm text-muted-foreground">no agent activity</p>;
  return <ol className="flex flex-col gap-1 pt-2">{feed.map((e) => <Row key={e.id} e={e} />)}</ol>;
}
