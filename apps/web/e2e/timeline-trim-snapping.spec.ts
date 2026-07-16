import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

const ORCHESTRATOR_URL = "http://localhost:4041";
const RUN_ID = Date.now().toString(36);
const PROJECT_NAME = `Timeline Trim Snapping E2E ${RUN_ID}`;
const PROJECT_ID = `timeline-trim-snapping-e2e-${RUN_ID}`;
const SUBJECT_ID = "trim-subject";
const TARGET_ID = "snap-target";

type JsonObject = Record<string, any>;

function clip(id: string, startTime: number, duration: number, inPoint: number, outPoint: number): JsonObject {
  return {
    id,
    type: "video",
    mediaId: `shape-${id}`,
    trackId: "video-track",
    startTime,
    duration,
    inPoint,
    outPoint,
    effects: [],
    audioEffects: [],
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation: 0,
      anchor: { x: 0.5, y: 0.5 },
      opacity: 1,
    },
    volume: 1,
    keyframes: [],
  };
}

async function deleteFixture(request: APIRequestContext): Promise<void> {
  const existing = await request.get(`${ORCHESTRATOR_URL}/api/projects/${PROJECT_ID}`);
  if (existing.ok()) {
    const deleted = await request.delete(`${ORCHESTRATOR_URL}/api/projects/${PROJECT_ID}`);
    expect(deleted.ok()).toBe(true);
  }
}

async function expectBackendTiming(
  request: APIRequestContext,
  expected: { startTime: number; duration: number; inPoint: number; outPoint: number },
): Promise<void> {
  await expect.poll(async () => {
    const response = await request.get(`${ORCHESTRATOR_URL}/api/projects/${PROJECT_ID}`);
    if (!response.ok()) return null;
    const payload = await response.json() as JsonObject;
    const tracks = (payload.project as JsonObject).timeline.tracks as JsonObject[];
    const current = tracks
      .flatMap((track) => track.clips as JsonObject[])
      .find((item) => item.id === SUBJECT_ID);
    return current
      ? [current.startTime, current.duration, current.inPoint, current.outPoint]
      : null;
  }, { timeout: 30_000 }).toEqual([
    expected.startTime,
    expected.duration,
    expected.inPoint,
    expected.outPoint,
  ]);
}

async function createFixture(request: APIRequestContext): Promise<void> {
  await deleteFixture(request);

  const createdResponse = await request.post(`${ORCHESTRATOR_URL}/api/projects`, {
    data: { name: PROJECT_NAME },
  });
  expect(createdResponse.ok(), await createdResponse.text()).toBe(true);
  const created = await createdResponse.json() as JsonObject;
  const project = created.project as JsonObject;
  expect(project.id).toBe(PROJECT_ID);

  const fixture = {
    ...project,
    modifiedAt: Math.max(Date.now(), Number(project.modifiedAt) + 1),
    mediaLibrary: { ...project.mediaLibrary, items: [] },
    timeline: {
      ...project.timeline,
      duration: 60,
      tracks: [{
        id: "video-track",
        type: "video",
        name: "Video",
        clips: [
          clip(SUBJECT_ID, 10, 8, 2, 10),
          clip(TARGET_ID, 14, 2, 0, 2),
        ],
        transitions: [],
        locked: false,
        hidden: false,
        muted: false,
        solo: false,
      }],
    },
  };

  // Seed through the import route so the fixture is committed as an initial
  // project snapshot without invoking the media-manifest audit used by PUT.
  await deleteFixture(request);
  const importedResponse = await request.post(`${ORCHESTRATOR_URL}/api/projects/import`, {
    data: fixture,
  });
  expect(importedResponse.ok(), await importedResponse.text()).toBe(true);
}

async function pixelsPerSecond(page: Page): Promise<number> {
  const label = page.getByText(/\d+px\/s/, { exact: true });
  await expect(label).toBeVisible();
  const match = (await label.textContent())?.match(/(\d+)px\/s/);
  expect(match).toBeTruthy();
  return Number(match![1]);
}

async function timelineTime(
  handle: Locator,
  scroller: Locator,
  pixelsPerSecondValue: number,
  edge: "left" | "right" = "left",
): Promise<number> {
  const [handleBox, scrollerBox, scrollLeft] = await Promise.all([
    handle.boundingBox(),
    scroller.boundingBox(),
    scroller.evaluate((node) => node.scrollLeft),
  ]);
  expect(handleBox).toBeTruthy();
  expect(scrollerBox).toBeTruthy();
  const edgeX = handleBox!.x + (edge === "right" ? handleBox!.width : 0);
  return (edgeX - scrollerBox!.x + scrollLeft) / pixelsPerSecondValue;
}

async function dragBySeconds(page: Page, handle: Locator, seconds: number, release = true): Promise<void> {
  const box = await handle.boundingBox();
  expect(box).toBeTruthy();
  const pps = await pixelsPerSecond(page);
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await handle.dispatchEvent("mousedown", { button: 0, clientX: x, clientY: y });
  await page.mouse.move(x + seconds * pps, y, { steps: 8 });
  if (release) await page.mouse.up();
}

async function expectInspectorTiming(
  page: Page,
  leftHandle: Locator,
  expected: { startTime: number; duration: number; endTime: number },
): Promise<void> {
  const box = await leftHandle.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.click(box!.x + box!.width + 12, box!.y + box!.height / 2);
  await expect(page.getByLabel("Clip start time")).toHaveValue(expected.startTime.toFixed(2));
  await expect(page.getByLabel("Clip duration")).toHaveValue(expected.duration.toFixed(2));
  await expect(page.getByLabel("Clip end time")).toHaveValue(expected.endTime.toFixed(2));
}

test("left and right trim stay rendered, persisted, and snapped at zoom plus scroll", async ({ page, request }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("openreel-ui-preferences", JSON.stringify({
      state: {
        snapSettings: {
          enabled: true,
          snapToGrid: false,
          snapToClips: true,
          snapToPlayhead: false,
          snapToMarkers: false,
          gridSize: 1,
          snapThreshold: 8,
        },
      },
      version: 1,
    }));
  });

  await createFixture(request);
  try {
    await page.goto(`/?projectId=${PROJECT_ID}#/editor`, { waitUntil: "domcontentloaded" });
    expect(page.url()).toContain(`projectId=${PROJECT_ID}`);

    const scroller = page.getByTestId("timeline-scroll-container");
    const left = page.getByTestId(`clip-trim-left-${SUBJECT_ID}`);
    const right = page.getByTestId(`clip-trim-right-${SUBJECT_ID}`);
    await expect(left).toBeVisible();
    await expect(right).toBeVisible();

    const snapButton = page.getByTitle(/Snap (on|off) \(N\)/);
    if ((await snapButton.getAttribute("title"))?.startsWith("Snap on")) await snapButton.click();
    await expect(snapButton).toHaveAttribute("title", "Snap off (N)");

    let pps = await pixelsPerSecond(page);
    await dragBySeconds(page, left, 3);
    await expect.poll(() => timelineTime(left, scroller, pps)).toBeCloseTo(13, 1);
    await expect.poll(() => timelineTime(right, scroller, pps, "right")).toBeCloseTo(18, 1);
    await expectInspectorTiming(page, left, { startTime: 13, duration: 5, endTime: 18 });
    await expectBackendTiming(request, { startTime: 13, duration: 5, inPoint: 5, outPoint: 10 });

    await dragBySeconds(page, left, -2);
    await expect.poll(() => timelineTime(left, scroller, pps)).toBeCloseTo(11, 1);
    await expect.poll(() => timelineTime(right, scroller, pps, "right")).toBeCloseTo(18, 1);
    await expectInspectorTiming(page, left, { startTime: 11, duration: 7, endTime: 18 });
    await expectBackendTiming(request, { startTime: 11, duration: 7, inPoint: 3, outPoint: 10 });

    await dragBySeconds(page, right, -1);
    await expect.poll(() => timelineTime(right, scroller, pps, "right")).toBeCloseTo(17, 1);
    await expectInspectorTiming(page, left, { startTime: 11, duration: 6, endTime: 17 });
    await expectBackendTiming(request, { startTime: 11, duration: 6, inPoint: 3, outPoint: 9 });

    await page.getByTitle("Zoom in").click();
    pps = await pixelsPerSecond(page);
    await scroller.evaluate((node) => { node.scrollLeft = 120; node.dispatchEvent(new Event("scroll")); });
    await expect.poll(() => scroller.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);

    await snapButton.click();
    await expect(snapButton).toHaveAttribute("title", "Snap on (N)");

    const box = await left.boundingBox();
    expect(box).toBeTruthy();
    const startX = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;
    await page.mouse.move(startX, y);
    await left.dispatchEvent("mousedown", { button: 0, clientX: startX, clientY: y });
    await page.mouse.move(startX + 3 * pps - 4, y, { steps: 8 });
    await expect(page.getByTestId("timeline-snap-indicator")).toBeVisible();
    await expect.poll(() => timelineTime(left, scroller, pps)).toBeCloseTo(14, 1);

    await page.mouse.move(startX + 3 * pps - 14, y, { steps: 4 });
    await expect(page.getByTestId("timeline-snap-indicator")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("timeline-snap-indicator")).toHaveCount(0);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await deleteFixture(request);
  }
});
