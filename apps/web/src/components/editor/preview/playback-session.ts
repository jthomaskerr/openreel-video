export function refreshActivePlaybackAfterWarmup(
  warmup: () => Promise<void>,
  isActive: () => boolean,
  refresh: () => void,
  onError: (error: unknown) => void = () => {},
): void {
  void warmup()
    .then(() => {
      if (isActive()) {
        refresh();
      }
    })
    .catch(onError);
}
