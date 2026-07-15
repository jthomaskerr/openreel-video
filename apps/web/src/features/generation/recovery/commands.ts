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
  cancel: GenerationJob;
}

export interface RecoveryCommandModule {
  execute(name: RecoveryCommandName, context: RecoveryCommandContext): Promise<GenerationJob | RecoveryDraft>;
}

export function createRecoveryCommandModule(controller: GenerationRecoveryController): RecoveryCommandModule {
  return {
    async execute(name, context) {
      switch (name) {
        case "regenerate":
          return controller.regenerate(context.job);
        case "variation":
          return controller.variation(context.job);
        case "retry-provider":
          return controller.retryProvider(context.job);
        case "retry-finalization":
          return controller.retryFinalization(context.job);
        case "retry-placement":
          return controller.retryPlacement(context.job);
        case "cancel":
          return controller.cancel(context.job);
      }
    },
  };
}
