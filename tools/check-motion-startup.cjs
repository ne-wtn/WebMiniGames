// Start Chrome with --remote-debugging-port=9331, then run this file.
// Uses a loopback-only server to exercise delayed scripts, fonts and cold loads.
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
(async () => {
 const root = path.resolve(__dirname, '..');
 let scriptDelay = 0, fontDelay = 0, blockScript = false;
 const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2' };
 const server = http.createServer(async (request, response) => {
  const relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/+/, '');
  const file = path.resolve(root, relative || 'index.html');
  if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  try {
   const data = await fs.readFile(file);
   if (blockScript && path.extname(file) === '.js') { response.writeHead(503).end(); return; }
   const delay = path.extname(file) === '.js' ? scriptDelay : path.extname(file) === '.woff2' ? fontDelay : 0;
   setTimeout(() => { response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); response.end(data); }, delay);
  } catch { response.writeHead(404).end(); }
 });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 const origin = `http://127.0.0.1:${server.address().port}/`;
 const targets = await (await fetch('http://127.0.0.1:9331/json')).json();
 const socket = new WebSocket(targets.find(item => item.type === 'page').webSocketDebuggerUrl);
 await new Promise((resolve,reject) => { socket.addEventListener('open',resolve,{once:true}); socket.addEventListener('error',reject,{once:true}); });
 let sequence = 0;
 const pending = new Map(), errors = [], reports = [];
 socket.addEventListener('message', event => {
  const data = JSON.parse(event.data);
  if (data.id) { const request = pending.get(data.id); pending.delete(data.id); if (data.error) request.reject(new Error(data.error.message)); else request.resolve(data.result); }
  else if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.exception?.description || data.params.exceptionDetails.text);
 });
 const send = (method, params = {}) => new Promise((resolve,reject) => { const id = ++sequence; pending.set(id,{resolve,reject}); socket.send(JSON.stringify({id,method,params})); });
 const evaluate = async expression => { const result = await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true}); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
 const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
 async function waitFor(expression) { for (let i=0;i<200;i++) { if (await evaluate(expression)) return; await delay(30); } throw new Error('Timed out: ' + expression); }
 await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
 await send('Network.setCacheDisabled',{cacheDisabled:true});
 await send('Emulation.setCPUThrottlingRate',{rate:4});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`
  window.__startupCheck={firstVisible:null,exposedBeforeMenu:false,shifts:[]};
  const check=window.__startupCheck;
  new PerformanceObserver(list=>{for(const entry of list.getEntries())if(check.firstVisible&&!entry.hadRecentInput)check.shifts.push(entry.value);}).observe({type:'layout-shift',buffered:true});
  function sample(now){
   if(document.body&&getComputedStyle(document.body).visibility==='visible'&&!check.firstVisible){
    const card=document.querySelector('.mg-overlay.is-open .mg-card');
    const heading=document.querySelector('.hero h1');
    check.firstVisible={time:now,fontStatus:document.fonts.status,cardOpacity:card?Number(getComputedStyle(card).opacity):null,headingOpacity:heading?Number(getComputedStyle(heading).opacity):null};
    check.exposedBeforeMenu=Boolean(document.querySelector('.mg-app')&&!card);
   }
   if(now<5000&&!check.firstVisible)requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
 `});
 const games = (await fs.readdir(root)).filter(name => /^game-\d\d-/.test(name));
 for (const width of [1280,390]) {
  await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});
  for (const file of ['index.html',...games.map(game => game + '/index.html')]) {
   scriptDelay = 160; fontDelay = 100;
   await send('Page.navigate',{url:origin + file});
   await waitFor('Boolean(window.__startupCheck?.firstVisible) && Boolean(window.ArcadeMotion)');
   const first = await evaluate('window.__startupCheck');
   assert.equal(first.exposedBeforeMenu,false,file+': game board flashes before menu');
   assert.equal(first.firstVisible.fontStatus,'loaded',file+': font swap during entrance');
   const opacity = file === 'index.html' ? first.firstVisible.headingOpacity : first.firstVisible.cardOpacity;
   assert(opacity < .55, file+': first visible frame starts in the entrance, not its settled state: '+opacity);
   if (file === 'index.html') {
    const stagger = await evaluate(`(() => {
     const host=document.createElement('div');
     for(let i=0;i<3;i++){const e=document.createElement('div');e.textContent='test';host.append(e);}
     document.body.append(host);ArcadeMotion.reveal(host.children,100);
     const last=host.lastElementChild,a=last.getAnimations()[0];a.pause();a.currentTime=0;
     const result={opacity:Number(getComputedStyle(last).opacity),fill:a.effect.getTiming().fill};
     host.getAnimations({subtree:true}).forEach(a=>a.cancel());host.remove();return result;
    })()`);
    assert.equal(stagger.opacity,0,'stagger delay exposes the settled element');
    assert.equal(stagger.fill,'backwards','stagger fill mode');
   }
   await delay(720);
   const shifts = await evaluate('window.__startupCheck.shifts.reduce((sum,value)=>sum+value,0)');
   assert.equal(shifts,0,file+': layout shifts after initial reveal');
   assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'),file+': horizontal overflow');
   reports.push({file,width,firstOpacity:opacity,fontsReady:true,layoutShift:shifts});
  }
  console.log(`PASS startup at ${width}px: hub + 10 games under 4x CPU slowdown, delayed scripts and fonts`);
 }
 // A script arriving after the failsafe must not animate an already-visible page.
 scriptDelay = 2100; fontDelay = 0;
 await send('Page.navigate',{url:origin+'game-01-ratio-recipe/index.html'});
 await waitFor('Boolean(window.MG?.current) && !document.documentElement.classList.contains("am-booting")');
 assert.equal(await evaluate('window.__arcadeBoot.expired'),true,'bootstrap failsafe');
 assert.equal(await evaluate('document.querySelector(".mg-overlay.is-open .mg-card").getAnimations().length'),0,'late script replays entrance');
 // Fonts that exceed the loading budget should get a static first screen,
 // rather than an entrance that stutters when its typeface eventually swaps.
 scriptDelay = 0; fontDelay = 1600;
 await send('Page.navigate',{url:origin+'game-01-ratio-recipe/index.html'});
 await waitFor('Boolean(window.MG?.current) && !document.documentElement.classList.contains("am-booting")');
 assert.equal(await evaluate('document.querySelector(".mg-overlay.is-open .mg-card").getAnimations().length'),0,'slow fonts start an unstable entrance');
 await waitFor('document.fonts.status==="loaded"');
 assert.equal(await evaluate('document.querySelector(".mg-overlay.is-open .mg-card").getAnimations().length'),0,'font completion replays entrance');
 // Missing application script: the guard must release the document on its own.
 scriptDelay = 0; fontDelay = 0; blockScript = true;
 await send('Page.navigate',{url:origin+'index.html'});
 await waitFor('Boolean(window.__arcadeBoot?.expired)');
 assert.equal(await evaluate('getComputedStyle(document.body).visibility'),'visible','failed script leaves content hidden');
 blockScript = false;
 await send('Emulation.setCPUThrottlingRate',{rate:1});
 await send('Network.setCacheDisabled',{cacheDisabled:false});
 assert.equal(errors.length,0,errors.join('\n'));
 await fs.mkdir(path.join(__dirname,'motion-checks'),{recursive:true});
 await fs.writeFile(path.join(__dirname,'motion-checks','startup-results.json'),JSON.stringify({reports,cpuSlowdown:4,lateScriptFallback:true,slowFontFallback:true,missingScriptFallback:true,runtimeErrors:errors},null,2));
 console.log('PASS delayed stagger, late script, slow fonts, missing script, zero browser exceptions');
 socket.close();server.close();
})().catch(error=>{console.error(error);process.exit(1);});
