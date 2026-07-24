// generic job registry — the scheduler layer never needs to know what a job DOES;
// which command it runs is a kdd CLI subcommand (args). New job = one line here.
export interface JobDef {
  id: string;
  args: string[];
  defaultIntervalMin: number;
  minIntervalMin: number;
}

export const JOBS: readonly JobDef[] = [
  { id: 'tick', args: ['tick'], defaultIntervalMin: 15, minIntervalMin: 1 },
] as const;

export function findJob(id: string): JobDef | undefined {
  return JOBS.find((j) => j.id === id);
}
