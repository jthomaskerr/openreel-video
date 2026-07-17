import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

const moduleUrl = (path: string) => `/@fs${resolve(process.cwd(), path)}`;

test("480p export geometry covers the WebKit output canvas", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(
    async ({ transformUrl, geometryUrl }) => {
      const { mapTransformToOutput } = await import(transformUrl);
      const { calculateFrameDrawRect } = await import(geometryUrl);
      const outputWidth = 854;
      const outputHeight = 480;
      const transform = mapTransformToOutput(
        {
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          anchor: { x: 0.5, y: 0.5 },
          opacity: 1,
          fitMode: "contain",
        },
        1920,
        1080,
        outputWidth,
        outputHeight,
      );
      const rect = calculateFrameDrawRect({
        sourceWidth: 1920,
        sourceHeight: 1080,
        canvasWidth: outputWidth,
        canvasHeight: outputHeight,
        fitMode: transform.fitMode,
        anchor: transform.anchor,
      });

      const canvas = document.createElement("canvas");
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("WebKit did not provide a 2D canvas context");
      context.fillStyle = "black";
      context.fillRect(0, 0, outputWidth, outputHeight);
      context.save();
      context.translate(outputWidth / 2, outputHeight / 2);
      context.scale(transform.scale.x, transform.scale.y);
      context.fillStyle = "white";
      context.fillRect(rect.x, rect.y, rect.width, rect.height);
      context.restore();

      const pixels = context.getImageData(0, 0, outputWidth, outputHeight).data;
      let litPixels = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index] > 200) litPixels += 1;
      }

      return {
        scale: transform.scale,
        coverage: litPixels / (outputWidth * outputHeight),
        rect,
      };
    },
    {
      transformUrl: moduleUrl("../../packages/core/src/video/output-transform.ts"),
      geometryUrl: moduleUrl("../../packages/core/src/video/frame-draw-geometry.ts"),
    },
  );

  expect(result.scale).toEqual({ x: 1, y: 1 });
  expect(result.rect.height).toBe(480);
  expect(result.coverage).toBeGreaterThan(0.99);
});

test("custom export exposes a validated start and end section", async ({ page }) => {
  await page.goto("/");

  const recoveryDialog = page.getByRole("dialog", { name: "Recover Your Work" });
  if (await recoveryDialog.isVisible()) {
    await recoveryDialog.getByRole("button", { name: "Close" }).click();
  }

  await page
    .getByRole("button", {
      name: "Horizontal YouTube, Vimeo, Web 1920 × 1080 Start creating",
    })
    .click();
  await page.getByRole("button", { name: "Video 1920×1080" }).click();
  await page.getByRole("button", { name: "Create Project" }).click();

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z8DAwMDAxMDAwMAAAAwBAQDJ/pLvAAAAAElFTkSuQmCC",
    "base64",
  );
  await page
    .locator('input[type="file"][accept="video/*,audio/*,image/*"]')
    .setInputFiles({ name: "range-fixture.png", mimeType: "image/png", buffer: png });
  const mediaCard = page
    .getByRole("img", { name: "Range fixture" })
    .locator("..")
    .locator("..");
  await mediaCard.dblclick({ force: true });

  await page.getByRole("button", { name: "Open editor menu" }).click();
  await page.getByRole("menuitem", { name: "Export" }).hover();
  await page
    .getByRole("menuitem", {
      name: "Custom export… Full settings with AI upscaling",
    })
    .click();

  const start = page.getByLabel("Start (seconds)");
  const end = page.getByLabel("End (seconds)");
  await expect(start).toHaveValue("0");
  await expect(end).toHaveValue("5");

  await start.fill("4");
  await end.fill("3");
  await expect(page.getByRole("alert")).toContainText("End must be after start");
  await expect(page.getByRole("button", { name: "Start Export" })).toBeDisabled();

  await start.fill("1");
  await end.fill("3");
  await expect(page.getByRole("alert")).toBeHidden();
  await page
    .getByRole("button", {
      name: "YouTube 1080p HD Standard HD quality for YouTube 1920x1080 30fps 16:9",
    })
    .click();
  await expect(page.getByRole("button", { name: "Start Export" })).toBeEnabled();
});
