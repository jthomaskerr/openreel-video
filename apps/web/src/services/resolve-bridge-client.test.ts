import { describe, expect, it, vi } from "vitest";
import {
  ResolveBridgeClientError,
  getExportJob,
  launchResolveBridge,
} from "./resolve-bridge-client";

describe("Resolve bridge client", () => {
  it("launches only a canonical one-token OpenReel Resolve URL", () => {
    const assign = vi.fn();
    launchResolveBridge(
      "openreel-resolve://import/123e4567-e89b-12d3-a456-426614174000",
      { assign },
    );

    expect(assign).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith(
      "openreel-resolve://import/123e4567-e89b-12d3-a456-426614174000",
    );
  });

  it.each([
    "file:///tmp/export",
    "openreel-resolve://import/123e4567-e89b-12d3-a456-426614174000?token=leak",
    "openreel-resolve://import/123e4567-e89b-12d3-a456-426614174000#fragment",
    "openreel-resolve://import/123e4567-e89b-12d3-a456-426614174000/extra",
    "openreel-resolve://user@import/123e4567-e89b-12d3-a456-426614174000",
    "openreel-resolve://import/%2e%2e/123e4567-e89b-12d3-a456-426614174000",
  ])("rejects unsafe bridge URL %s", (url) => {
    expect(() => launchResolveBridge(url, { assign: vi.fn() })).toThrow(
      "invalid bridge URL",
    );
  });

  it("maps malformed successful JSON to a user-safe client error", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ id: "not-a-uuid", secret: "/private/path" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      getExportJob("vintage-tokyo", "123e4567-e89b-12d3-a456-426614174000", {
        fetch: fetcher,
      }),
    ).rejects.toMatchObject({
      name: "ResolveBridgeClientError",
      code: "INVALID_RESPONSE",
      message: "The Resolve export returned an invalid response.",
    } satisfies Partial<ResolveBridgeClientError>);
    expect(fetcher).toHaveBeenCalledWith(
      "http://localhost:4041/api/projects/vintage-tokyo/exports/resolve/123e4567-e89b-12d3-a456-426614174000",
      expect.objectContaining({ signal: undefined }),
    );
  });

  it("uses the backend's stable error code without exposing untrusted details", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: { code: "LAUNCH_TOKEN_EXPIRED", message: "/project/private/internal" },
        }),
        { status: 410, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      getExportJob("vintage-tokyo", "123e4567-e89b-12d3-a456-426614174000", {
        fetch: fetcher,
      }),
    ).rejects.toMatchObject({
      name: "ResolveBridgeClientError",
      code: "LAUNCH_TOKEN_EXPIRED",
      message: "The Resolve launch request is no longer available.",
    } satisfies Partial<ResolveBridgeClientError>);
  });
});
