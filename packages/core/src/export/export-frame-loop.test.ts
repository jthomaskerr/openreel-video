import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runExportFrameLoop,
  type ExportFrameLoopOptions,
} from "./export-frame-loop";

function makeOptions(
  overrides: Partial<ExportFrameLoopOptions> = {},
): ExportFrameLoopOptions {
  return {
    totalFrames: 3,
    signal: new AbortController().signal,
    renderAndEncode: async () => undefined,
    cleanup: async () => undefined,
    onFrameComplete: async () => undefined,
    createCancelledError: () => new Error("cancelled"),
    ...overrides,
  };
}

async function executeFrameLoop(options: ExportFrameLoopOptions): Promise<void> {
  for await (const _frame of runExportFrameLoop(options)) {
    // Consume completion notifications as ExportEngine does.
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("runExportFrameLoop", () => {
  it("completes without installing a timer under a simulated background clamp", async () => {
    vi.useFakeTimers();
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const rendered: number[] = [];

    await executeFrameLoop(
      makeOptions({
        totalFrames: 12,
        renderAndEncode: async (frame) => {
          rendered.push(frame);
        },
      }),
    );

    expect(rendered).toEqual([...Array(12).keys()]);
    expect(timeoutSpy).not.toHaveBeenCalled();
  });

  it("cleans every five completed frames", async () => {
    const cleanup = vi.fn();

    await executeFrameLoop(makeOptions({ totalFrames: 11, cleanup }));

    expect(cleanup.mock.calls.map(([frame]) => frame)).toEqual([4, 9]);
  });

  it("checks cancellation before each frame", async () => {
    const controller = new AbortController();
    const rendered: number[] = [];

    await expect(
      executeFrameLoop(
        makeOptions({
          totalFrames: 3,
          signal: controller.signal,
          renderAndEncode: async (frame) => {
            rendered.push(frame);
            if (frame === 0) controller.abort();
          },
        }),
      ),
    ).rejects.toThrow("cancelled");

    expect(rendered).toEqual([0]);
  });
});
