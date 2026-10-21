import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const mode=process.argv[2]??'snapshot';
const output=resolve('artifacts/g1-2026-10-21');
await mkdir(output,{recursive:true});
let targets;
for(let attempt=0;attempt<30;attempt++){
  try{targets=await(await fetch('http://127.0.0.1:9225/json/list',{signal:AbortSignal.timeout(1000)})).json();
    if(targets.some(t=>t.type==='page'&&t.url.includes('index.html')))break;
  }catch{}
  await new Promise(resolve=>setTimeout(resolve,400));
}
const target=targets?.find(t=>t.type==='page'&&t.url.includes('index.html'));
if(!target)throw new Error('No Niko renderer on loopback port 9225');
const ws=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();
let counter=0;
ws.onmessage=event=>{const msg=JSON.parse(event.data),entry=pending.get(msg.id);if(!entry)return;
  clearTimeout(entry.timer);pending.delete(msg.id);
  if(msg.error)entry.reject(new Error(JSON.stringify(msg.error)));else entry.resolve(msg.result);
};
await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('WS timeout')),5000);
  ws.onopen=()=>{clearTimeout(timer);resolve();};ws.onerror=()=>{clearTimeout(timer);reject(new Error('WS failed'));};
});
function send(method,params={}){return new Promise((resolve,reject)=>{const id=++counter;
  const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout ${method}`));},8000);
  pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));
});}
async function evaluate(expression){const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result?.value;
}
try{
  if(mode==='debug-reload' && !target.url.includes('nikoDebug=1')){
    await send('Page.navigate',{url:target.url+'?nikoDebug=1'});
    await new Promise(resolve=>setTimeout(resolve,1200));
  }
  if(mode==='pet-preview'||mode==='reload'){
    await send('Page.reload',{ignoreCache:true});
    await new Promise(resolve=>setTimeout(resolve,1200));
  }
  for(let attempt=0;attempt<30;attempt++){
    if(await evaluate('!!window.__niko'))break;
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  if(mode==='pet-preview'||mode==='pet-demo'||mode==='pet-desktop'){
    await evaluate('window.__niko.stopWalk()');
    for(let attempt=0;attempt<30;attempt++){
      if(await evaluate('window.__niko.getState().skinReady'))break;
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    let desktopShot=null;
    if(mode==='pet-desktop'){
      await new Promise(resolve=>setTimeout(resolve,1700));
      const ready=resolve(output,'screenshot-ready.txt');
      try{await unlink(ready);}catch{}
      desktopShot=spawn('pwsh',['-NoProfile','-ExecutionPolicy','Bypass','-File','tools/screenshot.ps1',
        '-Out','g1-2026-10-21/bouncy-click-no-hearts.png','-ReadyFile',ready,'-DelayMs','250'],
        {windowsHide:true,stdio:'pipe'});
      for(let attempt=0;attempt<60&&!existsSync(ready);attempt++)await new Promise(resolve=>setTimeout(resolve,50));
      if(!existsSync(ready))throw new Error('Desktop screenshot did not become ready');
    }
    if(!await evaluate('window.__niko.pet()'))throw new Error('Pet reaction was blocked');
    await new Promise(resolve=>setTimeout(resolve,450));
    if(desktopShot){
      const exit=await new Promise(resolve=>desktopShot.once('close',resolve));
      if(exit!==0)throw new Error('Desktop screenshot failed');
    }
  }
  if(mode==='settings-open')await evaluate('window.petApi.openSettings()');
  if(mode==='drag-start')await evaluate('window.petApi.startDrag(window.__niko.getDragFootprint() ?? undefined)');
  if(mode==='drag-end')await evaluate('window.petApi.endDrag()');
  if(mode==='stop')await evaluate('window.__niko.stopWalk()');
  if(mode==='walk')await evaluate('window.__niko.forceWalk()');
  if(mode==='motion-probe'){
    const samples=[];
    const read=()=>evaluate('({at:performance.now(),x:screenX,walking:window.__niko.getState().walking,lean:window.__niko.getState().inertiaLean,bob:window.__niko.getState().elasticBob,squash:window.__niko.getState().elasticSquash})');
    await evaluate('window.__niko.forceWalk(1)');
    try{
      for(let i=0;i<24;i++){
        await new Promise(resolve=>setTimeout(resolve,70));
        samples.push(await read());
      }
    }finally{await evaluate('window.__niko.stopWalk()');}
    for(let i=0;i<16;i++){
      await new Promise(resolve=>setTimeout(resolve,70));
      samples.push(await read());
    }
    await writeFile(resolve(output,'motion-probe.json'),JSON.stringify(samples,null,2));
    console.log(JSON.stringify({motionSamples:samples.length,first:samples[0],walkingPeakLean:Math.max(...samples.filter(s=>s.walking).map(s=>Math.abs(s.lean))),stopPeakLean:Math.max(...samples.filter(s=>!s.walking).map(s=>Math.abs(s.lean))),last:samples.at(-1)},null,2));
  }
  const snapshot=await evaluate(`(()=>{const api=window.__niko,skin=api.viewer.playerObject.skin;
    return {at:new Date().toISOString(),href:location.href,state:api.getState(),peek:api.getPeekState(),dragFootprint:api.getDragFootprint?.(),
      window:{x:screenX,y:screenY,width:innerWidth,height:innerHeight,dpr:devicePixelRatio},
      parts:Object.fromEntries(['head','body','rightArm','leftArm','rightLeg','leftLeg'].map(name=>[name,{visible:skin[name].visible,layerMask:skin[name].layers.mask}])),
      webglAlpha:api.viewer.renderer.getContext().getContextAttributes().alpha};})()`);
  await writeFile(resolve(output,`${mode}-snapshot.json`),JSON.stringify(snapshot,null,2));
  console.log(JSON.stringify(snapshot,null,2));
  if(mode!=='pet-preview')process.exitCode=0;
  else {
  const shot=await send('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});
  if(shot.data)await writeFile(resolve(output,`${mode}-renderer.png`),Buffer.from(shot.data,'base64'));
  }
}finally{ws.close();}
