import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { LexicalEditor, TextNode } from "lexical";
import {
  $createRangeSelection,
  $getRoot,
  $setSelection,
} from "lexical";
import type {
  PromptReferenceDiagnostic,
  ReferenceTarget,
} from "@openreel/core";

import {
  MediaMentionEditor,
  type MediaMentionEditorProps,
  type MediaMentionOption,
} from "./MediaMentionEditor";
import { $isMentionNode } from "./MentionNode";

function option(
  id: string,
  overrides: Partial<MediaMentionOption> = {},
): MediaMentionOption {
  return {
    kind: "character",
    id,
    label: `Label ${id}`,
    description: `Description ${id}`,
    available: true,
    ...overrides,
  };
}

function diagnostic(
  overrides: Partial<PromptReferenceDiagnostic> = {},
): PromptReferenceDiagnostic {
  return {
    code: "unresolved",
    start: 0,
    end: 18,
    message: "Reference missing",
    blocking: true,
    ...overrides,
  };
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

interface LexicalRootElement extends HTMLElement {
  readonly __lexicalEditor?: LexicalEditor;
}

function getLexicalEditor(element: HTMLElement): LexicalEditor {
  const editor = (element as LexicalRootElement).__lexicalEditor;
  if (editor === undefined) {
    throw new Error("Expected a Lexical editor root");
  }
  return editor;
}

function getPlainTextNodeContaining(
  text: string,
  occurrence = 0,
): TextNode {
  const match = $getRoot()
    .getAllTextNodes()
    .filter(
      (node) =>
        !$isMentionNode(node) && node.getTextContent().includes(text),
    )[occurrence];

  if (match === undefined) {
    throw new Error(
      `No plain text node containing "${text}" at occurrence ${occurrence}`,
    );
  }

  return match;
}

async function setLexicalTextSelection(
  element: HTMLElement,
  startText: string,
  startOffset: number,
  endText = startText,
  endOffset = startOffset,
): Promise<void> {
  await act(async () => {
    getLexicalEditor(element).update(
      () => {
        const startNode = getPlainTextNodeContaining(startText);
        const endNode = getPlainTextNodeContaining(endText);
        const selection = $createRangeSelection();
        selection.anchor.set(startNode.getKey(), startOffset, "text");
        selection.focus.set(endNode.getKey(), endOffset, "text");
        $setSelection(selection);
      },
      { discrete: true },
    );
    await Promise.resolve();
  });
}

function collapseSelectionToEnd(element: HTMLElement): void {
  const selection = element.ownerDocument.getSelection();
  const range = element.ownerDocument.createRange();
  const lastTextNode = (node: Node | null): Text | null => {
    if (node === null) {
      return null;
    }
    if (node instanceof Text) {
      return node;
    }

    for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
      const match = lastTextNode(node.childNodes.item(index));
      if (match !== null) {
        return match;
      }
    }

    return null;
  };

  const textNode = lastTextNode(element);

  if (textNode instanceof Text) {
    range.setStart(textNode, textNode.textContent?.length ?? 0);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    element.ownerDocument.dispatchEvent(new Event("selectionchange"));
  }
}

async function focusEditor(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.focus();
    collapseSelectionToEnd(element);
    await Promise.resolve();
  });
}

async function pressKey(
  element: HTMLElement,
  key: string,
  options: KeyboardEventInit = {},
): Promise<void> {
  await act(async () => {
    fireEvent.keyDown(element, { key, ...options });
    if (key === "Backspace") {
      fireEvent(
        element,
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "deleteContentBackward",
        }),
      );
      fireEvent.input(element, { inputType: "deleteContentBackward" });
    }
    if (key === "Delete") {
      fireEvent(
        element,
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "deleteContentForward",
        }),
      );
      fireEvent.input(element, { inputType: "deleteContentForward" });
    }
    fireEvent.keyUp(element, { key, ...options });
    await Promise.resolve();
  });
}

async function typeText(element: HTMLElement, text: string): Promise<void> {
  for (const character of text) {
    await act(async () => {
      fireEvent(
        element,
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          data: character,
          inputType: "insertText",
        }),
      );
      fireEvent.input(element, {
        data: character,
        inputType: "insertText",
      });
      await Promise.resolve();
      collapseSelectionToEnd(element);
      await Promise.resolve();
    });
  }
}

function clipboardData(text: string) {
  return {
    getData: vi.fn((type: string) => (type === "text/plain" ? text : "")),
    setData: vi.fn(),
  };
}

async function renderEditor(
  props: Partial<MediaMentionEditorProps> = {},
) {
  const changeSpy = vi.fn();
  const openReferenceSpy = vi.fn();

  const onChange = props.onChange ?? changeSpy;
  const onOpenReference =
    props.onOpenReference ??
    (((target: ReferenceTarget, event) => {
      openReferenceSpy(target, event);
    }) satisfies MediaMentionEditorProps["onOpenReference"]);

  let rendered: ReturnType<typeof render> | null = null;

  await act(async () => {
    rendered = render(
      <MediaMentionEditor
        value={props.value ?? ""}
        options={props.options ?? [option("hero", { label: "Hero" })]}
        diagnostics={props.diagnostics ?? []}
        onChange={onChange}
        onOpenReference={onOpenReference}
      />,
    );
    await Promise.resolve();
  });

  await flushEffects();

  return {
    ...rendered!,
    onChange,
    onOpenReference,
    changeSpy,
    openReferenceSpy,
  };
}

const originalElementRect = HTMLElement.prototype.getBoundingClientRect;
const originalRangeRect = Range.prototype.getBoundingClientRect;
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
const originalClipboardEvent = globalThis.ClipboardEvent;

beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 24, 24);
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 24, 24);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  globalThis.ClipboardEvent = Event as unknown as typeof ClipboardEvent;
});

afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = originalElementRect;
  Range.prototype.getBoundingClientRect = originalRangeRect;
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  globalThis.ClipboardEvent = originalClipboardEvent;
});

describe("MediaMentionEditor", () => {
  it("renders a persistent aria-describedby hint instead of placeholder text", async () => {
    await renderEditor({
      value: "",
      options: [option("hero")],
    });

    const editor = screen.getByRole("combobox", { name: /prompt references/i });
    const hint = screen.getByText("Type @ to refer to other media");

    expect(editor).toHaveAttribute(
      "aria-describedby",
      expect.stringContaining(hint.id),
    );
    expect(editor).not.toHaveAttribute("placeholder");
  });

  it("filters @ suggestions and exposes combobox/listbox announcements before Enter selection", async () => {
    const { changeSpy } = await renderEditor({
      value: "",
      options: [
        option("hero", { label: "Hero", description: "Main character" }),
        option("helper", {
          label: "Helper",
          description: "Helpful support",
          available: false,
        }),
      ],
    });

    const editor = screen.getByRole("combobox", { name: /prompt references/i });
    await focusEditor(editor);
    await typeText(editor, "@h");

    await screen.findByRole("listbox", {
      name: /media mention suggestions/i,
    });
    const heroOption = screen.getByRole("option", { name: /hero/i });
    const helperOption = screen.getByRole("option", { name: /helper/i });

    expect(editor).toHaveAttribute("aria-autocomplete", "list");
    expect(editor).toHaveAttribute("aria-haspopup", "listbox");
    await waitFor(() => {
      expect(editor).toHaveAttribute("aria-expanded", "true");
    });
    expect(editor).toHaveAttribute("aria-controls", "typeahead-menu");
    expect(heroOption).toBeInTheDocument();
    expect(helperOption).toBeInTheDocument();
    expect(heroOption).toHaveAttribute("aria-selected", "true");
    expect(helperOption).toHaveAttribute("aria-disabled", "true");
    expect(editor).toHaveAttribute("aria-activedescendant", heroOption.id);
    expect(screen.getByText("2 results. 1 unavailable.")).toBeInTheDocument();
    expect(screen.getByText("Hero. 1 of 2.")).toBeInTheDocument();

    await pressKey(editor, "ArrowDown");
    expect(helperOption).toHaveAttribute("aria-selected", "true");
    expect(editor).toHaveAttribute("aria-activedescendant", helperOption.id);
    expect(screen.getByText("Helper unavailable. 2 of 2.")).toBeInTheDocument();

    await pressKey(editor, "ArrowUp");

    await pressKey(editor, "Enter");

    await waitFor(() => {
      expect(changeSpy).toHaveBeenLastCalledWith("@{character:hero} ");
    });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("supports arrow navigation, Escape to close the menu, and Tab to accept the active option", async () => {
    const { changeSpy, unmount } = await renderEditor({
      value: "",
      options: [
        option("hero", { label: "Hero" }),
        option("helper", { label: "Helper" }),
      ],
    });

    const editor = screen.getByRole("combobox", { name: /prompt references/i });
    await focusEditor(editor);

    await typeText(editor, "@h");
    await screen.findByRole("option", { name: /helper/i });

    await pressKey(editor, "ArrowDown");
    expect(screen.getByRole("option", { name: /helper/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await pressKey(editor, "ArrowUp");
    expect(screen.getByRole("option", { name: /hero/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await pressKey(editor, "Escape");
    await waitFor(() => {
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    unmount();

    await renderEditor({
      value: "",
      options: [
        option("hero", { label: "Hero" }),
        option("helper", { label: "Helper" }),
      ],
      onChange: changeSpy,
    });

    const reopenedEditor = screen.getByRole("combobox", {
      name: /prompt references/i,
    });
    await focusEditor(reopenedEditor);
    await typeText(reopenedEditor, "@h");
    await screen.findByRole("option", { name: /helper/i });

    await pressKey(reopenedEditor, "ArrowDown");
    await pressKey(reopenedEditor, "Tab");

    await waitFor(() => {
      expect(changeSpy).toHaveBeenLastCalledWith("@{character:helper} ");
    });
  });

  it("supports pointer selection without focus loss and opens the chosen mention target", async () => {
    const { changeSpy, openReferenceSpy } = await renderEditor({
      value: "",
      options: [option("hero", { label: "Hero" })],
    });

    const editor = screen.getByRole("combobox", { name: /prompt references/i });
    await focusEditor(editor);
    await typeText(editor, "@");

    const optionButton = await screen.findByRole("option", { name: /hero/i });

    await act(async () => {
      fireEvent.mouseDown(optionButton);
      fireEvent.click(optionButton);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(changeSpy).toHaveBeenLastCalledWith("@{character:hero} ");
    });
    expect(editor).toHaveFocus();

    const mention = await screen.findByRole("button", { name: /hero reference/i });

    await act(async () => {
      fireEvent.click(mention);
      await Promise.resolve();
    });

    expect(openReferenceSpy).toHaveBeenCalledWith(
      { kind: "character", id: "hero" },
      expect.objectContaining({ type: "click" }),
    );
  });

  it("reloads canonical serialization into pills and does not reset local open-menu selection on same-value rerender", async () => {
    const { rerender, onChange, onOpenReference } = await renderEditor({
      value: "",
      options: [option("hero", { label: "Hero" })],
    });

    const editor = screen.getByRole("combobox", { name: /prompt references/i });
    await focusEditor(editor);
    await typeText(editor, "@he");
    await screen.findByRole("listbox", {
      name: /media mention suggestions/i,
    });

    await act(async () => {
      rerender(
        <MediaMentionEditor
          value="@he"
          options={[option("hero", { label: "Hero" })]}
          diagnostics={[]}
          onChange={onChange}
          onOpenReference={onOpenReference}
        />,
      );
      await Promise.resolve();
    });

    await flushEffects();
    expect(editor).toHaveFocus();
    expect(
      await screen.findByRole("listbox", { name: /media mention suggestions/i }),
    ).toBeInTheDocument();

    await act(async () => {
      rerender(
        <MediaMentionEditor
          value="@{character:hero}"
          options={[option("hero", { label: "Hero" })]}
          diagnostics={[]}
          onChange={onChange}
          onOpenReference={onOpenReference}
        />,
      );
      await Promise.resolve();
    });

    await flushEffects();
    expect(await screen.findByRole("button", { name: /hero reference/i })).toBeInTheDocument();
  });

  it("shows unresolved references as invalid pills with their error announcement", async () => {
    await renderEditor({
      value: "@{character:hero} and @{media:missing}",
      options: [option("hero", { label: "Hero" })],
      diagnostics: [
        diagnostic({
          start: 22,
          end: 38,
          message: "Missing media reference",
        }),
      ],
    });

    const unresolved = await screen.findByRole("button", {
      name: /missing media reference/i,
    });

    expect(unresolved).toHaveAttribute("data-status", "unresolved");
    expect(await screen.findByRole("button", { name: /hero reference/i })).toBeInTheDocument();
  });

  it("copies canonical prompt text and pastes canonical tokens back into the editor", async () => {
    const { changeSpy } = await renderEditor({
      value: "alpha @{character:hero} omega",
      options: [option("hero", { label: "Hero" })],
    });

    const editor = screen.getByRole("combobox", { name: /prompt references/i });
    const copied = clipboardData("");

    await focusEditor(editor);
    await setLexicalTextSelection(editor, "alpha ", 2, " omega", 3);

    await act(async () => {
      fireEvent.copy(editor, { clipboardData: copied });
      await Promise.resolve();
    });

    expect(copied.setData).toHaveBeenCalledWith(
      "text/plain",
      "pha @{character:hero} om",
    );

    await setLexicalTextSelection(editor, "alpha ", 6, " omega", 0);

    const pastedReplacement = clipboardData("@{media:shot-1}");
    await act(async () => {
      fireEvent.paste(editor, { clipboardData: pastedReplacement });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(changeSpy).toHaveBeenLastCalledWith(
        "alpha @{media:shot-1} omega",
      );
    });
  });

  it("pastes canonical tokens at the actual middle caret instead of appending", async () => {
    const { changeSpy } = await renderEditor({
      value: "alpha omega",
      options: [option("hero", { label: "Hero" })],
    });

    const editor = screen.getByRole("combobox", { name: /prompt references/i });

    await focusEditor(editor);
    await setLexicalTextSelection(editor, "alpha omega", 6);

    const pasted = clipboardData("@{media:shot-1} ");
    await act(async () => {
      fireEvent.paste(editor, { clipboardData: pasted });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(changeSpy).toHaveBeenLastCalledWith(
        "alpha @{media:shot-1} omega",
      );
    });
  });

  it("does not delete a following mention when Backspace is immediately before it", async () => {
    const { changeSpy } = await renderEditor({
      value: "lead @{character:hero}",
      options: [option("hero", { label: "Hero" })],
    });

    const editor = screen.getByRole("combobox", { name: /prompt references/i });
    await focusEditor(editor);
    await setLexicalTextSelection(editor, "lead ", 5);

    await pressKey(editor, "Backspace");
    expect(screen.getByRole("button", { name: /hero reference/i })).toBeInTheDocument();
    expect(changeSpy).not.toHaveBeenCalledWith("lead ");
  });

  it("deletes a preceding mention atomically with Backspace and supports undo redo", async () => {
    const { changeSpy } = await renderEditor({
      value: "@{character:hero} tail",
      options: [option("hero", { label: "Hero" })],
    });

    const editor = screen.getByRole("combobox", { name: /prompt references/i });
    await focusEditor(editor);
    await setLexicalTextSelection(editor, " tail", 0);

    await pressKey(editor, "Backspace");
    await waitFor(() => {
      expect(changeSpy).toHaveBeenLastCalledWith(" tail");
    });

    await pressKey(editor, "z", { ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /hero reference/i })).toBeInTheDocument();
    });

    await pressKey(editor, "y", { ctrlKey: true });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /hero reference/i })).not.toBeInTheDocument();
    });
  });

  it("does not delete a preceding mention when Delete is immediately after it", async () => {
    const { changeSpy } = await renderEditor({
      value: "@{character:hero} tail",
      options: [option("hero", { label: "Hero" })],
    });

    const editor = screen.getByRole("combobox", { name: /prompt references/i });
    await focusEditor(editor);
    await setLexicalTextSelection(editor, " tail", 0);

    await pressKey(editor, "Delete");
    expect(screen.getByRole("button", { name: /hero reference/i })).toBeInTheDocument();
    expect(changeSpy).not.toHaveBeenCalledWith(" tail");
  });

  it("deletes a following mention atomically with Delete", async () => {
    const { changeSpy } = await renderEditor({
      value: "lead @{character:hero}",
      options: [option("hero", { label: "Hero" })],
    });

    const editor = screen.getByRole("combobox", { name: /prompt references/i });
    await focusEditor(editor);
    await setLexicalTextSelection(editor, "lead ", 5);

    await pressKey(editor, "Delete");
    await waitFor(() => {
      expect(changeSpy).toHaveBeenLastCalledWith("lead ");
    });
  });
});
