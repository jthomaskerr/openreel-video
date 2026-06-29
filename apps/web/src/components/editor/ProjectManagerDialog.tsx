import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  FolderOpen,
  Pencil,
  Trash2,
  Download,
  FileVideo,
  Square,
  SquareCheck,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Button,
  Input,
  ScrollArea,
} from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { useRouter } from "../../hooks/use-router";
import { autoSaveManager } from "../../services/auto-save";
import { projectManager, type RecentProject } from "../../services/project-manager";
import { useUIStore } from "../../stores/ui-store";

interface ManagedProject {
  id: string;
  name: string;
  lastModified: number;
  source: "autosave" | "recent";
  saveId?: string; // for autosave recovery
  fileHandle?: FileSystemFileHandle;
  duration?: number;
  trackCount?: number;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const ProjectManagerDialog: React.FC = () => {
  const { navigate } = useRouter();
  const {
    project: currentProject,
    createNewProject,
    recoverFromAutoSave,
    renameProject,
    saveProjectAsDialog,
    deleteCurrentProject,
    loadProject,
  } = useProjectStore();
  const projectManagerOpen = useUIStore((s) => s.projectManagerOpen ?? false);
  const setProjectManagerOpen = useUIStore((s) => s.setProjectManagerOpen);

  const [projects, setProjects] = useState<ManagedProject[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Load projects on open
  useEffect(() => {
    if (!projectManagerOpen) return;
    const load = async () => {
      const map = new Map<string, ManagedProject>();

      // Auto-save projects
      try {
        await autoSaveManager.initialize();
        const saves = await autoSaveManager.checkForRecovery();
        for (const save of saves) {
          const existing = map.get(save.projectId);
          if (!existing || save.timestamp > existing.lastModified) {
            map.set(save.projectId, {
              id: save.projectId,
              name: save.projectName,
              lastModified: save.timestamp,
              source: "autosave",
              saveId: save.id,
            });
          }
        }
      } catch {
        // silently ignore
      }

      // Recent projects from file handles
      try {
        const recent = await projectManager.getRecentProjects();
        for (const r of recent) {
          const existing = map.get(r.id);
          if (!existing || r.lastOpened > existing.lastModified) {
            map.set(r.id, {
              id: r.id,
              name: r.name,
              lastModified: r.lastOpened,
              source: "recent",
              fileHandle: r.fileHandle,
              duration: r.duration,
              trackCount: r.trackCount,
            });
          }
        }
      } catch {
        // silently ignore
      }

      setProjects(
        Array.from(map.values()).sort((a, b) => b.lastModified - a.lastModified),
      );
    };
    load();
  }, [projectManagerOpen]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === projects.length) return new Set<string>();
      return new Set(projects.map((p) => p.id));
    });
  }, [projects]);

  const allSelected = projects.length > 0 && selectedIds.size === projects.length;

  const handleOpen = useCallback(
    async (p: ManagedProject) => {
      setIsLoading(true);
      try {
        if (p.saveId) {
          await recoverFromAutoSave(p.saveId);
        } else if (p.fileHandle) {
          const recent: RecentProject = {
            id: p.id,
            name: p.name,
            lastOpened: Date.now(),
            fileHandle: p.fileHandle,
          };
          const opened = await projectManager.openRecentProject(recent);
          if (opened) loadProject(opened);
        }
        setProjectManagerOpen?.(false);
      } catch (err) {
        console.error("[ProjectManager] Failed to open project:", err);
      } finally {
        setIsLoading(false);
      }
    },
    [recoverFromAutoSave, loadProject, setProjectManagerOpen],
  );

  const handleRenameStart = useCallback((p: ManagedProject) => {
    setEditingId(p.id);
    setEditName(p.name);
  }, []);

  const handleRenameCommit = useCallback(
    async (p: ManagedProject) => {
      const trimmed = editName.trim();
      if (trimmed && trimmed !== p.name) {
        // For the current project, use the store rename
        if (p.id === currentProject.id) {
          await renameProject(trimmed);
        }
        // Reflect locally — note: IndexedDB rename for non-current projects
        // isn't implemented; this is a local-only rename for autosave records.
        setProjects((prev) =>
          prev.map((proj) =>
            proj.id === p.id ? { ...proj, name: trimmed } : proj,
          ),
        );
      }
      setEditingId(null);
    },
    [editName, currentProject.id, renameProject],
  );

  const handleDelete = useCallback(
    async (p: ManagedProject) => {
      if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
      if (p.id === currentProject.id) {
        await deleteCurrentProject();
        navigate("welcome");
      } else {
        await projectManager.deleteProject(p.id);
        await autoSaveManager.clearProjectSaves(p.id);
      }
      setProjects((prev) => prev.filter((proj) => proj.id !== p.id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(p.id);
        return next;
      });
    },
    [currentProject.id, deleteCurrentProject, navigate],
  );

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} project(s)? This cannot be undone.`)) return;

    const deletingCurrent = selectedIds.has(currentProject.id);
    for (const id of selectedIds) {
      await projectManager.deleteProject(id);
      await autoSaveManager.clearProjectSaves(id);
    }
    if (deletingCurrent) {
      await deleteCurrentProject();
      navigate("welcome");
    }
    setProjects((prev) => prev.filter((p) => !selectedIds.has(p.id)));
    setSelectedIds(new Set());
  }, [selectedIds, currentProject.id, deleteCurrentProject, navigate]);

  const handleExport = useCallback(
    async (p: ManagedProject) => {
      if (p.id === currentProject.id) {
        await saveProjectAsDialog();
      }
      // For non-current projects, we'd need to load them first
    },
    [currentProject.id, saveProjectAsDialog],
  );

  const subtitle = useMemo(() => {
    if (selectedIds.size > 0) return `${selectedIds.size} selected`;
    return `${projects.length} project${projects.length !== 1 ? "s" : ""}`;
  }, [projects.length, selectedIds.size]);

  return (
    <Dialog open={projectManagerOpen} onOpenChange={(open) => !open && setProjectManagerOpen?.(false)}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] bg-background flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 border-b border-border shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileVideo size={18} className="text-primary" />
            Project Manager
          </DialogTitle>
        </DialogHeader>

        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 px-4 py-2 bg-accent/5 border-b border-border shrink-0">
            <span className="text-sm text-text-secondary flex-1">
              {selectedIds.size} selected
            </span>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleBulkDelete}
              className="h-8 text-xs gap-1.5"
            >
              <Trash2 size={13} />
              Delete Selected
            </Button>
          </div>
        )}

        {/* Select all header */}
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border shrink-0 bg-background-secondary">
          <button
            onClick={toggleSelectAll}
            className="p-0.5 rounded hover:bg-background-tertiary transition-colors"
            title={allSelected ? "Deselect all" : "Select all"}
          >
            {allSelected ? (
              <SquareCheck size={16} className="text-primary" />
            ) : (
              <Square size={16} className="text-text-muted" />
            )}
          </button>
          <span className="text-xs text-text-muted flex-1">{subtitle}</span>
        </div>

        {/* Project list */}
        <ScrollArea className="flex-1">
          {projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-text-muted gap-2">
              <FileVideo size={32} className="opacity-30" />
              <p className="text-sm">No saved projects</p>
              <p className="text-xs">Create a new project to get started</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {projects.map((p) => {
                const isCurrent = p.id === currentProject.id;
                const isEditing = editingId === p.id;
                const isSelected = selectedIds.has(p.id);

                return (
                  <div
                    key={p.id}
                    className={`flex items-center gap-3 px-4 py-3 hover:bg-background-secondary transition-colors group ${
                      isCurrent ? "bg-primary/5" : ""
                    } ${isSelected ? "bg-accent/5" : ""}`}
                  >
                    {/* Checkbox */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelect(p.id);
                      }}
                      className="p-0.5 rounded hover:bg-background-tertiary transition-colors shrink-0"
                    >
                      {isSelected ? (
                        <SquareCheck size={16} className="text-primary" />
                      ) : (
                        <Square size={16} className="text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </button>

                    {/* Project info — clickable to open */}
                    <button
                      onClick={() => handleOpen(p)}
                      disabled={isLoading}
                      className="flex-1 min-w-0 text-left flex items-center gap-3 disabled:opacity-50"
                    >
                      <div className="p-1.5 bg-background-tertiary rounded-md shrink-0">
                        <FolderOpen size={16} className="text-text-muted" />
                      </div>
                      <div className="min-w-0">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <Input
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleRenameCommit(p);
                                if (e.key === "Escape") setEditingId(null);
                              }}
                              onBlur={() => handleRenameCommit(p)}
                              autoFocus
                              className="h-7 text-sm"
                            />
                          </div>
                        ) : (
                          <>
                            <div className="text-sm font-medium text-text-primary truncate flex items-center gap-1.5">
                              {p.name}
                              {isCurrent && (
                                <span className="text-[9px] px-1 py-0.5 rounded bg-primary/10 text-primary font-medium shrink-0">
                                  OPEN
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-text-muted">
                              {formatDate(p.lastModified)}
                              {p.duration !== undefined && ` · ${p.duration.toFixed(0)}s`}
                              {p.trackCount !== undefined && p.trackCount > 0 && ` · ${p.trackCount} tracks`}
                            </div>
                          </>
                        )}
                      </div>
                    </button>

                    {/* Row actions */}
                    <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpen(p);
                        }}
                        className="p-1.5 rounded hover:bg-background-tertiary text-text-muted hover:text-text-primary transition-colors"
                        title="Open project"
                      >
                        <FolderOpen size={14} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRenameStart(p);
                        }}
                        className="p-1.5 rounded hover:bg-background-tertiary text-text-muted hover:text-text-primary transition-colors"
                        title="Rename"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleExport(p);
                        }}
                        className="p-1.5 rounded hover:bg-background-tertiary text-text-muted hover:text-text-primary transition-colors"
                        title="Export / Save As"
                      >
                        <Download size={14} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(p);
                        }}
                        className="p-1.5 rounded hover:bg-error/10 text-text-muted hover:text-error transition-colors"
                        title="Delete project"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-border shrink-0 bg-background-secondary">
          <span className="text-xs text-text-muted">{subtitle}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              createNewProject();
              setProjectManagerOpen?.(false);
            }}
            className="h-8 text-xs gap-1.5"
          >
            <FileVideo size={13} />
            New Project
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
