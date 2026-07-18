import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { GenerationReferenceRecoveryState } from "./v2";

export type GenerationDraftScope =
  | { kind: "shot"; shotId: string; projectId?: string }
  | { kind: "new-asset"; draftId: string; projectId?: string };

export interface GenerationDraftState {
  key: string;
  modelId?: string;
  prompt: string;
  providerInputs: Record<string, unknown>;
  referenceIds: string[];
  placementPolicy: "none" | "create-linked-clip" | "replace-selected-clip-media";
  updatedAt: number;
}

const emptyDraft = (key: string): GenerationDraftState => ({
  key,
  prompt: "",
  providerInputs: {},
  referenceIds: [],
  placementPolicy: "none",
  updatedAt: 0,
});

const memoryStorage = (() => {
  let value: string | null = null;
  return {
    getItem: () => value,
    setItem: (_: string, next: string) => { value = next; },
    removeItem: () => { value = null; },
  };
})();

const draftStorage = () => {
  try {
    return typeof localStorage !== "undefined" && localStorage ? localStorage : memoryStorage;
  } catch {
    return memoryStorage;
  }
};

export const generationDraftKey = (scope: GenerationDraftScope): string =>
  scope.kind === "shot" ? `shot:${scope.shotId}` : `asset:${scope.draftId}`;

interface DraftStore {
  drafts: Record<string, GenerationDraftState>;
  referenceRecoveries: Record<string, GenerationReferenceRecoveryState>;
  getDraft: (scope: GenerationDraftScope) => GenerationDraftState;
  saveDraft: (scope: GenerationDraftScope, patch: Partial<GenerationDraftState>, now?: number) => void;
  saveReferenceRecovery: (
    scope: GenerationDraftScope,
    recovery: GenerationReferenceRecoveryState,
  ) => void;
  resetDraft: (scope: GenerationDraftScope) => void;
  removeDraft: (scope: GenerationDraftScope) => void;
}

export const useGenerationDraftStore = create<DraftStore>()(
  persist(
    (set, get) => ({
      drafts: {},
      referenceRecoveries: {},
      getDraft: (scope) => get().drafts[generationDraftKey(scope)] ?? emptyDraft(generationDraftKey(scope)),
      saveDraft: (scope, patch, now = Date.now()) => {
        const key = generationDraftKey(scope);
        set((state) => ({
          drafts: {
            ...state.drafts,
            [key]: { ...emptyDraft(key), ...state.drafts[key], ...patch, key, updatedAt: now },
          },
        }));
      },
      saveReferenceRecovery: (scope, recovery) => {
        const key = generationDraftKey(scope);
        set((state) => ({
          referenceRecoveries: {
            ...state.referenceRecoveries,
            [key]: recovery,
          },
        }));
      },
      resetDraft: (scope) => {
        const key = generationDraftKey(scope);
        set((state) => {
          const referenceRecoveries = { ...state.referenceRecoveries };
          delete referenceRecoveries[key];
          return {
            drafts: { ...state.drafts, [key]: emptyDraft(key) },
            referenceRecoveries,
          };
        });
      },
      removeDraft: (scope) => {
        const key = generationDraftKey(scope);
        set((state) => {
          const drafts = { ...state.drafts };
          const referenceRecoveries = { ...state.referenceRecoveries };
          delete drafts[key];
          delete referenceRecoveries[key];
          return { drafts, referenceRecoveries };
        });
      },
    }),
    {
      name: "openreel-generation-drafts-v2",
      storage: createJSONStorage(draftStorage),
      partialize: (state) => ({
        drafts: state.drafts,
        referenceRecoveries: state.referenceRecoveries,
      }),
    },
  ),
);
