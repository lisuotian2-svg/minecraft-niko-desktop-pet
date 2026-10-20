import { writeFileSync, mkdirSync } from 'node:fs';

const port = process.argv[2] ?? '9222';
const out = process.argv[3] ?? 'artifacts/renderer.png';
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
if (!targets.length) throw new Error('no devtools targets');
const target = targets.find((t) => t.type === 'page') ?? targets[0];
console.log('target:', target.title, target.url);
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const events = [];
function send(method, params = {}) {
  const msgId = ++id;
  ws.send(JSON.stringify({ id: msgId, method, params }));
  return new Promise((resolve) => pending.set(msgId, resolve));
}
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method) {
    if (['Runtime.consoleAPICalled', 'Runtime.exceptionThrown', 'Log.entryAdded'].includes(msg.method)) {
      events.push(msg);
    }
  }
};
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
  setTimeout(() => reject(new Error('ws timeout')), 5000);
});
await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await new Promise((r) => setTimeout(r, 1200));
const expr = `(() => {
  const c = document.querySelector('#pet');
  const gl = c && (c.getContext('webgl2') || c.getContext('webgl'));
  return {
    readyState: document.readyState,
    href: location.href,
    hasPetApi: !!window.petApi,
    canvas: c ? { width: c.width, height: c.height, clientWidth: c.clientWidth, clientHeight: c.clientHeight } : null,
    webgl: !!gl,
    webglAlpha: gl ? gl.getContextAttributes()?.alpha : null,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    resources: performance.getEntriesByType('resource').map((e) => e.name).slice(-10)
  };
})()`;
const evalResult = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
console.log('evaluate:', JSON.stringify(evalResult.result?.result?.value ?? evalResult, null, 2));
for (const e of events) {
  if (e.method === 'Runtime.exceptionThrown') {
    console.log('EXCEPTION:', JSON.stringify(e.params.exceptionDetails, null, 2));
  } else if (e.method === 'Log.entryAdded') {
    console.log('LOG:', e.params.entry.level, e.params.entry.text, e.params.entry.url ?? '');
  } else if (e.method === 'Runtime.consoleAPICalled') {
    console.log('CONSOLE:', e.params.type, e.params.args?.map((a) => a.value ?? a.description).join(' '));
  }
}
const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
if (shot.result?.data) {
  mkdirSync(out.split('/').slice(0, -1).join('/') || '.', { recursive: true });
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('screenshot:', out);
}
ws.close();
