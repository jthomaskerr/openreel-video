import React, { useCallback, useEffect, useState } from "react";
import { generateText } from "ai";
import {
  CheckCircle2,
  Circle,
  Globe,
  Loader2,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { Button, Input, Label } from "@openreel/ui";
import { toast } from "../../../stores/notification-store";
import { useSettingsStore } from "../../../stores/settings-store";
import { createModel } from "../../../services/llm/provider-factory";
import {
  DEFAULT_LLM_MODELS,
  type LlmInstance,
  type LlmProviderType,
} from "../../../services/service-instances";
import {
  deleteSecret,
  getSecret,
  saveSecret,
} from "../../../services/secure-storage";

const PROVIDER_OPTIONS: readonly {
  value: LlmProviderType;
  label: string;
  placeholder: string;
}[] = [
  {
    value: "openai-compatible",
    label: "OpenAI-compatible",
    placeholder: "https://api.openai.com/v1",
  },
  {
    value: "anthropic-compatible",
    label: "Anthropic-compatible",
    placeholder: "https://api.anthropic.com",
  },
  {
    value: "google",
    label: "Google",
    placeholder: "Leave empty to use Google default",
  },
] as const;

const INITIAL_PROVIDER: LlmProviderType = "openai-compatible";

type RowStatus =
  | { kind: "idle"; message: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

type PendingAction =
  | { id: string; action: "save" | "clear" | "test" | "remove" }
  | null;


export const ChatProviderSettings: React.FC = () => {
  const {
    llmInstances,
    defaultLlmInstanceId,
    chatApiProxyUrl,
    addLlmInstance,
    updateLlmInstance,
    removeLlmInstance,
    setDefaultLlmInstanceId,
    setChatApiProxyUrl,
    addConfiguredService,
    removeConfiguredService,
  } = useSettingsStore();

  const [newProviderType, setNewProviderType] = useState<LlmProviderType>(INITIAL_PROVIDER);
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [savedKeyPresence, setSavedKeyPresence] = useState<Record<string, boolean>>({});
  const [statusById, setStatusById] = useState<Record<string, RowStatus>>({});
  const [pending, setPending] = useState<PendingAction>(null);

  useEffect(() => {
    let cancelled = false;

    if (llmInstances.length === 0) {
      setSavedKeyPresence({});
      return undefined;
    }

    void (async () => {
      const presence = await Promise.all(
        llmInstances.map(async (instance) => {
          try {
            return [instance.id, Boolean(await getSecret(instance.apiKeySecretId))] as const;
          } catch {
            return [instance.id, false] as const;
          }
        }),
      );

      if (!cancelled) {
        setSavedKeyPresence(Object.fromEntries(presence));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [llmInstances]);

  const setRowStatus = useCallback((id: string, status: RowStatus) => {
    setStatusById((current) => ({ ...current, [id]: status }));
  }, []);

  const setDraftFor = useCallback((id: string, value: string) => {
    setKeyDrafts((current) => ({ ...current, [id]: value }));
  }, []);

  const resolveApiKey = useCallback(async (instance: LlmInstance): Promise<string | null> => {
    const draft = keyDrafts[instance.id]?.trim();
    if (draft) {
      return draft;
    }

    const secret = await getSecret(instance.apiKeySecretId);
    return secret?.trim() || null;
  }, [keyDrafts]);

  const handleAddInstance = useCallback(() => {
    const id = addLlmInstance({
      label: `${PROVIDER_OPTIONS.find((option) => option.value === newProviderType)?.label ?? newProviderType} instance`,
      providerType: newProviderType,
      baseUrl: null,
      defaultModel: DEFAULT_LLM_MODELS[newProviderType],
    });

    setDraftFor(id, "");
    setRowStatus(id, { kind: "success", message: "Instance added." });
    toast.success("LLM instance added", "Fill in the details, then save an API key.");
  }, [addLlmInstance, newProviderType, setDraftFor, setRowStatus]);

  const handleSaveKey = useCallback(async (instance: LlmInstance) => {
    const apiKey = (await resolveApiKey(instance))?.trim();
    if (!apiKey) {
      setRowStatus(instance.id, {
        kind: "error",
        message: "Paste an API key before saving.",
      });
      return;
    }

    setPending({ id: instance.id, action: "save" });
    try {
      await saveSecret(instance.apiKeySecretId, instance.label || (PROVIDER_OPTIONS.find((option) => option.value === instance.providerType)?.label ?? instance.providerType), apiKey);
      addConfiguredService(instance.apiKeySecretId);
      setSavedKeyPresence((current) => ({ ...current, [instance.id]: true }));
      setDraftFor(instance.id, "");
      setRowStatus(instance.id, { kind: "success", message: "Key saved to secure storage." });
      toast.success(`${instance.label} key saved`, "Stored locally in secure storage.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setRowStatus(instance.id, { kind: "error", message });
      toast.error("Failed to save key", message);
    } finally {
      setPending(null);
    }
  }, [addConfiguredService, resolveApiKey, setDraftFor, setRowStatus]);

  const handleClearKey = useCallback(async (instance: LlmInstance) => {
    const draft = keyDrafts[instance.id]?.trim();
    const savedSecret = await getSecret(instance.apiKeySecretId);
    const hasSavedKey = Boolean(savedSecret);

    if (!draft && !hasSavedKey) {
      setRowStatus(instance.id, { kind: "idle", message: "No saved key to clear." });
      return;
    }

    if (draft && !hasSavedKey) {
      setDraftFor(instance.id, "");
      setRowStatus(instance.id, { kind: "success", message: "Draft cleared." });
      return;
    }

    setPending({ id: instance.id, action: "clear" });
    try {
      await deleteSecret(instance.apiKeySecretId);
      removeConfiguredService(instance.apiKeySecretId);
      setSavedKeyPresence((current) => ({ ...current, [instance.id]: false }));
      setDraftFor(instance.id, "");
      setRowStatus(instance.id, { kind: "success", message: "Saved key removed." });
      toast.success(`${instance.label} key removed`, "Secure storage entry deleted.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setRowStatus(instance.id, { kind: "error", message });
      toast.error("Failed to clear key", message);
    } finally {
      setPending(null);
    }
  }, [keyDrafts, removeConfiguredService, setDraftFor, setRowStatus]);

  const handleRemoveInstance = useCallback(async (instance: LlmInstance) => {
    setPending({ id: instance.id, action: "remove" });
    try {
      removeConfiguredService(instance.apiKeySecretId);
      removeLlmInstance(instance.id);
      setSavedKeyPresence((current) => {
        const next = { ...current };
        delete next[instance.id];
        return next;
      });
      setKeyDrafts((current) => {
        const next = { ...current };
        delete next[instance.id];
        return next;
      });
      setStatusById((current) => {
        const next = { ...current };
        delete next[instance.id];
        return next;
      });
      toast.success("LLM instance removed", instance.label);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setRowStatus(instance.id, { kind: "error", message });
      toast.error("Failed to remove instance", message);
    } finally {
      setPending(null);
    }
  }, [removeConfiguredService, removeLlmInstance, setRowStatus]);

  const handleTestConnection = useCallback(async (instance: LlmInstance) => {
    const apiKey = await resolveApiKey(instance);
    const proxyUrl = chatApiProxyUrl?.trim() || null;

    if (!apiKey && !proxyUrl) {
      setRowStatus(instance.id, {
        kind: "error",
        message: "Save an API key or configure the chat proxy before testing.",
      });
      return;
    }

    setPending({ id: instance.id, action: "test" });
    try {
      const model = createModel(
        {
          ...instance,
          defaultModel: instance.defaultModel.trim() || DEFAULT_LLM_MODELS[instance.providerType],
        },
        {
          apiKeyOverride: apiKey,
          proxyUrl,
        },
      );

      const result = await generateText({
        model,
        prompt: "ping",
        maxOutputTokens: 24,
        temperature: 0,
      });

      const text = result.text.trim();
      setRowStatus(instance.id, {
        kind: "success",
        message: text ? `Connection OK: ${text}` : "Connection OK.",
      });
      toast.success(`${instance.label} connection OK`, text || "Received a response from the model.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setRowStatus(instance.id, { kind: "error", message });
      toast.error("Connection test failed", message);
    } finally {
      setPending(null);
    }
  }, [chatApiProxyUrl, resolveApiKey, setRowStatus]);

  const instanceCount = llmInstances.length;

  return (
    <section className="space-y-4 rounded-lg border border-border bg-background-secondary p-4">
      <div className="space-y-1">
        <h4 className="text-sm font-medium text-text-primary">Chat providers</h4>
        <p className="text-xs text-text-muted">
          Configure browser-direct or proxy-backed LLM instances. Keys stay in secure storage; only the secret id is stored in settings.
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-text-secondary">Chat API proxy URL (optional)</Label>
        <Input
          value={chatApiProxyUrl ?? ""}
          onChange={(event) => setChatApiProxyUrl(event.target.value || null)}
          placeholder="https://proxy.example/v1"
          className="h-9"
        />
        <p className="text-[11px] text-text-muted">
          When set, all LLM requests go through this URL; the proxy resolves the instance from the <code className="font-mono">x-openreel-instance</code> header.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[220px] flex-1 space-y-2">
          <Label className="text-xs text-text-secondary">New instance provider</Label>
          <select
            value={newProviderType}
            onChange={(event) => setNewProviderType(event.target.value as LlmProviderType)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {PROVIDER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <Button onClick={handleAddInstance} className="h-9">
          <Plus size={14} className="mr-2" />
          Add Instance
        </Button>
      </div>

      <div className="space-y-3">
        {instanceCount === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-background px-4 py-3 text-sm text-text-muted">
            No LLM instances configured yet.
          </div>
        ) : null}

        {llmInstances.map((instance) => {
          const isDefault = defaultLlmInstanceId === instance.id;
          const pendingForRow = pending?.id === instance.id;
          const rowStatus = statusById[instance.id];
          const providerPlaceholder = PROVIDER_OPTIONS.find((option) => option.value === instance.providerType)?.placeholder ?? "";

          return (
            <div key={instance.id} className="space-y-4 rounded-lg border border-border bg-background p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setDefaultLlmInstanceId(instance.id)}
                  className={`inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors ${
                    isDefault
                      ? "bg-primary/10 text-primary"
                      : "text-text-muted hover:bg-background-tertiary hover:text-text-primary"
                  }`}
                >
                  {isDefault ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                  {isDefault ? "Default instance" : "Set as default"}
                </button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleRemoveInstance(instance)}
                  disabled={pendingForRow}
                >
                  {pendingForRow && pending?.action === "remove" ? (
                    <Loader2 size={14} className="mr-2 animate-spin" />
                  ) : (
                    <Trash2 size={14} className="mr-2" />
                  )}
                  Remove
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-xs text-text-secondary">Label</Label>
                  <Input
                    value={instance.label}
                    onChange={(event) => updateLlmInstance(instance.id, { label: event.target.value })}
                    placeholder="Personal Claude"
                    className="h-9"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-text-secondary">Provider type</Label>
                  <select
                    value={instance.providerType}
                    onChange={(event) => {
                      const providerType = event.target.value as LlmProviderType;
                      updateLlmInstance(instance.id, {
                        providerType,
                        defaultModel: DEFAULT_LLM_MODELS[providerType],
                      });
                    }}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {PROVIDER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-text-secondary">Default model</Label>
                  <Input
                    value={instance.defaultModel}
                    onChange={(event) => updateLlmInstance(instance.id, { defaultModel: event.target.value })}
                    placeholder={DEFAULT_LLM_MODELS[instance.providerType]}
                    className="h-9"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-text-secondary">Base URL</Label>
                  <Input
                    value={instance.baseUrl ?? ""}
                    onChange={(event) => updateLlmInstance(instance.id, { baseUrl: event.target.value || null })}
                    placeholder={providerPlaceholder}
                    className="h-9"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-text-secondary">API key</Label>
                <Input
                  type="password"
                  value={keyDrafts[instance.id] ?? ""}
                  onChange={(event) => setDraftFor(instance.id, event.target.value)}
                  placeholder={savedKeyPresence[instance.id] ? "Update the saved key" : "Paste API key"}
                  className="h-9 font-mono text-xs"
                />
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-text-muted">
                  <span>
                    {savedKeyPresence[instance.id]
                      ? "Key saved in secure storage."
                      : "No saved key yet."}
                  </span>
                  {rowStatus && rowStatus.kind !== "idle" ? (
                    <p
                      className={`text-xs ${rowStatus.kind === "success" ? "text-emerald-500" : "text-red-500"}`}
                    >
                      {rowStatus.message}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => void handleSaveKey(instance)}
                  disabled={pendingForRow}
                >
                  {pendingForRow && pending?.action === "save" ? (
                    <Loader2 size={14} className="mr-2 animate-spin" />
                  ) : (
                    <Globe size={14} className="mr-2" />
                  )}
                  Save Key
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleClearKey(instance)}
                  disabled={pendingForRow}
                >
                  {pendingForRow && pending?.action === "clear" ? (
                    <Loader2 size={14} className="mr-2 animate-spin" />
                  ) : (
                    <Trash2 size={14} className="mr-2" />
                  )}
                  Clear
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleTestConnection(instance)}
                  disabled={pendingForRow}
                >
                  {pendingForRow && pending?.action === "test" ? (
                    <Loader2 size={14} className="mr-2 animate-spin" />
                  ) : (
                    <Play size={14} className="mr-2" />
                  )}
                  Test
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
