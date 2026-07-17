import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "export-scaling-webkit.spec.ts",
  timeout: 30_000,
  reporter: "line",
  workers: 1,
  use: {
    baseURL: "http://localhost:5173",
    browserName: "webkit",
    headless: true,
    viewport: { width: 1000, height: 700 },
  },
});
