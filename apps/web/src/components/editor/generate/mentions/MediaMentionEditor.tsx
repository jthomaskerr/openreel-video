import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ClipboardEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";
import type { EditorState, LexicalNode } from "lexical";
import {
  $createParagraphNode,
  $getSelection,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
} from "lexical";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import type {
  PromptReferenceDiagnostic,
  ReferenceTarget,
} from "@openreel/core";

import {
  $createMentionNode,
  $isMentionNode,
  MentionNode,
  type MentionKind,
} from "./MentionNode";
import { MentionTypeaheadPlugin } from "./MentionTypeaheadPlugin";
import {
  canonicalCharacterToken,
  canonicalMediaToken,
  tokenizePromptReferences,
} from "../../../../features/generation/references/tokens";

export interface MediaMentionOption {
  readonly kind: "character" | "media";
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly thumbnailUrl?: string;
  readonly available: boolean;
}

export interface MediaMentionEditorProps {
  readonly value: string;
  readonly options: readonly MediaMentionOption[];
  readonly diagnostics: readonly PromptReferenceDiagnostic[];
  readonly onChange: (canonicalPrompt: string) => void;
  readonly onOpenReference: (
    target: ReferenceTarget,
    event: ReactMouseEvent | ReactKeyboardEvent,
  ) => void;
}

function optionKey(kind: MentionKind, id: string): string {
  return `${kind}:${id}`;
}

function overlapsDiagnostic(
  tokenStart: number,
  tokenEnd: number,
  diagnostic: PromptReferenceDiagnostic,
): boolean {
  return diagnostic.start < tokenEnd && diagnostic.end > tokenStart;
}

function fallbackLabel(id: string): string {
  return id;
}

function exportLexicalNode(node: LexicalNode): string {
  if ($isMentionNode(node)) {
    return node.getCanonicalToken();
  }
  if ($isLineBreakNode(node)) {
    return "\n";
  }
  if ($isTextNode(node)) {
    return node.getTextContent();
  }
  if ($isElementNode(node)) {
    return node.getChildren().map(exportLexicalNode).join("");
  }
  return "";
}

function exportCanonicalPrompt(editorState: EditorState): string {
  return editorState.read(() =>
    $getRoot()
      .getChildren()
      .map(exportLexicalNode)
      .join("\n"),
  );
}

function seedEditorFromCanonicalPrompt(
  value: string,
  options: readonly MediaMentionOption[],
  diagnostics: readonly PromptReferenceDiagnostic[],
): void {
  const optionsByKey = new Map(
    options.map((option) => [optionKey(option.kind, option.id), option]),
  );

  const root = $getRoot();
  root.clear();

  const paragraph = $createParagraphNode();
  let cursor = 0;

  for (const token of tokenizePromptReferences(value)) {
    if (token.start > cursor) {
      paragraph.append($createTextNode(value.slice(cursor, token.start)));
    }

    if (token.kind === "legacy-character") {
      paragraph.append($createTextNode(token.source));
      cursor = token.end;
      continue;
    }

    const option = optionsByKey.get(optionKey(token.kind, token.id));
    const blockingDiagnostic = diagnostics.find((entry) =>
      overlapsDiagnostic(token.start, token.end, entry),
    );
    const status = blockingDiagnostic
      ? "unresolved"
      : option?.available === false
        ? "unavailable"
        : option
          ? "active"
          : "unresolved";

    paragraph.append(
      $createMentionNode({
        kind: token.kind,
        id: token.id,
        label: option?.label ?? fallbackLabel(token.id),
        description: option?.description ?? blockingDiagnostic?.message ?? "",
        canonicalToken:
          token.kind === "character"
            ? canonicalCharacterToken(token.id)
            : canonicalMediaToken(token.id),
        available: option?.available ?? false,
        status,
        message:
          blockingDiagnostic?.message ??
          (status === "unavailable"
            ? `${option?.label ?? token.id} is unavailable`
            : undefined),
      }),
    );

    cursor = token.end;
  }

  if (cursor < value.length) {
    paragraph.append($createTextNode(value.slice(cursor)));
  }

  root.append(paragraph);
  paragraph.selectEnd();
}

function documentSignature(
  value: string,
  options: readonly MediaMentionOption[],
  diagnostics: readonly PromptReferenceDiagnostic[],
): string {
  return JSON.stringify({
    value,
    options: options.map((option) => [
      option.kind,
      option.id,
      option.label,
      option.description,
      option.available,
    ]),
    diagnostics: diagnostics.map((diagnostic) => [
      diagnostic.code,
      diagnostic.start,
      diagnostic.end,
      diagnostic.message,
      diagnostic.blocking,
    ]),
  });
}

function targetFromElement(element: HTMLElement): ReferenceTarget {
  const token = element.dataset.mentionToken ?? "";
  const status = element.dataset.status;
  const kind = element.dataset.mentionKind;
  const id = element.dataset.mentionId ?? "";

  if (status && status !== "active") {
    return { kind: "missing", token };
  }
  if (kind === "character") {
    return { kind: "character", id };
  }
  return { kind: "imported-image", mediaId: id };
}

function PlainTextErrorBoundary({
  children,
}: {
  readonly children?: ReactNode;
}) {
  return <>{children ?? null}</>;
}

interface EditorBridgeProps {
  readonly value: string;
  readonly options: readonly MediaMentionOption[];
  readonly diagnostics: readonly PromptReferenceDiagnostic[];
  readonly onChange: (canonicalPrompt: string) => void;
}

function EditorBridge({
  value,
  options,
  diagnostics,
  onChange,
}: EditorBridgeProps) {
  const signature = documentSignature(value, options, diagnostics);
  const appliedSignatureRef = useRef<string | null>(null);

  const syncEditor = useCallback(() => {
    seedEditorFromCanonicalPrompt(value, options, diagnostics);
    appliedSignatureRef.current = signature;
  }, [diagnostics, options, signature, value]);

  return (
    <>
      <OnChangePlugin
        onChange={(editorState) => {
          const nextValue = exportCanonicalPrompt(editorState);
          appliedSignatureRef.current = documentSignature(
            nextValue,
            options,
            diagnostics,
          );
          if (nextValue !== value) {
            onChange(nextValue);
          }
        }}
      />
      <LexicalSyncPlugin
        signature={signature}
        appliedSignatureRef={appliedSignatureRef}
        syncEditor={syncEditor}
      />
    </>
  );
}

interface LexicalSyncPluginProps {
  readonly signature: string;
  readonly appliedSignatureRef: React.MutableRefObject<string | null>;
  readonly syncEditor: () => void;
}

function LexicalSyncPlugin({
  signature,
  appliedSignatureRef,
  syncEditor,
}: LexicalSyncPluginProps) {
  const [editor] = useLexicalComposerContext();
  const hasSyncedInitialRef = useRef(false);

  useEffect(() => {
    if (!hasSyncedInitialRef.current || appliedSignatureRef.current !== signature) {
      editor.update(syncEditor);
      hasSyncedInitialRef.current = true;
    }
  }, [appliedSignatureRef, editor, signature, syncEditor]);

  return null;
}

function SelectionGuardPlugin({
  selectionKey,
}: {
  readonly selectionKey: string;
}) {
  const [editor] = useLexicalComposerContext();

  const restoreCollapsedTextSelection = useCallback(() => {
    const rootElement = editor.getRootElement();
    if (rootElement === null || rootElement.ownerDocument.activeElement !== rootElement) {
      return;
    }

    editor.update(() => {
      const selection = $getSelection();
      if (
        $isRangeSelection(selection) &&
        selection.isCollapsed() &&
        selection.anchor.type === "text"
      ) {
        return;
      }

      $getRoot().selectEnd();
    });
  }, [editor]);

  useEffect(() => {
    const rootElement = editor.getRootElement();
    if (rootElement === null) {
      return;
    }

    const handleFocus = () => {
      queueMicrotask(restoreCollapsedTextSelection);
    };

    rootElement.addEventListener("focus", handleFocus);
    return () => {
      rootElement.removeEventListener("focus", handleFocus);
    };
  }, [editor, restoreCollapsedTextSelection]);

  useEffect(() => {
    queueMicrotask(restoreCollapsedTextSelection);
  }, [restoreCollapsedTextSelection, selectionKey]);

  return null;
}

function removeEdgeMentionToken(
  prompt: string,
  direction: "backward" | "forward",
): string | null {
  const tokens = tokenizePromptReferences(prompt).filter(
    (token): token is Extract<
      ReturnType<typeof tokenizePromptReferences>[number],
      { kind: "character" | "media" }
    > => token.kind === "character" || token.kind === "media",
  );

  if (tokens.length === 0) {
    return null;
  }

  const token = direction === "backward" ? tokens[tokens.length - 1] : tokens[0];
  const before = prompt.slice(0, token.start);
  const after = prompt.slice(token.end);

  if (
    (direction === "backward" && after.trim().length > 0) ||
    (direction === "forward" && before.trim().length > 0)
  ) {
    return null;
  }

  return `${before}${after}`.replace(/^\s+/, "").replace(/\s{2,}/g, " ");
}

export function MediaMentionEditor({
  value,
  options,
  diagnostics,
  onChange,
  onOpenReference,
}: MediaMentionEditorProps) {
  const helpId = useId();
  const menuId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [displayValue, setDisplayValue] = useState(value);
  const localValueRef = useRef(value);
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);

  useEffect(() => {
    if (value !== localValueRef.current) {
      localValueRef.current = value;
      setDisplayValue(value);
      undoStackRef.current = [];
      redoStackRef.current = [];
    }
  }, [value]);

  const initialConfig = useMemo(
    () => ({
      namespace: "openreel-media-mention-editor",
      onError(error: Error) {
        throw error;
      },
      nodes: [MentionNode],
    }),
    [],
  );

  const applyNextValue = useCallback(
    (nextValue: string) => {
      if (nextValue === localValueRef.current) {
        return;
      }
      undoStackRef.current.push(localValueRef.current);
      redoStackRef.current = [];
      localValueRef.current = nextValue;
      setDisplayValue(nextValue);
      onChange(nextValue);
    },
    [onChange],
  );

  const handleCanonicalChange = useCallback(
    (nextValue: string) => {
      applyNextValue(nextValue);
    },
    [applyNextValue],
  );

  const handleUndo = useCallback(() => {
    const previous = undoStackRef.current.pop();
    if (previous === undefined) {
      return;
    }
    redoStackRef.current.push(localValueRef.current);
    localValueRef.current = previous;
    setDisplayValue(previous);
    onChange(previous);
  }, [onChange]);

  const handleRedo = useCallback(() => {
    const nextValue = redoStackRef.current.pop();
    if (nextValue === undefined) {
      return;
    }
    undoStackRef.current.push(localValueRef.current);
    localValueRef.current = nextValue;
    setDisplayValue(nextValue);
    onChange(nextValue);
  }, [onChange]);

  const handleClipboardCapture = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      if (event.type === "copy") {
        event.preventDefault();
        event.clipboardData.setData("text/plain", localValueRef.current);
        return;
      }

      const pastedText = event.clipboardData.getData("text/plain");
      if (!pastedText) {
        return;
      }

      event.preventDefault();
      applyNextValue(`${localValueRef.current}${pastedText}`);
    },
    [applyNextValue],
  );

  const handleEditorEventCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement> | ReactKeyboardEvent<HTMLDivElement>) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      if ("key" in event) {
        const shortcutKey = event.metaKey || event.ctrlKey;
        const lowerKey = event.key.toLowerCase();

        if (shortcutKey && lowerKey === "z") {
          event.preventDefault();
          handleUndo();
          return;
        }
        if (shortcutKey && lowerKey === "y") {
          event.preventDefault();
          handleRedo();
          return;
        }
        if (lowerKey === "backspace" || lowerKey === "delete") {
          const direction = lowerKey === "backspace" ? "backward" : "forward";
          const nextValue = removeEdgeMentionToken(localValueRef.current, direction);
          if (nextValue !== null) {
            event.preventDefault();
            applyNextValue(nextValue);
            return;
          }
        }
      }

      const mentionElement = target.closest(
        "[data-mention-node='true']",
      ) as HTMLElement | null;
      if (mentionElement === null) {
        return;
      }

      if (
        "key" in event &&
        event.key !== "Enter" &&
        event.key !== " "
      ) {
        return;
      }

      event.preventDefault();
      onOpenReference(targetFromElement(mentionElement), event);
    },
    [applyNextValue, handleRedo, handleUndo, onOpenReference],
  );

  return (
    <div className="space-y-2">
      <LexicalComposer initialConfig={initialConfig}>
        <div
          className="rounded-lg border border-border bg-background-elevated p-3"
          onClickCapture={handleEditorEventCapture}
          onCopyCapture={handleClipboardCapture}
          onKeyDownCapture={handleEditorEventCapture}
          onPasteCapture={handleClipboardCapture}
        >
          <PlainTextPlugin
            contentEditable={
              <ContentEditable
                aria-autocomplete="list"
                aria-controls={menuId}
                aria-describedby={helpId}
                aria-expanded={menuOpen}
                aria-haspopup="listbox"
                aria-label="Prompt references"
                className="min-h-[72px] outline-none text-sm text-text-primary"
                role="combobox"
              />
            }
            placeholder={null}
            ErrorBoundary={PlainTextErrorBoundary}
          />
          <HistoryPlugin />
          <MentionTypeaheadPlugin
            options={options}
            menuId={menuId}
            onMenuOpenChange={setMenuOpen}
          />
          <SelectionGuardPlugin selectionKey={displayValue} />
          <EditorBridge
            value={displayValue}
            options={options}
            diagnostics={diagnostics}
            onChange={handleCanonicalChange}
          />
        </div>
      </LexicalComposer>
      <p id={helpId} className="text-xs text-text-muted">
        Type @ to refer to other media
      </p>
    </div>
  );
}
