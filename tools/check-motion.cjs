// Start an isolated Chrome with --remote-debugging-port=9331, then run this file.
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
(async () => {
 const root = path.resolve(__dirname, '..');
 const targets = await (await fetch('http://127.0.0.1:9331/json')).json();
 const target = targets.find(item => item.type === 'page');
 const socket = new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 let sequence=0;const pending=new Map(),errors=[],reports=[];
 socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){const request=pending.get(data.id);pending.delete(data.id);if(data.error)request.reject(new Error(data.error.message));else request.resolve(data.result);}else if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails.exception?.description||data.params.exceptionDetails.text);});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
 const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 async function waitFor(expression){for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(40);}throw new Error('Timed out: '+expression);}
 async function navigate(file,ready){await send('Page.navigate',{url:pathToFileURL(path.join(root,file)).href});await waitFor(ready);}
 async function viewport(width){await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});}
 async function screenshot(name){const image=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(__dirname,'motion-checks',name+'.png'),Buffer.from(image.data,'base64'));}
 await fs.mkdir(path.join(__dirname,'motion-checks'),{recursive:true});
 await send('Page.enable');await send('Runtime.enable');
 await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 await viewport(1280);
 await navigate('index.html',"!document.documentElement.classList.contains('am-booting') && document.querySelectorAll('#grid .card').length===10 && Boolean(window.ArcadeMotion)");
 await delay(850);
 assert(await evaluate("getComputedStyle(document.body).fontFamily.startsWith('Inter') && document.fonts.check('400 16px Inter')"),'hub uses loaded Inter');
 const hub=await evaluate(`(() => {
  const assert=(x,s)=>{if(!x)throw new Error(s)};
  const count=()=>Array.from(document.querySelectorAll('#grid .card')).filter(e=>!e.hidden).length;
  document.querySelector('[data-filter="geometry"]').click();assert(count()===3,'geometry filter');
  const moving=document.getAnimations().filter(a=>a.effect?.target?.classList.contains('card')).length;
  assert(moving>0,'cards should animate their layout');
  document.querySelector('[data-filter="data"]').click();assert(count()===2,'rapid filter');
  document.querySelector('[data-filter="all"]').click();assert(count()===10,'all filter');
  assert(!document.querySelector('.am-awaiting'),'no stranded invisible cards');
  return {name:'hub',filters:true,layoutAnimation:true};
 })()`);
 reports.push(hub);
 // Real pointer input exercises the delegated press and ripple, including mouse coordinates.
 const point=await evaluate("(() => {const r=document.querySelector('[data-filter=number]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
 await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
 assert(await evaluate("Boolean(document.querySelector('.am-ripple'))"),'pointer ripple');
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
 await evaluate("document.querySelector('[data-filter=all]').click()");
 await delay(850);await screenshot('hub-desktop');
 await viewport(390);await delay(120);
 assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'hub mobile overflow');
 await screenshot('hub-mobile');
 const games=(await fs.readdir(root)).filter(name=>/^game-\d\d-/.test(name));
 for(const game of games){
  await viewport(1280);
  await navigate(game+'/index.html',"!document.documentElement.classList.contains('am-booting') && Boolean(window.MG?.current?.ov.start.classList.contains('is-open'))");
  assert(await evaluate("getComputedStyle(document.body).fontFamily.startsWith('Inter') && document.fonts.check('400 16px Inter')"),game+': loaded Inter UI font');
  assert(await evaluate("MG.current.ov.start.querySelector('.mg-card').getAnimations().length>0"),game+': menu choreography');
  assert(await evaluate("MG.current.ov.start.contains(document.activeElement)"),game+': initial menu focus');
  await evaluate("MG.current.ov.start.querySelector('.mg-btn--play').click()");
  await waitFor("MG.current.state==='playing'");
  const score=await evaluate(`(() => {
   MG.current.addScore(100,'Perfect');
   return {score:MG.current.score,particles:document.querySelectorAll('.am-particle').length,animation:MG.current.hud.score.getAnimations().length};
  })()`);
  assert.equal(score.score,100,game+': score immediately correct');
  assert.equal(score.particles,10,game+': localized reward');
  assert(score.animation>0,game+': score reaction');
  if(game.startsWith('game-01')){await delay(120);await screenshot('recipe-score-reaction');}
  await evaluate('MG.current.pause()');
  const timer=await evaluate('MG.current.timeLeft');await delay(90);
  assert.equal(await evaluate('MG.current.timeLeft'),timer,game+': pause freezes clock');
  assert(await evaluate("document.querySelector('.mg-app').classList.contains('am-paused')"),game+': ambient motion paused');
  assert.equal(await evaluate("document.querySelectorAll('.am-particle').length"),0,game+': pause cleans effects');
  await evaluate('MG.current.resume()');
  assert(await evaluate("MG.current.state==='playing'&&!document.querySelector('.mg-app').classList.contains('am-paused')"),game+': resume');
  const firstScore=await evaluate("MG.current.setScore(1234);MG.current.end({won:true,title:'Round complete',reason:'Animation check',stars:3,stats:[['Rounds','10 / 10']],math:[]});document.querySelector('[data-final-score]').textContent");
  assert.equal(firstScore,'0',game+': count-up starts at zero before its first frame');
  await delay(1050);
  assert.equal(await evaluate("document.querySelector('[data-final-score]').textContent"),'1234',game+': count-up resolves exactly');
  assert.equal(await evaluate("document.querySelectorAll('.mg-star.is-on').length"),3,game+': earned stars');
  if(game.startsWith('game-01'))await screenshot('recipe-end-screen');
  await evaluate('MG.current.restart()');
  assert.equal(await evaluate('MG.current.score'),0,game+': restart resets score');
  await evaluate('MG.current.pause()');
  await viewport(390);await delay(200);
  assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'),game+': mobile overflow');
  reports.push({name:game,menu:true,scoreReaction:true,pause:true,endCount:true,restart:true,mobile:true});
 }
 // Switch the preference live while effects and counter frames are running.
 await viewport(1280);
 await evaluate("MG.current.resume();MG.current.addScore(100,'Test')");
 await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 await delay(70);
 assert(await evaluate('!ArcadeMotion.enabled()'),'reduced motion preference');
 assert.equal(await evaluate("document.querySelectorAll('.am-effects > span').length"),0,'preference change cancels effects');
 await evaluate("MG.current.addScore(100,'Reduced motion');MG.current.end({won:true,title:'Complete',reason:'Check',stars:3,stats:[],math:[]})");
 assert.equal(await evaluate("document.querySelector('[data-final-score]').textContent"),'200','reduced motion final score is immediate');
 assert.equal(await evaluate("getComputedStyle(document.querySelector('.mg-star.is-on')).animationName"),'none','CSS honors reduced motion');
 await navigate('index.html',"!document.documentElement.classList.contains('am-booting') && document.querySelectorAll('#grid .card').length===10");
 await evaluate("document.querySelector('[data-filter=geometry]').click()");
 assert.equal(await evaluate("document.querySelectorAll('.am-awaiting').length"),0,'reduced motion cards remain visible');
 assert.equal(errors.length,0,errors.join('\n'));
 await fs.writeFile(path.join(__dirname,'motion-checks','results.json'),JSON.stringify({reports,runtimeErrors:errors,reducedMotion:true},null,2));
 console.log(JSON.stringify({surfaces:reports.length,runtimeErrors:errors.length,reducedMotion:'passed',checks:'filters, pointer feedback, menus, score bursts, pause, results, restarts, mobile'},null,2));
 await send('Browser.close');socket.close();
})().catch(error=>{console.error(error);process.exit(1);});
