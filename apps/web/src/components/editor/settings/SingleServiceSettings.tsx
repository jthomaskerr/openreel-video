import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Play, Server, Trash2 } from "lucide-react";
import { Button, Input, Label } from "@openreel/ui";
import { toast } from "../../../stores/notification-store";
import { useSettingsStore } from "../../../stores/settings-store";
import { getProductionGenerationRuntime } from "../../../stores/generation-job-store";
import { deleteSecret, getSecret, saveSecret } from "../../../services/secure-storage";
import { KIEAI_API_BASE_URL } from "../../../services/kieai/client";
import { KIEAI_SECRET_ID } from "../../../services/service-instances";

type PendingAction = "save" | "clear" | "test" | null;
type RowStatus =
  | { kind: "idle"; message: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };
type WaveSpeedStatus =
  | { kind: "loading"; message: string }
  | { kind: "success"; message: string }
  | { kind: "warning"; message: string }
  | { kind: "error"; message: string };

export const SingleServiceSettings: React.FC = () => {
  const [generationRuntime] = useState(getProductionGenerationRuntime);
  const {
    kieaiHasApiKey,
    setKieaiHasApiKey,
    addConfiguredService,
    removeConfiguredService,
  } = useSettingsStore();
  const [kieaiDraft, setKieaiDraft] = useState("");
  const [kieaiStatus, setKieaiStatus] = useState<RowStatus>({ kind: "idle", message: "" });
  const [pending, setPending] = useState<PendingAction>(null);
  const [waveSpeedStatus, setWaveSpeedStatus] = useState<WaveSpeedStatus>({
    kind: "loading",
    message: "Reading server capabilities…",
  });

  const refreshWaveSpeedCapabilities = useCallback(async (
    isActive: () => boolean = () => true,
  ) => {
    setWaveSpeedStatus({ kind: "loading", message: "Reading server capabilities…" });
    try {
      const body = await generationRuntime.readCapabilities({ refresh: true });
      if (!isActive()) return;
      if (!body.configured) {
        setWaveSpeedStatus({ kind: "error", message: "Server is not configured for WaveSpeed." });
      } else if (!body.generationV2ReleaseEnabled) {
        setWaveSpeedStatus({ kind: "warning", message: "Server configured. New V2 submissions are paused by rollback." });
      } else {
        const routeCount = Array.isArray(body.routes) ? body.routes.length : 0;
        setWaveSpeedStatus({ kind: "success", message: `Server configured. ${routeCount} generation route${routeCount === 1 ? "" : "s"} available.` });
      }
    } catch (error) {
      if (!isActive()) return;
      const message = error instanceof Error ? error.message : "Unknown capability error";
      setWaveSpeedStatus({ kind: "error", message });
    }
  }, [generationRuntime]);

  useEffect(() => {
    let active = true;
    void refreshWaveSpeedCapabilities(() => active);
    return () => {
      active = false;
    };
  }, [refreshWaveSpeedCapabilities]);

  const resolveKieAiKey = useCallback(async (): Promise<string | null> => {
    const draft = kieaiDraft.trim();
    if (draft) return draft;
    const secret = await getSecret(KIEAI_SECRET_ID);
    return secret?.trim() || null;
  }, [kieaiDraft]);

  const handleSaveKieAi = useCallback(async () => {
    const key = await resolveKieAiKey();
    if (!key) {
      setKieaiStatus({ kind: "error", message: "Paste an API key before saving." });
      return;
    }
    setPending("save");
    try {
      await saveSecret(KIEAI_SECRET_ID, "Kie.ai", key);
      addConfiguredService(KIEAI_SECRET_ID);
      setKieaiHasApiKey(true);
      setKieaiDraft("");
      setKieaiStatus({ kind: "success", message: "Key saved to secure storage." });
      toast.success("Kie.ai key saved", "Stored locally in secure storage.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setKieaiStatus({ kind: "error", message });
      toast.error("Failed to save key", message);
    } finally {
      setPending(null);
    }
  }, [addConfiguredService, resolveKieAiKey, setKieaiHasApiKey]);

  const handleClearKieAi = useCallback(async () => {
    const savedKey = await getSecret(KIEAI_SECRET_ID);
    if (!kieaiDraft.trim() && !savedKey) {
      setKieaiStatus({ kind: "idle", message: "No saved key to clear." });
      return;
    }
    if (kieaiDraft.trim() && !savedKey) {
      setKieaiDraft("");
      setKieaiStatus({ kind: "success", message: "Draft cleared." });
      return;
    }
    setPending("clear");
    try {
      await deleteSecret(KIEAI_SECRET_ID);
      removeConfiguredService(KIEAI_SECRET_ID);
      setKieaiHasApiKey(false);
      setKieaiDraft("");
      setKieaiStatus({ kind: "success", message: "Saved key removed." });
      toast.success("Kie.ai key removed", "Secure storage entry deleted.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setKieaiStatus({ kind: "error", message });
      toast.error("Failed to clear key", message);
    } finally {
      setPending(null);
    }
  }, [kieaiDraft, removeConfiguredService, setKieaiHasApiKey]);

  const handleTestKieAi = useCallback(async () => {
    const key = await resolveKieAiKey();
    if (!key) {
      setKieaiStatus({ kind: "error", message: "Paste a Kie.ai key before testing." });
      return;
    }
    setPending("test");
    try {
      const response = await fetch(`${KIEAI_API_BASE_URL}/ping`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      const body = await response.json().catch(() => ({})) as { code?: number; msg?: string };
      if (!response.ok || (body.code ?? 200) !== 200) {
        throw new Error(body.msg ?? `KieAI ping failed (${response.status})`);
      }
      const message = body.msg ?? "Connection OK.";
      setKieaiStatus({ kind: "success", message });
      toast.success("KieAI connection OK", message);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setKieaiStatus({ kind: "error", message });
      toast.error("KieAI test failed", message);
    } finally {
      setPending(null);
    }
  }, [resolveKieAiKey]);

  return (
    <section className="space-y-4 rounded-lg border border-border bg-background-secondary p-4">
      <div className="space-y-1">
        <h4 className="text-sm font-medium text-text-primary">WaveSpeed & Kie.ai</h4>
        <p className="text-xs text-text-muted">
          WaveSpeed credentials stay on the server. Kie.ai retains its existing local secure-storage flow.
        </p>
      </div>

      <div className="space-y-3">
        <div className="space-y-3 rounded-lg border border-border bg-background p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Server size={14} className="text-primary" />
                <h5 className="text-sm font-medium text-text-primary">WaveSpeed</h5>
                {waveSpeedStatus.kind === "success" ? <CheckCircle2 size={14} className="text-emerald-500" /> : null}
              </div>
              <p className="text-xs text-text-muted">Configured and authenticated by the orchestrator.</p>
            </div>
          </div>
          <p className={`text-xs ${waveSpeedStatus.kind === "error" ? "text-red-500" : waveSpeedStatus.kind === "warning" ? "text-amber-500" : waveSpeedStatus.kind === "success" ? "text-emerald-500" : "text-text-muted"}`}>
            {waveSpeedStatus.kind === "loading" ? <Loader2 size={12} className="mr-2 inline animate-spin" /> : null}
            {waveSpeedStatus.message}
          </p>
          <Button variant="outline" size="sm" onClick={() => void refreshWaveSpeedCapabilities()} disabled={waveSpeedStatus.kind === "loading"}>
            Refresh capabilities
          </Button>
        </div>

        <div className="space-y-4 rounded-lg border border-border bg-background p-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Server size={14} className="text-primary" />
              <h5 className="text-sm font-medium text-text-primary">Kie.ai</h5>
              {kieaiHasApiKey ? <span className="text-[10px] font-medium text-emerald-500">Saved</span> : null}
            </div>
            <p className="text-xs text-text-muted">Used by existing Kie.ai image and media generation flows.</p>
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-text-secondary">API key</Label>
            <Input
              type="password"
              value={kieaiDraft}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setKieaiDraft(event.target.value)}
              placeholder={kieaiHasApiKey ? "Update the saved key" : "Paste KieAI API key"}
              className="h-9 font-mono text-xs"
            />
            {kieaiStatus.kind !== "idle" || kieaiStatus.message ? (
              <p className={`text-xs ${kieaiStatus.kind === "error" ? "text-red-500" : "text-emerald-500"}`}>{kieaiStatus.message}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void handleSaveKieAi()} disabled={pending !== null}>
              {pending === "save" ? <Loader2 size={14} className="mr-2 animate-spin" /> : <CheckCircle2 size={14} className="mr-2" />}
              Save
            </Button>
            <Button variant="outline" size="sm" onClick={() => void handleClearKieAi()} disabled={pending !== null}>
              {pending === "clear" ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Trash2 size={14} className="mr-2" />}
              Clear
            </Button>
            <Button variant="outline" size="sm" onClick={() => void handleTestKieAi()} disabled={pending !== null}>
              {pending === "test" ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Play size={14} className="mr-2" />}
              Test
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
};
