import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ProjectCommitScheduler,
  type ProjectCommitExecutor,
} from "./project-commit-scheduler";

class ManualTime {
  now = 1_000;
  private nextId = 1;
  private readonly callbacks = new Map<number, { dueAt: number; callback: () => void }>();

  setTimeout = (callback: () => void, delayMs: number): number => {
    const id = this.nextId++;
    this.callbacks.set(id, { dueAt: this.now + delayMs, callback });
    return id;
  };

  clearTimeout = (id: number): void => {
    this.callbacks.delete(id);
  };

  async advance(ms: number): Promise<void> {
    this.now += ms;
    const due = [...this.callbacks.entries()]
      .filter(([, timer]) => timer.dueAt <= this.now)
      .sort((left, right) => left[1].dueAt - right[1].dueAt);
    for (const [id, timer] of due) {
      this.callbacks.delete(id);
      timer.callback();
      await Promise.resolve();
      await Promise.resolve();
    }
  }
}

function makeScheduler(
  time: ManualTime,
  execute: ProjectCommitExecutor,
): ProjectCommitScheduler<number> {
  return new ProjectCommitScheduler({
    debounceMs: 120_000,
    retryDelayMs: 5_000,
    now: () => time.now,
    setTimeout: time.setTimeout,
    clearTimeout: time.clearTimeout,
    execute,
  });
}

test("executes only after the full quiet deadline and commits independently per project", async () => {
  const time = new ManualTime();
  const calls: string[] = [];
  const scheduler = makeScheduler(time, async (projectId, _generation, shouldCommit) => {
    assert.equal(shouldCommit(), true);
    calls.push(projectId);
    return { kind: "metadata-only" };
  });

  scheduler.noteAcceptedSave("a", 10, time.now, true);
  scheduler.noteAcceptedSave("b", 20, time.now, true);
  await time.advance(119_999);
  assert.deepEqual(calls, []);
  await time.advance(1);
  assert.deepEqual(calls.sort(), ["a", "b"]);
  assert.equal(scheduler.getStatus("a")?.state, "settled-metadata-only");
});

test("semantic saves reset the deadline while metadata-only saves preserve it", async () => {
  const time = new ManualTime();
  let calls = 0;
  const scheduler = makeScheduler(time, async () => {
    calls += 1;
    return { kind: "metadata-only" };
  });

  const first = scheduler.noteAcceptedSave("a", 10, time.now, true);
  await time.advance(60_000);
  const metadata = scheduler.noteAcceptedSave("a", 11, time.now, false);
  assert.equal(metadata.commitDueAt, first.commitDueAt);
  await time.advance(30_000);
  const reset = scheduler.noteAcceptedSave("a", 12, time.now, true);
  assert.equal(reset.commitDueAt, time.now + 120_000);
  await time.advance(30_000);
  assert.equal(calls, 0);
  await time.advance(90_000);
  assert.equal(calls, 1);
});

test("metadata-only saves without semantic dirt do not create timers", () => {
  const time = new ManualTime();
  const scheduler = makeScheduler(time, async () => ({ kind: "metadata-only" }));
  const status = scheduler.noteAcceptedSave("a", 10, time.now, false);
  assert.equal(status.state, "settled-metadata-only");
  assert.equal(status.commitDueAt, null);
});

test("failures enter retry-wait and a newer save supersedes the retry generation", async () => {
  const time = new ManualTime();
  let attempts = 0;
  const scheduler = makeScheduler(time, async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("credentials leaked: token-secret");
    return { kind: "metadata-only" };
  });

  scheduler.noteAcceptedSave("a", 10, time.now, true);
  await time.advance(120_000);
  assert.equal(scheduler.getStatus("a")?.state, "retry-wait");
  assert.equal(scheduler.getStatus("a")?.error, "Background project commit failed");
  const newer = scheduler.noteAcceptedSave("a", 11, time.now, true);
  await time.advance(5_000);
  assert.equal(attempts, 1);
  assert.equal(scheduler.getStatus("a")?.commitDueAt, newer.commitDueAt);
});

test("startup uses the remaining quiet time and disposal cancels callbacks", async () => {
  const time = new ManualTime();
  let calls = 0;
  const scheduler = makeScheduler(time, async () => {
    calls += 1;
    return { kind: "metadata-only" };
  });
  scheduler.scheduleDiscoveredDirtyProject("a", 10, time.now - 100_000);
  await time.advance(19_999);
  assert.equal(calls, 0);
  scheduler.dispose();
  await time.advance(1);
  assert.equal(calls, 0);
});
