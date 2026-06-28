import "../test/install-local-storage-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { useGenerationJobStore } from "./generation-job-store";

const BASE_ENQUEUE = {
  provider: "wavespeed" as const,
  providerJobId: "ws-001",
  model: "wan/t2v-13B",
  prompt: "A sunset over mountains",
  inputs: { prompt: "A sunset over mountains", steps: 30 },
  projectId: "proj-1",
  linkedMediaIds: ["media-1"],
};

describe("generation-job-store", () => {
  beforeEach(() => {
    useGenerationJobStore.setState({ jobs: [] });
  });

  // ─── enqueue ────────────────────────────────────────────────────────────────

  describe("enqueue", () => {
    it("adds a job with queued status and all required fields", () => {
      useGenerationJobStore.getState().enqueue(BASE_ENQUEUE);
      const { jobs } = useGenerationJobStore.getState();
      expect(jobs).toHaveLength(1);
      const job = jobs[0];
      expect(job.status).toBe("queued");
      expect(job.provider).toBe("wavespeed");
      expect(job.providerJobId).toBe("ws-001");
      expect(job.model).toBe("wan/t2v-13B");
      expect(job.prompt).toBe("A sunset over mountains");
      expect(job.inputs).toEqual({ prompt: "A sunset over mountains", steps: 30 });
      expect(job.projectId).toBe("proj-1");
      expect(job.linkedMediaIds).toEqual(["media-1"]);
      expect(typeof job.id).toBe("string");
      expect(job.id.length).toBeGreaterThan(0);
      expect(typeof job.createdAt).toBe("number");
      expect(typeof job.updatedAt).toBe("number");
      expect(job.retryHistory).toEqual([]);
    });

    it("assigns unique ids to each job", () => {
      useGenerationJobStore.getState().enqueue(BASE_ENQUEUE);
      useGenerationJobStore.getState().enqueue({ ...BASE_ENQUEUE, providerJobId: "ws-002" });
      const { jobs } = useGenerationJobStore.getState();
      expect(jobs[0].id).not.toBe(jobs[1].id);
    });

    it("supports kieai provider", () => {
      useGenerationJobStore.getState().enqueue({
        ...BASE_ENQUEUE,
        provider: "kieai",
        providerJobId: "kieai-task-001",
      });
      expect(useGenerationJobStore.getState().jobs[0].provider).toBe("kieai");
    });
  });

  // ─── updateStatus ───────────────────────────────────────────────────────────

  describe("updateStatus", () => {
    it("transitions status to running", () => {
      useGenerationJobStore.getState().enqueue(BASE_ENQUEUE);
      const id = useGenerationJobStore.getState().jobs[0].id;
      useGenerationJobStore.getState().updateStatus(id, "running");
      expect(useGenerationJobStore.getState().jobs[0].status).toBe("running");
    });

    it("does not affect other jobs", () => {
      useGenerationJobStore.getState().enqueue(BASE_ENQUEUE);
      useGenerationJobStore.getState().enqueue({ ...BASE_ENQUEUE, providerJobId: "ws-002" });
      const [job1] = useGenerationJobStore.getState().jobs;
      useGenerationJobStore.getState().updateStatus(job1.id, "running");
      expect(useGenerationJobStore.getState().jobs[1].status).toBe("queued");
    });

    it("updates updatedAt", () => {
      useGenerationJobStore.getState().enqueue(BASE_ENQUEUE);
      const before = useGenerationJobStore.getState().jobs[0].updatedAt;
      const id = useGenerationJobStore.getState().jobs[0].id;
      useGenerationJobStore.getState().updateStatus(id, "running");
      expect(useGenerationJobStore.getState().jobs[0].updatedAt).toBeGreaterThanOrEqual(before);
    });
  });

  // ─── complete ───────────────────────────────────────────────────────────────

  describe("complete", () => {
    it("sets status to completed and records outputUrl", () => {
      useGenerationJobStore.getState().enqueue(BASE_ENQUEUE);
      const id = useGenerationJobStore.getState().jobs[0].id;
      useGenerationJobStore.getState().complete(id, "https://cdn.example.com/video.mp4");
      const job = useGenerationJobStore.getState().jobs[0];
      expect(job.status).toBe("completed");
      expect(job.outputUrl).toBe("https://cdn.example.com/video.mp4");
    });
  });

  // ─── fail ───────────────────────────────────────────────────────────────────

  describe("fail", () => {
    it("sets status to failed with error message", () => {
      useGenerationJobStore.getState().enqueue(BASE_ENQUEUE);
      const id = useGenerationJobStore.getState().jobs[0].id;
      useGenerationJobStore.getState().fail(id, "Timeout");
      const job = useGenerationJobStore.getState().jobs[0];
      expect(job.status).toBe("failed");
      expect(job.error).toBe("Timeout");
    });

    it("allows fail without error message", () => {
      useGenerationJobStore.getState().enqueue(BASE_ENQUEUE);
      const id = useGenerationJobStore.getState().jobs[0].id;
      useGenerationJobStore.getState().fail(id);
      expect(useGenerationJobStore.getState().jobs[0].status).toBe("failed");
    });
  });

  // ─── cancel ─────────────────────────────────────────────────────────────────

  describe("cancel", () => {
    it("sets status to canceled", () => {
      useGenerationJobStore.getState().enqueue(BASE_ENQUEUE);
      const id = useGenerationJobStore.getState().jobs[0].id;
      useGenerationJobStore.getState().cancel(id);
      expect(useGenerationJobStore.getState().jobs[0].status).toBe("canceled");
    });
  });

  // ─── retry ──────────────────────────────────────────────────────────────────

  describe("retry", () => {
    it("sets a new providerJobId and moves the old one to retryHistory", () => {
      useGenerationJobStore.getState().enqueue(BASE_ENQUEUE);
      const id = useGenerationJobStore.getState().jobs[0].id;
      useGenerationJobStore.getState().fail(id, "API error");
      useGenerationJobStore.getState().retry(id, "ws-001-retry");

      const job = useGenerationJobStore.getState().jobs[0];
      expect(job.id).toBe(id); // logical id is stable
      expect(job.providerJobId).toBe("ws-001-retry");
      expect(job.status).toBe("queued");
      expect(job.error).toBeUndefined();
      expect(job.retryHistory).toHaveLength(1);
      expect(job.retryHistory[0].providerJobId).toBe("ws-001");
      expect(job.retryHistory[0].status).toBe("failed");
    });

    it("accumulates retryHistory across multiple retries", () => {
      useGenerationJobStore.getState().enqueue(BASE_ENQUEUE);
      const id = useGenerationJobStore.getState().jobs[0].id;

      useGenerationJobStore.getState().fail(id, "first failure");
      useGenerationJobStore.getState().retry(id, "ws-002");

      useGenerationJobStore.getState().fail(id, "second failure");
      useGenerationJobStore.getState().retry(id, "ws-003");

      const job = useGenerationJobStore.getState().jobs[0];
      expect(job.providerJobId).toBe("ws-003");
      expect(job.retryHistory).toHaveLength(2);
      expect(job.retryHistory[0].providerJobId).toBe("ws-001");
      expect(job.retryHistory[1].providerJobId).toBe("ws-002");
    });

    it("records canceled status in retryHistory when retrying a canceled job", () => {
      useGenerationJobStore.getState().enqueue(BASE_ENQUEUE);
      const id = useGenerationJobStore.getState().jobs[0].id;
      useGenerationJobStore.getState().cancel(id);
      useGenerationJobStore.getState().retry(id, "ws-002");

      const job = useGenerationJobStore.getState().jobs[0];
      expect(job.retryHistory[0].status).toBe("canceled");
    });

    it("does not retry queued, running, or completed jobs", () => {
      useGenerationJobStore.getState().enqueue(BASE_ENQUEUE);
      const queuedId = useGenerationJobStore.getState().jobs[0].id;
      useGenerationJobStore.getState().retry(queuedId, "should-not-replace-queued");
      expect(useGenerationJobStore.getState().jobs[0]).toMatchObject({
        providerJobId: "ws-001",
        status: "queued",
        retryHistory: [],
      });

      useGenerationJobStore.getState().updateStatus(queuedId, "running");
      useGenerationJobStore.getState().retry(queuedId, "should-not-replace-running");
      expect(useGenerationJobStore.getState().jobs[0]).toMatchObject({
        providerJobId: "ws-001",
        status: "running",
        retryHistory: [],
      });

      useGenerationJobStore.getState().complete(queuedId, "http://localhost/result.webp");
      useGenerationJobStore.getState().retry(queuedId, "should-not-replace-completed");
      expect(useGenerationJobStore.getState().jobs[0]).toMatchObject({
        providerJobId: "ws-001",
        status: "completed",
        retryHistory: [],
      });
    });
  });

  // ─── getJobsForProject ──────────────────────────────────────────────────────

  describe("getJobsForProject", () => {
    it("returns only jobs for the given project", () => {
      useGenerationJobStore.getState().enqueue({ ...BASE_ENQUEUE, projectId: "proj-1" });
      useGenerationJobStore
        .getState()
        .enqueue({ ...BASE_ENQUEUE, providerJobId: "ws-002", projectId: "proj-2" });

      const proj1Jobs = useGenerationJobStore.getState().getJobsForProject("proj-1");
      expect(proj1Jobs).toHaveLength(1);
      expect(proj1Jobs[0].projectId).toBe("proj-1");
    });

    it("returns empty array when no jobs match", () => {
      const jobs = useGenerationJobStore.getState().getJobsForProject("no-such-project");
      expect(jobs).toEqual([]);
    });
  });

  // ─── persistence shape ──────────────────────────────────────────────────────

  describe("persistence shape", () => {
    it("jobs carry every field required for serialisation and hydration", () => {
      useGenerationJobStore.getState().enqueue(BASE_ENQUEUE);
      const job = useGenerationJobStore.getState().jobs[0];

      const requiredFields: (keyof typeof job)[] = [
        "id",
        "provider",
        "providerJobId",
        "model",
        "prompt",
        "inputs",
        "projectId",
        "linkedMediaIds",
        "status",
        "createdAt",
        "updatedAt",
        "retryHistory",
      ];
      for (const field of requiredFields) {
        expect(field in job).toBe(true);
      }
    });
  });
});
