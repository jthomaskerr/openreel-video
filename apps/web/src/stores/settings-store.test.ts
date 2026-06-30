import "../test/install-local-storage-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LLM_MODELS } from "../services/service-instances";
import { useSettingsStore } from "./settings-store";

const deleteSecret = vi.fn(async (_id: string) => undefined);

vi.mock("../services/secure-storage", () => ({
  deleteSecret: (id: string) => deleteSecret(id),
  onSessionLock: vi.fn(),
}));

describe("settings-store LLM instances", () => {
  beforeEach(() => {
    deleteSecret.mockClear();
    useSettingsStore.setState({
      llmInstances: [],
      defaultLlmInstanceId: null,
      chatApiProxyUrl: null,
      wavespeedHasApiKey: false,
      kieaiHasApiKey: false,
      configuredServices: [],
    });
  });

  it("adds an LLM instance with a stable secure-storage id", () => {
    const id = useSettingsStore.getState().addLlmInstance({
      label: "Personal Claude",
      providerType: "anthropic-compatible",
      baseUrl: null,
      defaultModel: DEFAULT_LLM_MODELS["anthropic-compatible"],
    });

    const state = useSettingsStore.getState();
    expect(state.llmInstances).toEqual([
      {
        id,
        label: "Personal Claude",
        providerType: "anthropic-compatible",
        apiKeySecretId: `llm-${id}`,
        baseUrl: null,
        defaultModel: DEFAULT_LLM_MODELS["anthropic-compatible"],
      },
    ]);
    expect(state.defaultLlmInstanceId).toBe(id);
  });

  it("removes the default LLM instance and clears its secret", () => {
    const first = useSettingsStore.getState().addLlmInstance({
      label: "Claude",
      providerType: "anthropic-compatible",
      baseUrl: null,
      defaultModel: DEFAULT_LLM_MODELS["anthropic-compatible"],
    });
    const second = useSettingsStore.getState().addLlmInstance({
      label: "OpenAI",
      providerType: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: DEFAULT_LLM_MODELS["openai-compatible"],
    });
    useSettingsStore.getState().setDefaultLlmInstanceId(first);

    useSettingsStore.getState().removeLlmInstance(first);

    expect(deleteSecret).toHaveBeenCalledWith(`llm-${first}`);
    expect(useSettingsStore.getState().defaultLlmInstanceId).toBe(second);
  });

  it("clears the default when the last LLM instance is removed", () => {
    const id = useSettingsStore.getState().addLlmInstance({
      label: "Local",
      providerType: "openai-compatible",
      baseUrl: "http://localhost:11434/v1",
      defaultModel: "llama3.2",
    });

    useSettingsStore.getState().removeLlmInstance(id);

    expect(useSettingsStore.getState().llmInstances).toEqual([]);
    expect(useSettingsStore.getState().defaultLlmInstanceId).toBeNull();
  });
});
