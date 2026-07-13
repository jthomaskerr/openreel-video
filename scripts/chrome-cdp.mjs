#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const DEFAULT_MEDIA_SELECTOR = 'input[type="file"][accept="video/*,audio/*,image/*"]';

export function parseArgs(argv) {
  const args = [...argv];
  const options = { port: 9223, urlContains: "5173" };

  while (args[0]?.startsWith("--")) {
    const flag = args.shift();
    const value = args.shift();
    if (!value) throw new Error(`${flag} requires a value`);
    if (flag === "--port") options.port = Number(value);
    else if (flag === "--url-contains") options.urlContains = value;
    else throw new Error(`Unknown option: ${flag}`);
  }

  const command = args.shift();
  if (!command) throw new Error("A command is required: eval, upload, or screenshot");
  return { command, args, options };
}

async function connect({ port, urlContains }) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const target = targets.find(
    (entry) => entry.type === "page" && entry.url.includes(urlContains),
  );
  if (!target) throw new Error(`No page target contains ${JSON.stringify(urlContains)}`);

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
    if (message.error) handler.reject(new Error(message.error.message));
    else handler.resolve(message.result);
  });

  const send = (method, params = {}) => {
    const id = ++nextId;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };

  return { send, close: () => socket.close(), target };
}

export async function run(argv) {
  const { command, args, options } = parseArgs(argv);
  const client = await connect(options);
  try {
    if (command === "eval") {
      const expression = args.join(" ");
      if (!expression) throw new Error("eval requires a JavaScript expression");
      const result = await client.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text ?? "Browser evaluation failed");
      }
      return result.result?.value;
    }

    if (command === "upload") {
      let selector = DEFAULT_MEDIA_SELECTOR;
      if (args[0] === "--selector") {
        args.shift();
        selector = args.shift();
      }
      if (!selector || args.length === 0) {
        throw new Error("upload requires one or more absolute file paths");
      }
      const document = await client.send("DOM.getDocument", { depth: -1, pierce: true });
      const query = await client.send("DOM.querySelector", {
        nodeId: document.root.nodeId,
        selector,
      });
      if (!query.nodeId) throw new Error(`File input not found: ${selector}`);
      await client.send("DOM.setFileInputFiles", { nodeId: query.nodeId, files: args });
      return { uploaded: args, selector };
    }

    if (command === "screenshot") {
      const output = args[0];
      if (!output) throw new Error("screenshot requires an output path");
      const result = await client.send("Page.captureScreenshot", {
        format: output.endsWith(".jpg") ? "jpeg" : "png",
        captureBeyondViewport: false,
      });
      await writeFile(output, Buffer.from(result.data, "base64"));
      return { output };
    }

    throw new Error(`Unknown command: ${command}`);
  } finally {
    client.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2))
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
