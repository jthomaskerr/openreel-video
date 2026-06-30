export type LlmProviderType = "openai-compatible" | "anthropic-compatible" | "google";

export interface LlmInstance {
  id: string;
  label: string;
  providerType: LlmProviderType;
  apiKeySecretId: string;
  baseUrl: string | null;
  defaultModel: string;
}

export const DEFAULT_LLM_MODELS: Record<LlmProviderType, string> = {
  "openai-compatible": "gpt-5-mini",
  "anthropic-compatible": "claude-sonnet-4-5",
  google: "gemini-2.5-flash",
};

export const WAVESPEED_SECRET_ID = "wavespeed";
export const KIEAI_SECRET_ID = "kie-ai";
