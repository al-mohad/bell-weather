/**
 * Renders docs/technical-overview.html to a print-ready PDF.
 *
 * The document is authored as HTML and committed, so the PDF is a build artifact
 * rather than a binary somebody has to hand-edit.
 *
 * Why this drives Chrome over the DevTools protocol instead of `--print-to-pdf`:
 * paged.js does its layout asynchronously after load, and Chrome's CLI print fires
 * either at load (too early) or when `--virtual-time-budget` expires - and virtual
 * time skips straight past paged.js's own scheduling, producing a one-page PDF of an
 * unpaginated document. Over CDP we can wait for the actual completion signal the page
 * raises, then print. Zero dependencies: Node's built-in WebSocket and fetch.
 *
 *   node scripts/build-pdf.mjs [output.pdf]
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'docs', 'technical-overview.html');
const OUTPUT = process.argv[2] ?? join(ROOT, 'docs', 'bellwether-technical-overview.pdf');
const PAGED = join(ROOT, 'docs', 'vendor', 'paged.polyfill.js');
const PAGED_URL = 'https://unpkg.com/pagedjs/dist/paged.polyfill.js';

const CHROME_CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const chromePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (!chromePath) {
  console.error('no Chrome or Chromium found; set CHROME=/path/to/chrome');
  process.exit(1);
}

// paged.js is a build-time dependency, not a runtime one, so it is fetched on demand
// and kept out of the repository rather than vendored into it.
if (!existsSync(PAGED)) {
  console.log(`fetching paged.js from ${PAGED_URL}`);
  const response = await fetch(PAGED_URL);
  if (!response.ok) throw new Error(`${PAGED_URL} returned ${response.status}`);
  mkdirSync(dirname(PAGED), { recursive: true });
  writeFileSync(PAGED, Buffer.from(await response.arrayBuffer()));
}

const profile = mkdtempSync(join(tmpdir(), 'bw-chrome-'));
const chrome = spawn(chromePath, [
  '--headless',
  '--disable-gpu',
  '--no-sandbox',
  '--no-first-run',
  '--remote-debugging-port=0',
  `--user-data-dir=${profile}`,
  'about:blank',
]);

const endpoint = await new Promise((fulfil, reject) => {
  const timer = setTimeout(
    () => reject(new Error('Chrome did not report a DevTools endpoint')),
    30_000,
  );
  chrome.stderr.setEncoding('utf8');
  chrome.stderr.on('data', (chunk) => {
    const match = /DevTools listening on (ws:\/\/\S+)/.exec(chunk);
    if (match) {
      clearTimeout(timer);
      fulfil(match[1]);
    }
  });
  chrome.on('exit', (code) => reject(new Error(`Chrome exited with ${code} before starting`)));
});

const socket = new WebSocket(endpoint);
await new Promise((fulfil, reject) => {
  socket.addEventListener('open', fulfil, { once: true });
  socket.addEventListener('error', () => reject(new Error('could not attach to Chrome')), {
    once: true,
  });
});

let nextId = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  const settle = pending.get(message.id);
  if (!settle) return;
  pending.delete(message.id);
  if (message.error) settle.reject(new Error(`${message.method}: ${message.error.message}`));
  else settle.resolve(message.result);
});

function send(method, params = {}, sessionId) {
  const id = ++nextId;
  return new Promise((resolve_, reject) => {
    pending.set(id, { resolve: resolve_, reject, method });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

const finish = async (code) => {
  socket.close();
  chrome.kill('SIGTERM');
  setTimeout(() => chrome.kill('SIGKILL'), 2000).unref();
  process.exit(code);
};

try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });

  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Page.navigate', { url: pathToFileURL(SOURCE).href }, sessionId);

  // The page sets window.__PAGED_DONE__ from paged.js's own `after` hook. Polling for
  // it is what makes this build deterministic rather than a race against a timer.
  const deadline = Date.now() + 180_000;
  for (;;) {
    const { result } = await send(
      'Runtime.evaluate',
      { expression: 'window.__PAGED_DONE__ === true', returnByValue: true },
      sessionId,
    );
    if (result.value === true) break;
    if (Date.now() > deadline) throw new Error('paged.js did not finish laying out the document');
    await new Promise((r) => setTimeout(r, 250));
  }

  const { result: pageCount } = await send(
    'Runtime.evaluate',
    { expression: 'document.querySelectorAll(".pagedjs_page").length', returnByValue: true },
    sessionId,
  );

  const { data } = await send(
    'Page.printToPDF',
    {
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      transferMode: 'ReturnAsBase64',
    },
    sessionId,
  );

  writeFileSync(OUTPUT, Buffer.from(data, 'base64'));
  const size = Buffer.from(data, 'base64').length;
  console.log(`wrote ${OUTPUT} — ${pageCount.value} pages, ${(size / 1024).toFixed(0)} KB`);
  await finish(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  await finish(1);
}
