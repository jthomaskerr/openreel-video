import "../../../test/install-local-storage-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GenerationJob } from "@openreel/music-video-domain/generation";

const runtime = vi.hoisted(() => ({ command: vi.fn() }));

vi.mock("../../../stores/generation-job-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../stores/generation-job-store")>();
  return {
    ...actual,
    getProductionGenerationRuntime: () => runtime,
  };
});

import { JobManagementPanel } from "./JobManagementPanel";
import {
  hydrateGenerationJob,
  useGenerationJobStore,
} from "../../../stores/generation-job-store";

const routing = {
  providerInstanceId: "wavespeed-production",
  providerModelId: "wavespeed/model",
  requestedMode: "text-to-image" as const,
  providerSchemaId: "wavespeed-request",
  providerEndpointId: "wavespeed-submit",
  providerSchemaVersion: "2026-07",
};

function job(id: string, status: GenerationJob["status"]): GenerationJob {
  return {
    schemaVersion: 2,
    contractVersion: 2,
    id,
    projectId: "project-1",
    provider: "wavespeed",
    providerInstanceId: routing.providerInstanceId,
    modelId: routing.providerModelId,
    modelSchemaVersion: routing.providerSchemaVersion,
    routing,
    providerJobId: `provider-${id}`,
    status,
    attempt: 1,
    context: {
      projectId: "project-1",
      entryContext: { kind: "new-asset" },
      mode: "text-to-image",
      placementPolicy: "none",
      prompt: `${status} prompt`,
      references: [],
    },
    providerInputs: {},
    attempts: [{ attemptNumber: 1, routing, providerJobId: `provider-${id}`, startedAt: 1 }],
    checkpoints: {},
    createdAt: 1,
    updatedAt: 2,
  };
}

describe("JobManagementPanel", () => {
  beforeEach(() => {
    useGenerationJobStore.setState({ records: [], jobs: [], legacyAttention: [] });
    runtime.command.mockReset();
  });

  it("groups authoritative durable jobs without a parallel legacy store API", () => {
    for (const [id, status] of [
      ["running-1", "running"],
      ["completed-1", "completed"],
      ["failed-1", "failed"],
      ["canceled-1", "canceled"],
    ] as const) hydrateGenerationJob(job(id, status));

    render(<JobManagementPanel />);

    for (const label of ["Running", "Completed", "Failed", "Canceled"]) {
      expect(screen.getByRole("heading", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByText("running prompt")).toBeInTheDocument();
    expect(screen.getByText("failed prompt")).toBeInTheDocument();
  });

  it("dispatches cancellation through the singleton authoritative runtime", async () => {
    const current = job("running-1", "running");
    hydrateGenerationJob(current);
    runtime.command.mockImplementation(async (action: string, input: GenerationJob) => {
      expect(action).toBe("cancel");
      const canceled = { ...input, status: "canceled" as const, updatedAt: 3 };
      hydrateGenerationJob(canceled);
      return canceled;
    });

    render(<JobManagementPanel />);
    fireEvent.click(screen.getByRole("button", { name: /cancel running prompt/i }));

    await waitFor(() => expect(runtime.command).toHaveBeenCalledWith("cancel", current));
    expect(useGenerationJobStore.getState().jobs[0]?.status).toBe("canceled");
  });
});
