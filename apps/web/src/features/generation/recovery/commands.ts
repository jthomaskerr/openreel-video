import type { GenerationJob } from "@openreel/music-video-domain/generation";
import { GenerationRecoveryController, type RecoveryAction, type RecoveryDraft } from "./state-machine";

export type RecoveryCommandName = RecoveryAction;

export interface RecoveryCommandContext {
  job: GenerationJob;
}

export interface RecoveryCommandResultMap {
  regenerate: GenerationJob;
  variation: RecoveryDraft;
  "retry-provider": GenerationJob;
  "retry-finalization": GenerationJob;
  "retry-placement": GenerationJob;
  "reconcile-placement": GenerationJob;
  cancel: GenerationJob;
}

export interface RecoveryCommandModule {
  execute<Name extends RecoveryCommandName>(name: Name, context: RecoveryCommandContext): Promise<RecoveryCommandResultMap[Name]>;
}

export function createRecoveryCommandModule(controller: GenerationRecoveryController): RecoveryCommandModule {
  const handlers: {
    [Name in RecoveryCommandName]: (context: RecoveryCommandContext) => Promise<RecoveryCommandResultMap[Name]>;
  } = {
    regenerate: ({ job }) => controller.regenerate(job),
    variation: async ({ job }) => controller.variation(job),
    "retry-provider": ({ job }) => controller.retryProvider(job),
    "retry-finalization": ({ job }) => controller.retryFinalization(job),
    "retry-placement": ({ job }) => controller.retryPlacement(job),
    "reconcile-placement": ({ job }) => controller.reconcilePlacement(job),
    cancel: ({ job }) => controller.cancel(job),
  };

  return {
    execute(name, context) {
      return handlers[name](context);
    },
  };
}
