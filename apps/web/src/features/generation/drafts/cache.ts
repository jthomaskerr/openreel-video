import type { GenerationError } from "@openreel/music-video-domain/generation";
import type { GenerationDraft } from "../submit-generation";

export interface GenerationSubmissionDraftCacheEntry {
  key: string;
  draft: GenerationDraft;
  placeholderMediaId: string;
  status: "pending" | "failed";
  error?: GenerationError;
  updatedAt: number;
}

export interface GenerationSubmissionDraftCachePort {
  stagePending(entry: GenerationSubmissionDraftCacheEntry): Promise<void> | void;
  markFailed(input: { key: string; error: GenerationError; updatedAt: number }): Promise<void> | void;
  clear(key: string): Promise<void> | void;
  get(key: string): GenerationSubmissionDraftCacheEntry | undefined;
  clearAll(): void;
}

class MemoryGenerationSubmissionDraftCache implements GenerationSubmissionDraftCachePort {
  private readonly entries = new Map<string, GenerationSubmissionDraftCacheEntry>();

  stagePending(entry: GenerationSubmissionDraftCacheEntry): void {
    this.entries.set(entry.key, {
      ...entry,
      draft: structuredClone(entry.draft),
      status: "pending",
    });
  }

  markFailed(input: { key: string; error: GenerationError; updatedAt: number }): void {
    const existing = this.entries.get(input.key);
    if (!existing) return;
    this.entries.set(input.key, {
      ...existing,
      status: "failed",
      error: input.error,
      updatedAt: input.updatedAt,
    });
  }

  clear(key: string): void {
    this.entries.delete(key);
  }

  get(key: string): GenerationSubmissionDraftCacheEntry | undefined {
    return this.entries.get(key);
  }

  clearAll(): void {
    this.entries.clear();
  }
}

export function createGenerationSubmissionDraftCache(): GenerationSubmissionDraftCachePort {
  return new MemoryGenerationSubmissionDraftCache();
}

export const generationSubmissionDraftCache = createGenerationSubmissionDraftCache();

export function clearGenerationSubmissionDraftCache(): void {
  generationSubmissionDraftCache.clearAll();
}

export function createGenerationSubmissionRetryableDraft(input: {
  key: string;
  draft: GenerationDraft;
  placeholderMediaId: string;
  updatedAt: number;
}): GenerationSubmissionDraftCacheEntry {
  return {
    key: input.key,
    draft: structuredClone(input.draft),
    placeholderMediaId: input.placeholderMediaId,
    status: "pending",
    updatedAt: input.updatedAt,
  };
}
