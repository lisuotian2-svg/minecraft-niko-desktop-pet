import { writeFileSync, mkdirSync } from 'node:fs';

const port = process.argv[2] ?? '9223';
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find((t) => t.url.includes('index.html'));
if (!target) throw new Error('no pet target');
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
async function ev(expression, awaitPromise = true) {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
  if (res.result?.exceptionDetails) console.log('EXC', JSON.stringify(res.result.exceptionDetails));
  return res.result?.result?.value;
}
async function shot(name) {
  const s = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  if (s.result?.data) writeFileSync(`artifacts/${name}.png`, Buffer.from(s.result.data, 'base64'));
}
console.log('initial', await ev('window.__niko.getState()'));
await ev('window.__niko.stretch()');
await new Promise((r) => setTimeout(r, 900));
console.log('stretch', await ev('window.__niko.getState()'));
await shot('m2-stretch');
await new Promise((r) => setTimeout(r, 1800));
console.log('torch on', await ev('window.__niko.toggleTorch(true)'));
await new Promise((r) => setTimeout(r, 500));
console.log('torch state', await ev('window.__niko.getTorch()'));
await shot('m2-torch');
await ev('window.__niko.toggleTorch(false)');
await new Promise((r) => setTimeout(r, 300));
console.log('closing start', await ev('window.__niko.forceClose()', false));
await new Promise((r) => setTimeout(r, 400));
console.log('closing state', await ev('window.__niko.getState()'), 'particles', await ev('window.__niko.getParticles()'));
await shot('m2-close');
await new Promise((r) => setTimeout(r, 1400));
console.log('after close state', await ev('window.__niko.getState()').catch(() => 'target gone'));
ws.close();
