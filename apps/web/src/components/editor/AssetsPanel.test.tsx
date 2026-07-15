import "../../test/install-local-storage-mock";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { MediaItem, Project } from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useMusicVideoStore } from "../../stores/music-video-store";
import { AssetsPanel } from "./AssetsPanel";
import { mediaAvailabilityRuntime } from "../../services/media-verification";

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

function media(
  overrides: Partial<MediaItem> & Pick<MediaItem, "id" | "name" | "type">,
): MediaItem {
  const { id, name, type, ...rest } = overrides;
  return {
    fileHandle: null,
    blob: null,
    metadata: {
      duration: 0,
      width: 0,
      height: 0,
      frameRate: 0,
      codec: "",
      sampleRate: 0,
      channels: 0,
      fileSize: 0,
    },
    thumbnailUrl: null,
    ...rest,
    id,
    name,
    type,
  };
}

function seedProject(items: MediaItem[]): Project {
  const project = createEmptyProject("Assets Panel Test");
  const seeded: Project = {
    ...project,
    mediaLibrary: { items },
  };
  useProjectStore.setState({ project: seeded });
  useUIStore.getState().clearSelection();
  useUIStore.setState({ inspectedAsset: null });
  return seeded;
}

function renderPanel() {
  return render(<AssetsPanel />);
}

function getToolbar() {
  return screen.getByRole("toolbar", { name: "Media controls" });
}

function openSelectAndChoose(
  triggerName: RegExp | string,
  optionName: RegExp | string,
) {
  fireEvent.click(screen.getByRole("combobox", { name: triggerName }));
  fireEvent.click(screen.getByRole("option", { name: optionName }));
}

describe("AssetsPanel media toolbar and missing-only transitions", () => {
  beforeEach(() => {
    seedProject([]);
    useMusicVideoStore.setState({ projects: {}, activeProjectId: null });
    vi.spyOn(mediaAvailabilityRuntime, "get").mockImplementation((_projectId, mediaId) => {
      const item = useProjectStore.getState().project.mediaLibrary.items.find((candidate) => candidate.id === mediaId);
      if (!item?.sourceFile || item.blob) return item ? {
        mediaId,
        status: "available",
        evidence: { authoritative: true, mapping: "present", object: "present" },
      } : undefined;
      return {
        mediaId,
        status: "confirmed_missing",
        evidence: { authoritative: true, mapping: "absent", object: "absent" },
      };
    });
  });

  afterEach(() => {
    cleanup();
    useUIStore.getState().clearSelection();
    useUIStore.setState({ inspectedAsset: null });
    useProjectStore.setState({ project: createEmptyProject("Reset") });
    vi.restoreAllMocks();
  });

  it("cancels missing-only when the final missing asset is resolved", async () => {
    seedProject([
      media({
        id: "healthy-1",
        name: "healthy-1.mp4",
        type: "video",
        blob: new Blob(["healthy-1"], { type: "video/mp4" }),
      }),
      media({
        id: "missing-1",
        name: "missing-1.mp4",
        type: "video",
        sourceFile: {
          name: "missing-1.mp4",
          size: 101,
          lastModified: 0,
        },
      }),
    ]);

    renderPanel();

    fireEvent.click(
      screen.getByRole("button", { name: "Show only missing assets" }),
    );

    expect(screen.getByRole("button", { name: "Show only missing assets" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("missing-1.mp4")).toBeInTheDocument();
    expect(screen.queryByText("healthy-1.mp4")).toBeNull();

    await act(async () => {
      useProjectStore.setState((state) => ({
        project: {
          ...state.project,
          mediaLibrary: {
            items: state.project.mediaLibrary.items.map((item) =>
              item.id === "missing-1"
                ? {
                    ...item,
                    blob: new Blob(["resolved"], { type: "video/mp4" }),
                  }
                : item,
            ),
          },
        },
      }));
    });

    await waitFor(() => {
      expect(screen.getByText("healthy-1.mp4")).toBeInTheDocument();
      expect(screen.getByText("missing-1.mp4")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Show only missing assets" }),
      ).toBeNull();
      expect(screen.queryByRole("button", { name: "Relink from folder" })).toBeNull();
    });
  });

  it("keeps missing-only active while another missing asset remains", async () => {
    seedProject([
      media({
        id: "healthy-1",
        name: "healthy-1.mp4",
        type: "video",
        blob: new Blob(["healthy-1"], { type: "video/mp4" }),
      }),
      media({
        id: "missing-1",
        name: "missing-1.mp4",
        type: "video",
        sourceFile: {
          name: "missing-1.mp4",
          size: 101,
          lastModified: 0,
        },
      }),
      media({
        id: "missing-2",
        name: "missing-2.mp4",
        type: "video",
        sourceFile: {
          name: "missing-2.mp4",
          size: 102,
          lastModified: 0,
        },
      }),
    ]);

    renderPanel();
    fireEvent.click(
      screen.getByRole("button", { name: "Show only missing assets" }),
    );

    expect(screen.getByRole("button", { name: "Show only missing assets" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await act(async () => {
      useProjectStore.setState((state) => ({
        project: {
          ...state.project,
          mediaLibrary: {
            items: state.project.mediaLibrary.items.map((item) =>
              item.id === "missing-1"
                ? {
                    ...item,
                    blob: new Blob(["resolved"], { type: "video/mp4" }),
                  }
                : item,
            ),
          },
        },
      }));
    });

    await waitFor(() => {
      expect(screen.getByText("missing-2.mp4")).toBeInTheDocument();
      expect(screen.queryByText("missing-1.mp4")).toBeNull();
      expect(screen.getByRole("button", { name: "Show only missing assets" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByRole("button", { name: "Show only missing assets" })).toHaveTextContent("1");
    });
  });

  it("does not restore missing-only when missing assets reappear", async () => {
    seedProject([
      media({
        id: "healthy-1",
        name: "healthy-1.mp4",
        type: "video",
        blob: new Blob(["healthy-1"], { type: "video/mp4" }),
      }),
      media({
        id: "missing-1",
        name: "missing-1.mp4",
        type: "video",
        sourceFile: {
          name: "missing-1.mp4",
          size: 101,
          lastModified: 0,
        },
      }),
    ]);

    renderPanel();
    fireEvent.click(
      screen.getByRole("button", { name: "Show only missing assets" }),
    );

    await act(async () => {
      useProjectStore.setState((state) => ({
        project: {
          ...state.project,
          mediaLibrary: {
            items: state.project.mediaLibrary.items.map((item) =>
              item.id === "missing-1"
                ? {
                    ...item,
                    blob: new Blob(["resolved"], { type: "video/mp4" }),
                  }
                : item,
            ),
          },
        },
      }));
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Show only missing assets" }),
      ).toBeNull();
    });

    await act(async () => {
      useProjectStore.setState((state) => ({
        project: {
          ...state.project,
          mediaLibrary: {
            items: [
              ...state.project.mediaLibrary.items,
              media({
                id: "missing-2",
                name: "missing-2.mp4",
                type: "video",
                sourceFile: {
                  name: "missing-2.mp4",
                  size: 102,
                  lastModified: 0,
                },
              }),
            ],
          },
        },
      }));
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Show only missing assets" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      expect(screen.getByText("healthy-1.mp4")).toBeInTheDocument();
      expect(screen.getByText("missing-2.mp4")).toBeInTheDocument();
    });
  });

  it("does not derive missing-only validity from search results", async () => {
    seedProject([
      media({
        id: "healthy-1",
        name: "healthy-1.mp4",
        type: "video",
        blob: new Blob(["healthy-1"], { type: "video/mp4" }),
      }),
      media({
        id: "missing-1",
        name: "missing-1.mp4",
        type: "video",
        sourceFile: {
          name: "missing-1.mp4",
          size: 101,
          lastModified: 0,
        },
      }),
    ]);

    renderPanel();
    fireEvent.click(
      screen.getByRole("button", { name: "Show only missing assets" }),
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Search media" }), {
      target: { value: "healthy" },
    });

    expect(screen.getByRole("button", { name: "Show only missing assets" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByText("missing-1.mp4")).toBeNull();

    fireEvent.change(screen.getByRole("textbox", { name: "Search media" }), {
      target: { value: "" },
    });

    expect(screen.getByText("missing-1.mp4")).toBeInTheDocument();
  });

  it("renders every media-pane control inside one semantic toolbar", () => {
    seedProject([
      media({
        id: "healthy-1",
        name: "healthy-1.mp4",
        type: "video",
        blob: new Blob(["healthy-1"], { type: "video/mp4" }),
      }),
      media({
        id: "missing-1",
        name: "missing-1.mp4",
        type: "video",
        sourceFile: {
          name: "missing-1.mp4",
          size: 101,
          lastModified: 0,
        },
      }),
    ]);

    const { container } = renderPanel();
    const toolbar = getToolbar();

    expect(toolbar).toHaveClass("flex-nowrap", "overflow-x-auto");
    expect(within(toolbar).getByRole("textbox", { name: "Search media" }).parentElement?.parentElement).toHaveClass(
      "min-w-0",
    );
    expect(within(toolbar).getAllByRole("button", { name: /Import media|Show only missing assets|Relink from folder|Collapse all buckets|Expand all buckets|Large icons|Small icons|List view/ }).every((el) => toolbar.contains(el))).toBe(true);
    expect(within(toolbar).getByRole("button", { name: "Show only missing assets" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(within(toolbar).getByRole("button", { name: "Large icons" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(toolbar).getByRole("button", { name: "Small icons" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(within(toolbar).getByRole("button", { name: "List view" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(within(toolbar).getByRole("combobox", { name: "Group media by" })).toBeInTheDocument();
    expect(container.querySelectorAll('[role="toolbar"]').length).toBe(1);
    expect(screen.queryByRole("button", { name: "Import media" })).not.toBeNull();
    expect(within(toolbar).getByRole("button", { name: "Create Scene" })).toBeInTheDocument();
  });

  it("renders scenes as a searchable type bucket in the normal media content", () => {
    seedProject([
      media({ id: "video-1", name: "clip.mp4", type: "video" }),
    ]);
    renderPanel();

    fireEvent.click(within(getToolbar()).getByRole("button", { name: "Create Scene" }));

    const scenesBucket = screen.getByRole("button", { name: /Scenes 1/ });
    expect(scenesBucket).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("article", { name: "Scene: Untitled Scene" })).toBeInTheDocument();
    expect(screen.getAllByText("Scenes")).toHaveLength(1);

    fireEvent.change(screen.getByRole("textbox", { name: "Search media" }), {
      target: { value: "does not match" },
    });
    expect(screen.queryByRole("article", { name: "Scene: Untitled Scene" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Search media" }), {
      target: { value: "Untitled" },
    });
    expect(screen.getByRole("article", { name: "Scene: Untitled Scene" })).toBeInTheDocument();
  });

  it("keeps collapse and expand disabled when group by is none", () => {
    seedProject([
      media({
        id: "healthy-1",
        name: "healthy-1.mp4",
        type: "video",
        blob: new Blob(["healthy-1"], { type: "video/mp4" }),
      }),
      media({
        id: "missing-1",
        name: "missing-1.mp4",
        type: "video",
        sourceFile: {
          name: "missing-1.mp4",
          size: 101,
          lastModified: 0,
        },
      }),
    ]);

    renderPanel();

    openSelectAndChoose("Group media by", "None");
    expect(screen.getByRole("button", { name: "Collapse all buckets" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Expand all buckets" })).toBeDisabled();

    openSelectAndChoose("Group media by", "Type");
    expect(screen.getByRole("button", { name: "Collapse all buckets" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Expand all buckets" })).not.toBeDisabled();
  });

  it("does not count transient failures as missing and retries without semantic mutation", async () => {
    seedProject([
      media({ id: "transient-1", name: "transient.mp4", type: "video", sourceFile: { name: "transient.mp4", size: 10, lastModified: 0 } }),
    ]);
    vi.mocked(mediaAvailabilityRuntime.get).mockReturnValue({
      mediaId: "transient-1",
      status: "temporarily_unavailable",
      evidence: { authoritative: false, mapping: "unknown", object: "unknown" },
    });
    const verify = vi.spyOn(mediaAvailabilityRuntime, "verify").mockResolvedValue([]);
    const before = JSON.stringify(useProjectStore.getState().project);
    const projectId = useProjectStore.getState().project.id;

    renderPanel();

    expect(screen.queryByRole("button", { name: "Show only missing assets" })).toBeNull();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry verification for unavailable media" }));
    expect(verify).toHaveBeenCalledWith(projectId, ["transient-1"], expect.any(Object));
    expect(JSON.stringify(useProjectStore.getState().project)).toBe(before);
  });

  it("offers Associate with Scene only from video asset actions", async () => {
    seedProject([
      media({ id: "video-1", name: "clip.mp4", type: "video" }),
      media({ id: "image-1", name: "still.png", type: "image" }),
    ]);
    renderPanel();

    fireEvent.contextMenu(screen.getByText("clip.mp4"));
    const action = await screen.findByRole("menuitem", { name: "Associate with Scene…" });
    fireEvent.click(action);
    expect(screen.getByRole("dialog", { name: /Associate clip.mp4 with Scene/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.contextMenu(screen.getByText("still.png"));
    await waitFor(() => {
      expect(screen.queryByRole("menuitem", { name: "Associate with Scene…" })).not.toBeInTheDocument();
    });
  });
});
