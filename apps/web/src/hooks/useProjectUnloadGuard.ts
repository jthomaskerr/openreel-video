import { useEffect } from "react";
import type { Project, ProjectSaveReceipt } from "@openreel/core";
import { isProjectDirty } from "../stores/persistence-status-store";

interface PersistenceConfirmation {
  projectId: string | null;
  confirmedReceipt: ProjectSaveReceipt | null;
}

export function useProjectUnloadGuard(
  project: Pick<Project, "id" | "modifiedAt">,
  status: PersistenceConfirmation,
  enabled: boolean = true,
): void {
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (!enabled || !isProjectDirty(project, status)) return;
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [
    enabled,
    project.id,
    project.modifiedAt,
    status.projectId,
    status.confirmedReceipt,
  ]);
}
