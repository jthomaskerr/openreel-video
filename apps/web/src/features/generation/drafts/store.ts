import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type GenerationDraftKey = string;
export interface GenerationDraftState {
  key: GenerationDraftKey;
  modelId?: string;
  prompt: string;
  providerInputs: Record<string, unknown>;
  references: string[];
  placementPolicy: "none" | "create-linked-clip" | "replace-selected-clip-media";
  updatedAt: number;
}

const empty = (key: string): GenerationDraftState => ({ key, prompt: "", providerInputs: {}, references: [], placementPolicy: "none", updatedAt: 0 });
const memoryStorage = (() => { let value: string | null = null; return { getItem: () => value, setItem: (_: string, next: string) => { value = next; }, removeItem: () => { value = null; } }; })();
const draftStorage = () => { try { return typeof localStorage !== "undefined" && localStorage ? localStorage : memoryStorage; } catch { return memoryStorage; } };
interface DraftStore {
  drafts: Record<string, GenerationDraftState>;
  getDraft: (key: string) => GenerationDraftState;
  saveDraft: (key: string, patch: Partial<GenerationDraftState>, now?: number) => void;
  resetDraft: (key: string) => void;
  removeDraft: (key: string) => void;
}

export const useGenerationDraftStore = create<DraftStore>()(persist((set, get) => ({
  drafts: {},
  getDraft: (key) => get().drafts[key] ?? empty(key),
  saveDraft: (key, patch, now = Date.now()) => set((state) => ({ drafts: { ...state.drafts, [key]: { ...empty(key), ...state.drafts[key], ...patch, key, updatedAt: now } } })),
  resetDraft: (key) => set((state) => ({ drafts: { ...state.drafts, [key]: empty(key) } })),
  removeDraft: (key) => set((state) => { const drafts = { ...state.drafts }; delete drafts[key]; return { drafts }; }),
}), { name: "openreel-generation-drafts-v2", storage: createJSONStorage(draftStorage), partialize: (state) => ({ drafts: state.drafts }) }));

export const generationDraftKey = (input: { shotId?: string; draftId?: string; projectId?: string }) => input.shotId ? `shot:${input.shotId}` : input.draftId ? `draft:${input.draftId}` : `project:${input.projectId ?? "unknown"}`;
