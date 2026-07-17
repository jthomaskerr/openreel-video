import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MediaItem,
  ReferenceRoleByKey,
  ResolvedGenerationReference,
} from "@openreel/core";
import type { GenerationModelCapability } from "../../../../services/wavespeed/model-capabilities";
import { ReferenceCards } from "./ReferenceCards";
import { clearReferenceWarningPreferences } from "../../../../stores/reference-warning-preferences";

function capability(
  overrides: Partial<GenerationModelCapability["accepts"]> = {},
): GenerationModelCapability {
  return {
    provider: "wavespeed",
    modelId: "model-1",
    displayName: "Model 1",
    output: "image",
    mode: "image-to-image",
    accepts: {
      prompt: true,
      negativePrompt: true,
      sourceImage: true,
      referenceImages: { min: 0, max: 4 },
      audio: false,
      seed: true,
      ...overrides,
    },
    requestSchemaVersion: "schema-1",
    schemaVersion: "schema-1",
    supportsAudio: false,
    inputFields: {},
  };
}

function media(
  id: string,
  overrides: Partial<MediaItem> = {},
): MediaItem {
  return {
    id: `media-${id}`,
    name: `${id}.png`,
    type: "image",
    fileHandle: null,
    blob: null,
    metadata: {
      duration: 0,
      width: 1024,
      height: 1024,
      frameRate: 0,
      codec: "",
      sampleRate: 0,
      channels: 0,
      fileSize: 1,
    },
    thumbnailUrl: `data:image/png;base64,${id}`,
    title: `${id} title`,
    description: `${id} description`,
    ...overrides,
  };
}

function reference(
  id: string,
  overrides: Partial<ResolvedGenerationReference> = {},
): ResolvedGenerationReference {
  return {
    key: `reference:${id}`,
    mediaId: `media-${id}`,
    mediaVersionId: id,
    origins: ["prompt-media"],
    role: "prompt-media",
    canonicalTokens: [`media:${id}`],
    order: Number(id.replace(/\D+/g, "")) || 0,
    status: "active",
    ...overrides,
  };
}

function Harness(props: {
  references: readonly ResolvedGenerationReference[];
  mediaItems: readonly MediaItem[];
  capability: GenerationModelCapability;
  initialRolesByKey?: ReferenceRoleByKey;
  onSubmit?: (references: readonly ResolvedGenerationReference[]) => void;
}) {
  const [rolesByKey, setRolesByKey] = useState<ReferenceRoleByKey>(
    props.initialRolesByKey ?? {},
  );

  return (
    <ReferenceCards
      references={props.references}
      mediaItems={props.mediaItems}
      capability={props.capability}
      rolesByKey={rolesByKey}
      onRolesByKeyChange={setRolesByKey}
      onSubmit={props.onSubmit}
      submitLabel="Submit"
    />
  );
}

describe("ReferenceCards", () => {
  beforeEach(() => {
    clearReferenceWarningPreferences();
  });

  it("renders fixed-aspect cards with media details, merged origins, availability, invalid badge, and no add/remove controls", () => {
    render(
      <ReferenceCards
        references={[
          reference("1", {
            origins: ["source", "shot"],
            role: "source-image",
          }),
          reference("2", {
            origins: ["prompt-media", "shot"],
            role: "reference-images",
          }),
        ]}
        mediaItems={[
          media("1", { title: "Hero portrait", description: "Close framing." }),
          media("2", { title: "Mood board", description: "Neon palette." }),
        ]}
        capability={capability({ referenceImages: { min: 0, max: 0 } })}
        rolesByKey={{
          "reference:1": "source-image",
          "reference:2": "reference-images",
        }}
      />,
    );

    const sourceCard = screen.getByTestId("reference-card-reference:1");
    const overflowCard = screen.getByTestId("reference-card-reference:2");

    expect(screen.getByAltText("Hero portrait")).toBeInTheDocument();
    expect(screen.getByText("Hero portrait")).toBeInTheDocument();
    expect(screen.getByText("Close framing.")).toBeInTheDocument();
    expect(within(sourceCard).getByText("Available for submission")).toBeInTheDocument();
    expect(screen.getByText("Source • Shot")).toBeInTheDocument();
    expect(within(sourceCard).getByText("Source image")).toBeInTheDocument();
    expect(screen.getByText("Mood board")).toBeInTheDocument();
    expect(screen.getByText("Neon palette.")).toBeInTheDocument();
    expect(within(overflowCard).getByText("Excluded from submission")).toBeInTheDocument();
    expect(within(overflowCard).getByText("Only the first 0 reference images can be submitted to this model.")).toBeInTheDocument();
    expect(screen.getByText("Prompt mention • Shot")).toBeInTheDocument();
    expect(within(overflowCard).getByText("Excluded")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /add/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /remove/i }),
    ).not.toBeInTheDocument();
    expect(sourceCard.querySelector('[data-testid="reference-thumbnail-reference:1"]')).toHaveClass("aspect-square");
    expect(overflowCard.querySelector('[data-testid="reference-thumbnail-reference:2"]')).toHaveClass("aspect-square");
  });

  it("shows role choices only when multiple provider roles apply and updates the selected role", () => {
    render(
      <Harness
        references={[
          reference("1", {
            origins: ["source"],
            role: "source-image",
          }),
          reference("2"),
        ]}
        mediaItems={[media("1"), media("2")]}
        capability={capability()}
        initialRolesByKey={{
          "reference:1": "source-image",
          "reference:2": "reference-images",
        }}
      />,
    );

    const sourceCard = screen.getByTestId("reference-card-reference:1");
    const promptCard = screen.getByTestId("reference-card-reference:2");

    expect(within(sourceCard).getAllByRole("button")).toHaveLength(2);
    expect(within(promptCard).queryAllByRole("button")).toHaveLength(0);

    const sourceImageButton = within(sourceCard).getByRole("button", {
      name: "Source image",
    });
    const referenceImageButton = within(sourceCard).getByRole("button", {
      name: "Reference image",
    });

    expect(sourceImageButton).toHaveAttribute("aria-pressed", "true");
    expect(referenceImageButton).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(referenceImageButton);

    expect(sourceImageButton).toHaveAttribute("aria-pressed", "false");
    expect(referenceImageButton).toHaveAttribute("aria-pressed", "true");
  });

  it("confirms excluded references before submit and lets overflow warnings be suppressed for future submits only", () => {
    const onSubmit = vi.fn();

    render(
      <Harness
        references={[
          reference("1", {
            origins: ["source"],
            role: "source-image",
            order: 0,
          }),
          reference("2", { order: 1 }),
          reference("3", { order: 2 }),
        ]}
        mediaItems={[media("1"), media("2"), media("3")]}
        capability={capability({ referenceImages: { min: 0, max: 1 } })}
        initialRolesByKey={{
          "reference:1": "source-image",
          "reference:2": "reference-images",
          "reference:3": "reference-images",
        }}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      within(screen.getByRole("dialog")).getByText(
        "Only the first 1 reference image can be submitted to this model.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Do not show again"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "reference:3",
          status: "overflow",
          reason: "Only the first 1 reference image can be submitted to this model.",
        }),
      ]),
    );
    expect(screen.getByTestId("reference-card-reference:3")).toHaveTextContent("Excluded");

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });
});
