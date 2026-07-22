import { useEffect, useRef } from "react";
import { Clock3 } from "lucide-react";
import type { ResolveProjectListItem } from "../../../services/resolve-bridge-client";

export interface ProjectListProps {
  readonly projects: readonly ResolveProjectListItem[];
  readonly selectedId: string | null;
  readonly onSelect: (projectId: string) => void;
  readonly emptyMessage: string;
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function ProjectList({
  projects,
  selectedId,
  onSelect,
  emptyMessage,
}: ProjectListProps) {
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const typeahead = useRef("");
  const typeaheadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current);
    },
    [],
  );

  if (projects.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  const moveSelection = (currentIndex: number, nextIndex: number) => {
    const next = projects[nextIndex];
    if (!next || nextIndex === currentIndex) return;
    onSelect(next.id);
    optionRefs.current.get(next.id)?.focus();
  };

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = Math.min(currentIndex + 1, projects.length - 1);
    if (event.key === "ArrowUp") nextIndex = Math.max(currentIndex - 1, 0);
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = projects.length - 1;

    if (nextIndex !== null) {
      event.preventDefault();
      moveSelection(currentIndex, nextIndex);
      return;
    }

    if (event.key.length !== 1 || event.altKey || event.ctrlKey || event.metaKey) return;
    typeahead.current += event.key.toLocaleLowerCase();
    if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current);
    typeaheadTimer.current = setTimeout(() => {
      typeahead.current = "";
    }, 500);
    const offsetProjects = [...projects.slice(currentIndex + 1), ...projects.slice(0, currentIndex + 1)];
    const match = offsetProjects.find((project) =>
      project.name.toLocaleLowerCase().startsWith(typeahead.current),
    );
    if (!match) return;
    event.preventDefault();
    const matchIndex = projects.findIndex((project) => project.id === match.id);
    moveSelection(currentIndex, matchIndex);
  };

  return (
    <div role="listbox" aria-label="OpenReel projects" className="space-y-1 p-2">
      {projects.map((project, index) => {
        const selected = project.id === selectedId;
        return (
          <button
            key={project.id}
            ref={(node) => {
              if (node) optionRefs.current.set(project.id, node);
              else optionRefs.current.delete(project.id);
            }}
            type="button"
            role="option"
            aria-selected={selected}
            tabIndex={selected || (!selectedId && index === 0) ? 0 : -1}
            onClick={() => onSelect(project.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-md border border-transparent px-3 py-2 text-left transition-colors duration-200 hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-selected:border-border aria-selected:bg-accent aria-selected:text-accent-foreground motion-reduce:transition-none"
          >
            <span
              aria-hidden="true"
              className="flex h-10 w-14 shrink-0 items-center justify-center rounded border bg-muted text-xs font-medium text-muted-foreground"
            >
              {project.name.slice(0, 2).toLocaleUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{project.name}</span>
              <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <Clock3 aria-hidden="true" className="h-3.5 w-3.5" />
                Last edited {dateTimeFormatter.format(project.modifiedAt)}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
