import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  PromptReferenceDiagnostic,
  ReferenceTarget,
} from "@openreel/core";

import {
  MediaMentionEditor,
  type MediaMentionEditorProps,
  type MediaMentionOption,
} from "./MediaMentionEditor";

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
    const { changeSpy, rerender, onChange, onOpenReference } = await renderEditor({
      value: "",
      options: [
        option("hero", { label: "Hero", description: "Main character" }),
        option("helper", { label: "Helper", description: "Helpful support" }),
        option("villain", { label: "Villain", description: "Antagonist" }),
      ],
    });

    const editor = screen.getByRole("combobox", { name: /prompt references/i });
    await focusEditor(editor);
    await act(async () => {
      rerender(
        <MediaMentionEditor
          value="@h"
          options={[
            option("hero", { label: "Hero", description: "Main character" }),
            option("helper", { label: "Helper", description: "Helpful support" }),
            option("villain", { label: "Villain", description: "Antagonist" }),
          ]}
          diagnostics={[]}
          onChange={onChange}
          onOpenReference={onOpenReference}
        />,
      );
      await Promise.resolve();
    });
    await flushEffects();

    await screen.findByRole("listbox", {
      name: /media mention suggestions/i,
    });

    expect(editor).toHaveAttribute("aria-autocomplete", "list");
    expect(editor).toHaveAttribute("aria-haspopup", "listbox");
    await waitFor(() => {
      expect(editor).toHaveAttribute("aria-expanded", "true");
    });
    expect(editor).toHaveAttribute("aria-controls", "typeahead-menu");
    expect(screen.getByRole("option", { name: /hero/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /helper/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /villain/i })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /hero/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );

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
      value: "@{character:hero}",
      options: [option("hero", { label: "Hero" })],
    });

    const editor = screen.getByRole("combobox", { name: /prompt references/i });
    const copied = clipboardData("");

    await act(async () => {
      fireEvent.copy(editor, { clipboardData: copied });
      await Promise.resolve();
    });

    expect(copied.setData).toHaveBeenCalledWith(
      "text/plain",
      "@{character:hero}",
    );

    const pasted = clipboardData("@{media:shot-1}");
    await act(async () => {
      fireEvent.paste(editor, { clipboardData: pasted });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(changeSpy).toHaveBeenLastCalledWith(
        "@{character:hero}@{media:shot-1}",
      );
    });
  });

  it("deletes a mention atomically with Backspace and supports undo redo", async () => {
    const { changeSpy } = await renderEditor({
      value: "@{character:hero}",
      options: [option("hero", { label: "Hero" })],
    });

    const editor = screen.getByRole("combobox", { name: /prompt references/i });
    await focusEditor(editor);

    await pressKey(editor, "Backspace");
    await waitFor(() => {
      expect(changeSpy).toHaveBeenLastCalledWith("");
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

  it("deletes a leading mention atomically with Delete", async () => {
    const { changeSpy } = await renderEditor({
      value: "@{character:hero}",
      options: [option("hero", { label: "Hero" })],
    });

    const editor = screen.getByRole("combobox", { name: /prompt references/i });
    await focusEditor(editor);

    await pressKey(editor, "Delete");
    await waitFor(() => {
      expect(changeSpy).toHaveBeenLastCalledWith("");
    });
  });
});
