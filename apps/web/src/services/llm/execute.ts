import type { ActionResult, ValidationError } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";

export interface MutationResult {
  ok: boolean;
  message?: string;
  data?: unknown;
  undoLabel?: string;
  validationErrors?: ValidationError[];
}

function actionErrorToValidation(error: ActionResult["error"]): ValidationError[] {
  if (!error) return [];
  return [{ code: error.code, message: error.message, path: undefined }];
}

export async function executeEditorMutation(
  label: string,
  fn: () => Promise<ActionResult | MutationResult | boolean | void> | ActionResult | MutationResult | boolean | void,
): Promise<MutationResult> {
  const store = useProjectStore.getState();
  store.beginHistoryGroup(label);

  try {
    const result = await fn();

    if (typeof result === "boolean") {
      return { ok: result, undoLabel: result ? label : undefined };
    }

    if (!result) {
      return { ok: true, undoLabel: label };
    }

    if ("success" in result) {
      const validationErrors = actionErrorToValidation(result.error);
      return {
        ok: result.success,
        message: result.error?.message,
        undoLabel: result.success ? label : undefined,
        validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
      };
    }

    return {
      ...result,
      undoLabel: result.ok ? result.undoLabel ?? label : result.undoLabel,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Editor mutation failed",
    };
  } finally {
    useProjectStore.getState().endHistoryGroup();
  }
}
