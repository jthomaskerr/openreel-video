import ReactDOM from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { $createTextNode } from "lexical";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";

import { $createMentionNode } from "./MentionNode";
import type { MediaMentionOption } from "./MediaMentionEditor";

class MediaMentionMenuOption extends MenuOption {
  readonly option: MediaMentionOption;

  constructor(option: MediaMentionOption) {
    super(`${option.kind}:${option.id}`);
    this.option = option;
  }
}

export interface MentionTypeaheadPluginProps {
  readonly options: readonly MediaMentionOption[];
  readonly onActiveOptionChange?: (state: {
    readonly id?: string;
    readonly message?: string;
  }) => void;
  readonly onMenuAnnouncementChange?: (message: string) => void;
  readonly onMenuOpenChange?: (open: boolean) => void;
}

function normalized(text: string): string {
  return text.trim().toLowerCase();
}

function optionDomId(index: number): string {
  return `typeahead-item-${index}`;
}

function resultAnnouncement(
  resultCount: number,
  unavailableCount: number,
): string {
  return `${resultCount} ${resultCount === 1 ? "result" : "results"}. ${unavailableCount} unavailable.`;
}

function activeOptionAnnouncement(
  option: MediaMentionOption,
  index: number,
  total: number,
): string {
  return `${option.label}${option.available ? "" : " unavailable"}. ${index + 1} of ${total}.`;
}

function MenuAccessibilityBridge({
  onActiveOptionChange,
  options,
  selectedIndex,
}: {
  readonly onActiveOptionChange?: (state: {
    readonly id?: string;
    readonly message?: string;
  }) => void;
  readonly options: readonly MediaMentionMenuOption[];
  readonly selectedIndex: number | null;
}) {
  useEffect(() => {
    if (
      onActiveOptionChange === undefined ||
      selectedIndex === null ||
      selectedIndex < 0 ||
      selectedIndex >= options.length
    ) {
      onActiveOptionChange?.({});
      return;
    }

    const activeOption = options[selectedIndex];
    onActiveOptionChange({
      id: optionDomId(selectedIndex),
      message: activeOptionAnnouncement(
        activeOption.option,
        selectedIndex,
        options.length,
      ),
    });
  }, [onActiveOptionChange, options, selectedIndex]);

  return null;
}

export function MentionTypeaheadPlugin({
  options,
  onActiveOptionChange,
  onMenuAnnouncementChange,
  onMenuOpenChange,
}: MentionTypeaheadPluginProps) {
  const [query, setQuery] = useState<string | null>(null);
  const triggerFn = useBasicTypeaheadTriggerMatch("@", {
    minLength: 0,
  });

  const filteredOptions = useMemo(() => {
    if (query === null) {
      return [];
    }
    const search = normalized(query);
    return options.filter((option) => {
      if (search.length === 0) {
        return true;
      }
      return (
        normalized(option.label).includes(search) ||
        normalized(option.description).includes(search)
      );
    });
  }, [options, query]);

  const menuOptions = useMemo(
    () => filteredOptions.map((option) => new MediaMentionMenuOption(option)),
    [filteredOptions],
  );
  const unavailableCount = useMemo(
    () => filteredOptions.filter((option) => !option.available).length,
    [filteredOptions],
  );
  const menuOpen = query !== null && menuOptions.length > 0;

  useEffect(() => {
    onMenuOpenChange?.(menuOpen);
    onMenuAnnouncementChange?.(
      menuOpen ? resultAnnouncement(menuOptions.length, unavailableCount) : "",
    );
    if (!menuOpen) {
      onActiveOptionChange?.({});
    }
  }, [
    menuOpen,
    menuOptions.length,
    onActiveOptionChange,
    onMenuAnnouncementChange,
    onMenuOpenChange,
    unavailableCount,
  ]);

  return (
    <LexicalTypeaheadMenuPlugin<MediaMentionMenuOption>
      options={menuOptions}
      triggerFn={triggerFn}
      onQueryChange={setQuery}
      onSelectOption={(
        selectedOption,
        textNodeContainingQuery,
        closeMenu,
      ) => {
        if (!selectedOption.option.available) {
          return;
        }

        const mentionNode = $createMentionNode({
          kind: selectedOption.option.kind,
          id: selectedOption.option.id,
          label: selectedOption.option.label,
          description: selectedOption.option.description,
          canonicalToken:
            selectedOption.option.kind === "character"
              ? `@{character:${selectedOption.option.id}}`
              : `@{media:${selectedOption.option.id}}`,
          available: true,
          status: "active",
        });

        if (textNodeContainingQuery === null) {
          closeMenu();
          return;
        }

        const trailingSpace = $createTextNode(" ");
        textNodeContainingQuery.replace(mentionNode);
        mentionNode.insertAfter(trailingSpace);
        trailingSpace.selectEnd();

        closeMenu();
      }}
      menuRenderFn={(
        anchorElementRef,
        { options: renderedOptions, selectedIndex, selectOptionAndCleanUp, setHighlightedIndex },
      ) => {
        if (
          anchorElementRef.current === null ||
          renderedOptions.length === 0
        ) {
          return null;
        }

        return ReactDOM.createPortal(
          <div className="absolute left-0 top-full z-20 mt-2 w-72">
            <MenuAccessibilityBridge
              onActiveOptionChange={onActiveOptionChange}
              options={renderedOptions}
              selectedIndex={selectedIndex}
            />
            <ul
              role="listbox"
              aria-label="Media mention suggestions"
              className="max-h-64 overflow-y-auto rounded-lg border border-border bg-background-elevated p-1 shadow-lg"
            >
              {renderedOptions.map((option, index) => {
                const active = selectedIndex === index;
                return (
                  <li
                    id={optionDomId(index)}
                    key={option.key}
                    ref={option.setRefElement}
                    role="option"
                    aria-disabled={!option.option.available}
                    aria-selected={active}
                    className={[
                      "cursor-pointer rounded-md px-3 py-2 text-left",
                      active ? "bg-background-secondary" : "",
                      !option.option.available ? "opacity-50" : "",
                    ].join(" ")}
                    onMouseDown={(event) => {
                      event.preventDefault();
                    }}
                    onMouseEnter={() => {
                      setHighlightedIndex(index);
                    }}
                    onClick={() => {
                      setHighlightedIndex(index);
                      if (option.option.available) {
                        selectOptionAndCleanUp(option);
                      }
                    }}
                  >
                    <div className="text-sm font-medium text-text-primary">
                      {option.option.label}
                    </div>
                    <div className="text-xs text-text-muted">
                      {option.option.description}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>,
          anchorElementRef.current,
        );
      }}
    />
  );
}
