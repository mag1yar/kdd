interface JobSpec {
    name: string;
    everyMinutes: number;
    argv: string[];
    cwd: string;
    env?: Record<string, string>;
    logDir: string;
}
interface JobStatus {
    installed: boolean;
    nextRun?: Date;
    lastExitCode?: number;
}
type RunResult = {
    code: number;
    stdout: string;
    stderr: string;
};
type Runner = (cmd: string, args: string[], opts?: {
    input?: string;
}) => Promise<RunResult>;
interface ScheduleBackend {
    install(spec: JobSpec): Promise<void>;
    uninstall(name: string): Promise<void>;
    status(name: string): Promise<JobStatus>;
    list(): Promise<string[]>;
    preview(spec: JobSpec): string;
    path(name: string): string;
}
declare const defaultRunner: Runner;

declare function renderPlist(spec: JobSpec): string;
declare class LaunchdBackend implements ScheduleBackend {
    private runner;
    private dir;
    private launchctl;
    constructor(opts?: {
        runner?: Runner;
        dir?: string;
        launchctl?: string;
    });
    path(name: string): string;
    install(spec: JobSpec): Promise<void>;
    uninstall(name: string): Promise<void>;
    status(name: string): Promise<JobStatus>;
    list(): Promise<string[]>;
    preview(spec: JobSpec): string;
}

declare function getBackend(opts?: {
    runner?: Runner;
    dir?: string;
    launchctl?: string;
    platform?: NodeJS.Platform;
}): ScheduleBackend;

export { type JobSpec, type JobStatus, LaunchdBackend, type RunResult, type Runner, type ScheduleBackend, defaultRunner, getBackend, renderPlist };
