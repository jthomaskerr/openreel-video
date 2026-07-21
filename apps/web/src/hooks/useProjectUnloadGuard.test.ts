import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Project, ProjectSaveReceipt } from "@openreel/core";
import { useProjectUnloadGuard } from "./useProjectUnloadGuard";

const project = { id: "project-a", modifiedAt: 101 } as Project;
const receipt = {
  projectId: project.id,
  sourceModifiedAt: 100,
} as ProjectSaveReceipt;

describe("useProjectUnloadGuard", () => {
  it("prevents unload while the active project differs from its confirmed durable receipt", () => {
    renderHook(() => useProjectUnloadGuard(project, {
      projectId: project.id,
      confirmedReceipt: receipt,
    }));
    const event = new Event("beforeunload", { cancelable: true });
    const preventDefault = vi.spyOn(event, "preventDefault");

    window.dispatchEvent(event);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it("allows unload when the active project matches its confirmed durable receipt", () => {
    renderHook(() => useProjectUnloadGuard(
      { ...project, modifiedAt: receipt.sourceModifiedAt },
      { projectId: project.id, confirmedReceipt: receipt },
    ));
    const event = new Event("beforeunload", { cancelable: true });
    const preventDefault = vi.spyOn(event, "preventDefault");

    window.dispatchEvent(event);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
