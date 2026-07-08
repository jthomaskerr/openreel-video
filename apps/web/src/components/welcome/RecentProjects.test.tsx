import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RecentProjects } from "./RecentProjects";

const mockCheckForRecovery = vi.fn();
const mockRecoverFromAutoSave = vi.fn();
const mockListProjects = vi.fn();

vi.mock("../../services/auto-save", () => ({
  checkForRecovery: () => mockCheckForRecovery(),
}));

vi.mock("../../services/backend-save", () => ({
  backendSaveService: {
    listProjects: () => mockListProjects(),
  },
}));

vi.mock("../../stores/project-store", () => ({
  useProjectStore: (selector: (state: unknown) => unknown) =>
    selector({ recoverFromAutoSave: mockRecoverFromAutoSave }),
}));

describe("RecentProjects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: backend unreachable → fallback to IndexedDB
    mockListProjects.mockResolvedValue(null);
  });

  it("shows loading state initially", () => {
    mockListProjects.mockReturnValue(new Promise(() => {}));
    render(<RecentProjects />);
    expect(screen.getByText("Loading projects...")).toBeInTheDocument();
  });

  it("shows empty state when no projects", async () => {
    mockListProjects.mockResolvedValue([]);
    mockCheckForRecovery.mockResolvedValue([]);
    render(<RecentProjects />);

    await waitFor(() => {
      expect(screen.getByText("No Projects")).toBeInTheDocument();
    });
  });

  it("displays projects from backend (source of truth)", async () => {
    mockListProjects.mockResolvedValue([
      { id: "project-1", name: "My Video Project", createdAt: 1000, modifiedAt: Date.now() - 3600000 },
      { id: "project-2", name: "Another Project", createdAt: 1000, modifiedAt: Date.now() - 7200000 },
    ]);
    mockCheckForRecovery.mockResolvedValue([]);

    render(<RecentProjects />);

    await waitFor(() => {
      expect(screen.getByText("My Video Project")).toBeInTheDocument();
      expect(screen.getByText("Another Project")).toBeInTheDocument();
    });
  });

  it("falls back to auto-save when backend is unreachable", async () => {
    mockListProjects.mockResolvedValue(null);
    mockCheckForRecovery.mockResolvedValue([
      {
        id: "project-1-slot-0",
        projectId: "project-1",
        projectName: "Local Project",
        timestamp: Date.now() - 3600000,
        slot: 0,
        isRecovery: true,
      },
    ]);

    render(<RecentProjects />);

    await waitFor(() => {
      expect(screen.getByText("Local Project")).toBeInTheDocument();
    });
  });

  it("merges backend projects with auto-save timestamps", async () => {
    mockListProjects.mockResolvedValue([
      { id: "project-1", name: "Project v1", createdAt: 1000, modifiedAt: Date.now() - 7200000 },
    ]);
    mockCheckForRecovery.mockResolvedValue([
      {
        id: "project-1-slot-0",
        projectId: "project-1",
        projectName: "Project v1",
        timestamp: Date.now() - 1000,
        slot: 0,
        isRecovery: true,
      },
    ]);

    render(<RecentProjects />);

    await waitFor(() => {
      expect(screen.getByText("Projects (1)")).toBeInTheDocument();
      expect(screen.getByText("Project v1")).toBeInTheDocument();
    });
  });

  it("deduplicates by project ID showing most recent auto-save name", async () => {
    mockListProjects.mockResolvedValue(null);
    mockCheckForRecovery.mockResolvedValue([
      {
        id: "project-1-slot-1",
        projectId: "project-1",
        projectName: "Project v2",
        timestamp: Date.now(),
        slot: 1,
        isRecovery: true,
      },
      {
        id: "project-1-slot-0",
        projectId: "project-1",
        projectName: "Project v1",
        timestamp: Date.now() - 3600000,
        slot: 0,
        isRecovery: true,
      },
    ]);

    render(<RecentProjects />);

    await waitFor(() => {
      expect(screen.getByText("Projects (1)")).toBeInTheDocument();
      expect(screen.getByText("Project v2")).toBeInTheDocument();
      expect(screen.queryByText("Project v1")).not.toBeInTheDocument();
    });
  });

  it("calls recoverFromAutoSave when fallback project is selected", async () => {
    mockListProjects.mockResolvedValue(null);
    mockCheckForRecovery.mockResolvedValue([
      {
        id: "project-1-slot-0",
        projectId: "project-1",
        projectName: "Test Project",
        timestamp: Date.now(),
        slot: 0,
        isRecovery: true,
      },
    ]);
    mockRecoverFromAutoSave.mockResolvedValue(true);
    const onProjectSelected = vi.fn();

    render(<RecentProjects onProjectSelected={onProjectSelected} />);

    await waitFor(() => {
      expect(screen.getByText("Test Project")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Test Project"));

    await waitFor(() => {
      expect(mockRecoverFromAutoSave).toHaveBeenCalledWith("project-1-slot-0");
      expect(onProjectSelected).toHaveBeenCalled();
    });
  });

  it("removes project from list when delete is clicked", async () => {
    mockListProjects.mockResolvedValue(null);
    mockCheckForRecovery.mockResolvedValue([
      {
        id: "project-1-slot-0",
        projectId: "project-1",
        projectName: "Project to Remove",
        timestamp: Date.now(),
        slot: 0,
        isRecovery: true,
      },
    ]);

    render(<RecentProjects />);

    await waitFor(() => {
      expect(screen.getByText("Project to Remove")).toBeInTheDocument();
    });

    const removeButton = screen.getByTitle("Remove from projects");
    fireEvent.click(removeButton);

    await waitFor(() => {
      expect(screen.queryByText("Project to Remove")).not.toBeInTheDocument();
      expect(screen.getByText("No Projects")).toBeInTheDocument();
    });
  });

  it("shows relative dates for timestamps", async () => {
    mockListProjects.mockResolvedValue(null);
    mockCheckForRecovery.mockResolvedValue([
      {
        id: "project-1-slot-0",
        projectId: "project-1",
        projectName: "Today Project",
        timestamp: Date.now() - 1000,
        slot: 0,
        isRecovery: true,
      },
    ]);

    render(<RecentProjects />);

    await waitFor(() => {
      expect(screen.getByText("Today")).toBeInTheDocument();
    });
  });
});
