import "../../test/install-local-storage-mock";
import React, { forwardRef, useImperativeHandle } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { Project } from "@openreel/core";
import { createEmptyProject } from "../../stores/project/project-helpers";
import { Toolbar } from "./Toolbar";

const toolbarMocks = vi.hoisted(() => ({
  projectManagerOpen: vi.fn(),
  openFilePicker: vi.fn(),
  navigate: vi.fn(),
  toggleTheme: vi.fn(),
  openSettings: vi.fn(),
  openModal: vi.fn(),
  setExportState: vi.fn(),
  toggleKeyframeEditor: vi.fn(),
  togglePanel: vi.fn(),
  track: vi.fn(),
  undo: vi.fn(),
  redo: vi.fn(),
  renameProject: vi.fn(),
  importMedia: vi.fn(),
  loadProject: vi.fn(),
  markFailed: vi.fn(),
}));

let projectFixture: Project;

type PersistenceStatusState = {
  phase: string;
  projectId: string;
  persistedAt: number;
  persistedModifiedAt: number;
  error: unknown;
  phaseStartedAt: number | null;
  markFailed: typeof toolbarMocks.markFailed;
};

vi.mock("@openreel/ui", () => {
  const DropdownMenuContext = React.createContext<{
    open: boolean;
    setOpen: (open: boolean) => void;
  } | null>(null);

  function DropdownMenu({
    open,
    onOpenChange,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) {
    const [internalOpen, setInternalOpen] = React.useState(false);
    const isControlled = open !== undefined;
    const isOpen = isControlled ? open : internalOpen;
    const setOpen = React.useCallback(
      (next: boolean) => {
        if (isControlled) {
          onOpenChange?.(next);
        } else {
          setInternalOpen(next);
        }
      },
      [isControlled, onOpenChange],
    );

    return (
      <DropdownMenuContext.Provider value={{ open: isOpen, setOpen }}>
        {children}
      </DropdownMenuContext.Provider>
    );
  }

  function DropdownMenuTrigger({
    asChild,
    children,
  }: {
    asChild?: boolean;
    children: React.ReactElement;
  }) {
    const context = React.useContext(DropdownMenuContext);
    const trigger = React.cloneElement(children, {
      "aria-expanded": context?.open ?? false,
      onClick: (event: React.MouseEvent) => {
        children.props.onClick?.(event);
        context?.setOpen(!context.open);
      },
    });
    return asChild ? trigger : trigger;
  }

  function DropdownMenuContent({
    children,
  }: {
    children: React.ReactNode;
  }) {
    const context = React.useContext(DropdownMenuContext);
    if (!context?.open) return null;
    return <div role="menu">{children}</div>;
  }

  function DropdownMenuItem({
    onClick,
    children,
    disabled,
    className,
  }: {
    onClick?: () => void;
    children: React.ReactNode;
    disabled?: boolean;
    className?: string;
  }) {
    const context = React.useContext(DropdownMenuContext);
    return (
      <button
        type="button"
        role="menuitem"
        disabled={disabled}
        className={className}
        onClick={() => {
          if (disabled) return;
          onClick?.();
          context?.setOpen(false);
        }}
      >
        {children}
      </button>
    );
  }

  function DropdownMenuSeparator() {
    return <hr role="separator" />;
  }

  function DropdownMenuSub({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
  }

  function DropdownMenuSubTrigger({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) {
    return (
      <button type="button" role="menuitem" className={className}>
        {children}
        <span aria-hidden="true">›</span>
      </button>
    );
  }

  function DropdownMenuSubContent({
    children,
    className,
    style,
    side = "right",
    align = "start",
    sideOffset = 0,
  }: {
    children: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
    side?: string;
    align?: string;
    sideOffset?: number;
  }) {
    return (
      <div
        role="menu"
        className={className}
        style={{
          ...style,
          marginLeft: "calc(-100% - var(--radix-popper-anchor-width) - 8px)",
        }}
        data-side={side}
        data-align={align}
        data-side-offset={sideOffset}
      >
        {children}
      </div>
    );
  }

  function Tooltip({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
  }

  function TooltipTrigger({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
  }

  function TooltipContent({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
  }

  return {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent,
    Tooltip,
    TooltipTrigger,
    TooltipContent,
  };
});

vi.mock("../../stores/project-store", () => {
  const useProjectStore = vi.fn(() => ({
    project: projectFixture,
    undo: toolbarMocks.undo,
    redo: toolbarMocks.redo,
    renameProject: toolbarMocks.renameProject,
    importMedia: toolbarMocks.importMedia,
  }));

  Object.assign(useProjectStore, {
    getState: () => ({
      project: projectFixture,
      undo: toolbarMocks.undo,
      redo: toolbarMocks.redo,
      renameProject: toolbarMocks.renameProject,
      importMedia: toolbarMocks.importMedia,
      loadProject: toolbarMocks.loadProject,
    }),
  });

  return { useProjectStore };
});

vi.mock("../../stores/ui-store", () => ({
  useUIStore: () => ({
    openModal: toolbarMocks.openModal,
    selectedItems: [],
    setExportState: toolbarMocks.setExportState,
    keyframeEditorOpen: false,
    toggleKeyframeEditor: toolbarMocks.toggleKeyframeEditor,
    panels: {
      audioMixer: { visible: false },
      chat: { visible: false },
    },
    togglePanel: toolbarMocks.togglePanel,
    setProjectManagerOpen: toolbarMocks.projectManagerOpen,
  }),
}));

vi.mock("../../stores/theme-store", () => ({
  useThemeStore: () => ({
    mode: "system",
    toggleTheme: toolbarMocks.toggleTheme,
  }),
}));

vi.mock("../../hooks/use-router", () => ({
  useRouter: () => ({
    navigate: toolbarMocks.navigate,
  }),
}));

vi.mock("../../stores/settings-store", () => ({
  useSettingsStore: () => ({
    openSettings: toolbarMocks.openSettings,
  }),
}));

vi.mock("../../hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    track: toolbarMocks.track,
  }),
  AnalyticsEvents: {
    PROJECT_EXPORTED: "PROJECT_EXPORTED",
  },
}));

vi.mock("../../stores/persistence-status-store", () => ({
  usePersistenceStatusStore: <T,>(selector?: (state: PersistenceStatusState) => T) => {
    const state: PersistenceStatusState = {
      phase: "persisted",
      projectId: "project-1",
      persistedAt: 1,
      persistedModifiedAt: 1,
      error: null,
      phaseStartedAt: null,
      markFailed: toolbarMocks.markFailed,
    };

    return selector ? selector(state) : state;
  },
}));

vi.mock("./ExportDialog", () => ({ ExportDialog: () => null }));
vi.mock("./ScreenRecorder", () => ({ ScreenRecorder: () => null }));
vi.mock("./ProjectSwitcher", () => ({ ProjectSwitcher: () => null }));
vi.mock("./settings/SettingsDialog", () => ({ SettingsDialog: () => null }));
vi.mock("./ProjectManagerDialog", () => ({ ProjectManagerDialog: () => null }));
vi.mock("./inspector/HistoryPanel", () => ({ HistoryPanel: () => null }));

vi.mock("../../features/music-video", () => ({
  NeuralFramesImportTab: forwardRef((_props: unknown, ref) => {
    useImperativeHandle(ref, () => ({
      openFilePicker: toolbarMocks.openFilePicker,
    }));

    return null;
  }),
}));

function makeProjectFixture(): Project {
  const project = createEmptyProject("Toolbar Regression");
  return {
    ...project,
    id: "project-1",
    createdAt: 1,
    modifiedAt: 1,
  };
}

describe("Toolbar editor header layout and menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectFixture = makeProjectFixture();
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps Export compact and moves Projects and Neural Frames import into the menu", () => {
    render(<Toolbar />);

    const header = screen.getByRole("banner");
    expect(header).toHaveClass("h-topbar");
    expect(header).toHaveClass("grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]");

    const [leftRegion, centerRegion, rightRegion] = Array.from(header.children) as HTMLElement[];
    expect(leftRegion).toHaveClass("min-w-0");
    expect(centerRegion).toHaveClass("min-w-0");
    expect(rightRegion).toHaveClass("min-w-0", "flex-nowrap", "items-center", "justify-end");

    const menuTrigger = screen.getByRole("button", { name: "Open editor menu" });
    expect(menuTrigger).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "Projects" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import Neural Frames" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export" })).not.toBeInTheDocument();
    expect(within(centerRegion).queryByRole("textbox")).not.toBeInTheDocument();

    const visibleButtons = within(rightRegion).getAllByRole("button");
    expect(visibleButtons.at(-1)).toHaveAccessibleName("Open editor menu");

    fireEvent.click(menuTrigger);

    const exportItem = screen.getByRole("menuitem", { name: "Export" });
    const projectsItem = screen.getByRole("menuitem", { name: "Projects" });
    const importItem = screen.getByRole("menuitem", { name: "Import Neural Frames" });
    expect(exportItem).toBeInTheDocument();
    expect(projectsItem).toBeInTheDocument();
    expect(importItem).toBeInTheDocument();

    const submenu = screen
      .getAllByRole("menu")
      .find((menu) => menu.className.includes("w-60"));
    expect(submenu).toHaveAttribute("data-side-offset", "0");
    expect(submenu).toHaveClass("w-60");
    expect((submenu as HTMLElement).style.marginLeft).toBe("calc(-100% - var(--radix-popper-anchor-width) - 8px)");
    expect(within(submenu as HTMLElement).getByRole("menuitem", { name: /^MP4 Standard/ })).toBeInTheDocument();
    expect(within(submenu as HTMLElement).getByRole("menuitem", { name: /^Custom export…/ })).toBeInTheDocument();

    expect(exportItem.querySelectorAll("svg")).toHaveLength(1);

    fireEvent.click(projectsItem);
    expect(toolbarMocks.projectManagerOpen).toHaveBeenCalledWith(true);

    fireEvent.click(menuTrigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Import Neural Frames" }));
    expect(toolbarMocks.openFilePicker).toHaveBeenCalledTimes(1);
  });
});
