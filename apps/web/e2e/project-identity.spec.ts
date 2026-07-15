import { expect, test, type APIRequestContext } from "@playwright/test";

const ORCHESTRATOR_URL = "http://localhost:4041";

async function projectIds(request: APIRequestContext): Promise<string[]> {
  const response = await request.get(`${ORCHESTRATOR_URL}/api/projects`);
  expect(response.ok()).toBe(true);
  const payload = await response.json() as unknown;
  const projects = Array.isArray(payload)
    ? payload
    : (payload as { projects?: unknown[] }).projects ?? [];
  return projects
    .map((project) => (project as { id?: unknown }).id)
    .filter((id): id is string => typeof id === "string")
    .sort();
}

test("both supported project URLs load only the requested slug without creating a project", async ({
  browser,
  request,
}) => {
  const beforeIds = await projectIds(request);
  const projectPosts: string[] = [];
  const stateChangingWrites: string[] = [];
  const consoleErrors: string[] = [];

  const entries = [
    {
      url: "/#/editor?projectId=vintage-tokyo",
      screenshot: "/tmp/openreel-project-identity-hash.png",
    },
    {
      url: "/?projectId=vintage-tokyo#/editor",
      screenshot: "/tmp/openreel-project-identity-page-query.png",
    },
  ];

  for (const entry of entries) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on("request", (outbound) => {
      if (["PUT", "PATCH", "DELETE"].includes(outbound.method()) && outbound.url().includes("/api/")) {
        stateChangingWrites.push(`${outbound.method()} ${outbound.url()}`);
      }
      if (outbound.method() === "POST" && /\/api\/projects\/?$/.test(outbound.url())) {
        projectPosts.push(outbound.url());
      }
    });
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await page.goto(`http://localhost:5173${entry.url}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Vintage Tokyo", { exact: true }).first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Unresolved project");
    await expect(page.locator("body")).not.toContainText("Could not load requested project");
    await expect(page.locator("body")).not.toContainText("Welcome to OpenReel");
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    expect(page.url()).toContain("projectId=vintage-tokyo");
    expect(await page.title()).not.toBe("");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText("Vintage Tokyo", { exact: true }).first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Welcome to OpenReel");
    await page.waitForTimeout(1_000);
    await page.screenshot({ path: entry.screenshot });
    await page.close();
  }

  expect(projectPosts).toEqual([]);
  expect(stateChangingWrites).toEqual([]);
  expect(await projectIds(request)).toEqual(beforeIds);
  expect(consoleErrors).toEqual([]);
});
