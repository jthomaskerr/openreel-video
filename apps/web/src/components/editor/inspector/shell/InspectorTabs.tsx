import * as React from "react";
import { cn } from "@openreel/ui/lib/utils";
import type { InspectorTabDef, InspectorTabId } from "../clip-tabs.config";

export interface InspectorTabsProps {
  tabs: InspectorTabDef[];
  activeId: InspectorTabId;
  onSelect: (id: InspectorTabId) => void;
  badges?: Partial<Record<InspectorTabId, number>>;
}
export const InspectorTabs: React.FC<InspectorTabsProps> = ({ tabs, activeId, onSelect, badges }) => {
  const tabRefs = React.useRef(new Map<InspectorTabId, HTMLButtonElement>());

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (
      event.key !== "ArrowRight" &&
      event.key !== "ArrowLeft" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    const next = tabs[nextIndex];
    if (!next) return;
    onSelect(next.id);
    const nextElement = tabRefs.current.get(next.id);
    nextElement?.focus();
    nextElement?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  };

  return (
    <div
      role="tablist"
      aria-label="Inspector tabs"
      aria-orientation="horizontal"
      className="flex min-w-0 max-w-full shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border px-2 scrollbar-none"
    >
      {tabs.map((tab, index) => {
        const Icon = tab.icon;
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            ref={(element) => {
              if (element) tabRefs.current.set(tab.id, element);
              else tabRefs.current.delete(tab.id);
            }}
            id={`inspector-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`inspector-panel-${tab.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "-mb-px flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2.5 py-2 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary motion-reduce:transition-none",
              active
                ? "text-accent border-accent"
                : "text-fg-3 border-transparent hover:text-fg",
            )}
          >
            <Icon size={13} aria-hidden />
            <span>{tab.label}</span>
            {badges?.[tab.id] != null && badges[tab.id]! > 0 && (
              <span className="ml-0.5 text-[9px] bg-yellow-500/20 text-yellow-400 px-1 py-0.5 rounded-full leading-none font-medium">
                {badges[tab.id]}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
