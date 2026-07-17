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
  readonly menuId: string;
  readonly onMenuOpenChange?: (open: boolean) => void;
}

function normalized(text: string): string {
  return text.trim().toLowerCase();
}

export function MentionTypeaheadPlugin({
  options,
  menuId,
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

  useEffect(() => {
    onMenuOpenChange?.(query !== null && menuOptions.length > 0);
  }, [menuOptions.length, onMenuOpenChange, query]);

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
            <ul
              id={menuId}
              role="listbox"
              aria-label="Media mention suggestions"
              className="max-h-64 overflow-y-auto rounded-lg border border-border bg-background-elevated p-1 shadow-lg"
            >
              {renderedOptions.map((option, index) => {
                const active = selectedIndex === index;
                return (
                  <li
                    id={`typeahead-item-${index}`}
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
