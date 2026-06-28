import "../../../test/install-local-storage-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { JobManagementPanel } from "./JobManagementPanel";
import { useGenerationJobStore } from "../../../stores/generation-job-store";

describe("JobManagementPanel", () => {
  beforeEach(() => {
    useGenerationJobStore.setState({ jobs: [] });
  });

  it("groups running completed failed and canceled jobs", () => {
    const store = useGenerationJobStore.getState();
    store.enqueue({ provider: "wavespeed", providerJobId: "ws-run", model: "model-a", prompt: "running prompt", inputs: {}, projectId: "p1", linkedMediaIds: [] });
    const runningId = useGenerationJobStore.getState().jobs[0].id;
    store.updateStatus(runningId, "running");
    store.enqueue({ provider: "kieai", providerJobId: "kie-done", model: "model-b", prompt: "done prompt", inputs: {}, projectId: "p1", linkedMediaIds: ["media-done"] });
    const doneId = useGenerationJobStore.getState().jobs[1].id;
    store.complete(doneId, "http://localhost/done.png");
    store.enqueue({ provider: "wavespeed", providerJobId: "ws-fail", model: "model-c", prompt: "failed prompt", inputs: {}, projectId: "p1", linkedMediaIds: [] });
    const failedId = useGenerationJobStore.getState().jobs[2].id;
    store.fail(failedId, "bad request");
    store.enqueue({ provider: "kieai", providerJobId: "kie-cancel", model: "model-d", prompt: "cancel prompt", inputs: {}, projectId: "p1", linkedMediaIds: [] });
    const canceledId = useGenerationJobStore.getState().jobs[3].id;
    store.cancel(canceledId);

    render(<JobManagementPanel />);

    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Canceled")).toBeInTheDocument();
    expect(screen.getByText("running prompt")).toBeInTheDocument();
    expect(screen.getByText("done prompt")).toBeInTheDocument();
    expect(screen.getByText("failed prompt")).toBeInTheDocument();
    expect(screen.getByText("cancel prompt")).toBeInTheDocument();
  });

  it("cancels a running job locally", () => {
    const store = useGenerationJobStore.getState();
    store.enqueue({ provider: "wavespeed", providerJobId: "ws-run", model: "model-a", prompt: "running prompt", inputs: {}, projectId: "p1", linkedMediaIds: [] });
    const jobId = useGenerationJobStore.getState().jobs[0].id;
    store.updateStatus(jobId, "running");

    render(<JobManagementPanel />);
    fireEvent.click(screen.getByRole("button", { name: /cancel running prompt/i }));

    expect(useGenerationJobStore.getState().jobs[0].status).toBe("canceled");
  });

  it("retries failed jobs with a new local retry id", () => {
    const store = useGenerationJobStore.getState();
    store.enqueue({ provider: "wavespeed", providerJobId: "ws-fail", model: "model-a", prompt: "failed prompt", inputs: {}, projectId: "p1", linkedMediaIds: [] });
    const jobId = useGenerationJobStore.getState().jobs[0].id;
    store.fail(jobId, "bad request");

    render(<JobManagementPanel />);
    fireEvent.click(screen.getByRole("button", { name: /retry failed prompt/i }));

    const job = useGenerationJobStore.getState().jobs[0];
    expect(job.status).toBe("queued");
    expect(job.providerJobId).toMatch(/^retry-/);
    expect(job.retryHistory).toHaveLength(1);
  });
});
