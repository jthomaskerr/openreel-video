# Repository scripts

## Chrome CDP browser helper

`chrome-cdp.mjs` drives an existing Chromium/Chrome page through the Chrome
DevTools Protocol without adding Playwright or Puppeteer to the project. It is a
small fallback for local browser verification when the Browser plugin is not
available. It can inspect or interact with the DOM, upload fixture files through
a file input, and capture screenshot evidence.

Start Chrome with remote debugging and open the already-running app:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new \
  --remote-debugging-port=9223 \
  --user-data-dir=/tmp/openreel-chrome-profile \
  http://localhost:5173
```

Evaluate JavaScript in the matching page:

```sh
node scripts/chrome-cdp.mjs eval 'document.title'
node scripts/chrome-cdp.mjs eval \
  'JSON.stringify([...document.querySelectorAll("button")].map((button) => button.title))'
```

Upload one or more media fixtures through OpenReel's media input:

```sh
node scripts/chrome-cdp.mjs upload \
  /tmp/example.png \
  /tmp/example.mp4
```

Use `--selector '<css>'` immediately after `upload` for another file input. File
paths must be absolute because Chrome, not the Node process, reads them.

Capture the current viewport:

```sh
node scripts/chrome-cdp.mjs screenshot /tmp/openreel-browser-check.png
```

Global options precede the command. Use `--port <number>` for another debugging
port and `--url-contains <text>` to select a different page target. The default
target is a page whose URL contains `5173` on debugging port `9223`.

Run the deterministic CLI tests with:

```sh
node --test scripts/chrome-cdp.test.mjs
```

This helper does not start the app or Chrome, manage authentication, or replace
full cross-browser coverage. JavaScript passed to `eval` has the same authority
as DevTools on the selected page, so only use trusted expressions and local
targets.
