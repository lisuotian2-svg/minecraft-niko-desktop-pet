import { writeFileSync, mkdirSync } from 'node:fs';

const port = process.argv[2] ?? '9222';
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
await send('Runtime.enable');
await send('Page.enable');
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 208, y: 300 });
await new Promise((r) => setTimeout(r, 200));
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 208, y: 300, button: 'left', buttons: 1, clickCount: 1 });
await new Promise((r) => setTimeout(r, 120));
const expr = `(() => { const p=window.__nikoViewer.playerObject; return {scale:p.scale.toArray(), pos:p.position.toArray()}; })()`;
async function ev() {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return r.result?.result?.value;
}
console.log('pressed', await ev());
const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
if (shot.result?.data) { mkdirSync('artifacts', { recursive: true }); writeFileSync('artifacts/press-cdp.png', Buffer.from(shot.result.data, 'base64')); }
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 208, y: 300, button: 'left', buttons: 0, clickCount: 1 });
await new Promise((r) => setTimeout(r, 80));
console.log('released80', await ev());
const shot2 = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
if (shot2.result?.data) writeFileSync('artifacts/release-cdp-80.png', Buffer.from(shot2.result.data, 'base64'));
await new Promise((r) => setTimeout(r, 300));
console.log('released380', await ev());
const shot3 = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
if (shot3.result?.data) writeFileSync('artifacts/release-cdp-380.png', Buffer.from(shot3.result.data, 'base64'));
ws.close();
