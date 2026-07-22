/**
 * Independent release gate for new WaveSpeed Generation V2 submissions.
 *
 * Keep this fail-closed even when a server advertises the capability. Existing
 * submitted V2 jobs remain recoverable through the production job controller.
 */
export const WAVESPEED_GENERATION_V2_RELEASE_ENABLED = false as const;

export function isWaveSpeedGenerationV2Available(serverReleaseEnabled: boolean): boolean {
  return WAVESPEED_GENERATION_V2_RELEASE_ENABLED && serverReleaseEnabled;
}
