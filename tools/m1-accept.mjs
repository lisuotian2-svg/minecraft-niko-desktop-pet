import { writeFileSync, mkdirSync } from 'node:fs';

const port = process.argv[2] ?? '9223';
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
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
await send('Runtime.enable');
await send('Page.enable');
mkdirSync('artifacts', { recursive: true });
async function ev(expression) {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.result?.exceptionDetails) console.log('EXC', JSON.stringify(res.result.exceptionDetails));
  return res.result?.result?.value;
}
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  if (s.result?.data) writeFileSync(`artifacts/${name}.png`, Buffer.from(s.result.data, 'base64'));
}
console.log('before', await ev('window.__niko.getState()'));
await ev('window.__niko.forceWalk(1)');
await new Promise((r) => setTimeout(r, 1600));
console.log('right', await ev('window.__niko.getState()'));
await shot('m1-walk-right');
await ev('window.__niko.forceWalk(-1)');
await new Promise((r) => setTimeout(r, 1600));
console.log('left', await ev('window.__niko.getState()'));
await shot('m1-walk-left');
await ev('window.__niko.stopWalk()');
await new Promise((r) => setTimeout(r, 800));
console.log('stopped', await ev('window.__niko.getState()'));
await shot('m1-idle');
ws.close();
