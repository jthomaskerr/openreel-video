export interface ExportFrameLoopOptions {
  totalFrames: number;
  signal: AbortSignal;
  renderAndEncode(frame: number): Promise<void>;
  cleanup(frame: number): void | Promise<void>;
  onFrameComplete(frame: number): void | Promise<void>;
  createCancelledError(): unknown;
  cleanupEvery?: number;
}

export async function* runExportFrameLoop({
  totalFrames,
  signal,
  renderAndEncode,
  cleanup,
  onFrameComplete,
  createCancelledError,
  cleanupEvery = 5,
}: ExportFrameLoopOptions): AsyncGenerator<number, void, void> {
  for (let frame = 0; frame < totalFrames; frame += 1) {
    if (signal.aborted) throw createCancelledError();

    await renderAndEncode(frame);

    if ((frame + 1) % cleanupEvery === 0) {
      await cleanup(frame);
    }

    await onFrameComplete(frame);
    yield frame;
  }
}
