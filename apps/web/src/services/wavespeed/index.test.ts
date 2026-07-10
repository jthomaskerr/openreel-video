import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchModels, submitGeneration } from "./index";

vi.mock("../../stores/music-video-store", () => ({
  ORCHESTRATOR_URL: "http://localhost:4041",
}));
const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

describe("WaveSpeed browser client", () => {
  it("uses the orchestrator boundary for model discovery", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ models: [] }), { status: 200 }));

    await fetchModels();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/generate/wavespeed/models");
    expect(fetchMock.mock.calls[0][1]?.headers).toBeUndefined();
  });

  it("sends JSON without a browser provider secret", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ jobId: "job-123" }), { status: 200 }));

    await expect(submitGeneration("model-id", { prompt: "hello" })).resolves.toBe("job-123");

    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect((init?.headers as Record<string, string>)["X-WaveSpeed-Api-Key"]).toBeUndefined();
  });
});
