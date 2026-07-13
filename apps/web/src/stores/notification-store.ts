import { create } from "zustand";
import { logBus } from "./log-store";
import { useSettingsStore } from "./settings-store";

export type NotificationType = "success" | "error" | "warning" | "info";

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  duration?: number;
  dismissible?: boolean;
}

interface NotificationState {
  notifications: Notification[];
  addNotification: (notification: Omit<Notification, "id">) => string;
  removeNotification: (id: string) => void;
  clearAll: () => void;
}

let notificationId = 0;

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],

  addNotification: (notification) => {
    const id = `notification-${++notificationId}`;
    const newNotification: Notification = {
      id,
      duration: useSettingsStore.getState().toastDurationMs,
      dismissible: true,
      ...notification,
    };

    set((state) => ({
      notifications: [...state.notifications, newNotification],
    }));

    if (newNotification.duration && newNotification.duration > 0) {
      setTimeout(() => {
        get().removeNotification(id);
      }, newNotification.duration);
    }

    return id;
  },

  removeNotification: (id) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }));
  },

  clearAll: () => {
    set({ notifications: [] });
  },
}));

const recentRuntimeErrors = new Map<string, number>();
const RUNTIME_ERROR_DEDUPE_MS = 10_000;

function toRuntimeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown runtime error";
  }
}

export function reportRuntimeError(title: string, error: unknown, source: string): void {
  const message = toRuntimeErrorMessage(error);
  logBus.entry({
    kind: "runtime_error",
    label: title,
    message,
    source,
  });

  const key = `${source}:${title}:${message}`;
  const now = Date.now();
  const lastShown = recentRuntimeErrors.get(key) ?? 0;
  if (now - lastShown < RUNTIME_ERROR_DEDUPE_MS) return;
  recentRuntimeErrors.set(key, now);

  useNotificationStore
    .getState()
    .addNotification({ type: "error", title, message });
}

export const toast = {
  success: (title: string, message?: string, duration?: number) => {
    logBus.entry({
      kind: "unknown_error",
      message: message ?? title,
      label: title,
      source: "toast.success",
    });
    return useNotificationStore
      .getState()
      .addNotification({ type: "success", title, message, duration });
  },
  error: (title: string, message?: string) => {
    logBus.entry({
      kind: "error",
      message: message ?? title,
      label: title,
      source: "toast.error",
    });
    return useNotificationStore
      .getState()
      .addNotification({ type: "error", title, message });
  },
  warning: (title: string, message?: string) => {
    logBus.entry({
      kind: "unknown_error",
      message: message ?? title,
      label: title,
      source: "toast.warning",
    });
    return useNotificationStore
      .getState()
      .addNotification({ type: "warning", title, message });
  },
  info: (title: string, message?: string) => {
    logBus.entry({
      kind: "unknown_error",
      message: message ?? title,
      label: title,
      source: "toast.info",
    });
    return useNotificationStore
      .getState()
      .addNotification({ type: "info", title, message });
  },
};
