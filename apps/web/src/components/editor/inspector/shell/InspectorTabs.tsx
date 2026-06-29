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
  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(index + direction + tabs.length) % tabs.length];
    if (next) onSelect(next.id);
  };

  return (
    <div
      role="tablist"
      aria-label="Inspector tabs"
      className="flex items-center gap-0.5 px-2 border-b border-border overflow-x-auto scrollbar-none shrink-0"
    >
      {tabs.map((tab, index) => {
        const Icon = tab.icon;
        const active = tab.id === activeId;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-2 text-[12px] font-medium whitespace-nowrap transition-colors border-b-2 -mb-px",
              active
                ? "text-accent border-accent"
                : "text-fg-3 border-transparent hover:text-fg",
            )}
          >
            <Icon size={13} />
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
