# WaveSpeed Image and Video Generation (Redirect)

> **Canonical source:** [AI Generation and Providers — WaveSpeed adapter](../generation.md#92-wavespeed).
>
> This filename is retained for compatibility with existing links. It contains no independent normative requirements. Update [AI Generation and Providers](../generation.md) instead.

## Recovered task context

This compatibility document is the stable spec entry point for Pi Inbox #24, recovered from session `2026-07-10T11-32-11-922Z_019f4bcc-aa12-7bee-af2f-4df69b3f3018.jsonl`. The requested measurable outcome is covered by the canonical specification:

- WaveSpeed image and video generation is available through the shared generation controller.
- Explicit reference images and prompt-referenced character images are resolved, uploaded through the orchestrator, and mapped only to schema-declared fields.
- A compatible video model receives bounded audio extraction only from an explicitly selected valid linked timeline projection. A valid unlinked timeline range may provide timing and a placement default, but it does not authorize any audio work. An unplaced shot and a new-asset draft do zero audio work and do not infer timing or audio from stored shot values.
- Jobs survive reload and finalize the correct asset, shot history, and optional timeline placement exactly once.
- Deterministic tests, browser verification, and the maintained provider eval provide release evidence.

The executable decomposition, acceptance tests, failure modes, and delivery gates are in [the WaveSpeed implementation plan](../../superpowers/plans/2026-07-10-wavespeed-generation.md).
