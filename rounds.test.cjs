// Run with: node math-games/rounds.test.cjs
// Exercise real round setup with rendering stubbed (no browser required).
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const specs = [
  ['STAGES', 'setupStage'], ['LEVELS', 'buildLevel'], ['STAGES', 'setupStage'],
  ['STAGES', 'setupStage'], ['NIGHTS', 'startNight'], ['STAGES', 'setupStage'],
  [null, 'startCase'], ['MISSIONS', 'loadMission'], ['LEVELS', 'loadLevel'], [null, 'startDay']
];
for (const dir of fs.readdirSync(__dirname).filter(d => d.startsWith('game-'))) {
  const id = Number(dir.slice(5, 7));
  const [array, setup] = specs[id - 1];
  const complete = { 1: 'stageComplete', 2: 'levelComplete', 6: 'nextContract', 8: 'missionComplete', 9: 'levelComplete' }[id];
  const source = fs.readFileSync(`${__dirname}/${dir}/script.js`, 'utf8');
  const element = () => ({ addEventListener() {}, setAttribute() {}, style: {}, classList: { add() {}, remove() {}, toggle() {} }, querySelectorAll: () => [], querySelector: () => element(), append() {}, focus() {}, value: 0 });
  const context = vm.createContext({ console, Math, Set, Map, document: { getElementById: element, querySelectorAll: () => [], addEventListener() {} }, addEventListener() {} });
  context.window = context;
  const split = source.indexOf('/* ===== CORE GAME SHELL (end) ===== */');
  vm.runInContext(source.slice(0, split), context);
  const shell = { timeLeft: 0, score: 0, setTimer(t) { this.timeLeft = t; }, setTimerText(text) { this.timerText = text; }, setStage(s) { this.stage = s; }, setLives() {}, setResource() {}, setProgress() {}, stopTimer() {}, toast() {}, flash() {}, addScore() {}, isPlaying: () => true };
  context.MG.createShell = cfg => { shell.cfg = cfg; return shell; };
  context.MG.sound.play = () => {};
  let game = source.slice(split);
  // Keep actual construction and generation; replace only presentation routines.
  const presentation = [...game.matchAll(/function ((?:render\w*|draw\w*|resize|updateChips|hideTerminal|showSetup|syncControls|updateMaterials|showBanner|refresh|buildToolbar))\(/g)].map(m => `${m[1]} = () => {};`).join('\n');
  game = game.replace(/\}\)\(\);\s*$/, `${presentation}\nfinish = (won) => { MG.test.won = won; };\nMG.test = { setup: ${setup}, complete: ${complete || 'null'}, presets: DIFF, rounds: ${array || (id === 10 ? 'Array(DAYS)' : 'Array(10)')} };\n})();`);
  vm.runInContext(game, context);
  const api = context.MG.test;
  assert.equal(api.rounds.length, 10, `${dir}: total rounds`);
  assert.ok(!source.includes('Change Difficulty'));
  assert.ok(!source.includes('<fieldset class="mg-diff">'));
  if(context.MG.MathsSession)shell.maths=new context.MG.MathsSession(shell);
  shell.cfg.onStart.call(shell, 'easy');
  for (let round = 0; round < 10; round++) {
    if (id === 10) context.MG.game.state.day = round + 1;
    api.setup(round);
    const expected = api.presets[round < 3 ? 'easy' : round < 6 ? 'normal' : 'hard'];
    assert.deepEqual({ ...context.MG.game.state.cfg }, { ...expected }, `${dir}: round ${round + 1} config`);
    assert.match(shell.stage, new RegExp(`^${round + 1}\\s*/\\s*10`), `${dir}: HUD`);
    if(id===4)assert.equal(shell.timerText,'Take your time',`${dir}: no construction countdown`);
    else assert.ok(shell.timeLeft > 0, `${dir}: valid timer`);
  }
  if(context.MG.MathsSession)shell.maths=new context.MG.MathsSession(shell);
  shell.cfg.onStart.call(shell, 'easy');
  assert.deepEqual({ ...context.MG.game.state.cfg }, { ...api.presets.easy }, `${dir}: restart`);
  assert.match(shell.stage, /^1\s*\/\s*10/);
  if (api.complete) {
    for (let round = 0; round < 10; round++) {
      assert.equal(api.won, undefined, `${dir}: no premature completion`);
      assert.match(shell.stage, new RegExp(`^${round + 1}\\s*/\\s*10`));
      if(id===2)context.MG.game.state.level.terminals.forEach(terminal=>terminal.done=true);
      api.complete();
    }
    assert.equal(api.won, true, `${dir}: completes at round 10`);
  }
  console.log(`PASS ${dir}: 10 round setups, preset boundaries, HUD, timers, restart`);
}
