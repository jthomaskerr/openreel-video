import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ResolvePreview } from "@openreel/core";
import {
  ResolveProjectPicker,
  type ResolveProjectPickerClient,
} from "./ResolveProjectPicker";
import type { ResolveBridgeRequestOptions } from "../../../services/resolve-bridge-client";

const vintageSummary = {
  id: "vintage-tokyo",
  name: "Vintage Tokyo",
  createdAt: Date.UTC(2026, 6, 11, 9),
  modifiedAt: Date.UTC(2026, 6, 22, 10),
};

function preview(
  projectId: string,
  name: string,
  overrides: Partial<ResolvePreview> = {},
): ResolvePreview {
  return {
    projectId,
    revision: `revision-${projectId}`,
    name,
    description: "A neon travel film assembled from the OpenReel project store.",
    createdAt: vintageSummary.createdAt,
    modifiedAt: vintageSummary.modifiedAt,
    durationFrames: 7_980,
    frameRate: 30,
    trackCount: 4,
    clipCount: 38,
    mediaCount: 33,
    render: { status: "missing", reason: "Render this project to preview its output." },
    miniTimeline: { durationFrames: 7_980, tracks: [] },
    clipGroups: [],
    compatibility: {
      status: "degraded",
      blockingIssueCount: 0,
      warningCount: 2,
    },
    ...overrides,
  };
}

function client(
  overrides: Partial<ResolveProjectPickerClient> = {},
): ResolveProjectPickerClient {
  return {
    listProjects: vi.fn(async () => [vintageSummary]),
    getPreview: vi.fn(async (projectId) => preview(projectId, "Vintage Tokyo")),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("ResolveProjectPicker", () => {
  it("searches projects and exposes every selected-project metadata field", async () => {
    const onLaunch = vi.fn();
    render(
      <ResolveProjectPicker
        open
        onClose={vi.fn()}
        onLaunch={onLaunch}
        client={client()}
      />,
    );

    const search = screen.getByRole("searchbox", { name: /search projects/i });
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: "vintage" } });
    fireEvent.click(await screen.findByRole("option", { name: /vintage tokyo/i }));

    expect(await screen.findByRole("heading", { name: "Vintage Tokyo" })).toBeVisible();
    expect(screen.getByText(/neon travel film/i)).toBeVisible();
    expect(screen.getByText("11 July 2026")).toBeVisible();
    expect(screen.getAllByText(/last edited/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("7,980 frames")).toBeVisible();
    expect(screen.getByText("30 fps")).toBeVisible();
    expect(screen.getByText("4 tracks")).toBeVisible();
    expect(screen.getByText("38 clips")).toBeVisible();
    expect(screen.getByText("33 media items")).toBeVisible();
    expect(screen.getByText(/compatible with 2 warnings/i)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Open in Resolve" }));
    expect(onLaunch).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "vintage-tokyo", revision: "revision-vintage-tokyo" }),
    );
  });

  it("preserves backend order and supports roving listbox keyboard selection", async () => {
    const projects = [
      vintageSummary,
      { ...vintageSummary, id: "alpha", name: "Alpha", modifiedAt: vintageSummary.modifiedAt - 1 },
      { ...vintageSummary, id: "beta", name: "Beta", modifiedAt: vintageSummary.modifiedAt - 2 },
    ];
    const pickerClient = client({
      listProjects: vi.fn(async () => projects),
      getPreview: vi.fn(async (projectId) =>
        preview(projectId, projects.find((project) => project.id === projectId)?.name ?? projectId),
      ),
    });
    render(
      <ResolveProjectPicker open onClose={vi.fn()} onLaunch={vi.fn()} client={pickerClient} />,
    );

    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining("Vintage Tokyo"),
      expect.stringContaining("Alpha"),
      expect.stringContaining("Beta"),
    ]);

    options[0].focus();
    fireEvent.keyDown(options[0], { key: "End" });
    expect(options[2]).toHaveFocus();
    expect(options[2]).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("heading", { name: "Beta" })).toBeVisible();

    fireEvent.keyDown(options[2], { key: "Home" });
    expect(options[0]).toHaveFocus();
    expect(await screen.findByRole("heading", { name: "Vintage Tokyo" })).toBeVisible();
    fireEvent.keyDown(options[0], { key: "a" });
    expect(options[1]).toHaveFocus();
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("heading", { name: "Alpha" })).toBeVisible();
  });

  it("aborts a stale preview request and ignores its late response", async () => {
    const first = deferred<ResolvePreview>();
    const second = deferred<ResolvePreview>();
    const projects = [
      vintageSummary,
      { ...vintageSummary, id: "second", name: "Second Project" },
    ];
    const getPreview = vi.fn((projectId: string, _options?: ResolveBridgeRequestOptions) =>
      projectId === "vintage-tokyo" ? first.promise : second.promise,
    );
    const pickerClient = client({
      listProjects: vi.fn(async () => projects),
      getPreview,
    });
    render(
      <ResolveProjectPicker open onClose={vi.fn()} onLaunch={vi.fn()} client={pickerClient} />,
    );

    fireEvent.click(await screen.findByRole("option", { name: /second project/i }));
    await waitFor(() => expect(getPreview).toHaveBeenCalledTimes(2));
    const firstSignal = getPreview.mock.calls[0][1]?.signal;
    expect(firstSignal?.aborted).toBe(true);

    second.resolve(preview("second", "Second Project"));
    expect(await screen.findByRole("heading", { name: "Second Project" })).toBeVisible();
    first.resolve(preview("vintage-tokyo", "Vintage Tokyo"));
    await Promise.resolve();
    expect(screen.queryByRole("heading", { name: "Vintage Tokyo" })).not.toBeInTheDocument();
  });

  it("shows actionable list and preview errors without hiding the selected project", async () => {
    const listProjects = vi
      .fn<
        Parameters<ResolveProjectPickerClient["listProjects"]>,
        ReturnType<ResolveProjectPickerClient["listProjects"]>
      >()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([vintageSummary]);
    const getPreview = vi
      .fn<
        Parameters<ResolveProjectPickerClient["getPreview"]>,
        ReturnType<ResolveProjectPickerClient["getPreview"]>
      >()
      .mockRejectedValueOnce(new Error("preview unavailable"))
      .mockResolvedValueOnce(preview("vintage-tokyo", "Vintage Tokyo"));
    render(
      <ResolveProjectPicker
        open
        onClose={vi.fn()}
        onLaunch={vi.fn()}
        client={client({ listProjects, getPreview })}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load projects/i);
    fireEvent.click(screen.getByRole("button", { name: /retry loading projects/i }));
    expect(await screen.findByRole("option", { name: /vintage tokyo/i })).toBeVisible();
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load the project preview/i);
    expect(screen.getByRole("option", { name: /vintage tokyo/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: /retry project preview/i }));
    expect(await screen.findByRole("heading", { name: "Vintage Tokyo" })).toBeVisible();
  });

  it("renders an explicit empty search state", async () => {
    render(
      <ResolveProjectPicker
        open
        onClose={vi.fn()}
        onLaunch={vi.fn()}
        client={client({ listProjects: vi.fn(async () => []) })}
      />,
    );

    expect(await screen.findByText(/no openreel projects are available/i)).toBeVisible();
  });
});
