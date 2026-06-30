import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LlmInstance } from "../service-instances";

export interface CreateModelOptions {
  apiKeyOverride?: string | null;
  proxyUrl?: string | null;
}

export function createModel(instance: LlmInstance, opts: CreateModelOptions = {}) {
  const proxyUrl = opts.proxyUrl?.trim();
  if (proxyUrl) {
    const provider = createOpenAI({
      baseURL: proxyUrl,
      headers: {
        "x-openreel-instance": instance.id,
      },
      apiKey: "proxy",
    });

    return provider(instance.defaultModel);
  }

  const apiKey = opts.apiKeyOverride;
  if (!apiKey) {
    throw new Error(`No API key for instance '${instance.label}'`);
  }

  const baseUrl = instance.baseUrl?.trim();

  switch (instance.providerType) {
    case "openai-compatible": {
      const provider = createOpenAI({
        apiKey,
        ...(baseUrl ? { baseURL: baseUrl } : {}),
      });
      return provider(instance.defaultModel);
    }
    case "anthropic-compatible": {
      const provider = createAnthropic({
        apiKey,
        ...(baseUrl ? { baseURL: baseUrl } : {}),
      });
      return provider(instance.defaultModel);
    }
    case "google":
      // Google uses its own hosted endpoint; the AI SDK provider ignores custom base URLs.
      return createGoogle({ apiKey })(instance.defaultModel);
  }

  throw new Error(`Unsupported LLM provider type: ${instance.providerType}`);
}
