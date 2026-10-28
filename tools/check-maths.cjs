// Browser integration checks. Start isolated Chrome on debugging port 9331.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
(async()=>{
 const root=path.resolve(__dirname,'..'),targets=await(await fetch('http://127.0.0.1:9331/json')).json();
 const socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
 let seq=0;const requests=new Map(),errors=[],reports=[];
 socket.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.id){const pending=requests.get(data.id);requests.delete(data.id);data.error?pending.reject(Error(data.error.message)):pending.resolve(data.result);}else if(data.method==='Runtime.exceptionThrown')errors.push(data.params.exceptionDetails.exception?.description||data.params.exceptionDetails.text);});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;requests.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||JSON.stringify(result.exceptionDetails));return result.result.value;};
 const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 async function waitFor(expression){for(let i=0;i<150;i++){if(await evaluate(expression))return;await delay(30);}throw Error('Timeout '+expression);}
 await send('Page.enable');await send('Runtime.enable');
 await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 async function open(dir){
  await send('Page.navigate',{url:pathToFileURL(path.join(root,dir,'index.html')).href});
  await waitFor("!document.documentElement.classList.contains('am-booting')&&Boolean(window.MG?.current)");
  await evaluate(`MG.current.start();
   window.check=(value,message)=>{if(!value)throw Error(message);};
   window.submitMath=(wrong=false)=>{
    const current=MG.current.maths.current;check(current,'No maths plan');
    current.fields.forEach(({field,input})=>{input.value=field.options?field.answer:field.text?'none':String(wrong?999999:MG.round(field.answer,6));});
    current.node.requestSubmit();
   };
   window.countAttempts=()=>[...MG.current.maths.entries.values()].reduce((sum,e)=>sum+e.attempts,0);
  `);
 }
 async function run(dir,body){await open(dir);const result=await evaluate('(async()=>{'+body+'})()');reports.push({game:dir,...result});console.log('PASS '+dir+' '+JSON.stringify(result));}
 await run('game-01-ratio-recipe',`
  const g=MG.game,s=g.state,t=s.tickets[0];s.activeId=t.id;
  const first=Object.keys(t.required)[0];g.addToBowl(first);g.adjust(first,g.INGREDIENTS[first].step[1]);g.submitOrder();check(s.accuracies.at(-1)<100,'bad recipe accepted as exact');
  for(const[key,amount]of Object.entries(t.required)){g.addToBowl(key);g.adjust(key,amount-(t.bowl.get(key)||0));}
  g.submitOrder();check(s.accuracies.at(-1)===100,'scaled recipe rejected');
  const e=[...MG.current.maths.entries.values()][0];check(e.correct&&e.attempts===2&&!e.first,'recipe assessment mixed with timing');
  return {incorrectThenCorrect:true,separateMathsRecord:true};
 `);
 await run('game-02-algebra-platformer',`
  const originalRandom=Math.random;Math.random=()=>.5;MG.current.start();Math.random=originalRandom;
  const g=MG.game,s=g.state,t=s.level.terminals[0];s.activeTerm=t;g.changeVar('x',0);
  check(!document.getElementById('termMechs').textContent.includes('Preview:'),'answer preview leaked');
  const mechanisms=t.links.map(id=>s.level.mechs.find(m=>m.id===id));
  const options=[];for(let x=t.vars.x[0];x<=t.vars.x[1];x++)for(let y=t.vars.y?t.vars.y[0]:0;y<=(t.vars.y?t.vars.y[1]:0);y++)options.push({x,y});
  const valid=v=>mechanisms.every(m=>m.type==='bridge'?m.f(v)===m.gap:m.type==='lift'?m.f(v)===m.dock:m.f(v)===true);
  const bad=options.find(v=>!valid(v));Object.assign(t.vals,bad);g.activate();check(!t.done,'invalid equation advanced');
  Object.assign(t.vals,options.find(valid));g.activate();check(t.done,'valid equation rejected');
  check([...MG.current.maths.entries.values()][0].attempts===2,'first-try accuracy not tracked');
  check(new Set(g.LEVELS.map(l=>l.mechs.map(m=>m.text).join('|'))).size===10,'repeated algebra answers');
  const liftTerminal=s.level.terminals[2],lift=s.level.mechs.find(m=>m.id==='l1');s.activeTerm=liftTerminal;
  liftTerminal.vals.x=7;g.changeVar('x',0);
  check(lift.text==='h = 2(x − 4) − 1','coefficient variable shift missing from world label');
  check(document.querySelector('#termMechs .eq').textContent===lift.text,'terminal and world equations disagree');
  document.querySelector('#termMechs button').click();
  check(document.querySelector('#termMechs .pv').textContent.includes('h = 5'),'screenshot preview should give five tiles');
  g.changeVar('x',-1);g.activate();check(!liftTerminal.done,'incorrect lift height accepted');
  g.changeVar('x',1);g.activate();check(liftTerminal.done&&lift.solved,'correct displayed lift equation rejected');
  return {mathsGate:true,freshRounds:10,displayedEquationMatchesLift:true};
 `);
 await run('game-03-geometry-builder',`
  const g=MG.game;let rounds=0;
  while(MG.current.isPlaying()&&rounds<10){
   const s=g.state,stage=g.STAGES[s.stageIdx],i=s.stageIdx;
   const types=i<3?['house','park']:i<6?['house','pool','park']:['civic','garden','park'];
   const xs=i<3?{house:0,park:8}:i<6?{house:0,pool:8,park:15}:{civic:0,garden:7,park:15};
   for(const type of types){
    const word=type==='civic'?'library':type,requirements=stage.reqs.filter(r=>r.text.toLowerCase().includes(word));let candidate;
    outer:for(let w=1;w<=(type==='civic'?4:6);w++)for(let h=1;h<=(type==='garden'?13:6);h++)for(let z=1;z<=(type==='pool'?3:type==='civic'?6:1);z++){
     const c={type,x:xs[type],y:0,w,h,depth:z,height:z},road={type:'road',x:c.x+w,y:0,w:1,h:1};
     if(requirements.every(r=>r.check([c,road]).ok)){candidate=c;break outer;}
    }
    check(candidate,'No building solution');const item=g.makeItem(type,candidate.x,0,candidate.w,candidate.h);if(type==='pool')item.depth=candidate.depth;if(type==='civic')item.height=candidate.height;check(g.tryPlace(item),'invalid placement');
    if(type==='house'||type==='civic')check(g.tryPlace(g.makeItem('road',candidate.x+candidate.w,0,1,1)),'road blocked');
   }
   g.approve();check(MG.current.maths.current,'inspection skipped calculations');
   if(i===0){const approvals=s.approvals;submitMath(true);check(s.approvals===approvals,'wrong blueprint reached inspection');}
   submitMath();check(g.state.stagesDone===i+1,'valid blueprint did not clear');rounds++;
  }
  check(rounds===10&&MG.current.lastResult?.won,'geometry course failed');return{calculatedBlueprints:rounds,wrongAnswersBlocked:true};
 `);
 await run('game-05-probability-arcade',`
  const g=MG.game,s=g.state;let seed=123;Math.random=()=>((seed=(seed*1664525+1013904223)>>>0)/4294967296);
  let rounds=0;
  function feasible(){const st=g.stats(s.booth),n=Math.round(s.night.base*(.6+.4*st.sat));return st.sat*100>=s.night.sat&&n*st.profit*s.night.waves>=s.night.target;}
  function design(){
   if(s.booth==='wheel'){for(let J=0;J<=2;J++)for(let P=0;P<=8;P++)for(let S=0;S<=10;S++)if(J+P+S<=12){s.design.wheel={J,P,S};if(feasible())return;}}
   if(s.booth==='bag'){for(let gold=1;gold<=5;gold++)for(let silver=1;silver<=8;silver++)for(let red=1;red<=12;red++){s.design.bag={g:gold,s:silver,r:red};if(feasible())return;}}
   if(s.booth==='plinko'){
    const walk=(left,out)=>{if(!left.length){s.design.plinko={bins:out};return feasible();}for(let i=0;i<left.length;i++)if(walk(left.filter((_,j)=>i!==j),[...out,left[i]]))return true;return false;};if(walk([2,6,0,24,0,4,2],[]))return;
   }throw Error('No feasible attraction for round '+s.nightIdx);
  }
  while(MG.current.isPlaying()&&rounds<10){
   check(s.booth===s.night.required,'wheel bypass available');design();const index=s.nightIdx;
   g.run('wave');check(MG.current.maths.current,'forecast omitted');if(index===0){submitMath(true);check(!s.anim,'wrong forecast opened booth');}submitMath();
   while(MG.current.isPlaying()&&s.nightIdx===index){check(s.anim,'missing visitor wave');g.completeRun();if(s.nightIdx===index)g.run('wave');}
   rounds++;
  }
  check(MG.current.lastResult?.won&&rounds===10,'carnival failed course');return{mandatoryAttractions:true,forecasts:rounds,randomResultsSeparated:true};
 `);
 await run('game-06-function-factory',`
  const g=MG.game;let rounds=0;
  while(MG.current.isPlaying()&&rounds<10){const s=g.state,stage=g.STAGES[s.stageIdx],contract=s.contract;
   s.line=new Array(stage.slots).fill(null);contract.solution.forEach(([type,k],i)=>s.line[i]={type,k});
   g.startProduction();let steps=0;while(s.run&&steps++<500)MG.current.cfg.onUpdate.call(MG.current,.5);
   check(!s.run&&steps<500,'factory stalled');rounds++;
  }
  check(rounds===10&&MG.current.lastResult?.won,'factory failed');check([...MG.current.maths.entries.values()].every(e=>e.first),'correct factory marked wrong');return{contracts:rounds,compositionVerified:true};
 `);
 await run('game-07-statistics-detective',`
  const g=MG.game;let cases=0;
  function pin(ds,ids,col,stat,lead){g.openDataset(ds);const s=g.state,v=s.view[ds];v.col=col;v.stat=stat;v.sel=new Set(ids);g.pinFinding();check(MG.current.maths.current,'statistics were not calculated');
   if(cases===0&&lead==='time'){const cards=s.cards.length;submitMath(true);check(s.cards.length===cards,'incorrect statistic pinned');}
   submitMath();const card=s.cards.at(-1);check(card&&card.ds===ds,'finding missing');
   const select=Array.from(document.querySelectorAll('#cards select')).at(-1);check(select,'card lead selector missing');select.value=lead;select.dispatchEvent(new Event('change'));
  }
  while(MG.current.isPlaying()&&cases<10){let k=g.kase;g.visit('museum');pin('sensors',[k.ids.sensorH],'motion','mean','time');pin('doors',[k.ids.doorH],'opens','mean','entry');g.submitReport();check(g.state.chapter===1,'chapter 1 failed');
   g.visit('metro');pin('metro',k.ids.nearby,'time','range','nearby');g.visit('cafe');pin('cafe',[k.ids.alibiReceipt],'amount','mean','alibi');g.submitReport();check(g.state.chapter===2,'chapter 2 failed');
   g.visit('lab');pin('prints',k.datasets.prints.rows.map(r=>r._id),'stride','median','scene');g.visit('gym');pin('gym',k.datasets.gym.rows.filter(r=>r.name===k.culprit).map(r=>r._id),'stride','mean','match');g.submitReport();cases++;
  }
  check(cases===10&&MG.current.lastResult?.won,'detective course failed');return{cases,calculatedEvidence:60,interpretationRequired:true};
 `);
 await run('game-08-trigonometry-rescue',`
  const g=MG.game;let missions=0;
  g.launch();check(!g.state.flight,'bad plan flew');
  while(MG.current.isPlaying()&&missions<10){const index=g.state.mIdx;
   while(MG.current.isPlaying()&&g.state.mIdx===index){const s=g.state,M=s.M;
    if(M.view==='side'&&s.routeIndex===1&&!s.rescued.has(0)){
     const p=M.people[0],dx=p.x-s.drone.x,drop=s.drone.y-p.y;g.dom.cable.value=(Math.hypot(dx,drop)).toFixed(1);g.dom.cangle.value=(Math.atan2(dx,drop)*180/Math.PI).toFixed(1);g.lowerCable();check(s.rescued.has(0),'calculated cable missed');
    }
    const goal=M.waypoints[s.routeIndex];check(goal,'route missing');const dx=goal.x-s.drone.x,dy=goal.y-s.drone.y,a=M.wind/40;
    const d=(-a*dx+Math.sqrt(dx*dx+(1-a*a)*dy*dy))/(1-a*a),airX=dx-a*d;
    const angle=M.view==='top'?(Math.atan2(airX,dy)*180/Math.PI+360)%360:Math.atan2(dy,Math.abs(airX))*180/Math.PI;
    s.dir=airX<0?-1:1;g.dom.angle.value=angle.toFixed(1);g.dom.dist.value=d.toFixed(1);g.launch();check(s.flight,'calculated flight rejected');
    let steps=0;while(s.flight&&steps++<200)MG.current.cfg.onUpdate.call(MG.current,.25);check(steps<200,'flight stalled');check(s.crashes===0,'valid route crashed');
   }missions++;
  }
  check(missions===10&&MG.current.lastResult?.won,'rescue course incomplete');check(g.state.crashes===0,'rescue geometry unsafe');return{calculatedMissions:missions,liveAimingRemoved:true,windAndCables:true};
 `);
 await run('game-09-integer-maze',`
  const g=MG.game;let rounds=0;
  while(MG.current.isPlaying()&&rounds<10){const s=g.state,m=s.L.consoleItem,exit=[...s.L.items.values()].find(it=>it.type==='exit');
   const values=Array.from({length:37},(_,i)=>i-18),before=values.find(n=>m.f(n)===s.L.target);check(before!==undefined,'no intended energy');
   s.pos=[m.c,m.r];s.E=before;g.activate();check(MG.current.maths.current&&!m.used,'console auto-evaluated');check(!document.getElementById('inv').textContent.includes('E = '+s.L.target),'exit reveals console answer');
   if(rounds===0){submitMath(true);check(!m.used&&s.E===before,'wrong energy changed console');}submitMath();check(m.used&&s.E===s.L.target,'console calculation failed');
   let adjacent;for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){s.pos=[exit.c+dx,exit.r+dy];if(g.nearbyMechanism()===exit){adjacent=[dx,dy];break;}}
   check(adjacent,'cannot reach exit');g.activate();check(exit.open,'correct exit remains locked');g.tryMove(-adjacent[0],-adjacent[1]);rounds++;
  }
  check(rounds===10&&MG.current.lastResult?.won,'maze course incomplete');return{verifiedConsoles:rounds,answersHiddenUntilCommit:true};
 `);
 await run('game-10-finance-tycoon',`
  const g=MG.game;let days=0;
  while(MG.current.isPlaying()&&days<10){const s=g.state;
   for(const [key,target]of [['lemonade',100],['cookie',80],['smoothie',65]]){if(key==='cookie'&&s.day<4||key==='smoothie'&&s.day<7)continue;
    const q=Math.max(0,Math.ceil((target-s.stock[key])/10)*10);if(!q)continue;g.changeOrder(key,q);g.buy(key);check(MG.current.maths.current,'invoice not checked');
    if(days===0){const cash=s.cash;submitMath(true);check(s.cash===cash&&s.stock[key]===0,'wrong invoice spent cash');}submitMath();check(s.order[key]===0,'invoice did not complete purchase');
   }
   g.endDay();check(MG.current.maths.current&&s.phase==='plan','day skipped business quote');submitMath();check(s.phase==='sim','correct quote did not open shop');
   let steps=0;while(s.phase==='sim'&&steps++<20)MG.current.cfg.onUpdate.call(MG.current,1);check(s.phase==='report','missing daily report');g.nextDay();days++;
  }
  check(days===10&&MG.current.lastResult?.won,'finance course failed');return{days,checkedInvoices:true,mandatoryDailyQuotes:true};
 `);
 // Genuine mobile prompt interaction: no page overflow and no blank-as-zero.
 await open('game-10-finance-tycoon');await send('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:true});
 const mobile=await evaluate(`MG.game.changeOrder('lemonade',50);MG.game.buy('lemonade');const c=MG.current.maths.current;c.fields[0].input.value='';c.node.dispatchEvent(new Event('submit',{cancelable:true}));({attempts:countAttempts(),overflow:document.documentElement.scrollWidth>innerWidth,form:!!MG.current.maths.current})`);
 assert.equal(mobile.attempts,0);assert.equal(mobile.overflow,false);assert(mobile.form);
 await fs.mkdir(path.join(__dirname,'maths-checks'),{recursive:true});
 const screenshot=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(__dirname,'maths-checks','mobile-invoice.png'),Buffer.from(screenshot.data,'base64'));
 const edgeCases=await evaluate(`(() => {
  const g=MG.game,s=g.state,old=MG.current.maths.current;
  old.fields[0].input.value='1/0';old.node.dispatchEvent(new Event('submit',{cancelable:true}));check(countAttempts()===0,'invalid fraction counted');
  old.fields[0].input.value='18.01';old.node.requestSubmit();check(s.stock.lemonade===0&&countAttempts()===1,'one-penny error accepted');
  g.changeOrder('lemonade',10);old.fields[0].input.value='18';old.node.requestSubmit();check(!MG.current.maths.current&&s.stock.lemonade===0,'stale invoice purchased stock');
  g.buy('lemonade');const current=MG.current.maths.current;
  Array.from(current.node.querySelectorAll('button')).find(b=>b.textContent==='Show guidance').click();
  current.fields[0].input.value='108/5';current.node.requestSubmit();check(s.stock.lemonade===60,'fractional amount rejected');
  const solved=[...MG.current.maths.entries.values()].find(e=>e.correct);check(solved.assisted&&!solved.first,'guidance not recorded');
  MG.current.end({won:false,title:'Practice check',reason:'Validation check',stars:0,stats:[],math:[]});
  const saved=MG.store.get(MG.current.cfg.id+':maths-last',null);check(saved.solved===1&&saved.assisted===1&&saved.independentFirst===0,'maths record not saved');
  MG.current.restart();old.node.dispatchEvent(new Event('submit',{cancelable:true}));check(g.state.stock.lemonade===0&&MG.current.maths.entries.size===0,'old form affected new run');
  return {invalidFractions:true,pencePrecision:true,stalePlans:true,guidance:true,persistence:true,restart:true};
 })()`);
 assert.equal(errors.length,0,errors.join('\n'));
 await fs.writeFile(path.join(__dirname,'maths-checks','results.json'),JSON.stringify({reports,mobile,edgeCases,errors},null,2));
 console.log('PASS nine games: incorrect answers blocked, correct answers progress; mobile form and blank-input validation.');
 if(!process.argv.includes('--keep-browser'))await send('Browser.close');socket.close();
})().catch(error=>{console.error(error);process.exit(1);});
