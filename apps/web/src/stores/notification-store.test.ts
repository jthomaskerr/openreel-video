import "../test/install-local-storage-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "./settings-store";
import { useNotificationStore } from "./notification-store";

describe("notification-store timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useNotificationStore.getState().clearAll();
    useSettingsStore.getState().setToastDurationMs(3000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the persisted timeout and removes the toast when it expires", () => {
    useNotificationStore.getState().addNotification({ type: "error", title: "Save failed" });

    expect(useNotificationStore.getState().notifications).toHaveLength(1);
    expect(useNotificationStore.getState().notifications[0]?.duration).toBe(3000);

    vi.advanceTimersByTime(2999);
    expect(useNotificationStore.getState().notifications).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });
});
