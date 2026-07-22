import type { Project } from "@openreel/core";

export class ExternalMediaDeleteBlockedError extends Error {
  readonly code = "EXTERNAL_MEDIA_DELETE_BLOCKED" as const;

  constructor(readonly mediaId: string) {
    super(`Media ${mediaId} cannot be deleted because it is referenced by an external editor`);
    this.name = "ExternalMediaDeleteBlockedError";
  }
}

export function assertExternallyReferencedMediaPreserved(
  previous: Project,
  next: Project,
): void {
  const nextById = new Map(next.mediaLibrary.items.map((item) => [item.id, item]));

  for (const previousItem of previous.mediaLibrary.items) {
    if (previousItem.externallyReferenced !== true) continue;

    const nextItem = nextById.get(previousItem.id);
    if (
      !nextItem
      || nextItem.externallyReferenced !== true
      || nextItem.name !== previousItem.name
    ) {
      throw new ExternalMediaDeleteBlockedError(previousItem.id);
    }
  }
}
