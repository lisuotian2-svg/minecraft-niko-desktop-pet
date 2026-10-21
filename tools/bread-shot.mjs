import { writeFileSync } from 'node:fs';

const targets = await (await fetch('http://127.0.0.1:9223/json/list')).json();
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
const state = await send('Runtime.evaluate', { expression: 'window.__niko.getState()', returnByValue: true });
console.log(JSON.stringify(state.result?.result?.value));
const shot = await Promise.race([
  send('Page.captureScreenshot', { format: 'png', fromSurface: true }),
  new Promise((_, reject) => setTimeout(() => reject(new Error('capture timeout')), 10000))
]).catch((error) => { console.log(String(error)); return null; });
if (shot?.result?.data) {
  writeFileSync('artifacts/bread-eat3.png', Buffer.from(shot.result.data, 'base64'));
  console.log('captured');
}
ws.close();
