// Optional maintenance helper. The generated game files need no build step.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const begin = '/* ===== ARCADE MOTION (start) ===== */';
const end = '/* ===== ARCADE MOTION (end) ===== */';
const source = name => fs.readFileSync(path.join(__dirname, 'motion', name), 'utf8');
const bootBegin = '<!-- ARCADE BOOT (start) -->';
const bootEnd = '<!-- ARCADE BOOT (end) -->';
const bootstrap = `${bootBegin}
  <style>html.am-booting body { visibility: hidden; }</style>
  <script>
    (() => {
      const root = document.documentElement;
      root.classList.add('am-booting');
      window.__arcadeBoot = { expired: false, timer: setTimeout(() => {
        window.__arcadeBoot.expired = true;
        root.classList.remove('am-booting');
      }, 1800) };
    })();
  </script>
  ${bootEnd}`;
const engine = `${begin}\n${source('engine.js')}\n${end}\n`;
const styles = type => `${begin}\n${source('common.css')}\n${source(type + '.css')}\n${end}\n`;
function sync(file, block, prepend = false) {
 let text = fs.readFileSync(file, 'utf8');
 const start = text.indexOf(begin);
 if (start >= 0) {
  const stop = text.indexOf(end, start);
  if (stop < 0) throw new Error('Unclosed motion block: ' + file);
  text = text.slice(0, start) + text.slice(stop + end.length).replace(/^\r?\n/, '');
 }
 text = prepend ? block + text : text.trimEnd() + '\n\n' + block;
 fs.writeFileSync(file, text);
}
function syncBootstrap(file) {
 let html = fs.readFileSync(file, 'utf8');
 const start = html.indexOf(bootBegin);
 if (start >= 0) {
  const stop = html.indexOf(bootEnd, start);
  if (stop < 0) throw new Error('Unclosed bootstrap block: ' + file);
  html = html.slice(0, start) + bootstrap + html.slice(stop + bootEnd.length);
 } else {
  html = html.replace('<head>', '<head>\n  ' + bootstrap);
 }
 fs.writeFileSync(file, html);
}
sync(path.join(root, 'hub.js'), engine, true);
sync(path.join(root, 'hub.css'), styles('hub'));
syncBootstrap(path.join(root, 'index.html'));
for (const dir of fs.readdirSync(root).filter(name => /^game-\d\d-/.test(name))) {
 sync(path.join(root, dir, 'script.js'), engine, true);
 sync(path.join(root, dir, 'style.css'), styles('game'));
 syncBootstrap(path.join(root, dir, 'index.html'));
}
console.log('Synced self-contained motion into the hub and 10 games.');
