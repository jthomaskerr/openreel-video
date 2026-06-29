import React from "react";
import ReactDOM from "react-dom/client";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import App from "./App";
import "./index.css";
import { registerServiceWorker } from "./services/service-worker";
import { initCustomFonts } from "./components/editor/inspector/font-options";

// ── Global console.error → immutable error log ──────────────────────
// Intercept every console.error so errors are captured in the Log pane.
// Only explicit problemBus.report() calls create actionable Problems.
import { logBus } from "./stores/log-store";
const _origConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  _origConsoleError(...args);
  const msg = args.map((a) => (typeof a === "string" ? a : String(a))).join(" ");
  if (msg.length > 0 && msg.length < 500) {
    // Derive a rough kind and source from the message prefix
    let kind: import("./stores/problem-store").ProblemKind = "unknown_error";
    let source = "console.error";
    if (msg.includes("[EffectsBridge]")) { kind = "effect_error"; source = "bridge:effects"; }
    else if (msg.includes("[TransitionBridge]")) { kind = "transition_error"; source = "bridge:transition"; }
    else if (msg.includes("[RenderBridge]") || msg.includes("RenderBridge")) { kind = "render_error"; source = "bridge:render"; }
    else if (msg.includes("MediaBridge")) { kind = "media_error"; source = "bridge:media"; }
    else if (msg.includes("GraphicsBridge")) { kind = "graphics_error"; source = "bridge:graphics"; }
    else if (msg.includes("TextBridge")) { kind = "text_error"; source = "bridge:text"; }
    else if (msg.includes("PhotoBridge")) { kind = "photo_error"; source = "bridge:photo"; }
    else if (msg.includes("Bridge")) { kind = "bridge_error"; source = "bridge"; }
    else if (msg.includes("Engine") || msg.includes("initializ")) { kind = "engine_error"; source = "engine"; }
    else if (msg.includes("export")) kind = "export_error";
    else if (msg.includes("import")) kind = "import_error";
    else if (msg.includes("render")) kind = "render_error";
    else if (msg.includes("audio") || msg.includes("Audio")) kind = "audio_error";

    logBus.entry({
      kind,
      message: msg.slice(0, 300),
      label: msg.slice(0, 80),
      source,
    });
  }
};

const POSTHOG_KEY = import.meta.env.VITE_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = import.meta.env.VITE_PUBLIC_POSTHOG_HOST;

if (POSTHOG_KEY && POSTHOG_HOST) {
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    capture_pageview: true,
    capture_pageleave: true,
  });
}

registerServiceWorker().then((registration) => {
  if (registration) {
  }
});

void initCustomFonts();

const root = document.getElementById("root")!;

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    {POSTHOG_KEY && POSTHOG_HOST ? (
      <PostHogProvider client={posthog}>
        <App />
      </PostHogProvider>
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
