export interface MediaMetadataPatch {
  readonly title?: string;
  readonly description?: string;
  readonly tags?: string[];
  readonly group?: string;
}

export function normalizeMediaMetadataPatch(
  patch: MediaMetadataPatch,
): MediaMetadataPatch {
  const normalizedTags = patch.tags?.reduce<string[]>((tags, value) => {
    const trimmed = value.trim();
    if (
      trimmed &&
      !tags.some((existing) => existing.toLocaleLowerCase() === trimmed.toLocaleLowerCase())
    ) {
      tags.push(trimmed);
    }
    return tags;
  }, []);
  return {
    ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
    ...(patch.description !== undefined
      ? { description: patch.description.trim() }
      : {}),
    ...(normalizedTags !== undefined ? { tags: normalizedTags } : {}),
    ...(patch.group !== undefined ? { group: patch.group.trim() } : {}),
  };
}
