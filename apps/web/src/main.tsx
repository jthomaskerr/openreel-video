import React from "react";
import ReactDOM from "react-dom/client";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import App from "./App";
import "./index.css";
import { registerServiceWorker } from "./services/service-worker";
import { initCustomFonts } from "./components/editor/inspector/font-options";

// ── Global console.error → log store ────────────────────────────────
// Intercept every console.error so errors are captured in the Log pane.
import { logBus } from "./stores/log-store";
const _origConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  _origConsoleError(...args);
  const msg = args.map((a) => (typeof a === "string" ? a : String(a))).join(" ");
  if (msg.length > 0 && msg.length < 500) {
    let kind: import("./stores/problem-store").ProblemKind = "import_error";
    let source = "console.error";
    if (msg.includes("Bridge")) { source = "bridge"; }
    else if (msg.includes("Engine") || msg.includes("initializ")) { source = "engine"; }
    else if (msg.includes("export")) { source = "export"; }
    else if (msg.includes("import")) { source = "import"; }
    else if (msg.includes("audio") || msg.includes("Audio")) { source = "audio"; }
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
