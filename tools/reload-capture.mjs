import { writeFileSync, mkdirSync } from 'node:fs';

const port = process.argv[2] ?? '9222';
const out = process.argv[3] ?? 'artifacts/m0-final.png';
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find((t) => t.type === 'page');
if (!target) throw new Error('no page target');
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
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
  }
};
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
await send('Page.enable');
await send('Runtime.enable');
await send('Page.reload', { ignoreCache: true });
await new Promise((r) => setTimeout(r, 2600));
const state = await send('Runtime.evaluate', {
  expression: `(() => { const v=window.__nikoViewer; return v ? {zoom:v.zoom, camera:v.camera.position.toArray(), target:v.controls.target.toArray()} : {viewer:false}; })()`,
  returnByValue: true
});
console.log(JSON.stringify(state.result?.result?.value));
const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
if (shot.result?.data) {
  mkdirSync('artifacts', { recursive: true });
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log(out);
}
ws.close();
