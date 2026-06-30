import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MessageSquare,
  Plus,
  Send,
  Settings,
  Square,
  Trash2,
  User,
  X,
} from "lucide-react";
import {
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openreel/ui";
import { useSettingsStore } from "../../stores/settings-store";
import { useUIStore } from "../../stores/ui-store";
import { useChatStore } from "../../stores/chat-store";

interface MessagePartLike {
  type?: string;
  text?: unknown;
  content?: unknown;
  reasoning?: unknown;
  args?: unknown;
  input?: unknown;
  result?: unknown;
  output?: unknown;
  state?: string;
  toolName?: string;
  name?: string;
  label?: string;
  toolInvocation?: {
    toolName?: string;
    state?: string;
    args?: unknown;
    input?: unknown;
    result?: unknown;
    output?: unknown;
    errorText?: unknown;
  };
}

interface MessageLike {
  id: string;
  role?: string;
  parts?: MessagePartLike[];
  text?: unknown;
  content?: unknown;
  createdAt?: number;
}

interface SessionLike {
  id: string;
  title: string;
  messages: MessageLike[];
  createdAt: number;
  updatedAt: number;
}

interface ApprovalLike {
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

const SUGGESTIONS = [
  "Add a title over the first 3 seconds",
  "Fade out the music track at the end",
  "Export for YouTube at 1080p",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const stringify = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(stringify).filter(Boolean).join("");
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const formatTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });


const getPartText = (part: MessagePartLike): string => {
  return stringify(
    part.text ?? part.content ?? part.reasoning ?? part.result ?? part.output,
  ).trim();
};

const getToolName = (part: MessagePartLike): string => {
  const invocation = isRecord(part.toolInvocation) ? part.toolInvocation : null;
  return (
    stringify(
      part.toolName ?? part.name ?? part.label ?? invocation?.toolName,
    ).trim() || "Tool"
  );
};

const getToolState = (part: MessagePartLike): string | null => {
  const invocation = isRecord(part.toolInvocation) ? part.toolInvocation : null;
  const state = stringify(part.state ?? invocation?.state).trim();
  return state.length > 0 ? state : null;
};

const getToolArgs = (part: MessagePartLike): unknown => {
  const invocation = isRecord(part.toolInvocation) ? part.toolInvocation : null;
  return part.args ?? part.input ?? invocation?.args ?? invocation?.input;
};

const getToolResult = (part: MessagePartLike): unknown => {
  const invocation = isRecord(part.toolInvocation) ? part.toolInvocation : null;
  return part.result ?? part.output ?? invocation?.result ?? invocation?.output;
};

const isToolPart = (part: MessagePartLike): boolean => {
  const type = stringify(part.type).toLowerCase();
  return (
    type.includes("tool") ||
    Boolean(part.toolInvocation) ||
    part.args !== undefined ||
    part.input !== undefined ||
    part.result !== undefined ||
    part.output !== undefined
  );
};

const isReasoningPart = (part: MessagePartLike): boolean => {
  const type = stringify(part.type).toLowerCase();
  return type.includes("reason") || Boolean(part.reasoning);
};


export const ChatPanel: React.FC = () => {
  const [draft, setDraft] = useState("");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const sessions = useChatStore((state) => state.sessions as SessionLike[]);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const isStreaming = useChatStore((state) => state.isStreaming);
  const error = useChatStore((state) => state.error);
  const pendingToolApprovals = useChatStore((state) => state.pendingToolApprovals);
  const newSession = useChatStore((state) => state.newSession);
  const deleteSession = useChatStore((state) => state.deleteSession);
  const setActiveSessionId = useChatStore((state) => state.setActiveSessionId);
  const clearSession = useChatStore((state) => state.clearSession);
  const sendMessage = useChatStore((state) => state.sendMessage);
  const abort = useChatStore((state) => state.abort);
  const retry = useChatStore((state) => state.retry);
  const approveTool = useChatStore((state) => state.approveTool);
  const rejectTool = useChatStore((state) => state.rejectTool);

  const llmInstances = useSettingsStore((state) => state.llmInstances);
  const defaultLlmInstanceId = useSettingsStore((state) => state.defaultLlmInstanceId);
  const setDefaultLlmInstanceId = useSettingsStore(
    (state) => state.setDefaultLlmInstanceId,
  );
  const openSettings = useSettingsStore((state) => state.openSettings);
  const setPanelVisible = useUIStore((state) => state.setPanelVisible);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  const activeInstance = useMemo(
    () =>
      llmInstances.find((instance) => instance.id === defaultLlmInstanceId) ?? null,
    [llmInstances, defaultLlmInstanceId],
  );

  const approvalList = useMemo<ApprovalLike[]>(() => {
    if (pendingToolApprovals instanceof Map) {
      return Array.from(pendingToolApprovals.values()) as ApprovalLike[];
    }
    if (Array.isArray(pendingToolApprovals)) {
      return pendingToolApprovals as ApprovalLike[];
    }
    if (isRecord(pendingToolApprovals)) {
      return Object.values(pendingToolApprovals) as ApprovalLike[];
    }
    return [];
  }, [pendingToolApprovals]);

  const sendDraft = useCallback(() => {
    const text = draft.trim();
    if (!text || isStreaming || !activeInstance) return;
    void sendMessage(text);
    setDraft("");
    textareaRef.current?.focus();
  }, [draft, isStreaming, activeInstance, sendMessage]);

  const handleDraftKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        sendDraft();
      }
    },
    [sendDraft],
  );

  const handleNewSession = useCallback(() => {
    void newSession();
    setDraft("");
    textareaRef.current?.focus();
  }, [newSession]);

  const handleClearSession = useCallback(() => {
    void clearSession();
    setDraft("");
    textareaRef.current?.focus();
  }, [clearSession]);

  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      void deleteSession(sessionId);
      setDraft("");
    },
    [deleteSession],
  );

  const handlePromptSuggestion = useCallback((prompt: string) => {
    setDraft(prompt);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const handleSessionSelect = useCallback(
    (sessionId: string) => {
      setActiveSessionId(sessionId);
    },
    [setActiveSessionId],
  );

  const handleInstanceChange = useCallback(
    (instanceId: string) => {
      setDefaultLlmInstanceId(instanceId || null);
    },
    [setDefaultLlmInstanceId],
  );

  const handleRejectTool = useCallback(
    (approvalId: string) => {
      void rejectTool(approvalId, "Rejected from chat panel");
    },
    [rejectTool],
  );

  const renderMessagePart = useCallback((part: MessagePartLike, index: number) => {
    if (isReasoningPart(part)) {
      const text = getPartText(part);
      return (
        <details
          key={`reasoning-${index}`}
          className="rounded-md border border-border bg-background-tertiary/60 px-3 py-2 text-xs text-text-muted"
        >
          <summary className="cursor-pointer list-none font-medium text-text-secondary">
            Reasoning
          </summary>
          {text ? <pre className="mt-2 whitespace-pre-wrap">{text}</pre> : null}
        </details>
      );
    }

    if (isToolPart(part)) {
      const toolState = getToolState(part);
      const toolArgs = getToolArgs(part);
      const toolResult = getToolResult(part);
      const toolError = stringify(part.toolInvocation?.errorText).trim();

      return (
        <div
          key={`tool-${index}`}
          className="rounded-md border border-border bg-background-tertiary/70 px-3 py-2 text-xs"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium text-text-primary">{getToolName(part)}</p>
              {toolState && <p className="text-[10px] uppercase tracking-wider text-text-muted">{toolState}</p>}
            </div>
            {toolState === "running" || toolState === "streaming" ? (
              <Loader2 size={12} className="shrink-0 animate-spin text-text-muted" />
            ) : null}
          </div>
          {toolArgs ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-text-muted">
                Args
              </summary>
              <pre className="mt-1 whitespace-pre-wrap rounded bg-bg-1 px-2 py-1 text-[11px] text-text-secondary">
                {stringify(toolArgs)}
              </pre>
            </details>
          ) : null}
          {toolResult ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-[10px] uppercase tracking-wider text-text-muted">
                Result
              </summary>
              <pre className="mt-1 whitespace-pre-wrap rounded bg-bg-1 px-2 py-1 text-[11px] text-text-secondary">
                {stringify(toolResult)}
              </pre>
            </details>
          ) : null}
          {toolError ? (
            <p className="mt-2 text-[11px] text-status-error">{toolError}</p>
          ) : null}
        </div>
      );
    }

    const text = getPartText(part);
    if (text) {
      return (
        <p key={`text-${index}`} className="whitespace-pre-wrap text-sm leading-6 text-text-primary">
          {text}
        </p>
      );
    }

    return (
      <pre
        key={`fallback-${index}`}
        className="whitespace-pre-wrap rounded-md border border-border bg-background-tertiary/60 px-3 py-2 text-xs text-text-secondary"
      >
        {stringify(part)}
      </pre>
    );
  }, []);

  const renderMessage = useCallback(
    (message: MessageLike) => {
      const isUser = message.role === "user";
      const isTool = message.role === "tool";
      const parts = Array.isArray(message.parts) ? message.parts : [];
      const fallbackText = stringify(message.text ?? message.content).trim();

      return (
        <div key={message.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
          <div
            className={`w-full max-w-[92%] rounded-lg border px-3 py-2 shadow-sm ${
              isUser
                ? "border-primary/25 bg-primary/10"
                : isTool
                  ? "border-border bg-background-tertiary/60"
                  : "border-border bg-background-secondary"
            }`}
          >
            <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wider text-text-muted">
              {isUser ? <User size={10} /> : <Bot size={10} />}
              <span>{isUser ? "You" : isTool ? "Tool" : "Copilot"}</span>
              {message.createdAt ? <span>· {formatTime(message.createdAt)}</span> : null}
            </div>
            <div className="space-y-2">
              {parts.length > 0 ? parts.map(renderMessagePart) : null}
              {!parts.length && fallbackText ? (
                <p className="whitespace-pre-wrap text-sm leading-6 text-text-primary">{fallbackText}</p>
              ) : null}
              {!parts.length && !fallbackText ? (
                <p className="text-sm italic text-text-muted">No content</p>
              ) : null}
            </div>
          </div>
        </div>
      );
    },
    [renderMessagePart],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-1 text-fg">
      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <MessageSquare size={14} className="shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-text-primary">Chat</p>
              <p className="truncate text-[10px] text-text-muted">
                {activeSession ? activeSession.title.trim() || "Untitled session" : "No active session"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {llmInstances.length > 0 ? (
              <Select value={defaultLlmInstanceId ?? ""} onValueChange={handleInstanceChange}>
                <SelectTrigger className="h-8 w-[180px] bg-background-tertiary border-border text-[11px] text-text-primary">
                  <SelectValue placeholder="LLM instance" />
                </SelectTrigger>
                <SelectContent className="bg-background-secondary border-border">
                  {llmInstances.map((instance) => (
                    <SelectItem key={instance.id} value={instance.id}>
                      {instance.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <button
                type="button"
                onClick={() => openSettings("api-keys")}
                className="h-8 rounded-md border border-border px-3 text-[11px] text-text-muted transition-colors hover:bg-background-tertiary hover:text-text-primary"
              >
                No LLM instances
              </button>
            )}

            <button
              type="button"
              onClick={() => openSettings("api-keys")}
              className="grid h-8 w-8 place-items-center rounded-md border border-border text-text-muted transition-colors hover:bg-background-tertiary hover:text-text-primary"
              title="Open settings"
            >
              <Settings size={14} />
            </button>

            <button
              type="button"
              onClick={() => setPanelVisible("chat", false)}
              className="grid h-8 w-8 place-items-center rounded-md border border-border text-text-muted transition-colors hover:bg-background-tertiary hover:text-text-primary"
              title="Close chat"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside
          className={`flex h-full min-h-0 shrink-0 flex-col border-r border-border bg-background-secondary transition-[width] duration-150 ${
            isSidebarCollapsed ? "w-12" : "w-64"
          }`}
        >
          <div className="flex items-center justify-between gap-1 border-b border-border px-2 py-2">
            {!isSidebarCollapsed ? (
              <span className="text-[10px] uppercase tracking-wider text-text-muted">Sessions</span>
            ) : (
              <span className="text-[10px] uppercase tracking-wider text-text-muted">&nbsp;</span>
            )}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleNewSession}
                className="grid h-7 w-7 place-items-center rounded-md text-text-muted transition-colors hover:bg-background-tertiary hover:text-text-primary"
                title="New session"
              >
                <Plus size={12} />
              </button>
              <button
                type="button"
                onClick={handleClearSession}
                className="grid h-7 w-7 place-items-center rounded-md text-text-muted transition-colors hover:bg-background-tertiary hover:text-text-primary"
                title="Clear current session"
              >
                <Trash2 size={12} />
              </button>
              <button
                type="button"
                onClick={() => setIsSidebarCollapsed((value) => !value)}
                className="grid h-7 w-7 place-items-center rounded-md text-text-muted transition-colors hover:bg-background-tertiary hover:text-text-primary"
                title={isSidebarCollapsed ? "Expand sessions" : "Collapse sessions"}
              >
                {isSidebarCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
              </button>
            </div>
          </div>

          <ScrollArea className="flex-1 min-h-0">
            <div className="p-2">
              {sessions.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-2 py-6 text-center text-text-muted">
                  <MessageSquare size={18} className="opacity-40" />
                  {!isSidebarCollapsed ? (
                    <>
                      <p className="text-xs">No sessions yet</p>
                      <button
                        type="button"
                        onClick={handleNewSession}
                        className="rounded-md border border-dashed border-border px-2 py-1 text-[10px] transition-colors hover:border-primary hover:text-primary"
                      >
                        Start a chat
                      </button>
                    </>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-1">
                  {sessions.map((session, index) => {
                    const isActive = session.id === activeSessionId;
                    return (
                      <button
                        key={session.id}
                        type="button"
                        onClick={() => handleSessionSelect(session.id)}
                        className={`group flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left transition-colors ${
                          isActive
                            ? "border-primary/30 bg-primary/10 text-text-primary"
                            : "border-transparent hover:bg-background-tertiary"
                        }`}
                        title={session.title.trim() || "Untitled session"}
                      >
                        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-background-tertiary text-[11px] font-semibold text-text-primary">
                          {session.title.trim().slice(0, 1).toUpperCase() || String(index + 1)}
                        </div>
                        {!isSidebarCollapsed ? (
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-medium text-text-primary">
                                {session.title.trim() || "Untitled session"}
                              </span>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleDeleteSession(session.id);
                                }}
                                className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-text-muted opacity-0 transition-colors hover:bg-background-tertiary hover:text-text-primary group-hover:opacity-100"
                                title="Delete session"
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                            <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-text-muted">
                              <span>{session.messages.length} messages</span>
                              <span>{formatTime(session.updatedAt)}</span>
                            </div>
                          </div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </ScrollArea>
        </aside>


        <main className="flex min-w-0 min-h-0 flex-1 flex-col">
          {error ? (
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-100">
              <span className="min-w-0 truncate">{error}</span>
              <button
                type="button"
                onClick={() => {
                  void retry();
                }}
                className="rounded-md border border-red-500/30 px-2 py-1 font-medium text-red-50 transition-colors hover:bg-red-500/20"
              >
                Retry
              </button>
            </div>
          ) : null}

          <ScrollArea className="flex-1 min-h-0">
            <div className="space-y-3 p-3">
              {activeSession && activeSession.messages.length > 0 ? (
                activeSession.messages.map(renderMessage)
              ) : (
                <div className="flex min-h-[260px] flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border bg-background-tertiary/30 px-6 py-10 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-background-secondary text-text-muted">
                    <Bot size={18} />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-text-primary">Start a conversation</p>
                    <p className="max-w-sm text-xs text-text-muted">
                      Ask the copilot to edit the timeline, inspect the project, or export the video.
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2 pt-1">
                    {SUGGESTIONS.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => handlePromptSuggestion(suggestion)}
                        className="rounded-full border border-border bg-background-secondary px-3 py-1.5 text-xs text-text-secondary transition-colors hover:border-primary hover:text-text-primary"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          {approvalList.length > 0 ? (
            <div className="shrink-0 border-t border-border bg-background-secondary px-3 py-2">
              <div className="space-y-2">
                {approvalList.map((approval) => {
                  const payload = stringify(approval.args ?? approval.input ?? approval.result ?? approval.output).trim();
                  return (
                    <div
                      key={approval.id}
                      className="rounded-md border border-border bg-background-tertiary/70 px-3 py-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-text-primary">
                            {approval.toolName ?? approval.title ?? approval.label ?? "Tool approval"}
                          </p>
                          {approval.message || approval.reason ? (
                            <p className="mt-0.5 text-[10px] text-text-muted">
                              {approval.message ?? approval.reason}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              void approveTool(approval.id);
                            }}
                            className="rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary transition-colors hover:bg-primary/20"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRejectTool(approval.id)}
                            className="rounded-md border border-border px-2 py-1 text-[10px] font-medium text-text-muted transition-colors hover:bg-background-tertiary hover:text-text-primary"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                      {payload ? (
                        <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap rounded bg-bg-1 px-2 py-1 text-[10px] text-text-secondary">
                          {payload}
                        </pre>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="shrink-0 border-t border-border bg-background-secondary px-3 py-3">
            {!activeInstance ? (
              <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
                <span className="min-w-0 truncate">Configure an LLM instance in Settings to chat.</span>
                <button
                  type="button"
                  onClick={() => openSettings("api-keys")}
                  className="shrink-0 rounded-md border border-amber-500/30 px-2 py-1 font-medium text-amber-50 transition-colors hover:bg-amber-500/20"
                >
                  Open settings
                </button>
              </div>
            ) : null}

            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleDraftKeyDown}
                disabled={!activeInstance}
                rows={3}
                placeholder={
                  activeInstance
                    ? "Ask the copilot to edit the project…"
                    : "Add an LLM instance in Settings first"
                }
                className="min-h-[88px] flex-1 resize-none rounded-md border border-border bg-background-tertiary px-3 py-2 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-primary disabled:cursor-not-allowed disabled:opacity-60"
              />
              <button
                type="button"
                onClick={isStreaming ? () => void abort() : sendDraft}
                disabled={!activeInstance || (!isStreaming && draft.trim().length === 0)}
                className={`grid h-11 w-11 shrink-0 place-items-center rounded-md border transition-colors ${
                  isStreaming
                    ? "border-red-500/30 bg-red-500/10 text-red-100 hover:bg-red-500/20"
                    : "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 disabled:border-border disabled:bg-transparent disabled:text-text-muted"
                }`}
                title={isStreaming ? "Stop generating" : "Send message"}
              >
                {isStreaming ? <Square size={14} /> : <Send size={14} />}
              </button>
            </div>

            <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-text-muted">
              <span>
                {isStreaming ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 size={10} className="animate-spin" />
                    Streaming…
                  </span>
                ) : (
                  "Cmd/Ctrl+Enter to send"
                )}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleClearSession}
                  className="rounded-md border border-border px-2 py-1 font-medium text-text-muted transition-colors hover:bg-background-tertiary hover:text-text-primary"
                >
                  Clear
                </button>
                {error ? (
                  <button
                    type="button"
                    onClick={() => {
                      void retry();
                    }}
                    className="rounded-md border border-border px-2 py-1 font-medium text-text-muted transition-colors hover:bg-background-tertiary hover:text-text-primary"
                  >
                    Retry last
                  </button>
                ) : null}
                {isStreaming ? (
                  <button
                    type="button"
                    onClick={() => void abort()}
                    className="rounded-md border border-red-500/30 px-2 py-1 font-medium text-red-100 transition-colors hover:bg-red-500/20"
                  >
                    Stop
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

export default ChatPanel;
