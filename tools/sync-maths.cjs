const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const start = '/* ===== MATHS PRACTICE (start) ===== */', end = '/* ===== MATHS PRACTICE (end) ===== */';
for (const dir of fs.readdirSync(root).filter(name => /^game-\d\d-/.test(name))) {
 for (const [name, source] of [['script.js','maths-session.js'],['style.css','maths-session.css']]) {
  const file = path.join(root,dir,name);let text = fs.readFileSync(file,'utf8');
  if (text.includes(start)) {const a=text.indexOf(start),b=text.indexOf(end,a);if(b<0)throw Error(file);text=text.slice(0,a)+text.slice(b+end.length).replace(/^\r?\n/,'');}
  const block = start+'\n'+fs.readFileSync(path.join(__dirname,source),'utf8')+'\n'+end+'\n';
  if(name==='script.js'){const marker='/* ===== CORE GAME SHELL (end) ===== */';text=text.replace(marker,marker+'\n'+block);}else text=text.trimEnd()+'\n\n'+block;
  fs.writeFileSync(file,text);
 }
}
