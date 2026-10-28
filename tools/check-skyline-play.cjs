// Start isolated Chrome on port 9331; run node math-games/tools/check-skyline.cjs.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
(async()=>{
 const root=path.resolve(__dirname,'..'),out=path.join(__dirname,'skyline-checks');await fs.mkdir(out,{recursive:true});
 const targets=await(await fetch('http://127.0.0.1:9331/json')).json(),socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 let sequence=0;const requests=new Map(),errors=[];
 socket.addEventListener('message',event=>{const d=JSON.parse(event.data);if(d.id){const p=requests.get(d.id);requests.delete(d.id);d.error?p.reject(Error(d.error.message)):p.resolve(d.result);}else if(d.method==='Runtime.exceptionThrown')errors.push(d.params.exceptionDetails.exception?.description||d.params.exceptionDetails.text);});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;requests.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 async function waitFor(expression){for(let i=0;i<150;i++){if(await evaluate(expression))return;await delay(30);}throw Error('Timeout '+expression+' '+errors.join(' | '));}
 let metrics={width:1365,height:900,deviceScaleFactor:1,mobile:false};
 async function screenshot(name){const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await fs.writeFile(path.join(out,name+'.png'),Buffer.from(r.data,'base64'));await send('Emulation.setDeviceMetricsOverride',metrics);await delay(150);}
 async function pointerDrag(from,to,touch=false){
  if(touch){await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:from.x,y:from.y}]});for(let i=1;i<=8;i++)await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+(to.x-from.x)*i/8,y:from.y+(to.y-from.y)*i/8}]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
  else{await send('Input.dispatchMouseEvent',{type:'mousePressed',x:from.x,y:from.y,button:'left',buttons:1,clickCount:1});for(let i=1;i<=8;i++)await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:from.x+(to.x-from.x)*i/8,y:from.y+(to.y-from.y)*i/8,buttons:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:to.x,y:to.y,button:'left',buttons:0,clickCount:1});}
 }
 async function fitFloor(){await evaluate(`(()=>{const s=MG.game.state;document.querySelector('[data-width="'+s.stage.floor.w+'"]').click();let d=s.stage.floor.x-s.plan.x;for(let i=0;i<Math.abs(d);i++)document.getElementById(d<0?'moveLeft':'moveRight').click();document.getElementById('buildBtn').click();})()`);await waitFor("['ready','brace'].includes(MG.game.state.phase)");}
 async function fitBeam(){await evaluate(`(()=>{const s=MG.game.state,b=s.stage.brace;const socket=b.sockets.findIndex(p=>p.x===b.b.x);const piece=b.options.findIndex((p,i)=>MG.game.validateBrace(s.stage,i,socket));document.querySelector('[data-beam="'+piece+'"]').click();if(b.sockets.length>1)document.querySelector('[data-socket="'+socket+'"]').click();document.getElementById('buildBtn').click();})()`);await waitFor("MG.game.state.phase==='ready'");}
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',metrics);await send('Emulation.setTouchEmulationEnabled',{enabled:false});await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 await send('Page.navigate',{url:'about:blank'});await waitFor("!window.MG&&location.href==='about:blank'");errors.length=0;
 await send('Page.navigate',{url:pathToFileURL(path.join(root,'game-04-coordinate-racer/index.html')).href});await waitFor("window.MG?.game&&!document.documentElement.classList.contains('am-booting')");
 await evaluate("MG.current.start();window.check=(v,m)=>{if(!v)throw Error(m)}");await delay(800);
 const first=await evaluate(`(()=>{const s=MG.game.state;check(document.querySelectorAll('input,textarea,select').length===0,'typing controls remain');check(document.getElementById('buildBtn').disabled,'unselected block can drop');MG.game.submitPlan();check(s.attempts===0,'empty drop counted');const wrong=s.stage.widths.find(w=>w!==s.stage.floor.w);document.querySelector('[data-width="'+wrong+'"]').click();document.getElementById('buildBtn').click();MG.game.submitPlan();check(s.attempts===1,'double drop counted');MG.current.pause();return true;})()`);
 await delay(200);assert.equal(await evaluate('MG.game.state.phase'),'drop','pause advanced construction');await evaluate('MG.current.resume()');await waitFor("MG.game.state.phase==='plan'");
 assert(await evaluate("MG.game.state.built.length===0&&document.getElementById('buildFeedback').textContent.includes('block')"),'wrong block accepted');
 await evaluate("document.querySelector('[data-width=\"24\"]').click();check(document.querySelector('[data-width=\"24\"]').getAttribute('aria-pressed')==='true','selected block not marked');check([...document.querySelectorAll('[data-width]')].filter(b=>b.getAttribute('aria-pressed')==='true').length===1,'more than one block selected')");await delay(200);await screenshot('desktop-ground-floor');
 const dragPoints=await evaluate(`(()=>{const s=MG.game.state,f=s.stage.floor;return{from:MG.game.screenPoint(s.plan.x+s.plan.w/2,f.y+4+f.h/2),to:MG.game.screenPoint(f.x+s.plan.w/2,f.y+4+f.h/2)};})()`);
 await pointerDrag(dragPoints.from,dragPoints.to);await waitFor("MG.game.state.phase==='ready'");
 assert(await evaluate("MG.game.state.built.length===1&&!MG.current.timerOn&&MG.current.hud.meter.getAttribute('aria-valuenow')==='10'"),'drag floor failed');
 await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 const rounds=[];
 for(let i=1;i<10;i++){
  await evaluate("document.getElementById('nextBtn').click()");
  if(i===3)await evaluate("document.getElementById('guidanceBtn').click()");
  // Real keyboard input moves a block without requiring a text field.
  if(i===1){await evaluate("document.getElementById('site').focus()");const before=await evaluate('MG.game.state.plan.x');await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});assert.equal(await evaluate('MG.game.state.plan.x'),before+1);}
  await fitFloor();
  if(i>=6){
   assert(await evaluate(`MG.game.nextFloor();MG.game.state.stageIdx===${i}&&MG.game.state.phase==='brace'`),'brace skipped');
   if(i===6){
    await evaluate(`(()=>{const s=MG.game.state,b=s.stage.brace,index=b.options.findIndex((p,i)=>!MG.game.validateBrace(s.stage,i,0));document.querySelector('[data-beam="'+index+'"]').click();document.getElementById('buildBtn').click();})()`);await waitFor("MG.game.state.phase==='brace'");
    await evaluate(`(()=>{const s=MG.game.state,index=s.stage.brace.options.findIndex((p,i)=>MG.game.validateBrace(s.stage,i,0));document.querySelector('[data-beam="'+index+'"]').click();})()`);
    // A HUD layout change must not leave scaled/stale canvas pointer coordinates.
    await evaluate("document.getElementById('hud').style.paddingBottom='42px'");await delay(100);
    const points=await evaluate('({from:MG.game.screenPoint(MG.game.state.stage.brace.a.x,MG.game.state.stage.brace.a.y),to:MG.game.screenPoint(MG.game.state.stage.brace.b.x,MG.game.state.stage.brace.b.y)})');await pointerDrag(points.from,points.to);await waitFor("MG.game.state.phase==='ready'");
    await evaluate("document.getElementById('hud').style.paddingBottom=''");
   }else if(i===9){
    await evaluate(`(()=>{const s=MG.game.state,b=s.stage.brace,piece=b.options.findIndex(p=>p.length===10);document.querySelector('[data-beam="'+piece+'"]').click();document.querySelector('[data-socket="0"]').click();document.getElementById('buildBtn').click();})()`);await waitFor("MG.game.state.phase==='brace'");await fitBeam();
   }else await fitBeam();
  }
  rounds.push({floor:i+1,complete:true});
  if(i===8){await evaluate("document.getElementById('overviewBtn').click()");await delay(1300);await screenshot('desktop-upper-floors');}
 }
 await evaluate("document.getElementById('nextBtn').click()");
 const result=await evaluate(`(()=>{const r=MG.current.lastResult,s=MG.store.get('skyline-stack:maths-last',null);check(r.won&&r.stars===2,'wrong stars');check(s.decisions===14&&s.solved===14&&s.attempts===17&&s.independentFirst===10&&s.assisted===1,'incorrect practice record');return{stars:r.stars,...s};})()`);await screenshot('completed');
 metrics={width:390,height:844,deviceScaleFactor:1,mobile:true};await send('Emulation.setDeviceMetricsOverride',metrics);await send('Emulation.setTouchEmulationEnabled',{enabled:true});
 await evaluate("MG.current.restart();scrollTo(0,0);check(MG.game.state.completed===0&&MG.current.maths.entries.size===0,'restart retained progress');document.querySelector('[data-width=\"24\"]').click()");await delay(100);
 const mobileDrag=await evaluate(`(()=>{const s=MG.game.state,f=s.stage.floor;return{from:MG.game.screenPoint(s.plan.x+12,f.y+4+f.h/2),to:MG.game.screenPoint(f.x+12,f.y+4+f.h/2)};})()`);await pointerDrag(mobileDrag.from,mobileDrag.to,true);await waitFor("MG.game.state.phase==='ready'");
 for(let i=1;i<10;i++){await evaluate("document.getElementById('nextBtn').click()");await fitFloor();if(i>=6&&i<9)await fitBeam();}
 await evaluate('scrollTo(0,0)');await delay(1300);await screenshot('mobile-crown');
 // Closely spaced touch sockets choose the nearest point, rather than the first hitbox.
 await evaluate(`(()=>{const b=MG.game.state.stage.brace,piece=b.options.findIndex(p=>p.length===10);document.querySelector('[data-beam="'+piece+'"]').click();})()`);
 const socketPoint=await evaluate('MG.game.screenPoint(MG.game.state.stage.brace.b.x,MG.game.state.stage.brace.b.y)');await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[socketPoint]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await waitFor("MG.game.state.phase==='ready'");
 const mobile=await evaluate(`(()=>{check(document.documentElement.scrollWidth<=innerWidth,'horizontal overflow');check(document.querySelectorAll('input,textarea,select').length===0,'mobile needs typing');check(MG.game.state.completed===10,'mobile touch socket did not finish');return{width:innerWidth,noOverflow:true,touchDrag:true,touchSocket:true,noTyping:true};})()`);
 await evaluate('MG.current.restart();MG.current.pause();MG.game.chooseBlock(24);MG.game.submitPlan();check(MG.game.state.phase===\'plan\'&&MG.game.state.attempts===0,\'paused controls changed the game\');MG.current.resume()');
 await send('Page.navigate',{url:pathToFileURL(path.join(root,'index.html')).href});await waitFor("document.querySelectorAll('#grid .card').length===10&&!document.documentElement.classList.contains('am-booting')");
 assert(await evaluate("[...document.querySelectorAll('#grid .card')].some(c=>c.textContent.includes('Skyline Stack')&&c.textContent.includes('Pip'))"),'hub not updated');assert.equal(errors.length,0,errors.join('\n'));
 await fs.writeFile(path.join(out,'results.json'),JSON.stringify({noTyping:first,mouseDrag:true,keyboard:true,layoutResize:true,wrongBlocksAndBeamsRejected:true,pause:true,rounds,result,mobile,restart:true,runtimeErrors:errors},null,2));
 console.log('PASS playful Skyline Stack: 10 floors and 4 beams; real mouse drag, keyboard, mobile touch drag/socket, wrong pieces, pause, guidance, stars, restart; no typing or runtime errors.');
 if(!process.argv.includes('--keep-browser'))await send('Browser.close');socket.close();
})().catch(error=>{console.error(error);process.exit(1);});
