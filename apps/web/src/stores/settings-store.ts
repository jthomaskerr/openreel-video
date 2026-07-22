import { create } from "zustand";
import { createDurableId } from "@openreel/core";
import { subscribeWithSelector, persist } from "zustand/middleware";
import { deleteSecret, onSessionLock } from "../services/secure-storage";
import type { LlmInstance } from "../services/service-instances";

export interface ServiceConfig {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly docsUrl?: string;
}

/**
 * Registry of supported external services that require API keys.
 * Add new services here as the app integrates more third-party APIs.
 */
export const SERVICE_REGISTRY: readonly ServiceConfig[] = [
  {
    id: "elevenlabs",
    label: "ElevenLabs",
    description: "AI voice generation and text-to-speech",
    docsUrl: "https://elevenlabs.io/docs/api-reference",
  },
  {
    id: "wavespeed",
    label: "WaveSpeed",
    description: "AI video and image generation models",
    docsUrl: "https://wavespeed.ai",
  },
  {
    id: "kie-ai",
    label: "Kie.ai",
    description: "AI aggregator for video/image generation, upscaling, and editing",
    docsUrl: "https://kie.ai",
  },
  {
    id: "freepik",
    label: "Freepik",
    description: "AI aggregator for image generation, vectors, and creative assets",
    docsUrl: "https://www.freepik.com/api",
  },
] as const;

export type TtsProvider = "piper" | "elevenlabs";
export type SettingsTab = "general" | "api-keys";

type LlmInstanceInput = Omit<LlmInstance, "id" | "apiKeySecretId">;
type LlmInstancePatch = Partial<Omit<LlmInstance, "id" | "apiKeySecretId">>;

export interface SettingsState {
  // General preferences
  autoSave: boolean;
  autoSaveInterval: number;
  toastDurationMs: number;
  language: string;
  revertToPlaybackStartOnStop: boolean;

  // AI/Service preferences
  defaultTtsProvider: TtsProvider;
  llmInstances: LlmInstance[];
  defaultLlmInstanceId: string | null;
  chatApiProxyUrl: string | null;
  wavespeedHasApiKey: boolean;
  kieaiHasApiKey: boolean;
  elevenLabsModel: string;
  favoriteVoices: Array<{ voiceId: string; name: string; previewUrl?: string }>;
  favoriteModels: Array<{ modelId: string; name: string }>;
  configuredServices: string[]; // IDs of services with stored API keys

  // Session-scoped API caches (cleared on session lock, not persisted)
  cachedElevenLabsVoices: Array<{ voice_id: string; name: string; category: string; labels: Record<string, string>; preview_url?: string }> | null;
  cachedElevenLabsModels: Array<{ model_id: string; name: string; description?: string; can_do_text_to_speech?: boolean; languages?: Array<{ language_id: string; name: string }> }> | null;

  // Settings dialog state
  settingsOpen: boolean;
  settingsTab: SettingsTab;

  // Actions
  setAutoSave: (enabled: boolean) => void;
  setAutoSaveInterval: (minutes: number) => void;
  setToastDurationMs: (milliseconds: number) => void;
  setLanguage: (lang: string) => void;
  setRevertToPlaybackStartOnStop: (enabled: boolean) => void;
  setDefaultTtsProvider: (provider: TtsProvider) => void;
  addLlmInstance: (partial: LlmInstanceInput) => string;
  updateLlmInstance: (id: string, patch: LlmInstancePatch) => void;
  removeLlmInstance: (id: string) => void;
  setDefaultLlmInstanceId: (id: string | null) => void;
  setChatApiProxyUrl: (url: string | null) => void;
  setWavespeedHasApiKey: (flag: boolean) => void;
  setKieaiHasApiKey: (flag: boolean) => void;
  setElevenLabsModel: (model: string) => void;
  addFavoriteVoice: (voice: { voiceId: string; name: string; previewUrl?: string }) => void;
  removeFavoriteVoice: (voiceId: string) => void;
  addFavoriteModel: (model: { modelId: string; name: string }) => void;
  removeFavoriteModel: (modelId: string) => void;
  addConfiguredService: (serviceId: string) => void;
  removeConfiguredService: (serviceId: string) => void;
  setCachedElevenLabsVoices: (voices: SettingsState["cachedElevenLabsVoices"]) => void;
  setCachedElevenLabsModels: (models: SettingsState["cachedElevenLabsModels"]) => void;
  clearApiCaches: () => void;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        autoSave: true,
        autoSaveInterval: 5,
        toastDurationMs: 6000,
        language: "en",
        revertToPlaybackStartOnStop: false,

        defaultTtsProvider: "elevenlabs" as TtsProvider,
        llmInstances: [],
        defaultLlmInstanceId: null,
        chatApiProxyUrl: null,
        wavespeedHasApiKey: false,
        kieaiHasApiKey: false,
        elevenLabsModel: "eleven_v3",
        favoriteVoices: [],
        favoriteModels: [],
        configuredServices: [],

        cachedElevenLabsVoices: null,
        cachedElevenLabsModels: null,

        settingsOpen: false,
        settingsTab: "general" as SettingsTab,

        setAutoSave: (enabled: boolean) => set({ autoSave: enabled }),

        setAutoSaveInterval: (minutes: number) =>
          set({ autoSaveInterval: Math.max(1, Math.min(30, minutes)) }),
        setToastDurationMs: (milliseconds: number) =>
          set({ toastDurationMs: Math.max(1000, Math.min(30000, milliseconds)) }),

        setLanguage: (lang: string) => set({ language: lang }),
        setRevertToPlaybackStartOnStop: (enabled: boolean) =>
          set({ revertToPlaybackStartOnStop: enabled }),

        setDefaultTtsProvider: (provider: TtsProvider) =>
          set({ defaultTtsProvider: provider }),

        addLlmInstance: (partial) => {
          const id = createDurableId("llm-instance");
          const instance: LlmInstance = {
            ...partial,
            id,
            apiKeySecretId: `llm-${id}`,
          };
          const { defaultLlmInstanceId, llmInstances } = get();
          set({
            llmInstances: [...llmInstances, instance],
            defaultLlmInstanceId: defaultLlmInstanceId ?? id,
          });
          return id;
        },

        updateLlmInstance: (id, patch) =>
          set((state) => ({
            llmInstances: state.llmInstances.map((instance) =>
              instance.id === id ? { ...instance, ...patch } : instance,
            ),
          })),

        removeLlmInstance: (id) => {
          const { llmInstances, defaultLlmInstanceId } = get();
          const removed = llmInstances.find((instance) => instance.id === id);
          if (removed) {
            void deleteSecret(removed.apiKeySecretId);
          }
          const remaining = llmInstances.filter((instance) => instance.id !== id);
          set({
            llmInstances: remaining,
            defaultLlmInstanceId:
              defaultLlmInstanceId === id ? remaining[0]?.id ?? null : defaultLlmInstanceId,
          });
        },

        setDefaultLlmInstanceId: (id) => {
          if (id === null) {
            set({ defaultLlmInstanceId: null });
            return;
          }
          if (get().llmInstances.some((instance) => instance.id === id)) {
            set({ defaultLlmInstanceId: id });
          }
        },

        setChatApiProxyUrl: (url) => set({ chatApiProxyUrl: url?.trim() || null }),
        setWavespeedHasApiKey: (flag) => set({ wavespeedHasApiKey: flag }),
        setKieaiHasApiKey: (flag) => set({ kieaiHasApiKey: flag }),

        setElevenLabsModel: (model: string) =>
          set({ elevenLabsModel: model }),

        addFavoriteVoice: (voice) => {
          const { favoriteVoices } = get();
          if (!favoriteVoices.some((v) => v.voiceId === voice.voiceId)) {
            set({ favoriteVoices: [...favoriteVoices, voice] });
          }
        },

        removeFavoriteVoice: (voiceId: string) => {
          const { favoriteVoices } = get();
          set({ favoriteVoices: favoriteVoices.filter((v) => v.voiceId !== voiceId) });
        },

        addFavoriteModel: (model) => {
          const { favoriteModels } = get();
          if (!favoriteModels.some((m) => m.modelId === model.modelId)) {
            set({ favoriteModels: [...favoriteModels, model] });
          }
        },

        removeFavoriteModel: (modelId: string) => {
          const { favoriteModels } = get();
          set({ favoriteModels: favoriteModels.filter((m) => m.modelId !== modelId) });
        },

        addConfiguredService: (serviceId: string) => {
          const { configuredServices } = get();
          if (!configuredServices.includes(serviceId)) {
            set({ configuredServices: [...configuredServices, serviceId] });
          }
        },

        removeConfiguredService: (serviceId: string) => {
          const { configuredServices } = get();
          set({
            configuredServices: configuredServices.filter((id) => id !== serviceId),
          });
        },

        setCachedElevenLabsVoices: (voices) =>
          set({ cachedElevenLabsVoices: voices }),

        setCachedElevenLabsModels: (models) =>
          set({ cachedElevenLabsModels: models }),

        clearApiCaches: () =>
          set({ cachedElevenLabsVoices: null, cachedElevenLabsModels: null }),

        openSettings: (tab?: SettingsTab) =>
          set({
            settingsOpen: true,
            settingsTab: tab ?? get().settingsTab,
          }),

        closeSettings: () => set({ settingsOpen: false }),
      }),
      {
        name: "openreel-settings",
        version: 4,
        partialize: (state) => ({
          autoSave: state.autoSave,
          autoSaveInterval: state.autoSaveInterval,
          toastDurationMs: state.toastDurationMs,
          language: state.language,
          revertToPlaybackStartOnStop: state.revertToPlaybackStartOnStop,
          defaultTtsProvider: state.defaultTtsProvider,
          llmInstances: state.llmInstances,
          defaultLlmInstanceId: state.defaultLlmInstanceId,
          chatApiProxyUrl: state.chatApiProxyUrl,
          wavespeedHasApiKey: state.wavespeedHasApiKey,
          kieaiHasApiKey: state.kieaiHasApiKey,
          elevenLabsModel: state.elevenLabsModel,
          favoriteVoices: state.favoriteVoices,
          favoriteModels: state.favoriteModels,
          configuredServices: state.configuredServices,
        }),
        migrate: (persistedState) => {
          if (!persistedState || typeof persistedState !== "object") {
            return persistedState;
          }
          const state = persistedState as Partial<SettingsState> & Record<string, unknown>;
          const next = { ...state };
          delete next.defaultLlmProvider;
          delete next.defaultAggregator;
          return {
            ...next,
            llmInstances: state.llmInstances ?? [],
            defaultLlmInstanceId: state.defaultLlmInstanceId ?? null,
            chatApiProxyUrl: state.chatApiProxyUrl ?? null,
            wavespeedHasApiKey: state.wavespeedHasApiKey ?? false,
            kieaiHasApiKey: state.kieaiHasApiKey ?? false,
            toastDurationMs: state.toastDurationMs ?? 6000,
            revertToPlaybackStartOnStop:
              state.revertToPlaybackStartOnStop ?? false,
          };
        },
      },
    ),
  ),
);

// Clear API caches when the secure session locks
onSessionLock(() => {
  useSettingsStore.getState().clearApiCaches();
});
