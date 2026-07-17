import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";
import type { EditorState, LexicalNode } from "lexical";
import {
  $createParagraphNode,
  $getNodeByKey,
  $getSelection,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  COPY_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  PASTE_COMMAND,
} from "lexical";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { mergeRegister } from "@lexical/utils";
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

function buildCanonicalPromptNodes(
  value: string,
  options: readonly MediaMentionOption[],
  diagnostics: readonly PromptReferenceDiagnostic[],
): LexicalNode[] {
  const optionsByKey = new Map(
    options.map((option) => [optionKey(option.kind, option.id), option]),
  );
  const nodes: LexicalNode[] = [];
  let cursor = 0;

  for (const token of tokenizePromptReferences(value)) {
    if (token.start > cursor) {
      nodes.push($createTextNode(value.slice(cursor, token.start)));
    }

    if (token.kind === "legacy-character") {
      nodes.push($createTextNode(token.source));
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

    nodes.push(
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
    nodes.push($createTextNode(value.slice(cursor)));
  }

  return nodes;
}

function seedEditorFromCanonicalPrompt(
  value: string,
  options: readonly MediaMentionOption[],
  diagnostics: readonly PromptReferenceDiagnostic[],
): void {
  const root = $getRoot();
  root.clear();

  const paragraph = $createParagraphNode();
  for (const node of buildCanonicalPromptNodes(value, options, diagnostics)) {
    paragraph.append(node);
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

function firstLeafNode(node: LexicalNode | null): LexicalNode | null {
  if (node === null) {
    return null;
  }
  if ($isElementNode(node)) {
    return firstLeafNode(node.getFirstChild());
  }
  return node;
}

function lastLeafNode(node: LexicalNode | null): LexicalNode | null {
  if (node === null) {
    return null;
  }
  if ($isElementNode(node)) {
    return lastLeafNode(node.getLastChild());
  }
  return node;
}

function adjacentLeafNode(
  node: LexicalNode,
  direction: "backward" | "forward",
): LexicalNode | null {
  let current: LexicalNode | null = node;

  while (current !== null) {
    const sibling =
      direction === "backward"
        ? current.getPreviousSibling()
        : current.getNextSibling();

    if (sibling !== null) {
      return direction === "backward"
        ? lastLeafNode(sibling)
        : firstLeafNode(sibling);
    }

    current = current.getParent();
  }

  return null;
}

function selectTextBoundary(
  node: LexicalNode | null,
  direction: "backward" | "forward",
): void {
  if (node === null) {
    return;
  }

  if ($isTextNode(node)) {
    if (direction === "backward") {
      node.selectEnd();
      return;
    }
    node.select(0, 0);
    return;
  }

  if ($isElementNode(node)) {
    if (direction === "backward") {
      node.selectEnd();
      return;
    }
    node.selectStart();
  }
}

interface SelectionPointDescriptor {
  readonly key: string;
  readonly offset: number;
  readonly type: "text" | "element";
}

function getAdjacentMentionNodeAtPoint(
  point: SelectionPointDescriptor,
  direction: "backward" | "forward",
): MentionNode | null {
  const node = $getNodeByKey(point.key);
  if (node === null) {
    return null;
  }

  if (point.type === "text" && ($isTextNode(node) || $isMentionNode(node))) {
    if ($isMentionNode(node)) {
      if (direction === "backward" && point.offset === node.getTextContentSize()) {
        return node;
      }
      if (direction === "forward" && point.offset === 0) {
        return node;
      }
      return null;
    }

    if (direction === "backward") {
      if (point.offset !== 0) {
        return null;
      }
      const candidate = adjacentLeafNode(node, "backward");
      return $isMentionNode(candidate) ? candidate : null;
    }

    if (point.offset !== node.getTextContentSize()) {
      return null;
    }
    const candidate = adjacentLeafNode(node, "forward");
    return $isMentionNode(candidate) ? candidate : null;
  }

  if (point.type === "element" && $isElementNode(node)) {
    const candidate =
      direction === "backward"
        ? lastLeafNode(node.getChildAtIndex(point.offset - 1))
        : firstLeafNode(node.getChildAtIndex(point.offset));
    return $isMentionNode(candidate) ? candidate : null;
  }

  return null;
}

function removeAdjacentMention(
  point: SelectionPointDescriptor,
  direction: "backward" | "forward",
): boolean {
  const mentionNode = getAdjacentMentionNodeAtPoint(point, direction);
  if (mentionNode === null) {
    return false;
  }

  const previousNode = mentionNode.getPreviousSibling();
  const nextNode = mentionNode.getNextSibling();
  const parent = mentionNode.getParent();

  mentionNode.remove();
  if (previousNode !== null) {
    selectTextBoundary(previousNode, "backward");
  } else if (nextNode !== null) {
    selectTextBoundary(nextNode, "forward");
  } else {
    selectTextBoundary(parent, "forward");
  }

  return true;
}

function removeMentionAtCollapsedSelection(
  primaryDirection: "backward" | "forward",
): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
    return false;
  }

  const secondaryDirection =
    primaryDirection === "backward" ? "forward" : "backward";
  return (
    removeAdjacentMention(selection.anchor, primaryDirection) ||
    removeAdjacentMention(selection.anchor, secondaryDirection)
  );
}

interface CanonicalLeafSegment {
  readonly nodeKey: string;
  readonly canonicalText: string;
  readonly canonicalStart: number;
  readonly canonicalEnd: number;
}

interface CanonicalSelectionRange {
  readonly start: number;
  readonly end: number;
  readonly canonicalText: string;
}

function collectCanonicalLeafSegments(
  node: LexicalNode,
  segments: CanonicalLeafSegment[],
  canonicalCursor: number,
): number {
  if ($isMentionNode(node)) {
    const canonicalText = node.getCanonicalToken();
    segments.push({
      nodeKey: node.getKey(),
      canonicalText,
      canonicalStart: canonicalCursor,
      canonicalEnd: canonicalCursor + canonicalText.length,
    });
    return canonicalCursor + canonicalText.length;
  }

  if ($isLineBreakNode(node)) {
    segments.push({
      nodeKey: node.getKey(),
      canonicalText: "\n",
      canonicalStart: canonicalCursor,
      canonicalEnd: canonicalCursor + 1,
    });
    return canonicalCursor + 1;
  }

  if ($isTextNode(node)) {
    const canonicalText = node.getTextContent();
    segments.push({
      nodeKey: node.getKey(),
      canonicalText,
      canonicalStart: canonicalCursor,
      canonicalEnd: canonicalCursor + canonicalText.length,
    });
    return canonicalCursor + canonicalText.length;
  }

  if ($isElementNode(node)) {
    return node.getChildren().reduce(
      (cursor, child) => collectCanonicalLeafSegments(child, segments, cursor),
      canonicalCursor,
    );
  }

  return canonicalCursor;
}

function canonicalBoundaryForNode(
  node: LexicalNode | null,
  edge: "start" | "end",
  segments: readonly CanonicalLeafSegment[],
): number {
  if (node === null) {
    return edge === "start"
      ? 0
      : segments[segments.length - 1]?.canonicalEnd ?? 0;
  }

  if ($isElementNode(node)) {
    const child = edge === "start" ? node.getFirstChild() : node.getLastChild();
    return canonicalBoundaryForNode(child, edge, segments);
  }

  const segment = segments.find((entry) => entry.nodeKey === node.getKey());
  if (segment === undefined) {
    return edge === "start"
      ? 0
      : segments[segments.length - 1]?.canonicalEnd ?? 0;
  }

  return edge === "start" ? segment.canonicalStart : segment.canonicalEnd;
}

function canonicalIndexFromSelectionPoint(
  selectionPoint: SelectionPointDescriptor,
  segments: readonly CanonicalLeafSegment[],
): number {
  const node = $getNodeByKey(selectionPoint.key);
  if (node === null) {
    return 0;
  }

  if (selectionPoint.type === "text" && ($isTextNode(node) || $isMentionNode(node))) {
    const segment = segments.find((entry) => entry.nodeKey === node.getKey());
    if (segment === undefined) {
      return 0;
    }

    if ($isMentionNode(node)) {
      return selectionPoint.offset <= 0
        ? segment.canonicalStart
        : segment.canonicalEnd;
    }

    const offset = Math.max(
      0,
      Math.min(selectionPoint.offset, node.getTextContentSize()),
    );
    return segment.canonicalStart + offset;
  }

  if (selectionPoint.type === "element" && $isElementNode(node)) {
    const children = node.getChildren();
    if (children.length === 0) {
      return canonicalBoundaryForNode(node, "start", segments);
    }
    if (selectionPoint.offset <= 0) {
      return canonicalBoundaryForNode(children[0], "start", segments);
    }
    if (selectionPoint.offset >= children.length) {
      return canonicalBoundaryForNode(
        children[children.length - 1],
        "end",
        segments,
      );
    }
    return canonicalBoundaryForNode(children[selectionPoint.offset], "start", segments);
  }

  return 0;
}

function getCanonicalSelectionRangeFromPoints(
  anchorPoint: SelectionPointDescriptor,
  focusPoint: SelectionPointDescriptor,
): CanonicalSelectionRange | null {
  const segments: CanonicalLeafSegment[] = [];
  let cursor = 0;
  for (const child of $getRoot().getChildren()) {
    cursor = collectCanonicalLeafSegments(child, segments, cursor);
  }

  const start = canonicalIndexFromSelectionPoint(anchorPoint, segments);
  const end = canonicalIndexFromSelectionPoint(focusPoint, segments);
  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
    canonicalText: segments.map((segment) => segment.canonicalText).join(""),
  };
}

function exportCanonicalSelection(selection: ReturnType<typeof $getSelection>): string {
  if (!$isRangeSelection(selection) || selection.isCollapsed()) {
    return "";
  }

  const range = getCanonicalSelectionRangeFromPoints(
    selection.anchor,
    selection.focus,
  );
  if (range === null) {
    return "";
  }

  return range.canonicalText.slice(range.start, range.end);
}

interface CanonicalEditingPluginProps {
  readonly options: readonly MediaMentionOption[];
  readonly diagnostics: readonly PromptReferenceDiagnostic[];
}

function clipboardDataFromEvent(
  event: ClipboardEvent | InputEvent | KeyboardEvent | null,
): DataTransfer | null {
  if (event === null || !("clipboardData" in event)) {
    return null;
  }
  return event.clipboardData;
}

function CanonicalEditingPlugin({
  options,
  diagnostics,
}: CanonicalEditingPluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      mergeRegister(
        editor.registerCommand(
          COPY_COMMAND,
          (event) => {
            const clipboardData = clipboardDataFromEvent(event);
            const canonicalSelection = exportCanonicalSelection($getSelection());
            if (clipboardData === null || canonicalSelection.length === 0) {
              return false;
            }

            event?.preventDefault();
            clipboardData.setData("text/plain", canonicalSelection);
            return true;
          },
          COMMAND_PRIORITY_HIGH,
        ),
        editor.registerCommand(
          PASTE_COMMAND,
          (event) => {
            const clipboardData = clipboardDataFromEvent(event);
            const selection = $getSelection();
            if (clipboardData === null || !$isRangeSelection(selection)) {
              return false;
            }

            const canonicalText = clipboardData.getData("text/plain");
            if (canonicalText.length === 0) {
              return false;
            }

            event.preventDefault();
            selection.insertNodes(
              buildCanonicalPromptNodes(canonicalText, options, diagnostics),
            );
            return true;
          },
          COMMAND_PRIORITY_HIGH,
        ),
        editor.registerCommand(
          KEY_BACKSPACE_COMMAND,
          (event) => {
            const handled = removeMentionAtCollapsedSelection("backward");
            if (handled) {
              event?.preventDefault();
            }
            return handled;
          },
          COMMAND_PRIORITY_HIGH,
        ),
        editor.registerCommand(
          KEY_DELETE_COMMAND,
          (event) => {
            const handled = removeMentionAtCollapsedSelection("forward");
            if (handled) {
              event?.preventDefault();
            }
            return handled;
          },
          COMMAND_PRIORITY_HIGH,
        ),
      ),
    [diagnostics, editor, options],
  );

  return null;
}

export function MediaMentionEditor({
  value,
  options,
  diagnostics,
  onChange,
  onOpenReference,
}: MediaMentionEditorProps) {
  const helpId = useId();
  const menuAnnouncementId = useId();
  const activeAnnouncementId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnnouncement, setMenuAnnouncement] = useState("");
  const [activeOptionAnnouncement, setActiveOptionAnnouncement] = useState("");
  const [activeDescendantId, setActiveDescendantId] = useState<string | undefined>();
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
    [handleRedo, handleUndo, onOpenReference],
  );

  const handleMenuAnnouncementChange = useCallback((message: string) => {
    setMenuAnnouncement(message);
  }, []);

  const handleActiveOptionChange = useCallback(
    (state: { id?: string; message?: string }) => {
      setActiveDescendantId(state.id);
      setActiveOptionAnnouncement(state.message ?? "");
    },
    [],
  );

  return (
    <div className="space-y-2">
      <LexicalComposer initialConfig={initialConfig}>
        <div
          className="rounded-lg border border-border bg-background-elevated p-3"
          onClickCapture={handleEditorEventCapture}
          onKeyDown={handleEditorEventCapture}
        >
          <PlainTextPlugin
            contentEditable={
              <ContentEditable
                aria-activedescendant={activeDescendantId}
                aria-autocomplete="list"
                aria-describedby={`${helpId} ${menuAnnouncementId} ${activeAnnouncementId}`}
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
            onActiveOptionChange={handleActiveOptionChange}
            onMenuAnnouncementChange={handleMenuAnnouncementChange}
            onMenuOpenChange={setMenuOpen}
          />
          <CanonicalEditingPlugin
            options={options}
            diagnostics={diagnostics}
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
      <p id={menuAnnouncementId} className="sr-only" aria-live="polite">
        {menuAnnouncement}
      </p>
      <p id={activeAnnouncementId} className="sr-only" aria-live="polite">
        {activeOptionAnnouncement}
      </p>
    </div>
  );
}
