import type {
  ProjectPersistenceStatusResponse,
  ProjectSaveReceipt,
} from "@openreel/core";

export type ProjectCommitExecutionResult =
  | { readonly kind: "committed"; readonly receipt: ProjectSaveReceipt }
  | { readonly kind: "metadata-only" };

export type ProjectCommitExecutor = (
  projectId: string,
  generation: number,
  shouldCommit: () => boolean,
) => Promise<ProjectCommitExecutionResult>;

export interface ProjectCommitSchedulerOptions<TTimer = ReturnType<typeof setTimeout>> {
  readonly debounceMs: number;
  readonly retryDelayMs?: number;
  readonly now?: () => number;
  readonly setTimeout?: (callback: () => void, delayMs: number) => TTimer;
  readonly clearTimeout?: (timer: TTimer) => void;
  readonly execute: ProjectCommitExecutor;
  readonly publishStatus?: (status: ProjectPersistenceStatusResponse) => void;
}

interface ProjectState<TTimer> {
  generation: number;
  sourceModifiedAt: number;
  commitDueAt: number | null;
  state: ProjectPersistenceStatusResponse["state"];
  error: string | null;
  receipt: ProjectSaveReceipt | null;
  timer: TTimer | null;
}

const SAFE_COMMIT_ERROR = "Background project commit failed";

export class ProjectCommitScheduler<TTimer = ReturnType<typeof setTimeout>> {
  private readonly states = new Map<string, ProjectState<TTimer>>();
  private readonly debounceMs: number;
  private readonly retryDelayMs: number;
  private readonly now: () => number;
  private readonly scheduleTimer: (callback: () => void, delayMs: number) => TTimer;
  private readonly cancelTimer: (timer: TTimer) => void;
  private readonly execute: ProjectCommitExecutor;
  private readonly publishStatus?: (status: ProjectPersistenceStatusResponse) => void;
  private disposed = false;

  constructor(options: ProjectCommitSchedulerOptions<TTimer>) {
    this.debounceMs = options.debounceMs;
    this.retryDelayMs = options.retryDelayMs ?? Math.max(1_000, options.debounceMs);
    this.now = options.now ?? Date.now;
    this.scheduleTimer = options.setTimeout
      ?? ((callback, delayMs) => setTimeout(callback, delayMs) as TTimer);
    this.cancelTimer = options.clearTimeout
      ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
    this.execute = options.execute;
    this.publishStatus = options.publishStatus;
  }

  noteAcceptedSave(
    projectId: string,
    sourceModifiedAt: number,
    persistedAt: number,
    semanticChanged: boolean,
  ): ProjectPersistenceStatusResponse {
    this.assertActive();
    let record = this.states.get(projectId);
    if (!record) {
      record = {
        generation: 0,
        sourceModifiedAt,
        commitDueAt: null,
        state: "settled-metadata-only",
        error: null,
        receipt: null,
        timer: null,
      };
      this.states.set(projectId, record);
    }
    record.sourceModifiedAt = sourceModifiedAt;

    if (semanticChanged) {
      record.generation += 1;
      this.clearRecordTimer(record);
      record.commitDueAt = persistedAt + this.debounceMs;
      record.state = "waiting";
      record.error = null;
      record.receipt = null;
      this.schedule(projectId, record, record.generation, record.commitDueAt);
    } else if (record.commitDueAt === null) {
      record.state = "settled-metadata-only";
      record.error = null;
    }

    return this.emit(projectId, record);
  }

  scheduleDiscoveredDirtyProject(
    projectId: string,
    sourceModifiedAt: number,
    newestChangedPathAt: number,
  ): ProjectPersistenceStatusResponse {
    return this.noteAcceptedSave(
      projectId,
      sourceModifiedAt,
      newestChangedPathAt,
      true,
    );
  }

  getStatus(projectId: string): ProjectPersistenceStatusResponse | undefined {
    const record = this.states.get(projectId);
    return record ? this.toStatus(projectId, record) : undefined;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const record of this.states.values()) this.clearRecordTimer(record);
  }

  private schedule(
    projectId: string,
    record: ProjectState<TTimer>,
    generation: number,
    dueAt: number,
  ): void {
    const delayMs = Math.max(0, dueAt - this.now());
    record.timer = this.scheduleTimer(() => {
      record.timer = null;
      void this.run(projectId, generation);
    }, delayMs);
  }

  private async run(projectId: string, generation: number): Promise<void> {
    if (this.disposed) return;
    const record = this.states.get(projectId);
    if (!record || record.generation !== generation || record.commitDueAt === null) return;
    if (this.now() < record.commitDueAt) {
      this.schedule(projectId, record, generation, record.commitDueAt);
      return;
    }

    record.state = "committing";
    record.error = null;
    this.emit(projectId, record);
    const shouldCommit = (): boolean => {
      const current = this.states.get(projectId);
      return !this.disposed
        && current === record
        && current.generation === generation
        && current.commitDueAt !== null
        && this.now() >= current.commitDueAt;
    };

    try {
      const result = await this.execute(projectId, generation, shouldCommit);
      if (!shouldCommit()) return;
      record.commitDueAt = null;
      record.error = null;
      if (result.kind === "metadata-only") {
        record.state = "settled-metadata-only";
        record.receipt = null;
      } else {
        record.state = "clean";
        record.receipt = { ...result.receipt, committed: true, commitDueAt: null };
      }
      this.emit(projectId, record);
    } catch {
      if (!shouldCommit()) return;
      record.state = "retry-wait";
      record.error = SAFE_COMMIT_ERROR;
      record.commitDueAt = this.now() + this.retryDelayMs;
      this.emit(projectId, record);
      this.schedule(projectId, record, generation, record.commitDueAt);
    }
  }

  private clearRecordTimer(record: ProjectState<TTimer>): void {
    if (record.timer === null) return;
    this.cancelTimer(record.timer);
    record.timer = null;
  }

  private emit(
    projectId: string,
    record: ProjectState<TTimer>,
  ): ProjectPersistenceStatusResponse {
    const status = this.toStatus(projectId, record);
    this.publishStatus?.(status);
    return status;
  }

  private toStatus(
    projectId: string,
    record: ProjectState<TTimer>,
  ): ProjectPersistenceStatusResponse {
    return {
      projectId,
      state: record.state,
      sourceModifiedAt: record.sourceModifiedAt,
      commitDueAt: record.commitDueAt,
      error: record.error,
      receipt: record.receipt,
    };
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("Project commit scheduler is disposed");
  }
}
