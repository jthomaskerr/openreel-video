import type { GeneratedImageDefinition } from "@openreel/core";

export function findGeneratedImageDependencyCycle(
  definitions: readonly GeneratedImageDefinition[],
  referencesByDefinitionId: ReadonlyMap<string, readonly string[]>,
  startDefinitionId: string,
): readonly string[] | null {
  const knownDefinitionIds = new Set(definitions.map((definition) => definition.id));
  const path: string[] = [];
  const pathIndexById = new Map<string, number>();

  const walk = (definitionId: string): readonly string[] | null => {
    if (!knownDefinitionIds.has(definitionId)) {
      return null;
    }

    const existingIndex = pathIndexById.get(definitionId);
    if (existingIndex !== undefined) {
      return [...path.slice(existingIndex), definitionId];
    }

    pathIndexById.set(definitionId, path.length);
    path.push(definitionId);

    const dependencyIds = referencesByDefinitionId.get(definitionId) ?? [];
    for (const dependencyId of dependencyIds) {
      const cycle = walk(dependencyId);
      if (cycle) {
        return cycle;
      }
    }

    path.pop();
    pathIndexById.delete(definitionId);
    return null;
  };

  return walk(startDefinitionId);
}
