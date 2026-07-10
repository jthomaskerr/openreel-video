import assert from "node:assert/strict";
import { test } from "node:test";
import { redactSecrets } from "./redaction.js";
import { rejectBrowserProviderKey, requireJsonContentType } from "./security.js";
test("browser provider key is rejected", () => assert.throws(() => rejectBrowserProviderKey({ "x-wavespeed-api-key": "secret" }), /provider-key-header-forbidden/));
test("redaction removes bearer and signed URL values", () => { const value = redactSecrets({ authorization: "Bearer abc", signedUrl: "https://x.test/a?signature=abc", prompt: "keep" }); assert.deepEqual(value, { authorization: "[REDACTED]", signedUrl: "[REDACTED]", prompt: "keep" }); });
test("JSON content type is strict", () => assert.throws(() => requireJsonContentType("text/plain"), /content-type-required/));
