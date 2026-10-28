const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function load(dir,random=Math.random){
 const element=()=>({addEventListener(){},setAttribute(){},style:{},classList:{add(){},remove(){},toggle(){}},querySelectorAll:()=>[],querySelector:element,append(){},focus(){},value:'0'});
 const context=vm.createContext({console,Math:Object.assign(Object.create(Math),{random}),Set,Map,document:{getElementById:element,querySelectorAll:()=>[],addEventListener(){}},addEventListener(){}});context.window=context;
 const source=fs.readFileSync(path.join(root,dir,'script.js'),'utf8'),split=source.indexOf('/* ===== CORE GAME SHELL (end) ===== */');
 vm.runInContext(source.slice(0,split),context);
 const shell={timeLeft:0,setTimer(t){this.timeLeft=t;},setTimerText(){},setStage(){},setLives(){},setResource(){},setProgress(){},stopTimer(){},toast(){},flash(){},addScore(){},isPlaying:()=>true};
 context.MG.createShell=cfg=>{shell.cfg=cfg;return shell;};context.MG.sound.play=()=>{};
 let game=source.slice(split);const presentation=[...game.matchAll(/function ((?:render\w*|draw\w*|resize|updateChips|hideTerminal|showSetup|syncControls|updateMaterials|showBanner|refresh|buildToolbar))\(/g)].map(m=>m[1]+'=()=>{};').join('\n');
 game=game.replace(/\}\)\(\);\s*$/,presentation+'\n})();');vm.runInContext(game,context);
 const start=()=>{shell.maths=new context.MG.MathsSession(shell);shell.cfg.onStart.call(shell,'easy');};start();return{MG:context.MG,shell,start};
}
// Independently interpret the authored labels, including implicit multiplication.
// This must not call the mechanism function whose result it is checking.
function displayedValue(label,values){
 const expression=label.replace(/^[Lh]\s*=\s*/,'').replace(/−/g,'-');
 const tokens=expression.match(/\d+(?:\.\d+)?|[xy()+*\-≥≤<>]/g)||[];
 assert.equal(tokens.join(''),expression.replace(/\s/g,''),'unrecognised expression: '+label);
 let index=0;
 function atom(){
  const token=tokens[index++];
  if(token==='+'||token==='-')return(token==='-'?-1:1)*atom();
  if(token==='('){const value=sum();assert.equal(tokens[index++],')');return value;}
  if(token==='x'||token==='y'){assert(Number.isFinite(values[token]));return values[token];}
  assert(token!==undefined&&Number.isFinite(Number(token)),'expected a number: '+label);return Number(token);
 }
 function product(){
  let value=atom();
  while(tokens[index]==='*'||/^(?:\d|[xy(])/.test(tokens[index]||'')){
   if(tokens[index]==='*')index++;
   value*=atom();
  }
  return value;
 }
 function sum(){let value=product();while(tokens[index]==='+'||tokens[index]==='-'){const op=tokens[index++],right=product();value=op==='+'?value+right:value-right;}return value;}
 let value=sum();const comparison=tokens[index];
 if(['≥','≤','>','<'].includes(comparison)){
  index++;const right=sum();value=comparison==='≥'?value>=right:comparison==='≤'?value<=right:comparison==='>'?value>right:value<right;
 }
 assert.equal(index,tokens.length,'unconsumed expression: '+label);return value;
}
const screenshot=load('game-02-algebra-platformer',()=>.5).MG.game.LEVELS[0].mechs.find(m=>m.id==='l1');
assert.equal(screenshot.text,'h = 2(x − 4) − 1');
assert.equal(displayedValue(screenshot.text,{x:7}),5,'screenshot lift label must give five tiles at x=7');
assert.equal(screenshot.f({x:7}),5);
const algebra=load('game-02-algebra-platformer'),factory=load('game-06-function-factory'),geometry=load('game-03-geometry-builder'),rescue=load('game-08-trigonometry-rescue'),skyline=load('game-04-coordinate-racer');
let expressionChecks=0;
for(let sample=0;sample<40;sample++){
 for(const game of [algebra,factory,geometry,rescue,skyline])game.start();
 for(const st of skyline.MG.game.STAGES){
  const {floor:f,support:p,answer:a}=st,near=(x,y)=>assert(Math.abs(x-y)<1e-7);
  near(f.y,p.y+p.h);assert(f.x>=p.x-1e-7&&f.x+f.w<=p.x+p.w+1e-7,'floor leaves its support');
  if(st.i===0)near(f.x,p.x);
  if(st.i===1)near(f.x+f.w,p.x+p.w);
  if([2,3,5,8].includes(st.i))near(f.x+f.w/2,p.x+p.w/2);
  if(st.i===3)near(f.w,p.w*.75);
  if(st.i===4){near(f.x,p.x+1);near(f.w,p.w-2);}
  if(st.i===5)near(f.w,p.w*.8);
  if(st.guide)near(f.y+f.h,st.guide.m*(f.x+f.w)+st.guide.b);
  if(st.brace){const {a,b,slope,length}=st.brace;near(slope,(b.y-a.y)/(b.x-a.x));near(length,Math.hypot(b.x-a.x,b.y-a.y));assert(a.x>=f.x&&a.x<=f.x+f.w&&b.x>=f.x&&b.x<=f.x+f.w);near(a.y,f.y);near(b.y,f.y+f.h);}
  assert(Number.isInteger(f.x)&&Number.isInteger(f.w),'drag placement must use whole metres');
  assert.equal(new Set(st.widths).size,3);assert(st.widths.includes(f.w));
  if(st.brace){
   let solutions=0;
   for(let i=0;i<st.brace.options.length;i++)for(let j=0;j<st.brace.sockets.length;j++){
    const piece=st.brace.options[i],socket=st.brace.sockets[j],b=st.brace;
    const expected=(b.mode==='slope'?piece.run===b.b.x-b.a.x&&piece.rise===b.b.y-b.a.y:piece.length===Math.hypot(b.b.x-b.a.x,b.b.y-b.a.y))&&socket.x===b.b.x&&socket.y===b.b.y;
    assert.equal(skyline.MG.game.validateBrace(st,i,j),expected,'beam geometry validation mismatch');if(expected)solutions++;
   }
   assert.equal(solutions,1,'beam puzzle must have exactly one fitting piece and socket');
  }
  assert(skyline.MG.game.validatePlan(st,a),'correct tower plan rejected');
  for(const field of st.fields){assert(!skyline.MG.game.validatePlan(st,{...a,[field.key]:a[field.key]+.01}),'incorrect tower input accepted');assert(!skyline.MG.game.validatePlan(st,{...a,[field.key]:NaN}),'invalid tower input accepted');}
 }
 const levels=algebra.MG.game.LEVELS;assert.equal(new Set(levels.map(l=>l.mechs.map(m=>m.text).join('|'))).size,10);
 for(const level of levels)for(const terminal of level.terminals){
  const names=Object.keys(terminal.vars),candidates=[];
  function search(index,values){if(index===names.length){candidates.push({...values});return;}const key=names[index],[min,max]=terminal.vars[key];for(let n=min;n<=max;n++)search(index+1,{...values,[key]:n});}search(0,{});
  for(const values of candidates)for(const id of terminal.links){
   const m=level.mechs.find(m=>m.id===id);
   assert.equal(displayedValue(m.text,values),m.f(values),m.text+' at '+JSON.stringify(values));expressionChecks++;
  }
  assert(candidates.some(values=>terminal.links.every(id=>{const m=level.mechs.find(m=>m.id===id),v=m.f(values);return m.type==='bridge'?v===m.gap:m.type==='lift'?v===m.dock:v===true;})),'unsolvable algebra terminal');
 }
 assert.equal(new Set(factory.MG.game.STAGES.map(stage=>JSON.stringify([-2,0,3].map(n=>stage.contracts[0].target(n))))).size,10,'duplicate factory rule');
 for(const stage of factory.MG.game.STAGES)for(const contract of stage.contracts){
  assert(contract.solution.length<=stage.slots);
  for(const n of [-3,0,1,2,5,8,13]){
   const value=contract.solution.reduce((value,[type,k])=>type==='add'?value+k:type==='mul'?value*k:type==='div'?value/k:type==='sq'?value*value:-value,n);
   assert(Math.abs(value-contract.target(n))<1e-8,'factory solution does not generalise');
  }
 }
 for(const [i,stage] of geometry.MG.game.STAGES.entries()){
  const G=geometry.MG.game.G,items=[];
  const types=i<3?['house','park']:i<6?['house','pool','park']:['civic','garden','park'];
  const positions=i<3?{house:0,park:8}:i<6?{house:0,pool:8,park:15}:{civic:0,garden:7,park:15};
  for(const type of types){
   const word=type==='civic'?'library':type;
   const requirements=stage.reqs.filter(r=>r.text.toLowerCase().includes(word));let chosen;
   const maxW=type==='civic'?4:6,maxH=type==='garden'?13:6;
   outer:for(let w=1;w<=maxW;w++)for(let h=1;h<=maxH;h++)for(let z=1;z<=(type==='pool'?3:type==='civic'?6:1);z++){
    const candidate={type,x:positions[type],y:0,w,h,depth:z,height:z};const road={type:'road',x:candidate.x+w,y:0,w:1,h:1};
    if(requirements.every(r=>r.check([candidate,road]).ok)){chosen=candidate;break outer;}
   }
   assert(chosen,'no geometry solution for '+type+' round '+(i+1));items.push(chosen);
   if(type==='house'||type==='civic')items.push({type:'road',x:chosen.x+chosen.w,y:0,w:1,h:1});
  }
  assert(stage.reqs.every(r=>r.check(items).ok),'combined geometry layout rejected');
  assert(items.reduce((sum,item)=>sum+G.cost(item),0)<=stage.budget,'geometry budget unsolvable');
  for(const item of items){assert(item.x+item.w<=stage.cols&&item.y+item.h<=stage.rows);for(const other of items)if(item!==other)assert(!(item.x<other.x+other.w&&item.x+item.w>other.x&&item.y<other.y+other.h&&item.y+item.h>other.y),'geometry solution overlaps');}
 }
 for(const M of rescue.MG.game.MISSIONS){
  let p=M.view==='top'?{x:0,y:0}:{x:40,y:20},fuel=100;
  for(const goal of M.waypoints){
   const dx=goal.x-p.x,dy=goal.y-p.y,a=M.wind/40;
   const distance=(-a*dx+Math.sqrt(dx*dx+(1-a*a)*dy*dy))/(1-a*a);
   assert(distance>0&&distance<=300,'flight distance out of controls: '+M.name+' '+distance);fuel-=distance*.08+Math.max(0,dy)*.08;
   if(M.view==='side')for(let k=.1;k<1;k+=.1)assert(p.y+dy*k>=20,'flight intersects ground');
   p=goal;
  }
  assert(fuel>=30,'mission fuel not attainable');
  if(M.view==='side'){const w=M.waypoints[0],person=M.people[0],cable=Math.hypot(person.x-w.x,person.y-w.y);assert(cable<=150,'winch too short');}
 }
}
console.log('PASS '+expressionChecks+' displayed algebra calculations, screenshot regression, 400 algebra rounds, 400 tower blueprints, 400 factory contracts, 400 feasible geometry layouts, 400 fuel-safe rescue missions.');
