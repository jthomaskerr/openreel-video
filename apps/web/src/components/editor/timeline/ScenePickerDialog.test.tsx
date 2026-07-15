import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ScenePickerDialog } from "./ScenePickerDialog";

describe("ScenePickerDialog", () => {
  it("exposes a searchable scene list and returns the selected stable scene id", () => {
    const onSelect = vi.fn();

    render(
      <ScenePickerDialog
        open
        title="Link to Existing Scene"
        scenes={[
          { id: "scene-sunrise", label: "Sunrise", prompt: "Warm beach" },
          { id: "scene-city", label: "Night City", prompt: "Neon rain" },
        ]}
        onSelect={onSelect}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("listbox", { name: "Scenes" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Search scenes" }), {
      target: { value: "NEON" },
    });

    expect(screen.queryByRole("option", { name: /Sunrise/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: /Night City/ }));
    expect(onSelect).toHaveBeenCalledWith("scene-city");
  });

  it("cancels without selecting a scene", () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();

    render(
      <ScenePickerDialog
        open
        title="Link to Existing Scene"
        scenes={[{ id: "scene-1", label: "Scene 1" }]}
        onSelect={onSelect}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
