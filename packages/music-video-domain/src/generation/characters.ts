import type { ProjectCharacter } from "./contracts.js";

export interface NeuralFramesCharacterInput { id?: string; name: string; primaryImageMediaId: string; primaryImageVersionId?: string }
export function canonicalizeCharacterSlug(name: string): string {
  return name.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "character";
}
export function convertNeuralFramesCharacters(inputs: readonly NeuralFramesCharacterInput[]): ProjectCharacter[] {
  const ordered = [...inputs].sort((a, b) => `${a.id ?? ""}\0${a.name}`.localeCompare(`${b.id ?? ""}\0${b.name}`));
  const counts = new Map<string, number>();
  return ordered.map((input) => {
    const base = canonicalizeCharacterSlug(input.name);
    const occurrence = (counts.get(base) ?? 0) + 1;
    counts.set(base, occurrence);
    return { id: input.id || `neuralframes:${base}:${occurrence}`, slug: occurrence === 1 ? base : `${base}-${occurrence}`, displayName: input.name, primaryImageMediaId: input.primaryImageMediaId, ...(input.primaryImageVersionId ? { primaryImageVersionId: input.primaryImageVersionId } : {}) };
  });
}

