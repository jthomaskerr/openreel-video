import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmInstance } from "../service-instances";
import { createModel } from "./provider-factory";

const mocks = vi.hoisted(() => ({
  createOpenAI: vi.fn(),
  createAnthropic: vi.fn(),
  createGoogle: vi.fn(),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: mocks.createOpenAI,
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: mocks.createAnthropic,
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogle: mocks.createGoogle,
}));

function makeInstance(overrides: Partial<LlmInstance> = {}): LlmInstance {
  return {
    id: "inst-1",
    label: "Personal Claude",
    providerType: "anthropic-compatible",
    apiKeySecretId: "llm-inst-1",
    baseUrl: null,
    defaultModel: "claude-sonnet-4-5",
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("createModel", () => {
  it("uses the proxy OpenAI provider when proxyUrl is set", () => {
    const model = vi.fn((modelId: string) => ({ tag: "proxy", modelId }));
    mocks.createOpenAI.mockImplementation(() => model);

    const result = createModel(makeInstance({ providerType: "openai-compatible", defaultModel: "gpt-5-mini" }), {
      proxyUrl: "https://proxy.example/v1",
    });

    expect(mocks.createOpenAI).toHaveBeenCalledWith({
      baseURL: "https://proxy.example/v1",
      headers: {
        "x-openreel-instance": "inst-1",
      },
      apiKey: "proxy",
    });
    expect(model).toHaveBeenCalledWith("gpt-5-mini");
    expect(result).toEqual({ tag: "proxy", modelId: "gpt-5-mini" });
  });

  it("uses OpenAI with a base URL and explicit API key", () => {
    const model = vi.fn((modelId: string) => ({ tag: "openai", modelId }));
    mocks.createOpenAI.mockImplementation(() => model);

    const result = createModel(
      makeInstance({
        providerType: "openai-compatible",
        baseUrl: "https://api.openai.com/v1",
        defaultModel: "gpt-5-mini",
      }),
      { apiKeyOverride: "openai-key" },
    );

    expect(mocks.createOpenAI).toHaveBeenCalledWith({
      apiKey: "openai-key",
      baseURL: "https://api.openai.com/v1",
    });
    expect(result).toEqual({ tag: "openai", modelId: "gpt-5-mini" });
  });

  it("uses Anthropic without a base URL when none is configured", () => {
    const model = vi.fn((modelId: string) => ({ tag: "anthropic", modelId }));
    mocks.createAnthropic.mockImplementation(() => model);

    const result = createModel(
      makeInstance({
        providerType: "anthropic-compatible",
        defaultModel: "claude-sonnet-4-5",
      }),
      { apiKeyOverride: "anthropic-key" },
    );

    expect(mocks.createAnthropic).toHaveBeenCalledWith({
      apiKey: "anthropic-key",
    });
    expect(result).toEqual({ tag: "anthropic", modelId: "claude-sonnet-4-5" });
  });

  it("uses Google and ignores baseUrl", () => {
    const model = vi.fn((modelId: string) => ({ tag: "google", modelId }));
    mocks.createGoogle.mockImplementation(() => model);

    const result = createModel(
      makeInstance({
        providerType: "google",
        baseUrl: "https://example.invalid/v1",
        defaultModel: "gemini-2.5-flash",
      }),
      { apiKeyOverride: "google-key" },
    );

    expect(mocks.createGoogle).toHaveBeenCalledWith({
      apiKey: "google-key",
    });
    expect(result).toEqual({ tag: "google", modelId: "gemini-2.5-flash" });
  });

  it("throws when a direct provider has no API key", () => {
    expect(() =>
      createModel(makeInstance({ providerType: "openai-compatible" })),
    ).toThrow("No API key for instance 'Personal Claude'");
  });
});
