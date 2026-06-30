import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchModels, submitGeneration } from "./index";
import { getSecret } from "../secure-storage";

vi.mock("../../stores/music-video-store", () => ({
  ORCHESTRATOR_URL: "http://localhost:4041",
}));
vi.mock("../secure-storage", () => ({
  getSecret: vi.fn(),
}));

const mockedGetSecret = vi.mocked(getSecret);
const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

describe("WaveSpeed browser client", () => {
  it("attaches the WaveSpeed API key to GET requests", async () => {
    mockedGetSecret.mockResolvedValue("wave-key");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ models: [] }), { status: 200 }));

    await fetchModels();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/generate/wavespeed/models");
    expect((init?.headers as Headers).get("X-WaveSpeed-Api-Key")).toBe("wave-key");
  });

  it("attaches the WaveSpeed API key and JSON content type to POST requests", async () => {
    mockedGetSecret.mockResolvedValue("wave-key");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ jobId: "job-123" }), { status: 200 }));

    await expect(submitGeneration("model-id", { prompt: "hello" })).resolves.toBe("job-123");

    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Headers).get("Content-Type")).toBe("application/json");
    expect((init?.headers as Headers).get("X-WaveSpeed-Api-Key")).toBe("wave-key");
  });

  it("throws a clear error when no WaveSpeed key is configured", async () => {
    mockedGetSecret.mockResolvedValue(null);

    await expect(fetchModels()).rejects.toThrow("WaveSpeed API key not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
