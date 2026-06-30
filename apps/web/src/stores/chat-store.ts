import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

export interface ChatMessagePart {
  type?: string;
  text?: unknown;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  parts: ChatMessagePart[];
  text?: string;
  createdAt: number;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface ToolApproval {
  id: string;
  toolName?: string;
  title?: string;
  label?: string;
  message?: string;
  reason?: string;
  args?: unknown;
  input?: unknown;
  result?: unknown;
  output?: unknown;
}

export interface ChatState {
  sessions: ChatSession[];
  activeSessionId: string | null;
  isStreaming: boolean;
  error: string | null;
  pendingToolApprovals: Map<string, ToolApproval>;
  setActiveSessionId: (sessionId: string | null) => void;
  newSession: () => void;
  deleteSession: (sessionId: string) => void;
  renameSession: (sessionId: string, title: string) => void;
  clearSession: () => void;
  sendMessage: (text: string) => void;
  abort: () => void;
  retry: () => void;
  approveTool: (approvalId: string) => void;
  rejectTool: (approvalId: string, reason: string) => void;
}

const createSession = (title = "Untitled session"): ChatSession => {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
};

const createUserMessage = (text: string): ChatMessage => ({
  id: crypto.randomUUID(),
  role: "user",
  parts: [{ type: "text", text }],
  text,
  createdAt: Date.now(),
});

const summarizeTitle = (text: string): string => {
  const compact = text.trim().replace(/\s+/g, " ");
  if (compact.length === 0) return "Untitled session";
  if (compact.length <= 48) return compact;
  return `${compact.slice(0, 45)}…`;
};

const upsertSession = (
  sessions: ChatSession[],
  sessionId: string,
  updater: (session: ChatSession) => ChatSession,
): ChatSession[] => sessions.map((session) => (session.id === sessionId ? updater(session) : session));

export const useChatStore = create<ChatState>()(
  subscribeWithSelector((set, get) => ({
    sessions: [],
    activeSessionId: null,
    isStreaming: false,
    error: null,
    pendingToolApprovals: new Map(),

    setActiveSessionId: (sessionId) => set({ activeSessionId: sessionId }),

    newSession: () => {
      const session = createSession();
      set((state) => ({
        sessions: [...state.sessions, session],
        activeSessionId: session.id,
        error: null,
      }));
    },

    deleteSession: (sessionId) => {
      const { sessions, activeSessionId } = get();
      const remaining = sessions.filter((session) => session.id !== sessionId);
      set({
        sessions: remaining,
        activeSessionId:
          activeSessionId === sessionId ? remaining[0]?.id ?? null : activeSessionId,
      });
    },

    renameSession: (sessionId, title) => {
      const nextTitle = title.trim() || "Untitled session";
      set((state) => ({
        sessions: upsertSession(state.sessions, sessionId, (session) => ({
          ...session,
          title: nextTitle,
          updatedAt: Date.now(),
        })),
      }));
    },

    clearSession: () => {
      const { sessions, activeSessionId } = get();
      const targetId = activeSessionId ?? sessions[0]?.id ?? null;
      if (!targetId) return;

      set((state) => ({
        sessions: upsertSession(state.sessions, targetId, (session) => ({
          ...session,
          title: "Untitled session",
          messages: [],
          updatedAt: Date.now(),
        })),
      }));
    },

    sendMessage: (text) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const { sessions, activeSessionId } = get();
      const targetId = activeSessionId ?? sessions[0]?.id ?? null;
      const now = Date.now();
      const userMessage = createUserMessage(trimmed);

      if (!targetId) {
        const session = createSession(summarizeTitle(trimmed));
        session.messages.push(userMessage);
        set({
          sessions: [session],
          activeSessionId: session.id,
          error: null,
          isStreaming: false,
        });
        return;
      }

      set((state) => ({
        sessions: upsertSession(state.sessions, targetId, (session) => ({
          ...session,
          title:
            session.title === "Untitled session"
              ? summarizeTitle(trimmed)
              : session.title,
          messages: [...session.messages, userMessage],
          updatedAt: now,
        })),
        activeSessionId: targetId,
        error: null,
        isStreaming: false,
      }));
    },

    abort: () => set({ isStreaming: false }),

    retry: () => set({ error: null, isStreaming: false }),

    approveTool: (approvalId) => {
      set((state) => {
        const next = new Map(state.pendingToolApprovals);
        next.delete(approvalId);
        return { pendingToolApprovals: next };
      });
    },

    rejectTool: (approvalId, _reason) => {
      set((state) => {
        const next = new Map(state.pendingToolApprovals);
        next.delete(approvalId);
        return { pendingToolApprovals: next };
      });
    },
  })),
);
