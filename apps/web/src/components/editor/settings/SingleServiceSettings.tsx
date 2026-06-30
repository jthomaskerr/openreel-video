import React, { useCallback, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Play,
  Server,
  Trash2,
} from "lucide-react";
import { Button, Input, Label } from "@openreel/ui";
import { toast } from "../../../stores/notification-store";
import { useSettingsStore } from "../../../stores/settings-store";
import { ORCHESTRATOR_URL } from "../../../stores/music-video-store";
import {
  deleteSecret,
  getSecret,
  saveSecret,
} from "../../../services/secure-storage";
import {
  KIEAI_API_BASE_URL,
} from "../../../services/kieai/client";
import {
  KIEAI_SECRET_ID,
  WAVESPEED_SECRET_ID,
} from "../../../services/service-instances";

type ServiceId = "wavespeed" | "kieai";
type PendingAction = { id: ServiceId; action: "save" | "clear" | "test" } | null;
type RowStatus =
  | { kind: "idle"; message: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

const SERVICE_META: Record<
  ServiceId,
  {
    label: string;
    secretId: string;
    placeholder: string;
    description: string;
  }
> = {
  wavespeed: {
    label: "WaveSpeed",
    secretId: WAVESPEED_SECRET_ID,
    placeholder: "Paste WaveSpeed API key",
    description: "Used by the asset generator and model fetching.",
  },
  kieai: {
    label: "Kie.ai",
    secretId: KIEAI_SECRET_ID,
    placeholder: "Paste KieAI API key",
    description: "Used by the KieAI image and media generation flows.",
  },
} as const;


export const SingleServiceSettings: React.FC = () => {
  const {
    wavespeedHasApiKey,
    kieaiHasApiKey,
    setWavespeedHasApiKey,
    setKieaiHasApiKey,
    addConfiguredService,
    removeConfiguredService,
  } = useSettingsStore();

  const [drafts, setDrafts] = useState<Record<ServiceId, string>>({
    wavespeed: "",
    kieai: "",
  });
  const [statusById, setStatusById] = useState<Record<ServiceId, RowStatus>>({
    wavespeed: { kind: "idle", message: "" },
    kieai: { kind: "idle", message: "" },
  });
  const [pending, setPending] = useState<PendingAction>(null);

  const setStatus = useCallback((id: ServiceId, status: RowStatus) => {
    setStatusById((current) => ({ ...current, [id]: status }));
  }, []);

  const setDraft = useCallback((id: ServiceId, value: string) => {
    setDrafts((current) => ({ ...current, [id]: value }));
  }, []);

  const resolveKey = useCallback(async (id: ServiceId): Promise<string | null> => {
    const draft = drafts[id].trim();
    if (draft) {
      return draft;
    }

    const secret = await getSecret(SERVICE_META[id].secretId);
    return secret?.trim() || null;
  }, [drafts]);

  const handleSave = useCallback(async (id: ServiceId) => {
    const key = await resolveKey(id);
    if (!key) {
      setStatus(id, { kind: "error", message: "Paste an API key before saving." });
      return;
    }

    setPending({ id, action: "save" });
    try {
      await saveSecret(SERVICE_META[id].secretId, SERVICE_META[id].label, key);
      addConfiguredService(SERVICE_META[id].secretId);
      if (id === "wavespeed") {
        setWavespeedHasApiKey(true);
      } else {
        setKieaiHasApiKey(true);
      }
      setDraft(id, "");
      setStatus(id, { kind: "success", message: "Key saved to secure storage." });
      toast.success(`${SERVICE_META[id].label} key saved`, "Stored locally in secure storage.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setStatus(id, { kind: "error", message });
      toast.error("Failed to save key", message);
    } finally {
      setPending(null);
    }
  }, [addConfiguredService, resolveKey, setDraft, setKieaiHasApiKey, setStatus, setWavespeedHasApiKey]);

  const handleClear = useCallback(async (id: ServiceId) => {
    const draft = drafts[id].trim();
    const savedKey = await getSecret(SERVICE_META[id].secretId);
    const hasSavedKey = Boolean(savedKey);

    if (!draft && !hasSavedKey) {
      setStatus(id, { kind: "idle", message: "No saved key to clear." });
      return;
    }

    if (draft && !hasSavedKey) {
      setDraft(id, "");
      setStatus(id, { kind: "success", message: "Draft cleared." });
      return;
    }

    setPending({ id, action: "clear" });
    try {
      await deleteSecret(SERVICE_META[id].secretId);
      removeConfiguredService(SERVICE_META[id].secretId);
      if (id === "wavespeed") {
        setWavespeedHasApiKey(false);
      } else {
        setKieaiHasApiKey(false);
      }
      setDraft(id, "");
      setStatus(id, { kind: "success", message: "Saved key removed." });
      toast.success(`${SERVICE_META[id].label} key removed`, "Secure storage entry deleted.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setStatus(id, { kind: "error", message });
      toast.error("Failed to clear key", message);
    } finally {
      setPending(null);
    }
  }, [drafts, removeConfiguredService, setDraft, setKieaiHasApiKey, setStatus, setWavespeedHasApiKey]);

  const handleTestWaveSpeed = useCallback(async (id: ServiceId) => {
    const key = await resolveKey(id);
    if (!key) {
      setStatus(id, { kind: "error", message: "Paste a WaveSpeed key before testing." });
      return;
    }

    setPending({ id, action: "test" });
    try {
      const response = await fetch(`${ORCHESTRATOR_URL}/api/generate/wavespeed/models`, {
        headers: { "X-WaveSpeed-Api-Key": key },
      });

      const body = (await response.json().catch(() => ({}))) as { models?: unknown[]; error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? `WaveSpeed models request failed (${response.status})`);
      }

      const modelCount = Array.isArray(body.models) ? body.models.length : 0;
      const message = `Connection OK: ${modelCount} models returned.`;
      setStatus(id, { kind: "success", message });
      toast.success("WaveSpeed connection OK", message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setStatus(id, { kind: "error", message });
      toast.error("WaveSpeed test failed", message);
    } finally {
      setPending(null);
    }
  }, [resolveKey, setStatus]);

  const handleTestKieAi = useCallback(async (id: ServiceId) => {
    const key = await resolveKey(id);
    if (!key) {
      setStatus(id, { kind: "error", message: "Paste a Kie.ai key before testing." });
      return;
    }

    setPending({ id, action: "test" });
    try {
      const response = await fetch(`${KIEAI_API_BASE_URL}/ping`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      const body = (await response.json().catch(() => ({}))) as { code?: number; msg?: string };

      if (!response.ok) {
        throw new Error(body.msg ?? `KieAI ping failed (${response.status})`);
      }
      if ((body.code ?? 200) !== 200) {
        throw new Error(body.msg ?? "KieAI ping failed");
      }

      const message = body.msg ?? "Connection OK.";
      setStatus(id, { kind: "success", message });
      toast.success("KieAI connection OK", message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setStatus(id, { kind: "error", message });
      toast.error("KieAI test failed", message);
    } finally {
      setPending(null);
    }
  }, [resolveKey, setStatus]);

  const renderService = (id: ServiceId) => {
    const meta = SERVICE_META[id];
    const hasKey = id === "wavespeed" ? wavespeedHasApiKey : kieaiHasApiKey;
    const pendingForRow = pending?.id === id;
    const status = statusById[id];

    return (
      <div key={id} className="space-y-4 rounded-lg border border-border bg-background p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Server size={14} className="text-primary" />
              <h5 className="text-sm font-medium text-text-primary">{meta.label}</h5>
              {hasKey ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-500">
                  <CheckCircle2 size={11} />
                  Saved
                </span>
              ) : null}
            </div>
            <p className="text-xs text-text-muted">{meta.description}</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-text-secondary">API key</Label>
          <Input
            type="password"
            value={drafts[id]}
            onChange={(event) => setDraft(id, event.target.value)}
            placeholder={hasKey ? "Update the saved key" : meta.placeholder}
            className="h-9 font-mono text-xs"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-text-muted">
            <span>{hasKey ? "Key saved in secure storage." : "No saved key yet."}</span>
            {status && status.kind !== "idle" ? (
              <p className={`text-xs ${status.kind === "success" ? "text-emerald-500" : "text-red-500"}`}>
                {status.message}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => void handleSave(id)}
            disabled={pendingForRow}
          >
            {pendingForRow && pending?.action === "save" ? (
              <Loader2 size={14} className="mr-2 animate-spin" />
            ) : (
              <CheckCircle2 size={14} className="mr-2" />
            )}
            Save
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleClear(id)}
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
            onClick={() => void (id === "wavespeed" ? handleTestWaveSpeed(id) : handleTestKieAi(id))}
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
  };

  return (
    <section className="space-y-4 rounded-lg border border-border bg-background-secondary p-4">
      <div className="space-y-1">
        <h4 className="text-sm font-medium text-text-primary">WaveSpeed & Kie.ai</h4>
        <p className="text-xs text-text-muted">
          Store API keys locally in secure storage and verify that each service can connect before you use it.
        </p>
      </div>

      <div className="space-y-3">
        {renderService("wavespeed")}
        {renderService("kieai")}
      </div>
    </section>
  );
};
