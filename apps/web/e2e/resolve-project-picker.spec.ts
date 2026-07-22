import { expect, test, type Page, type Route } from "@playwright/test";
import { createHandoffFixtureProject } from "../../../packages/core/src/export/handoff/__fixtures__/projects";

const projectId = "vintage-tokyo";
const revision = "0123456789abcdef0123456789abcdef01234567";
const jobId = "2430ba4b-6b35-4c51-8ed2-cf0920710617";
const launchToken = "9b705f5b-638e-4307-bf1f-313ba3e157b7";
const launchUrl = `openreel-resolve://import/${launchToken}`;

const project = createHandoffFixtureProject({
  id: projectId,
  name: "Vintage Tokyo",
  description: "A neon travel film assembled from the OpenReel project store.",
  createdAt: Date.UTC(2026, 6, 11, 9),
  modifiedAt: Date.UTC(2026, 6, 22, 10),
});

const preview = {
  projectId,
  revision,
  name: "Vintage Tokyo",
  description: project.description,
  createdAt: project.createdAt,
  modifiedAt: project.modifiedAt,
  durationFrames: 7_980,
  frameRate: 30,
  trackCount: 4,
  clipCount: 38,
  mediaCount: 33,
  render: {
    status: "ready",
    mediaId: "render-1",
    previewUrl: `/api/projects/${projectId}/media/render-1`,
    updatedAt: project.modifiedAt,
    stale: false,
  },
  miniTimeline: {
    durationFrames: 7_980,
    tracks: [{
      id: "video-track-1",
      index: 0,
      type: "video",
      clips: [{ id: "video-1", label: "Shibuya Crossing", startFrame: 10, endFrame: 400 }],
    }],
  },
  clipGroups: [
    {
      type: "video",
      clips: [{
        id: "video-1",
        mediaId: "media-video-1",
        label: "Shibuya Crossing",
        startFrame: 10,
        endFrame: 400,
        preview: {
          status: "ready",
          kind: "video",
          url: `/api/projects/${projectId}/media/media-video-1`,
          thumbnailUrl: `/api/projects/${projectId}/media/media-video-1/thumbnail`,
        },
      }],
    },
    {
      type: "audio",
      clips: [{
        id: "audio-1",
        mediaId: "media-audio-1",
        label: "Vintage Tokyo Master",
        startFrame: 0,
        endFrame: 7_980,
        preview: {
          status: "ready",
          kind: "audio",
          url: `/api/projects/${projectId}/media/media-audio-1`,
          waveformUrl: `/api/projects/${projectId}/media/media-audio-1/waveform`,
        },
      }],
    },
  ],
  compatibility: { status: "degraded", blockingIssueCount: 0, warningCount: 1 },
};

const readyJob = {
  id: jobId,
  projectId,
  revision,
  phase: "ready",
  processed: 38,
  total: 38,
  percent: 100,
  warnings: ["One title will be flattened."],
  createdAt: "2026-07-22T10:00:00.000Z",
  updatedAt: "2026-07-22T10:00:00.000Z",
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function installResolveExportFixtures(page: Page, failFirstList = false) {
  let listAttempts = 0;
  let launchRequest: string | null = null;
  const exportRequests: unknown[] = [];

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Page.enable");
  await cdp.send("Network.enable");
  const recordLaunch = (event: { url?: string; request?: { url?: string } }) => {
    const url = event.url ?? event.request?.url;
    if (url?.startsWith("openreel-resolve://")) launchRequest = url;
  };
  cdp.on("Page.frameRequestedNavigation", recordLaunch);
  cdp.on("Network.requestWillBeSent", recordLaunch);
  await page.route("http://localhost:4041/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path === `/api/projects/${projectId}` && request.method() === "GET") {
      return json(route, {
        project,
        mediaFiles: {},
        saved: true,
        projectId,
        persistedAt: project.modifiedAt,
        sourceModifiedAt: project.modifiedAt,
        commitSha: revision,
        treeSha: "89abcdef0123456789abcdef0123456789abcdef",
        projectBlobSha: "fedcba9876543210fedcba9876543210fedcba98",
        mediaManifestDigest: "sha256:resolve-e2e",
        lfsPayloads: [],
        committed: true,
        commitDueAt: null,
      });
    }
    if (path === "/api/projects" && request.method() === "GET") {
      listAttempts += 1;
      if (failFirstList && listAttempts === 1) return json(route, { error: "temporary" }, 503);
      return json(route, [{
        id: projectId,
        name: "Vintage Tokyo",
        description: preview.description,
        createdAt: preview.createdAt,
        modifiedAt: preview.modifiedAt,
      }]);
    }
    if (path === `/api/projects/${projectId}/resolve-preview`) return json(route, preview);
    if (path === `/api/projects/${projectId}/exports/resolve` && request.method() === "POST") {
      exportRequests.push(request.postDataJSON());
      return json(route, {
        job: readyJob,
        jobId,
        revision,
        phase: "ready",
        statusUrl: `/api/projects/${projectId}/exports/resolve/${jobId}`,
        cancelUrl: `/api/projects/${projectId}/exports/resolve/${jobId}`,
        bridgeLaunchUrl: launchUrl,
      });
    }
    if (path === `/api/projects/${projectId}/exports/resolve/${jobId}`) return json(route, readyJob);
    if (path.includes("/media/")) {
      return route.fulfill({ status: 200, contentType: "application/octet-stream", body: "fixture" });
    }
    if (["POST", "PUT", "PATCH"].includes(request.method())) {
      return json(route, { saved: true, projectId, sourceModifiedAt: project.modifiedAt, committed: true });
    }
    return json(route, { error: "unhandled fake route" }, 404);
  });

  return {
    exportRequests,
    listAttempts: () => listAttempts,
    launchRequest: () => launchRequest,
  };
}

async function openResolvePicker(page: Page, keyboardOnly = false) {
  const activate = async (locator: ReturnType<Page["getByRole"]>) => {
    if (keyboardOnly) {
      await locator.focus();
      await page.keyboard.press("Enter");
    } else {
      await locator.click();
    }
  };
  await activate(page.getByRole("button", { name: "Open editor menu" }));
  const exportMenu = page.getByRole("menuitem", { name: "Export" });
  if (keyboardOnly) {
    await exportMenu.focus();
    await page.keyboard.press("ArrowRight");
  } else {
    await exportMenu.hover();
  }
  await activate(page.getByRole("menuitem", { name: /^Continue editing…/ }));
  await activate(page.getByRole("button", { name: /DaVinci Resolve/i }));
  await activate(page.getByRole("button", { name: /Start handoff/i }));
}

test("selects Vintage Tokyo, retries loading, previews rich media, and launches one verified Resolve job", async ({ page }) => {
  const fixture = await installResolveExportFixtures(page, true);
  await page.goto("/?projectId=vintage-tokyo#/editor", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Vintage Tokyo", { exact: true }).first()).toBeVisible();
  await openResolvePicker(page);

  await expect(page.getByRole("alert")).toContainText("Could not load projects");
  await page.getByRole("button", { name: /Retry loading projects/i }).click();
  await page.getByRole("option", { name: /Vintage Tokyo/i }).click();
  await expect(page.getByRole("heading", { name: "Vintage Tokyo", exact: true })).toBeVisible();
  await expect(page.getByText("11 July 2026")).toBeVisible();
  await expect(page.getByLabel("Latest rendered output", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Play Vintage Tokyo Master" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Video, 1 clip" })).toBeVisible();

  await page.getByRole("button", { name: "Open in Resolve" }).click();
  await expect(page.getByText(/Resolve export is ready to open/i)).toBeVisible();
  await expect.poll(fixture.launchRequest).toBe(launchUrl);
  expect(fixture.listAttempts()).toBe(2);
  expect(fixture.exportRequests).toHaveLength(1);
  expect(fixture.exportRequests[0]).toMatchObject({ revision, selection: { projectId, target: "resolve" } });
});

test("completes the picker with keyboard controls at 200% zoom without document overflow", async ({ page }) => {
  const fixture = await installResolveExportFixtures(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/?projectId=vintage-tokyo#/editor", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Vintage Tokyo", { exact: true }).first()).toBeVisible();
  await page.evaluate(() => { document.body.style.zoom = "2"; });
  await openResolvePicker(page, true);

  const option = page.getByRole("option", { name: /Vintage Tokyo/i });
  await option.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Vintage Tokyo", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

  const launch = page.getByRole("button", { name: "Open in Resolve" });
  await launch.focus();
  await page.keyboard.press("Enter");
  await expect.poll(fixture.launchRequest).toBe(launchUrl);
  expect(fixture.exportRequests).toHaveLength(1);
});
