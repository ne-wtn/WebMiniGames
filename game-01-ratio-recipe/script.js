/* ===== ARCADE MOTION (start) ===== */
// Embedded into the hub and every game by tools/sync-motion.cjs.
// The shipped pages remain self-contained; no runtime imports or dependencies.
(function (global) {
  'use strict';
  if (global.ArcadeMotion) return;
  const doc = global.document;
  const preference = global.matchMedia?.('(prefers-reduced-motion: reduce)');
  const spring = 'cubic-bezier(.16, 1, .3, 1)';
  const settling = 'cubic-bezier(.22, .85, .3, 1)';
  const active = new Set();
  const channels = new WeakMap();
  const counters = new Map();
  const observed = new Set();
  let effects = null;
  let observer = null;
  let bootComplete = false;
  let bootScheduled = false;
  let suppressStartup = false;
  const startupTasks = [];
  const enabled = () => !preference?.matches && !doc.hidden && !suppressStartup;

  // The tiny head bootstrap guards the first paint. Discover the fonts used by
  // the finished layout, then install entrance keyframes before revealing it.
  function ready(task) {
    if (bootComplete) { task(); return; }
    startupTasks.push(task);
    if (bootScheduled) return;
    bootScheduled = true;
    global.requestAnimationFrame(() => {
      doc.documentElement.getBoundingClientRect();
      let settled = false;
      let deadline;
      const commit = () => {
        if (settled) return;
        settled = true;
        global.clearTimeout(deadline);
        global.requestAnimationFrame(() => {
          // If the script missed the bootstrap deadline, keep already-visible
          // content in place rather than replaying an entrance over it.
          suppressStartup = !!global.__arcadeBoot?.expired || doc.fonts?.status === 'loading';
          bootComplete = true;
          try {
            for (const callback of startupTasks.splice(0)) callback();
          } finally {
            doc.documentElement.classList.remove('am-booting');
            global.clearTimeout(global.__arcadeBoot?.timer);
            suppressStartup = false;
          }
        });
      };
      deadline = global.setTimeout(commit, 1200);
      Promise.resolve(doc.fonts?.ready).then(commit, commit);
    });
  }

  function cancel(element, channel) {
    channels.get(element)?.get(channel)?.cancel();
  }

  function animate(element, frames, options = {}, channel = 'reaction') {
    if (!element?.animate || !element.isConnected || !enabled()) return null;
    cancel(element, channel);
    // Keep the first keyframe in effect throughout any stagger delay.
    const animation = element.animate(frames, { duration: 460, easing: spring, fill: 'backwards', ...options });
    let map = channels.get(element);
    if (!map) { map = new Map(); channels.set(element, map); }
    map.set(channel, animation);
    active.add(animation);
    const cleanup = () => {
      active.delete(animation);
      if (map.get(channel) === animation) map.delete(channel);
    };
    animation.addEventListener('finish', cleanup, { once: true });
    animation.addEventListener('cancel', cleanup, { once: true });
    return animation;
  }

  function layer() {
    if (!effects?.isConnected) {
      effects = doc.createElement('div');
      effects.className = 'am-effects';
      effects.setAttribute('aria-hidden', 'true');
      doc.body.appendChild(effects);
    }
    return effects;
  }

  function accent(element) {
    const style = global.getComputedStyle(element);
    return style.getPropertyValue('--c-accent').trim() || style.getPropertyValue('--mg-accent').trim() || style.getPropertyValue('--focus').trim() || '#ffcc00';
  }

  function effect(className, x, y, color, frames, options) {
    if (!enabled() || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < 0 || y < 0 || x > global.innerWidth || y > global.innerHeight) return;
    const host = layer();
    if (host.childElementCount >= 64) return;
    const node = doc.createElement('span');
    node.className = className;
    node.style.left = x + 'px';
    node.style.top = y + 'px';
    node.style.color = color;
    host.appendChild(node);
    const animation = animate(node, frames, options, 'effect');
    if (!animation) { node.remove(); return; }
    animation.addEventListener('finish', () => node.remove(), { once: true });
    animation.addEventListener('cancel', () => node.remove(), { once: true });
  }

  function ripple(element, point) {
    if (!enabled()) return;
    const rect = element.getBoundingClientRect();
    const x = point?.x ?? rect.left + rect.width / 2;
    const y = point?.y ?? rect.top + rect.height / 2;
    const size = Math.min(110, Math.max(44, Math.min(rect.width, rect.height) * 1.7));
    effect('am-ripple', x, y, accent(element), [
      { width: size + 'px', height: size + 'px', scale: '.12', opacity: .34 },
      { width: size + 'px', height: size + 'px', scale: '1', opacity: 0 }
    ], { duration: 620, easing: 'cubic-bezier(.12,.65,.25,1)' });
  }

  function press(element, point) {
    animate(element, [
      { scale: '1', offset: 0 },
      { scale: '.955', offset: .2 },
      { scale: '1.018', offset: .65 },
      { scale: '1', offset: 1 }
    ], { duration: 390, easing: settling }, 'press');
    ripple(element, point);
  }

  function reveal(elements, gap = 48) {
    // Measure as a batch, before any animation writes can invalidate layout.
    const visible = Array.from(elements).filter(element => element.getClientRects().length);
    visible.forEach((element, index) => {
      element.classList.remove('am-awaiting');
      animate(element, [
        { opacity: 0, translate: '0 14px' },
        { opacity: 1, translate: '0 0' }
      ], { duration: 520, delay: Math.min(index * gap, 180) }, 'entrance');
    });
  }

  function observe(elements) {
    if (!enabled() || !global.IntersectionObserver) return;
    if (!observer) observer = new IntersectionObserver(entries => {
      const entering = entries.filter(entry => entry.isIntersecting).map(entry => entry.target);
      entering.forEach(element => { observer.unobserve(element); observed.delete(element); });
      reveal(entering);
    }, { threshold: .08, rootMargin: '0px 0px 28px 0px' });
    const visible = Array.from(elements).filter(element => element.getClientRects().length);
    visible.forEach(element => {
      element.classList.add('am-awaiting');
      observed.add(element);
      observer.observe(element);
    });
  }

  // FLIP reflows cards from their previous position, without delaying filtering.
  function layout(container, mutate) {
    const children = Array.from(container.children);
    const before = new Map();
    for (const child of children) {
      if (!child.hidden) before.set(child, child.getBoundingClientRect());
    }
    for (const child of children) {
      cancel(child, 'layout');
      cancel(child, 'entrance');
      child.classList.remove('am-awaiting');
      observer?.unobserve(child);
      observed.delete(child);
    }
    mutate();
    const entering = [];
    const moving = [];
    for (const child of children) {
      if (child.hidden) continue;
      const previous = before.get(child);
      if (!previous) { entering.push(child); continue; }
      const rect = child.getBoundingClientRect();
      const x = previous.left - rect.left, y = previous.top - rect.top;
      if (Math.abs(x) + Math.abs(y) > 1) moving.push({ child, x, y });
    }
    for (const { child, x, y } of moving) {
      animate(child, [
        { translate: x + 'px ' + y + 'px' },
        { translate: '0 0' }
      ], { duration: 540 }, 'layout');
    }
    reveal(entering, 35);
  }

  function panel(overlay) {
    if (!bootComplete) { ready(() => panel(overlay)); return; }
    if (!overlay.classList.contains('is-open')) return;
    const card = overlay.querySelector('.mg-card');
    if (!card) return;
    // One surface entrance avoids fading the full-screen backdrop and scaling
    // a large SVG at the same time as every nested menu item.
    animate(card, [
      { opacity: 0, translate: '0 18px' },
      { opacity: 1, translate: '0 0' }
    ], { duration: 440 }, 'panel');
    // Visual-only count-up: the final value remains available to screen readers.
    const final = card.querySelector('[data-final-score]');
    if (final) count(final, Number(final.dataset.finalScore));
  }

  function count(element, value) {
    if (!enabled() || !Number.isFinite(value)) return;
    const previous = counters.get(element);
    if (previous) { global.cancelAnimationFrame(previous.frame); element.textContent = previous.value; }
    const start = global.performance.now();
    const counter = { value, frame: 0 };
    counters.set(element, counter);
    // Reserve the final number's width and set zero before the next paint.
    // The first frame must not show the final value and then jump backwards.
    element.style.minWidth = element.getBoundingClientRect().width + 'px';
    element.textContent = '0';
    const tick = now => {
      if (!element.isConnected || !enabled()) { element.textContent = value; counters.delete(element); return; }
      const t = Math.min(1, (now - start) / 900);
      element.textContent = Math.round(value * (1 - Math.pow(1 - t, 3)));
      if (t < 1) counter.frame = global.requestAnimationFrame(tick);
      else counters.delete(element);
    };
    counter.frame = global.requestAnimationFrame(tick);
  }

  function reward(element, points, x, y) {
    animate(element, [
      { translate: '0 0', scale: '1' },
      { translate: '0 -3px', scale: '1.14', offset: .32 },
      { translate: '0 0', scale: '1' }
    ], { duration: 520, easing: settling }, 'score');
    if (points <= 0) return;
    const color = accent(element);
    effect('am-reward-ring', x, y, color, [
      { scale: '.2', opacity: .6 }, { scale: '1.3', opacity: 0 }
    ], { duration: 560 });
    const total = points >= 100 ? 10 : 6;
    for (let i = 0; i < total; i++) {
      const angle = (i / total) * Math.PI * 2;
      const radius = 32 + (i % 3) * 15;
      const dx = Math.cos(angle) * radius, dy = Math.sin(angle) * radius;
      effect('am-particle' + (i % 2 ? ' am-particle--round' : ''), x, y, color, [
        { translate: '0 0', scale: '.45', opacity: 0, rotate: '0deg' },
        { translate: dx * .7 + 'px ' + (dy - 10) + 'px', scale: '1', opacity: .9, rotate: '55deg', offset: .4 },
        { translate: dx + 'px ' + (dy + 28) + 'px', scale: '.35', opacity: 0, rotate: '120deg' }
      ], { duration: 650 + (i % 3) * 60, easing: 'cubic-bezier(.12,.55,.35,1)' });
    }
  }

  function round(element) {
    animate(element, [
      { opacity: .3, translate: '0 9px', scale: '.96' },
      { opacity: 1, translate: '0 0', scale: '1' }
    ], { duration: 620 }, 'round');
    const rect = element.getBoundingClientRect();
    ripple(element, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  }

  function stop() {
    for (const animation of Array.from(active)) animation.cancel();
    for (const [element, counter] of counters) {
      global.cancelAnimationFrame(counter.frame);
      element.textContent = counter.value;
    }
    counters.clear();
    for (const element of observed) element.classList.remove('am-awaiting');
    observed.clear();
    observer?.disconnect();
    effects?.replaceChildren();
  }

  const controls = 'button, .card__link, .mg-btn, summary';
  doc.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    const control = event.target.closest?.(controls);
    if (!control || control.matches(':disabled, [aria-disabled="true"]')) return;
    press(control, { x: event.clientX, y: event.clientY });
  }, { passive: true });
  doc.addEventListener('keydown', event => {
    if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
    const control = event.target.closest?.(controls);
    if (!control || control.matches(':disabled, [aria-disabled="true"]') || control.matches('input, select, textarea')) return;
    press(control);
  });
  doc.addEventListener('visibilitychange', () => {
    doc.documentElement.classList.toggle('am-hidden', doc.hidden);
    if (doc.hidden) stop();
  });
  preference?.addEventListener('change', () => { if (!enabled()) stop(); });
  global.addEventListener('pagehide', stop);
  global.ArcadeMotion = { ready, enabled, animate, reveal, observe, layout, panel, reward, round, stop };
})(window);

/* ===== ARCADE MOTION (end) ===== */
/* ===== CORE GAME SHELL (start) ===== */
/* Core shell (JavaScript) — the standard screens, HUD, timer, pause, sound and end card used by this game. Game-specific code follows below. */
/* ==========================================================================
   Secondary Maths Games — core utilities and the GameShell (embedded in this game).

   The shell owns everything that every game needs in the same way:
   start screen, instructions, HUD, countdown timer, pause/resume,
   restart, sound toggle, end-game card, star display and best scores.

   Each game supplies its own mechanics through callbacks:
     onStart(difficulty)   build fresh state for a run
     onUpdate(dt)          called every animation frame while playing (dt in s)
     onTimeUp()            called once when the countdown reaches zero
     onPause()/onResume()  optional
     onStop()              tear down per-run resources (restart / end)

   All per-frame work flows through the shell's single requestAnimationFrame
   loop, so pausing the shell freezes every timer, hazard and animation.
   ========================================================================== */
(function (global) {
  'use strict';

  const MG = {};

  /* ---------------- Maths & DOM helpers ---------------- */
  MG.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  MG.lerp = (a, b, t) => a + (b - a) * t;
  MG.rand = (a, b) => a + Math.random() * (b - a);
  MG.randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
  MG.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  MG.shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  /** Round to dp decimal places, avoiding 1.005 -> 1.00 style errors. */
  MG.round = (v, dp = 0) => {
    const f = Math.pow(10, dp);
    return Math.round((v + Math.sign(v) * Number.EPSILON) * f) / f;
  };
  MG.safeNum = (v, fallback = 0) => (Number.isFinite(v) ? v : fallback);
  MG.fmtTime = (s) => {
    s = Math.max(0, Math.ceil(MG.safeNum(s)));
    const m = Math.floor(s / 60);
    return m + ':' + String(s % 60).padStart(2, '0');
  };
  MG.gcd = (a, b) => {
    a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b));
    while (b) [a, b] = [b, a % b];
    return a || 1;
  };
  /** Format a decimal as a simplified fraction (mixed number unless improper is true). */
  MG.fraction = (v, maxDen = 16, improper = false) => {
    if (Number.isInteger(v)) return String(v);
    for (let d = 2; d <= maxDen; d++) {
      const n = v * d;
      if (Math.abs(n - Math.round(n)) < 1e-9) {
        const g = MG.gcd(Math.round(n), d);
        const nn = Math.round(n) / g, dd = d / g;
        const whole = Math.trunc(nn / dd);
        const rem = Math.abs(nn % dd);
        if (!improper && whole !== 0 && rem) return `${whole} ${rem}/${dd}`;
        return `${nn}/${dd}`;
      }
    }
    return String(MG.round(v, 3));
  };
  MG.escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** Tiny element factory: MG.el('button', {class:'x', onclick: fn}, 'Label') */
  MG.el = (tag, props, ...children) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      e.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return e;
  };
  /** Safe check of a keyboard event's target (targets can be window/document). */
  MG.isTarget = (e, sel) => !!(e.target && e.target.matches && e.target.matches(sel));
  MG.$ = (sel, root = document) => root.querySelector(sel);
  MG.$$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ---------------- Safe localStorage ---------------- */
  MG.store = {
    get(key, fallback) {
      try {
        const v = global.localStorage.getItem('mathgames:' + key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { global.localStorage.setItem('mathgames:' + key, JSON.stringify(value)); return true; }
      catch (e) { return false; }
    }
  };

  /* ---------------- Web Audio sound engine ----------------
     Sound starts muted and the AudioContext is only created after the
     player explicitly turns sound on (which is also a user gesture). */
  class SoundEngine {
    constructor() {
      this.enabled = false;
      this.ctx = null;
      this.master = null;
      this.subs = new Set();
    }
    _ensure() {
      if (this.ctx) return true;
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return false;
      try {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.32;
        this.master.connect(this.ctx.destination);
        return true;
      } catch (e) { return false; }
    }
    setEnabled(on) {
      this.enabled = !!on;
      if (this.enabled && this._ensure() && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      this.subs.forEach((fn) => fn(this.enabled));
      if (this.enabled) this.play('select');
    }
    toggle() { this.setEnabled(!this.enabled); }
    onChange(fn) { this.subs.add(fn); fn(this.enabled); }
    tone({ freq = 440, to = null, dur = 0.12, type = 'sine', vol = 0.5, delay = 0 }) {
      const c = this.ctx, t = c.currentTime + delay;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + dur + 0.02);
    }
    noise({ dur = 0.2, vol = 0.3, delay = 0, freq = 1200 }) {
      const c = this.ctx, t = c.currentTime + delay;
      const len = Math.max(1, Math.floor(c.sampleRate * dur));
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = c.createBufferSource(); src.buffer = buf;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
      const g = c.createGain(); g.gain.value = vol;
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(t);
    }
    play(name) {
      if (!this.enabled || !this._ensure()) return;
      const fx = SOUND_PRESETS[name];
      if (fx) { try { fx(this); } catch (e) { /* audio is non-critical */ } }
    }
  }
  const SOUND_PRESETS = {
    click: (s) => s.tone({ freq: 660, dur: 0.05, type: 'square', vol: 0.15 }),
    select: (s) => s.tone({ freq: 520, to: 780, dur: 0.08, type: 'triangle', vol: 0.3 }),
    place: (s) => { s.tone({ freq: 220, dur: 0.08, type: 'square', vol: 0.2 }); s.noise({ dur: 0.05, vol: 0.15, freq: 800 }); },
    coin: (s) => { s.tone({ freq: 988, dur: 0.07, type: 'square', vol: 0.2 }); s.tone({ freq: 1319, dur: 0.16, type: 'square', vol: 0.2, delay: 0.07 }); },
    success: (s) => [523, 659, 784].forEach((f, i) => s.tone({ freq: f, dur: 0.14, type: 'triangle', vol: 0.35, delay: i * 0.08 })),
    error: (s) => { s.tone({ freq: 220, to: 140, dur: 0.25, type: 'sawtooth', vol: 0.25 }); },
    hit: (s) => { s.noise({ dur: 0.25, vol: 0.45, freq: 600 }); s.tone({ freq: 120, to: 50, dur: 0.25, type: 'square', vol: 0.3 }); },
    jump: (s) => s.tone({ freq: 300, to: 720, dur: 0.14, type: 'square', vol: 0.15 }),
    stage: (s) => [392, 523, 659, 784, 1047].forEach((f, i) => s.tone({ freq: f, dur: 0.16, type: 'triangle', vol: 0.32, delay: i * 0.09 })),
    win: (s) => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => s.tone({ freq: f, dur: 0.22, type: 'triangle', vol: 0.35, delay: i * 0.12 })),
    lose: (s) => [392, 330, 262, 196].forEach((f, i) => s.tone({ freq: f, dur: 0.3, type: 'sawtooth', vol: 0.2, delay: i * 0.18 })),
    tick: (s) => s.tone({ freq: 1200, dur: 0.03, type: 'square', vol: 0.12 }),
    whoosh: (s) => s.noise({ dur: 0.35, vol: 0.25, freq: 2000 }),
    cash: (s) => { s.tone({ freq: 1568, dur: 0.06, type: 'square', vol: 0.15 }); s.tone({ freq: 2093, dur: 0.2, type: 'triangle', vol: 0.25, delay: 0.05 }); },
    pop: (s) => s.tone({ freq: 400, to: 900, dur: 0.06, type: 'sine', vol: 0.35 }),
    spin: (s) => s.tone({ freq: 800, dur: 0.02, type: 'square', vol: 0.08 }),
    alarm: (s) => [880, 660, 880, 660].forEach((f, i) => s.tone({ freq: f, dur: 0.12, type: 'square', vol: 0.18, delay: i * 0.13 })),
    beep: (s) => s.tone({ freq: 880, dur: 0.08, type: 'sine', vol: 0.3 }),
    engine: (s) => s.tone({ freq: 90, to: 140, dur: 0.12, type: 'sawtooth', vol: 0.06 })
  };
  MG.sound = new SoundEngine();

  /* ---------------- Star SVG ---------------- */
  const STAR_PATH = 'M32 4l8.6 17.5 19.4 2.8-14 13.6 3.3 19.2L32 48.1 14.7 57.1 18 37.9 4 24.3l19.4-2.8z';
  MG.starsSVG = (n) => [0, 1, 2].map((i) =>
    `<svg class="mg-star${i < n ? ' is-on' : ''}" viewBox="0 0 64 64" aria-hidden="true"><path d="${STAR_PATH}"/></svg>`).join('');

  // Zero-based round indices; normal is the existing medium preset.
  MG.roundTier = (index) => index < 3 ? 0 : index < 6 ? 1 : 2;
  MG.roundDifficulty = (index) => ['easy', 'normal', 'hard'][MG.roundTier(index)];
  MG.roundConfig = (presets, index) => ({ ...presets[MG.roundDifficulty(index)] });
  MG.expandRounds = (templates) => Array.from({ length: 10 }, (_, index) => {
    const template = templates[MG.roundTier(index)];
    const round = { ...template };
    for (const key of ['name', 'title']) {
      if (round[key]) round[key] = round[key].replace(/^(Stage|Sector) \d+/, '$1 ' + (index + 1));
    }
    return round;
  });

  /* ---------------- GameShell ---------------- */
  class Shell {
    constructor(cfg) {
      this.cfg = Object.assign({
        difficulties: [
          { id: 'easy', label: 'Easy', desc: 'Extra time & hints' },
          { id: 'normal', label: 'Normal', desc: 'Just right' },
          { id: 'hard', label: 'Hard', desc: 'For experts' }
        ],
        defaultDifficulty: 'normal',
        livesLabel: 'Lives',
        timerLabel: 'Time',
        stageLabel: 'Round',
        hubUrl: '../index.html'
      }, cfg);
      this.state = 'menu';
      this.difficulty = this.cfg.defaultDifficulty;
      this.score = 0;
      this.timeLeft = 0;
      this.timerOn = false;
      this.playTime = 0;
      this.raf = 0;
      this.last = 0;
      this._lastTick = -1;
      this.app = document.querySelector('.mg-app');
      MG.current = this; // handle used by automated tests
      this._build();
      this._bindGlobal();
      MG.sound.onChange((on) => this._syncSound(on));
      this.showStart();
    }

    /* ----- DOM construction ----- */
    _build() {
      const c = this.cfg;
      const hud = document.getElementById('hud');
      hud.classList.add('mg-hud');
      hud.innerHTML = `
        <span class="mg-hud__title">${MG.escape(c.title)}</span>
        <div class="mg-hud__item"><span class="mg-hud__label" data-k="stageLabel">${MG.escape(c.stageLabel)}</span><span class="mg-hud__value" data-k="stage">1</span></div>
        <div class="mg-hud__item"><span class="mg-hud__label">Score</span><span class="mg-hud__value" data-k="score" aria-live="polite">0</span></div>
        <div class="mg-hud__item mg-hud__item--timer"><span class="mg-hud__label" data-k="timerLabel">${MG.escape(c.timerLabel)}</span><span class="mg-hud__value" data-k="timer">0:00</span></div>
        <div class="mg-hud__item mg-hud__item--lives"><span class="mg-hud__label" data-k="livesLabel">${MG.escape(c.livesLabel)}</span><span class="mg-hud__value" data-k="lives">—</span></div>
        <div class="mg-hud__item mg-hud__progress"><span class="mg-hud__label" data-k="progressLabel">Progress</span><div class="mg-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-label="Progress"><span data-k="progress"></span></div></div>
        <div class="mg-hud__btns">
          <button class="mg-btn mg-btn--icon" type="button" data-act="sound" aria-pressed="false" aria-label="Sound off. Turn sound on" title="Sound (M)">🔇</button>
          <button class="mg-btn" type="button" data-act="pause" aria-label="Pause game" title="Pause (P or Esc)">⏸ <span class="mg-hide-sm">Pause</span></button>
        </div>`;
      this.hud = {};
      hud.querySelectorAll('[data-k]').forEach((n) => { this.hud[n.dataset.k] = n; });
      this.hud.timerItem = hud.querySelector('.mg-hud__item--timer');
      this.hud.livesItem = hud.querySelector('.mg-hud__item--lives');
      this.hud.meter = hud.querySelector('.mg-meter');
      hud.querySelector('[data-act="pause"]').addEventListener('click', () => this.togglePause());
      hud.querySelector('[data-act="sound"]').addEventListener('click', () => MG.sound.toggle());

      // Overlays
      this.ov = {};
      const mk = (name, extra = '') => {
        const o = MG.el('div', { class: 'mg-overlay ' + extra, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mg-' + name + '-title' });
        document.body.appendChild(o);
        this.ov[name] = o;
        return o;
      };
      this._buildStart(mk('start', 'mg-overlay--start'));
      this._buildHelp(mk('help'));
      this._buildPause(mk('pause'));
      mk('end');

      this.toasts = MG.el('div', { class: 'mg-toasts', 'aria-live': 'polite' });
      document.body.appendChild(this.toasts);
    }

    _soundBtn() {
      const b = MG.el('button', { class: 'mg-btn mg-btn--ghost', type: 'button', 'data-sound': '', 'aria-pressed': 'false' }, '🔇 Sound off');
      b.addEventListener('click', () => MG.sound.toggle());
      return b;
    }

    /** The three picture steps shown on the start screen and in the help card. */
    _stepsHTML(cls = '') {
      const steps = this.cfg.steps || [];
      return `<ol class="mg-steps ${cls}">${steps.map(([icon, text], i) => `
        <li class="mg-step" style="--i:${i}"><span class="mg-step__n">${i + 1}</span><span class="mg-step__icon" aria-hidden="true">${icon}</span><span class="mg-step__text">${text}</span></li>`).join('')}</ol>`;
    }

    _buildStart(o) {
      const c = this.cfg;
      o.innerHTML = `
        <div class="mg-card mg-start-card">
          <div class="mg-start-art">${c.art || ''}</div>
          <div class="mg-start-body">
            <p class="mg-kicker">${MG.escape(c.topic)}</p>
            <h1 class="mg-title" id="mg-start-title">${MG.escape(c.title)}</h1>
            <p class="mg-tagline">${c.tagline || c.premise}</p>
            ${this._stepsHTML()}
            <p class="mg-rounds">10 rounds</p>
            <div class="mg-actions" data-slot="actions"></div>
            <div class="mg-meta-row"><span data-k="best"></span><a class="mg-link" href="${c.hubUrl}">← All games</a></div>
          </div>
        </div>`;
      const actions = o.querySelector('[data-slot="actions"]');
      const start = MG.el('button', { class: 'mg-btn mg-btn--primary mg-btn--lg mg-btn--play', type: 'button' }, '▶ Play');
      start.addEventListener('click', () => {
        this.start();
      });
      const help = MG.el('button', { class: 'mg-btn mg-btn--ghost', type: 'button' }, '? How to play');
      help.addEventListener('click', () => this.showHelp());
      actions.append(start, help, this._soundBtn());
      this.startBtn = start;
      this.bestLabel = o.querySelector('[data-k="best"]');
    }

    /** Short help for players; the full rules sit in a closed "for teachers" section. */
    _buildHelp(o) {
      const c = this.cfg, ins = c.instructions;
      const list = (arr) => '<ul>' + arr.map((x) => `<li>${x}</li>`).join('') + '</ul>';
      const keys = (c.keys || []).map(([k, what]) => `<li><span class="mg-keys__k">${k}</span><span>${what}</span></li>`).join('');
      o.innerHTML = `
        <div class="mg-card mg-help-card">
          <button class="mg-btn mg-btn--icon mg-close" type="button" data-act="close" aria-label="Close instructions">✕</button>
          <h2 id="mg-help-title">How to play</h2>
          <p class="mg-help-goal"><span aria-hidden="true">🎯</span> ${c.goal || ins.objective}</p>
          ${this._stepsHTML('mg-steps--big')}
          ${keys ? `<ul class="mg-keys" aria-label="Controls">${keys}</ul>` : ''}
          <p class="mg-help-stars"><span aria-hidden="true">★★★</span> ${c.stars[2]}</p>
          <details class="mg-more">
            <summary>Full rules, scoring &amp; maths (for teachers)</summary>
            <h3>Objective</h3><p>${ins.objective}</p>
            <h3>Controls</h3>${list(ins.controls)}
            <h3>How the maths works</h3>${list(ins.maths)}
            <h3>Points</h3>${list(ins.scoring)}
            <h3>Failure &amp; lives</h3>${list(ins.failure)}
            <h3>Timer &amp; pause</h3>${list(ins.timer)}
            <h3>Star rating</h3><ul class="mg-star-rules">${c.stars.map((x) => `<li>${x}</li>`).join('')}</ul>
          </details>
          <div class="mg-actions"><button class="mg-btn mg-btn--primary" type="button" data-act="close">Got it!</button></div>
        </div>`;
      o.querySelectorAll('[data-act="close"]').forEach((b) => b.addEventListener('click', () => this.hideHelp()));
    }

    _buildPause(o) {
      o.innerHTML = `
        <div class="mg-card" style="max-width:420px;text-align:center">
          <h2 id="mg-pause-title">⏸ Paused</h2>
          <p>The timer and all gameplay are frozen.</p>
          <div class="mg-actions" style="justify-content:center;flex-direction:column;align-items:stretch" data-slot="a"></div>
        </div>`;
      const a = o.querySelector('[data-slot="a"]');
      const b = (label, cls, fn) => { const x = MG.el('button', { class: 'mg-btn ' + cls, type: 'button' }, label); x.addEventListener('click', fn); a.appendChild(x); return x; };
      this.resumeBtn = b('▶ Resume', 'mg-btn--primary mg-btn--lg', () => this.resume());
      b('↻ Restart', '', () => this.restart());
      b('📖 Instructions', '', () => this.showHelp());
      a.appendChild(this._soundBtn());
      b('⌂ Main Menu', 'mg-btn--ghost', () => this.toHub());
    }

    _bindGlobal() {
      global.addEventListener('keydown', (e) => {
        if (this.ov.help.classList.contains('is-open')) {
          if (e.key === 'Escape') { e.preventDefault(); this.hideHelp(); }
          return;
        }
        const k = e.key.toLowerCase();
        if ((k === 'p' || k === 'escape') && (this.state === 'playing' || this.state === 'paused')) {
          e.preventDefault();
          this.togglePause();
        } else if (k === 'm' && !MG.isTarget(e, 'input, textarea, select')) {
          MG.sound.toggle();
        }
      });
      // Never let the timer run while the tab is hidden.
      document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); });
    }

    _syncSound(on) {
      document.querySelectorAll('[data-sound]').forEach((b) => {
        b.textContent = on ? '🔊 Sound on' : '🔇 Sound off';
        b.setAttribute('aria-pressed', String(on));
      });
      const hb = document.querySelector('#hud [data-act="sound"]');
      if (hb) {
        hb.textContent = on ? '🔊' : '🔇';
        hb.setAttribute('aria-pressed', String(on));
        hb.setAttribute('aria-label', on ? 'Sound on. Turn sound off' : 'Sound off. Turn sound on');
      }
    }

    _open(name) {
      this.ov[name].classList.add('is-open');
      global.ArcadeMotion.panel(this.ov[name]);
      if (this.app) this.app.inert = true;
      const f = this.ov[name].querySelector('.mg-btn--primary') || this.ov[name].querySelector('button');
      if (f) global.ArcadeMotion.ready(() => {
        // Startup releases its visibility guard before this microtask focuses.
        global.queueMicrotask(() => {
          if (this.ov[name].classList.contains('is-open')) f.focus({ preventScroll: true });
        });
      });
    }
    _close(name) {
      this.ov[name].classList.remove('is-open');
      const anyOpen = Object.values(this.ov).some((o) => o.classList.contains('is-open'));
      if (this.app && !anyOpen) this.app.inert = false;
    }

    /* ----- Screens ----- */
    showStart() {
      this._teardown();
      this.state = 'menu';
      ['end', 'pause'].forEach((n) => this._close(n));
      const best = MG.store.get(this.cfg.id + ':best', 0);
      this.bestLabel.textContent = best ? `🏆 Best score: ${best}` : 'No best score yet';
      this._open('start');
    }
    showHelp() { this._open('help'); }
    hideHelp() {
      this._close('help');
      const back = ['pause', 'start', 'end'].find((n) => this.ov[n].classList.contains('is-open'));
      if (back) this._open(back);
    }
    toHub() { global.location.href = this.cfg.hubUrl; }

    /* ----- Run lifecycle ----- */
    start(diff) {
      this._teardown();
      this.difficulty = 'easy';
      this.score = 0;
      this.playTime = 0;
      this.timeLeft = 0;
      this.timerOn = false;
      this._lastTick = -1;
      this.setScore(0);
      this.setProgress(0);
      ['start', 'end', 'pause', 'help'].forEach((n) => this._close(n));
      this.state = 'playing';
      this.maths = new MG.MathsSession(this);
      MG.sound.play('select');
      this.app?.classList.remove('am-paused');
      this.cfg.onStart.call(this, this.difficulty);
      global.ArcadeMotion.reveal(document.querySelectorAll('.mg-hud__item'), 34);
      this.last = performance.now();
      this.raf = requestAnimationFrame((t) => this._frame(t));
    }
    restart() { this.start(this.difficulty); }

    _teardown() {
      this.maths?.clearPrompt();
      global.ArcadeMotion.stop();
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      if (this.state === 'playing' || this.state === 'paused' || this.state === 'ended') {
        if (this.cfg.onStop) this.cfg.onStop.call(this);
      }
      this.toasts.innerHTML = '';
      document.querySelectorAll('.mg-floater, .mg-flash').forEach((n) => n.remove());
    }

    _frame(now) {
      this.raf = 0;
      if (this.state !== 'playing' && this.state !== 'paused') return;
      // Elapsed-time step, clamped so a long frame cannot teleport objects.
      const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
      this.last = now;
      if (this.state === 'playing') {
        this.playTime += dt;
        if (this.timerOn) {
          this.timeLeft -= dt;
          const whole = Math.ceil(this.timeLeft);
          if (whole <= 10 && whole > 0 && whole !== this._lastTick) { this._lastTick = whole; MG.sound.play('tick'); }
          if (this.timeLeft <= 0) {
            this.timeLeft = 0;
            this.timerOn = false;
            this._renderTimer();
            if (this.cfg.onTimeUp) this.cfg.onTimeUp.call(this);
          }
        }
        if (this.state === 'playing' && this.cfg.onUpdate) this.cfg.onUpdate.call(this, dt);
        this._renderTimer();
      }
      if (this.state === 'playing' || this.state === 'paused') {
        this.raf = requestAnimationFrame((t) => this._frame(t));
      }
    }

    pause() {
      if (this.state !== 'playing') return;
      this.state = 'paused';
      global.ArcadeMotion.stop();
      this.app?.classList.add('am-paused');
      if (this.cfg.onPause) this.cfg.onPause.call(this);
      MG.sound.play('click');
      this._open('pause');
    }
    resume() {
      if (this.state !== 'paused') return;
      this._close('help');
      this._close('pause');
      this.app?.classList.remove('am-paused');
      this.state = 'playing';
      this.last = performance.now();
      if (this.cfg.onResume) this.cfg.onResume.call(this);
    }
    togglePause() { if (this.state === 'playing') this.pause(); else if (this.state === 'paused') this.resume(); }
    isPlaying() { return this.state === 'playing'; }

    /**
     * Finish the run and show the end card.
     * r = { won, title, reason, stars (0-3), stats: [[label, value]], math: [html strings] }
     */
    end(r) {
      if (this.state === 'ended' || this.state === 'menu') return;
      global.ArcadeMotion.stop();
      this.app?.classList.add('am-paused');
      if (this.maths) r = this.maths.summary(r);
      this.state = 'ended';
      this.timerOn = false;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      this._close('pause');
      this._close('help');
      const stars = MG.clamp(Math.round(MG.safeNum(r.stars)), 0, 3);
      const score = Math.max(0, Math.round(MG.safeNum(this.score)));
      const key = this.cfg.id + ':best';
      const best = MG.store.get(key, 0);
      const newBest = score > best;
      if (newBest) MG.store.set(key, score);
      const starKey = this.cfg.id + ':stars';
      if (stars > MG.store.get(starKey, 0)) MG.store.set(starKey, stars);
      MG.sound.play(r.won ? 'win' : 'lose');

      const stat = ([k, v]) => `<div class="mg-stat"><dt>${MG.escape(k)}</dt><dd>${MG.escape(v)}</dd></div>`;
      const allStats = r.stats || [];
      const stats = allStats.slice(0, 4).map(stat).join('');
      const moreStats = allStats.slice(4).map(stat).join('');
      const math = (r.math || []).map((m) => `<li>${m}</li>`).join('');
      const rules = this.cfg.stars.map((s, i) => `<li class="${i < stars ? 'is-met' : ''}">${s}</li>`).join('');
      const o = this.ov.end;
      o.innerHTML = `
        <div class="mg-card mg-end-card ${r.won ? 'is-win' : 'is-lose'}">
          <p class="mg-end__status ${r.won ? 'is-win' : 'is-lose'}">${r.won ? '✔ Completed' : '✘ Not completed'}</p>
          <h2 id="mg-end-title">${MG.escape(r.title || (r.won ? 'Victory!' : 'Game Over'))}</h2>
          <div class="mg-stars" role="img" aria-label="${stars} of 3 stars">${MG.starsSVG(stars)}</div>
          <p class="mg-final-score"><span aria-hidden="true" data-final-score="${score}">${score}</span><span class="mg-sr-only">${score}</span> <small>pts</small> ${newBest ? '<span class="mg-newbest">New best!</span>' : ''}</p>
          <p class="mg-end__reason">${r.reason || ''}</p>
          <dl class="mg-stats">${stats}</dl>
          <div class="mg-actions" data-slot="a"></div>
          <details class="mg-more">
            <summary>More stats &amp; the maths</summary>
            ${moreStats ? `<dl class="mg-stats">${moreStats}</dl>` : ''}
            ${math ? `<h3>The maths you used</h3><ul class="mg-math-summary">${math}</ul>` : ''}
            <h3>How to earn stars</h3><ul class="mg-star-rules">${rules}</ul>
          </details>
        </div>`;
      const a = o.querySelector('[data-slot="a"]');
      const again = MG.el('button', { class: 'mg-btn mg-btn--primary mg-btn--lg', type: 'button' }, '↻ Play Again');
      again.addEventListener('click', () => this.restart());
      const menu = MG.el('button', { class: 'mg-btn mg-btn--ghost', type: 'button' }, '⌂ Main Menu');
      menu.addEventListener('click', () => this.toHub());
      a.append(again, menu);
      this.lastResult = Object.assign({}, r, { stars, score });
      // Tidy per-run resources now that the run is over.
      if (this.cfg.onStop) this.cfg.onStop.call(this);
      this.state = 'ended';
      this._open('end');
      // A finished run does not need teardown again when the next run starts.
      this.state = 'ended-clean';
    }
    _diffLabel() {
      const d = this.cfg.difficulties.find((x) => x.id === this.difficulty);
      return d ? d.label : this.difficulty;
    }

    /* ----- HUD API ----- */
    setScore(v) {
      this.score = Math.max(0, Math.round(MG.safeNum(v)));
      this.hud.score.textContent = this.score;
    }
    /** Add (or deduct) points and show a floating label explaining why. */
    addScore(pts, reason, anchor) {
      pts = Math.round(MG.safeNum(pts));
      if (!pts) return;
      this.setScore(this.score + pts);
      let x, y;
      if (anchor && anchor.getBoundingClientRect) {
        const r = anchor.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top;
      } else if (anchor && Number.isFinite(anchor.x)) { x = anchor.x; y = anchor.y; } else {
        const r = this.hud.score.getBoundingClientRect(); x = r.left + r.width / 2; y = r.bottom + 30;
      }
      const f = MG.el('div', { class: 'mg-floater' + (pts < 0 ? ' is-neg' : '') }, `${pts > 0 ? '+' : ''}${pts}${reason ? ' ' + reason : ''}`);
      f.style.left = x + 'px'; f.style.top = y + 'px';
      document.body.appendChild(f);
      const half = f.getBoundingClientRect().width / 2;
      f.style.left = MG.clamp(x, half + 12, global.innerWidth - half - 12) + 'px';
      global.ArcadeMotion.reward(this.hud.score, pts, x, y);
      setTimeout(() => f.remove(), 1250);
    }
    setTimer(seconds) {
      this.timeLeft = Math.max(0, MG.safeNum(seconds));
      this.timerOn = this.timeLeft > 0;
      this._lastTick = -1;
      this._renderTimer();
    }
    addTime(s) { this.timeLeft = Math.max(0, this.timeLeft + MG.safeNum(s)); this._renderTimer(); }
    stopTimer() { this.timerOn = false; this._renderTimer(); }
    resumeTimer() { if (this.timeLeft > 0) this.timerOn = true; }
    _renderTimer() {
      if (this._timerText != null) { this.hud.timer.textContent = this._timerText; return; }
      this.hud.timer.textContent = MG.fmtTime(this.timeLeft);
      this.hud.timerItem.classList.toggle('is-low', this.timerOn && this.timeLeft <= 10);
    }
    /** Override the timer display with custom text (null restores the countdown). */
    setTimerText(text) { this._timerText = text; this._renderTimer(); }
    setLabel(which, text) { if (this.hud[which + 'Label']) this.hud[which + 'Label'].textContent = text; }
    setStage(text) {
      const changed = this.hud.stage.textContent !== String(text);
      this.hud.stage.textContent = text;
      if (changed) { this.maths?.clearPrompt(); global.ArcadeMotion.round(this.hud.stage); }
    }
    /** Hearts (or any icon) for small counts, plain text otherwise. */
    setLives(cur, max, icon = '❤') {
      cur = Math.max(0, Math.round(MG.safeNum(cur)));
      max = Math.max(cur, Math.round(MG.safeNum(max, cur)));
      if (max <= 8) {
        this.hud.lives.innerHTML = `<span class="mg-hearts">${Array.from({ length: max }, (_, i) => `<span class="${i < cur ? '' : 'mg-heart--off'}">${icon}</span>`).join('')}</span>`;
      } else this.hud.lives.textContent = `${cur}/${max}`;
      this.hud.lives.setAttribute('aria-label', `${cur} of ${max}`);
      this.hud.livesItem.classList.toggle('is-low', cur <= 1);
    }
    /** Generic resource display for the lives slot (fuel, cash, credibility...). */
    setResource(text, low = false) {
      this.hud.lives.textContent = text;
      this.hud.livesItem.classList.toggle('is-low', !!low);
    }
    setProgress(frac, label) {
      const p = MG.clamp(MG.safeNum(frac), 0, 1) * 100;
      this.hud.progress.style.width = p + '%';
      this.hud.meter.setAttribute('aria-valuenow', Math.round(p));
      if (label != null) this.hud.progressLabel.textContent = label;
    }
    toast(msg, kind = 'info', ms = 2400) {
      const t = MG.el('div', { class: 'mg-toast mg-toast--' + kind, html: msg });
      this.toasts.appendChild(t);
      while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
      setTimeout(() => { t.classList.add('is-leaving'); setTimeout(() => t.remove(), 320); }, ms);
    }
    flash(kind = 'good') {
      const f = MG.el('div', { class: 'mg-flash mg-flash--' + kind });
      document.body.appendChild(f);
      setTimeout(() => f.remove(), 480);
    }
  }
  MG.createShell = (cfg) => new Shell(cfg);

  /**
   * Hold-to-press helper for on-screen touch buttons. Writes into a key-state
   * object so games can treat touch exactly like keyboard input.
   */
  MG.bindHold = (btn, keys, name) => {
    const down = (e) => { e.preventDefault(); keys[name] = true; btn.classList.add('is-down'); };
    const up = (e) => { e.preventDefault(); keys[name] = false; btn.classList.remove('is-down'); };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  };

  /** Resize a canvas to its CSS box with devicePixelRatio; returns {w,h,dpr}. */
  MG.fitCanvas = (canvas) => {
    const dpr = Math.min(2, global.devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h, dpr, ctx };
  };

  global.MG = MG;
})(window);
/* ===== CORE GAME SHELL (end) ===== */
/* ===== MATHS PRACTICE (start) ===== */
// Embedded in every assessed game.
(function (MG) {
  'use strict';
  let sequence = 0;
  class MathsSession {
    constructor(shell) { this.shell = shell; this.entries = new Map(); this.accepted = new Set(); this.current = null; }
    entry(topic, key) {
      if (!this.entries.has(key)) this.entries.set(key, { topic, key, attempts: 0, correct: false, assisted: false, first: false });
      return this.entries.get(key);
    }
    assist(topic, key) { const entry=this.entry(topic,key); if(!entry.correct)entry.assisted=true; }
    record(topic, key, correct) {
      const entry = this.entry(topic, key);
      if (entry.correct) return;
      entry.attempts++;
      entry.correct = !!correct;
      entry.first = correct && entry.attempts === 1 && !entry.assisted;
    }
    clearPrompt() { this.current?.node.remove(); this.current = null; }
    static number(text) {
      const value = String(text).trim().replace(/−/g, '-');
      if (!value) return NaN;
      if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*\/\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) {
        const [a, b] = value.split('/').map(Number); return b ? a / b : NaN;
      }
      return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) ? Number(value) : NaN;
    }
    gate(task) {
      if (this.accepted.has(task.key)) return true;
      if (this.current?.task.key === task.key && this.current.node.isConnected) return false;
      this.clearPrompt();
      const host = typeof task.container === 'function' ? task.container() : task.container;
      if (!host) throw new Error('Missing maths planning surface: ' + task.title);
      const form = MG.el('form', { class: 'mg-maths-plan', 'aria-label': task.title });
      form.append(MG.el('h3', {}, task.title), MG.el('p', { html: task.prompt }));
      const fields = task.fields.map(field => {
        const id = 'maths-plan-' + (++sequence);
        const label = MG.el('label', { for: id }, field.label);
        let input;
        if (field.options) {
          input = MG.el('select', { id, required: true }, MG.el('option', { value: '' }, 'Choose…'));
          field.options.forEach(option => input.append(MG.el('option', { value: option.value }, option.label)));
        } else input = MG.el('input', { id, type: 'text', inputmode: field.text ? 'text' : 'decimal', autocomplete: 'off', required: true, placeholder: field.text ? '' : 'Number or fraction' });
        const row = MG.el('div', { class: 'mg-maths-field' }, label, input);
        form.append(row);
        return { field, input };
      });
      const feedback = MG.el('p', { class: 'mg-maths-feedback', 'aria-live': 'polite' });
      const actions = MG.el('div', { class: 'mg-actions' });
      const commit = MG.el('button', { class: 'mg-btn mg-btn--primary', type: 'submit' }, task.action || 'Commit calculation');
      const help = MG.el('button', { class: 'mg-btn mg-btn--ghost', type: 'button' }, 'Show guidance');
      const cancel = MG.el('button', { class: 'mg-btn', type: 'button' }, 'Edit plan');
      const hint = MG.el('p', { class: 'mg-maths-hint', hidden: true });
      help.addEventListener('click', () => {
        this.assist(task.topic, task.key);
        hint.hidden = false;
        hint.textContent = task.hint || 'Work through the operations one step at a time. A calculator is allowed. This attempt will be recorded as assisted.';
        hint.textContent += ' Guidance used: recorded as assisted.';
      });
      cancel.addEventListener('click', () => this.clearPrompt());
      actions.append(commit, help, cancel); form.append(feedback, actions, hint);
      form.addEventListener('keydown', event => event.stopPropagation());
      form.addEventListener('submit', event => {
        event.preventDefault();
        if (!this.shell.isPlaying() || this.shell.maths !== this) return;
        if (task.valid && !task.valid()) { this.clearPrompt(); this.shell.toast('The plan changed. Commit its updated figures.', 'warn'); return; }
        let missing = false;
        const checks = fields.map(({ field, input }) => {
          if (!input.value.trim()) { missing = true; return false; }
          const value = field.text || field.options ? input.value.trim() : MathsSession.number(input.value);
          if (typeof value === 'number' && !Number.isFinite(value)) { missing = true; return false; }
          return field.check ? field.check(value) : typeof field.answer === 'number' ? Math.abs(value - field.answer) <= (field.tolerance ?? .0051) : value === field.answer;
        });
        const correct = checks.every(Boolean);
        if (missing) { feedback.textContent = 'Enter a valid value in every field. Fractions such as 3/4 are accepted.'; return; }
        this.record(task.topic, task.key, correct);
        if (!correct) { feedback.textContent = 'The figures do not balance yet. Check your calculation and units, then try again.'; return; }
        this.accepted.add(task.key);
        this.clearPrompt();
        task.onPass();
      });
      host.append(form);
      this.current = { task, node: form, fields };
      form.scrollIntoView?.({ block: 'nearest' });
      fields[0]?.input.focus({ preventScroll: true });
      return false;
    }
    summary(result) {
      this.clearPrompt();
      const entries = [...this.entries.values()].filter(entry => entry.attempts);
      const solved = entries.filter(entry => entry.correct).length;
      const first = entries.filter(entry => entry.first).length;
      const assisted = entries.filter(entry => entry.assisted).length;
      const attempts = entries.reduce((sum, entry) => sum + entry.attempts, 0);
      const topics = [...new Set(entries.map(entry => entry.topic))];
      MG.store.set(this.shell.cfg.id+':maths-last', { decisions:entries.length, solved, independentFirst:first, assisted, attempts,
        topics:topics.map(topic=>({topic,decisions:entries.filter(e=>e.topic===topic).length,independentFirst:entries.filter(e=>e.topic===topic&&e.first).length})) });
      return { ...result, stats: [
        ['Independent first attempts', `${first} / ${entries.length}`],
        ['Maths decisions completed', `${solved} / ${entries.length}`],
        ['Guided decisions', assisted],
        ['Maths attempts', attempts],
        ...(result.stats || [])
      ], math: [
        'Maths decisions are recorded separately from movement, timers, lives and random outcomes. These are topic-practice results, not a school-grade or overall maths-level estimate.',
        ...topics.map(topic => {
          const group = entries.filter(entry => entry.topic === topic);
          return `${MG.escape(topic)}: ${group.filter(entry => entry.first).length}/${group.length} independently correct on the first attempt.`;
        }), ...(result.math || [])
      ] };
    }
  }
  MG.MathsSession = MathsSession;
})(window.MG);

/* ===== MATHS PRACTICE (end) ===== */






/* ==========================================================================
   Recipe Rush — ratios, proportion, fractions, percentages, unit conversion.
   Customers order dishes for a number of servings. Each recipe card shows
   the base recipe; the player scales every ingredient by
   (servings ordered ÷ servings in recipe), measures it into the bowl,
   submits, cooks in an oven and serves before the dish burns.
   ========================================================================== */
(() => {
  'use strict';
  const { el, clamp, round, fraction } = MG;

  /* ---------------- Configuration ---------------- */
  // step: [big, fine] increments in the measuring unit. All required amounts
  // are generated as exact multiples of the fine step, so perfection is possible.
  const INGREDIENTS = {
    flour:  { name: 'Flour',     icon: '🌾', unit: 'g',   step: [25, 5],     stock: 1600, color: '#f3e7cf' },
    sugar:  { name: 'Sugar',     icon: '🍬', unit: 'g',   step: [10, 5],     stock: 700,  color: '#ffffff' },
    butter: { name: 'Butter',    icon: '🧈', unit: 'g',   step: [10, 5],     stock: 420,  color: '#ffe38a' },
    milk:   { name: 'Milk',      icon: '🥛', unit: 'ml',  step: [50, 10],    stock: 2200, color: '#f7fbff' },
    stock:  { name: 'Veg stock', icon: '🍲', unit: 'ml',  step: [100, 10],   stock: 3600, color: '#d9a85b' },
    eggs:   { name: 'Eggs',      icon: '🥚', unit: 'egg', step: [1, 1],      stock: 20,   color: '#ffd23f' },
    tomato: { name: 'Tomatoes',  icon: '🍅', unit: 'each',step: [1, 1],      stock: 26,   color: '#e53b2c' },
    cheese: { name: 'Cheese',    icon: '🧀', unit: 'g',   step: [25, 5],     stock: 900,  color: '#ffc845' },
    rice:   { name: 'Rice',      icon: '🍚', unit: 'g',   step: [25, 5],     stock: 1500, color: '#fbfbf2' },
    pasta:  { name: 'Pasta',     icon: '🍝', unit: 'g',   step: [50, 10],    stock: 1600, color: '#f1cf78' },
    cocoa:  { name: 'Cocoa',     icon: '🍫', unit: 'g',   step: [5, 5],      stock: 160,  color: '#6b3a1f' },
    salt:   { name: 'Salt',      icon: '🧂', unit: 'tsp', step: [0.25, 0.25],stock: 6,    color: '#dfe6ee' }
  };

  const RECIPES = {
    pancakes: { name: 'Pancakes',       icon: '🥞', serves: 4, cook: 5, items: { flour: 200, milk: 300, eggs: 2, sugar: 40 } },
    omelette: { name: 'Cheese Omelette',icon: '🍳', serves: 1, cook: 4, items: { eggs: 2, milk: 30, cheese: 40 } },
    soup:     { name: 'Tomato Soup',    icon: '🥣', serves: 2, cook: 6, items: { tomato: 6, stock: 400, butter: 20, salt: 0.5 } },
    risotto:  { name: 'Cheesy Risotto', icon: '🍛', serves: 4, cook: 7, items: { rice: 300, stock: 800, cheese: 80, butter: 40 } },
    muffins:  { name: 'Choc Muffins',   icon: '🧁', serves: 6, cook: 6, items: { flour: 240, sugar: 120, cocoa: 30, eggs: 3, milk: 180 } },
    mac:      { name: 'Mac & Cheese',   icon: '🧀', serves: 3, cook: 6, items: { pasta: 300, cheese: 150, milk: 300, butter: 30 } }
  };

  const STAGES = MG.expandRounds([
    { title: 'Stage 1 · Doubling Up', intro: 'Whole-number scaling: double, triple or halve each recipe.',
      target: 3, recipes: ['pancakes', 'omelette', 'soup'], factors: [2, 3, 0.5, 4], units: false, mods: false },
    { title: 'Stage 2 · Fraction Frenzy', intro: 'Fractional scale factors such as 3/2, 3/4, 2/3 and 5/4.',
      target: 4, recipes: ['pancakes', 'soup', 'risotto', 'muffins', 'mac'], factors: [1.5, 2.5, 0.75, 1.25, 2 / 3, 4 / 3, 5 / 3, 0.5], units: false, mods: false },
    { title: 'Stage 3 · Head Chef', intro: 'Recipes now use kg, litres and cups, and customers ask for percentage changes.',
      target: 5, recipes: Object.keys(RECIPES), factors: [2, 3, 1.5, 2.5, 0.75, 1.25, 2 / 3, 4 / 3, 0.5], units: true, mods: true }
  ]);

  const DIFF = {
    easy:   { lives: 5, stageTime: 210, patience: 85, spawn: 13, ready: 10, close: 0.05, rough: 0.15, stockMul: 1.25, maxTickets: 3 },
    normal: { lives: 4, stageTime: 170, patience: 65, spawn: 11, ready: 8,  close: 0.05, rough: 0.12, stockMul: 1,    maxTickets: 3 },
    hard:   { lives: 3, stageTime: 140, patience: 50, spawn: 9,  ready: 6,  close: 0.03, rough: 0.08, stockMul: 0.8,  maxTickets: 4 }
  };

  const MODS = [-0.5, -0.25, 0.2, 0.5];
  const RESTOCK_COST = 30;
  const RESTOCK_TIME = 8;
  const EPS = 1e-9;

  /* ---------------- DOM ---------------- */
  const dom = {
    rail: document.getElementById('rail'),
    pantry: document.getElementById('pantry'),
    recipe: document.getElementById('recipe'),
    bowlRows: document.getElementById('bowlRows'),
    bowlFill: document.getElementById('bowlFill'),
    bowlTitle: document.getElementById('bowlTitle'),
    ovens: document.getElementById('ovens'),
    result: document.getElementById('result'),
    banner: document.getElementById('banner'),
    submit: document.getElementById('submitBtn'),
    empty: document.getElementById('emptyBtn')
  };

  let S = null; // run state

  /* ---------------- Formatting helpers ---------------- */
  const fmtAmt = (v, unit) => {
    const n = round(v, 2);
    if (unit === 'egg') return `${n} ${n === 1 ? 'egg' : 'eggs'}`;
    if (unit === 'each') return `${n}`;
    if (unit === 'tsp') return `${fraction(n, 4)} tsp`;
    return `${n} ${unit}`;
  };
  /** Express a base amount in a "recipe book" unit for Stage 3 conversions. */
  const altUnit = (key, amt) => {
    const u = INGREDIENTS[key].unit;
    if (u === 'g' && amt >= 100) return { text: `${round(amt / 1000, 3)} kg`, conv: '1 kg = 1000 g' };
    if (u === 'ml' && amt % 125 === 0) return { text: `${fraction(amt / 250, 4)} cup${amt === 250 ? '' : 's'}`, conv: '1 cup = 250 ml' };
    if (u === 'ml' && amt >= 100) return { text: `${round(amt / 1000, 3)} L`, conv: '1 L = 1000 ml' };
    return null;
  };
  const isMultiple = (v, step) => Math.abs(v / step - Math.round(v / step)) < 1e-6;

  /* ---------------- Order generation ---------------- */
  function makeTicket() {
    const st = STAGES[S.stageIdx];
    for (let attempt = 0; attempt < 200; attempt++) {
      const key = MG.pick(st.recipes);
      const r = RECIPES[key];
      const factor = MG.pick(st.factors);
      const servings = r.serves * factor;
      if (Math.abs(servings - Math.round(servings)) > EPS || servings < 1) continue;
      let mod = null;
      if (st.mods && Math.random() < 0.75) {
        mod = { key: MG.pick(Object.keys(r.items)), pct: MG.pick(MODS) };
      }
      const required = {};
      let ok = true;
      for (const [ing, amt] of Object.entries(r.items)) {
        let need = amt * factor;
        if (mod && mod.key === ing) need *= 1 + mod.pct;
        need = round(need, 4);
        if (need < INGREDIENTS[ing].step[1] - EPS || !isMultiple(need, INGREDIENTS[ing].step[1])) { ok = false; break; }
        required[ing] = need;
      }
      if (!ok) continue;
      const display = {};
      for (const [ing, amt] of Object.entries(r.items)) {
        const alt = st.units && Math.random() < 0.7 ? altUnit(ing, amt) : null;
        display[ing] = alt ? alt : { text: fmtAmt(amt, INGREDIENTS[ing].unit) };
      }
      const gold = S.stageIdx > 0 && !S.tickets.some((t) => t.gold) && Math.random() < 0.28;
      const patience = S.cfg.patience * (gold ? 0.75 : 1) * (1 - MG.roundTier(S.stageIdx) * 0.06);
      return {
        id: S.nextId++, key, servings: Math.round(servings), factor, required, display, mod, gold,
        patience, maxPatience: patience, status: 'waiting', fresh: true,
        bowl: new Map() // every order has its own mixing bowl
      };
    }
    return null;
  }

  function spawnTicket() {
    if (S.tickets.length >= S.cfg.maxTickets) return;
    const t = makeTicket();
    if (!t) return;
    S.tickets.push(t);
    if (S.activeId == null) S.activeId = t.id;
    MG.sound.play('pop');
    renderRail();
    renderRecipe();
    renderBowl();
    renderPantry();
  }

  /* ---------------- Stage flow ---------------- */
  function setupStage(idx) {
    S.cfg = MG.roundConfig(DIFF, idx);
    S.stageIdx = idx;
    S.stageServed = 0;
    S.tickets = [];
    S.activeId = null;
    S.ovens = [null, null];
    S.spawnTimer = 3;
    S.stock = {};
    for (const [k, ing] of Object.entries(INGREDIENTS)) {
      S.stock[k] = round(Math.round((ing.stock * S.cfg.stockMul) / ing.step[1]) * ing.step[1], 2);
    }
    const st = STAGES[idx];
    this_shell.setStage(`${idx + 1} / ${STAGES.length}`);
    this_shell.setTimer(S.cfg.stageTime);
    dom.result.innerHTML = '';
    showBanner(st.title, st.intro + `<br><strong>Goal:</strong> serve ${st.target} orders before the timer runs out.`);
    spawnTicket();
    renderAll();
  }

  function showBanner(title, html) {
    dom.banner.innerHTML = `<h2>${title}</h2><p>${html}</p>`;
    dom.banner.hidden = false;
    S.bannerTime = 3.2;
  }

  function stageComplete() {
    const st = STAGES[S.stageIdx];
    const timeBonus = Math.round(this_shell.timeLeft * 2);
    this_shell.addScore(150 + timeBonus, `Stage clear (+${timeBonus} time)`);
    S.stagesCleared++;
    MG.sound.play('stage');
    this_shell.flash('good');
    if (S.stageIdx + 1 >= STAGES.length) return finish(true, 'Kitchen conquered!', `You served every order across all ${STAGES.length} stages.`);
    this_shell.toast(`${st.title} complete!`, 'good');
    setupStage(S.stageIdx + 1);
  }

  /* ---------------- Player actions ---------------- */
  const activeTicket = () => S.tickets.find((t) => t.id === S.activeId) || null;
  const NO_BOWL = new Map();
  /** The bowl being prepared: it belongs to the selected order while that order waits. */
  const bowlOf = () => { const t = activeTicket(); return t && t.status === 'waiting' ? t.bowl : null; };
  /** Return everything in an order's bowl to the pantry. */
  const returnToPantry = (bowl) => { for (const [k, v] of bowl) S.stock[k] = round(S.stock[k] + v, 4); bowl.clear(); };

  function selectTicket(id) {
    if (!this_shell.isPlaying()) return;
    S.activeId = id;
    MG.sound.play('click');
    renderRail();
    renderRecipe();
    renderBowl();
    renderPantry();
  }

  function addToBowl(key) {
    if (!this_shell.isPlaying()) return;
    const bowl = bowlOf();
    if (!bowl) { this_shell.toast('Tap an order ticket first. Each order has its own bowl.', 'warn'); MG.sound.play('error'); return; }
    if (S.stock[key] <= EPS && !bowl.has(key)) return restock(key);
    if (!bowl.has(key)) bowl.set(key, 0);
    MG.sound.play('click');
    renderRail();
    renderBowl();
    renderPantry();
    const btn = dom.bowlRows.querySelector(`[data-ing="${key}"] [data-d="1"]`);
    if (btn) btn.focus({ preventScroll: true });
  }

  /** Move an amount between stock and bowl; delta in measuring units. */
  function adjust(key, delta) {
    if (!this_shell.isPlaying()) return;
    const bowl = bowlOf();
    if (!bowl || !bowl.has(key)) return;
    const cur = bowl.get(key);
    let next = round(cur + delta, 4);
    if (next < 0) next = 0;
    const take = round(next - cur, 4);
    if (take > S.stock[key] + EPS) {
      this_shell.toast(`Not enough ${INGREDIENTS[key].name.toLowerCase()} in stock (${fmtAmt(S.stock[key], INGREDIENTS[key].unit)} left).`, 'warn');
      MG.sound.play('error');
      return;
    }
    S.stock[key] = round(S.stock[key] - take, 4);
    bowl.set(key, next);
    MG.sound.play(delta > 0 ? 'click' : 'spin');
    renderBowl();
    renderPantry();
  }

  function removeFromBowl(key, bowl = bowlOf()) {
    if (!bowl || !bowl.has(key)) return;
    S.stock[key] = round(S.stock[key] + bowl.get(key), 4);
    bowl.delete(key);
    renderBowl();
    renderPantry();
  }

  function emptyBowl() {
    if (!this_shell.isPlaying()) return;
    const bowl = bowlOf();
    if (!bowl) return;
    for (const k of [...bowl.keys()]) removeFromBowl(k, bowl);
    MG.sound.play('whoosh');
    renderRail();
  }

  function restock(key) {
    if (!this_shell.isPlaying()) return;
    const ing = INGREDIENTS[key];
    S.stock[key] = round(S.stock[key] + Math.round(ing.stock * 0.5 / ing.step[1]) * ing.step[1], 4);
    S.restocks++;
    this_shell.addScore(-RESTOCK_COST, 'Restock');
    this_shell.addTime(-RESTOCK_TIME);
    this_shell.toast(`Supplier delivered ${ing.name}. −${RESTOCK_COST} pts and −${RESTOCK_TIME} s.`, 'warn');
    MG.sound.play('cash');
    renderPantry();
  }

  /**
   * Submit Order: compare every measured amount with the scaled requirement.
   * Relative error = |used − needed| ÷ needed. The worst ingredient decides
   * the dish quality. Extra unwanted ingredients add a 50% error.
   */
  function submitOrder() {
    if (!this_shell.isPlaying()) return;
    const t = activeTicket();
    if (!t) { this_shell.toast('Select an order ticket first.', 'warn'); MG.sound.play('error'); return; }
    if (t.status !== 'waiting') { this_shell.toast('That order is already in the oven.', 'warn'); return; }
    const bowl = t.bowl;
    const total = [...bowl.values()].reduce((a, b) => a + b, 0);
    if (total <= EPS) { this_shell.toast('The bowl is empty — add ingredients from the pantry first.', 'warn'); MG.sound.play('error'); dom.bowlRows.classList.add('mg-shake'); setTimeout(() => dom.bowlRows.classList.remove('mg-shake'), 450); return; }
    const ovenIdx = S.ovens.findIndex((o) => !o);
    if (ovenIdx < 0) { this_shell.toast('Both ovens are busy — serve a dish first.', 'warn'); MG.sound.play('error'); return; }

    const lines = [];
    let worst = 0;
    for (const [ing, need] of Object.entries(t.required)) {
      const used = bowl.get(ing) || 0;
      const err = Math.abs(used - need) / need;
      worst = Math.max(worst, err);
      lines.push({ ing, need, used, err });
    }
    const extras = [...bowl.entries()].filter(([k, v]) => v > EPS && !(k in t.required));
    if (extras.length) worst += 0.5;
    const accuracy = clamp(Math.round((1 - worst) * 100), 0, 100);
    S.accuracies.push(accuracy);
    this_shell.maths.record(STAGES[S.stageIdx].mods ? 'Ratio, units and percentages' : 'Recipe scaling', 'recipe:'+S.stageIdx+':'+t.id, worst <= .001);
    t.bowl = new Map(); // ingredients are now mixed and used up

    let quality;
    if (worst <= 0.001) quality = 'perfect';
    else if (worst <= S.cfg.close) quality = 'close';
    else if (worst <= S.cfg.rough) quality = 'rough';
    else quality = 'ruined';

    showResult(t, lines, extras, quality, accuracy);

    if (quality === 'ruined') {
      S.wasted++;
      loseLife('Dish ruined — ingredients wasted');
    } else {
      S.ovens[ovenIdx] = { ticketId: t.id, quality, accuracy, cookLeft: RECIPES[t.key].cook, cookTotal: RECIPES[t.key].cook, readyLeft: S.cfg.ready, state: 'cooking', patienceFrac: t.patience / t.maxPatience };
      t.status = 'cooking';
      if (quality === 'perfect') S.perfect++;
      MG.sound.play(quality === 'perfect' ? 'success' : 'place');
      this_shell.flash('good');
      // Auto-select the next waiting order to keep the kitchen moving.
      const next = S.tickets.find((x) => x.status === 'waiting');
      S.activeId = next ? next.id : null;
    }
    renderAll();
  }

  function showResult(t, lines, extras, quality, accuracy) {
    const labels = { perfect: '★ Perfect measure!', close: 'Close enough — small slip', rough: 'Rough — customer will notice', ruined: '✘ Ruined — quantities too far off' };
    const cls = quality === 'perfect' ? 'is-good' : quality === 'ruined' ? 'is-bad' : 'is-ok';
    const items = lines.map((l) => {
      const u = INGREDIENTS[l.ing].unit;
      const mark = l.err <= 0.001 ? '✔' : '✘';
      return `<li>${mark} ${INGREDIENTS[l.ing].name}: needed <strong>${fmtAmt(l.need, u)}</strong>, used ${fmtAmt(l.used, u)}${l.err > 0.001 ? ` (${Math.round(l.err * 100)}% off)` : ''}</li>`;
    }).join('') + extras.map(([k]) => `<li>✘ ${INGREDIENTS[k].name} is not in this recipe</li>`).join('');
    dom.result.innerHTML = `<div class="result__box ${cls}"><strong>${labels[quality]}</strong> · ${RECIPES[t.key].name} for ${t.servings} · accuracy ${accuracy}%<ul>${items}</ul></div>`;
  }

  function serve(i) {
    if (!this_shell.isPlaying()) return;
    const o = S.ovens[i];
    if (!o || o.state !== 'ready') return;
    const t = S.tickets.find((x) => x.id === o.ticketId);
    const qMul = { perfect: 1, close: 0.75, rough: 0.45 }[o.quality];
    let pts = Math.round(100 * qMul + 40 * o.patienceFrac);
    if (t && t.gold && o.quality === 'perfect') pts *= 2;
    const btn = dom.ovens.querySelector(`[data-serve="${i}"]`);
    this_shell.addScore(pts, t && t.gold && o.quality === 'perfect' ? 'Gold order ×2' : 'Served', btn);
    MG.sound.play('cash');
    S.ovens[i] = null;
    S.tickets = S.tickets.filter((x) => x.id !== o.ticketId);
    S.stageServed++;
    S.totalServed++;
    if (t && t.gold) S.goldServed++;
    renderAll();
    if (S.stageServed >= STAGES[S.stageIdx].target) stageComplete();
  }

  function loseLife(why) {
    S.lives--;
    S.livesLost++;
    this_shell.setLives(S.lives, S.maxLives);
    this_shell.flash('bad');
    MG.sound.play('error');
    this_shell.toast(`${why}. −1 life`, 'bad');
    if (S.lives <= 0) finish(false, 'Kitchen closed', 'You ran out of lives. Check the scale factor (servings ordered ÷ recipe servings) before measuring.');
  }

  /* ---------------- Per-frame update ---------------- */
  function update(dt) {
    if (S.bannerTime > 0) {
      S.bannerTime -= dt;
      if (S.bannerTime <= 0) dom.banner.hidden = true;
    }
    // New customers arrive at a steady pace while there is space on the rail.
    S.spawnTimer -= dt;
    if (S.spawnTimer <= 0) {
      S.spawnTimer = S.cfg.spawn;
      spawnTicket();
    }
    if (!S.tickets.length && S.spawnTimer > 2) S.spawnTimer = 2;

    // Customer patience drains only while their order waits.
    let changed = false;
    for (const t of S.tickets) {
      if (t.status !== 'waiting') continue;
      t.patience -= dt;
      if (t.patience <= 0) {
        S.tickets = S.tickets.filter((x) => x !== t);
        if (t.bowl.size) { returnToPantry(t.bowl); this_shell.toast(`The ${RECIPES[t.key].name} customer left. Their ingredients went back to the pantry.`, 'warn'); }
        if (S.activeId === t.id) { const next = S.tickets.find((x) => x.status === 'waiting'); S.activeId = next ? next.id : null; }
        changed = true;
        if (t.gold) this_shell.toast('The gold-ticket customer left (no life lost).', 'warn');
        else { S.walkouts++; loseLife(`${RECIPES[t.key].name} customer walked out`); }
        if (!this_shell.isPlaying()) return;
      }
    }
    // Ovens: cook, then a ready window before the dish burns.
    S.ovens.forEach((o, i) => {
      if (!o) return;
      if (o.state === 'cooking') {
        o.cookLeft -= dt;
        if (o.cookLeft <= 0) { o.state = 'ready'; MG.sound.play('beep'); changed = true; }
      } else {
        o.readyLeft -= dt;
        if (o.readyLeft <= 0) {
          S.ovens[i] = null;
          S.tickets = S.tickets.filter((x) => x.id !== o.ticketId);
          S.burnt++;
          changed = true;
          loseLife('A dish burnt in the oven');
        }
      }
    });
    if (!this_shell.isPlaying()) return;
    if (changed) renderAll(); else updateBars();
    const st = STAGES[S.stageIdx];
    this_shell.setProgress(S.stageServed / st.target, `Orders ${S.stageServed}/${st.target}`);
  }

  function updateBars() {
    for (const t of S.tickets) {
      const bar = dom.rail.querySelector(`[data-id="${t.id}"] .ticket__bar span`);
      if (!bar) continue;
      const f = clamp(t.patience / t.maxPatience, 0, 1);
      bar.style.width = f * 100 + '%';
      bar.className = f < 0.25 ? 'is-low' : f < 0.55 ? 'is-mid' : '';
      const face = dom.rail.querySelector(`[data-id="${t.id}"] .ticket__face`);
      if (face) face.textContent = t.status !== 'waiting' ? '😋' : f < 0.25 ? '😠' : f < 0.55 ? '😐' : '😀';
    }
    S.ovens.forEach((o, i) => {
      if (!o) return;
      const bar = dom.ovens.querySelector(`[data-oven="${i}"] .oven__bar span`);
      const lab = dom.ovens.querySelector(`[data-oven="${i}"] .oven__time`);
      if (!bar) return;
      if (o.state === 'cooking') { bar.style.width = (1 - o.cookLeft / o.cookTotal) * 100 + '%'; lab.textContent = `${Math.ceil(o.cookLeft)} s`; }
      else { bar.style.width = (o.readyLeft / S.cfg.ready) * 100 + '%'; lab.textContent = `burns in ${Math.ceil(o.readyLeft)} s`; }
    });
  }

  /* ---------------- Rendering ---------------- */
  function renderAll() { renderRail(); renderRecipe(); renderBowl(); renderPantry(); renderOvens(); updateBars(); }

  function renderRail() {
    dom.rail.innerHTML = '';
    if (!S.tickets.length) { dom.rail.append(el('li', { class: 'rail__empty' }, 'Waiting for customers…')); return; }
    S.tickets.forEach((t, i) => {
      const r = RECIPES[t.key];
      const b = el('button', {
        type: 'button',
        class: `ticket${t.id === S.activeId ? ' is-active' : ''}${t.gold ? ' is-gold' : ''}${t.status !== 'waiting' ? ' is-cooking' : ''}${t.fresh ? ' is-new' : ''}`,
        'data-id': t.id,
        'aria-pressed': String(t.id === S.activeId),
        'aria-label': `Order ${i + 1}: ${r.name} for ${t.servings}${t.gold ? ', gold bonus order' : ''}${t.status !== 'waiting' ? ', in oven' : ''}`
      });
      b.innerHTML = `
        <div class="ticket__top"><span class="ticket__dish">${r.icon} ${r.name}</span><span class="ticket__face">😀</span></div>
        <div class="ticket__meta">For <strong>${t.servings}</strong> · recipe serves ${r.serves}${t.gold ? ' · <strong>★ GOLD ×2 if perfect</strong>' : ''}${t.mod ? ' · special request' : ''}${t.status === 'waiting' && t.bowl.size ? ' · 🥣 started' : ''}</div>
        <div class="ticket__meta">${t.status === 'waiting' ? 'Patience' : 'In the oven'}</div>
        <div class="ticket__bar"><span></span></div>
        <span class="ticket__num">#${i + 1}</span>`;
      t.fresh = false;
      b.addEventListener('click', () => selectTicket(t.id));
      dom.rail.append(el('li', {}, b));
    });
  }

  function renderRecipe() {
    const t = activeTicket();
    if (!t) {
      dom.recipe.innerHTML = '<h3>No order selected</h3><p class="recipe__sub">Tap an order ticket on the rail above to see its recipe card.</p>';
      return;
    }
    const r = RECIPES[t.key];
    const st = STAGES[S.stageIdx];
    const rows = Object.keys(r.items).map((k) => `<tr><td>${INGREDIENTS[k].icon} ${INGREDIENTS[k].name}</td><td class="num">${t.display[k].text}</td><td>${INGREDIENTS[k].unit === 'egg' || INGREDIENTS[k].unit === 'each' ? 'count' : INGREDIENTS[k].unit}</td></tr>`).join('');
    const convs = [...new Set(Object.values(t.display).map((d) => d.conv).filter(Boolean))];
    let notes = '';
    if (t.mod) {
      const pct = Math.round(t.mod.pct * 100);
      notes += `<div class="recipe__note recipe__note--mod">🗨 Special request: <strong>${pct > 0 ? pct + '% more' : -pct + '% less'} ${INGREDIENTS[t.mod.key].name.toLowerCase()}</strong> than the scaled recipe.</div>`;
    }
    if (convs.length) notes += `<div class="recipe__note">📏 Conversions: ${convs.join(' · ')}</div>`;
    if (t.hintUsed) notes += `<div class="recipe__note recipe__note--hint">💡 Scale factor = ${t.servings} ÷ ${r.serves} = <strong>${fraction(t.factor)}</strong>. Multiply every amount by it.</div>`;
    dom.recipe.innerHTML = `
      <h3>${r.icon} ${r.name} ${t.gold ? '<span class="mg-tag mg-tag--warn">★ Gold</span>' : ''}</h3>
      <p class="recipe__sub">Recipe card serves <strong>${r.serves}</strong>. This order is for <strong>${t.servings}</strong> servings.${st.units ? ' Your kitchen scales measure in g, ml, tsp and whole items.' : ''}</p>
      <table><thead><tr><th>Ingredient</th><th>Recipe (serves ${r.serves})</th><th>Measure in</th></tr></thead><tbody>${rows}</tbody></table>
      ${notes}`;
    if (!t.hintUsed) {
      const hint = el('button', {class:'mg-btn mg-btn--sm',type:'button'}, 'Show scaling guidance');
      hint.addEventListener('click', () => { t.hintUsed = true; this_shell.maths.assist(STAGES[S.stageIdx].mods ? 'Ratio, units and percentages' : 'Recipe scaling', 'recipe:'+S.stageIdx+':'+t.id); renderRecipe(); });
      dom.recipe.append(hint);
    }
  }

  function renderBowl() {
    dom.bowlRows.innerHTML = '';
    dom.bowlFill.innerHTML = '';
    const bowl = bowlOf() || NO_BOWL;
    const t = activeTicket();
    dom.bowlTitle.innerHTML = t && t.status === 'waiting' ? `Bowl for: <strong>${RECIPES[t.key].name} × ${t.servings}</strong>` : 'Mixing bowl';
    if (!bowl.size) {
      const msg = !t ? 'Tap an order ticket to start its bowl.' : t.status !== 'waiting' ? 'This order is in the oven. Tap a waiting order.' : 'The bowl is empty. Pick ingredients from the pantry.';
      dom.bowlRows.append(el('p', { class: 'bowl__empty' }, msg));
    }
    let total = 0;
    for (const [k, v] of bowl) {
      const ing = INGREDIENTS[k];
      const [big, fine] = ing.step;
      const row = el('div', { class: 'brow', 'data-ing': k });
      const name = el('div', {}, el('span', { class: 'brow__name' }, `${ing.icon} ${ing.name}`), el('span', { class: 'brow__amt' }, fmtAmt(v, ing.unit)));
      const ctl = el('div', { class: 'brow__ctl' });
      const mk = (label, d, aria) => {
        const b = el('button', { class: 'mg-btn', type: 'button', 'data-d': d > 0 ? (d === fine ? '1' : '2') : '0', 'aria-label': aria }, label);
        b.addEventListener('click', () => adjust(k, d));
        return b;
      };
      const u = ing.unit === 'egg' || ing.unit === 'each' ? '' : ing.unit === 'tsp' ? '' : ing.unit;
      const lab = (n) => `${fraction(n, 4)}${u}`;
      if (big !== fine) ctl.append(mk(`−${lab(big)}`, -big, `Remove ${big} ${ing.unit} ${ing.name}`));
      ctl.append(mk(`−${lab(fine)}`, -fine, `Remove ${fine} ${ing.unit} ${ing.name}`));
      ctl.append(mk(`+${lab(fine)}`, fine, `Add ${fine} ${ing.unit} ${ing.name}`));
      if (big !== fine) ctl.append(mk(`+${lab(big)}`, big, `Add ${big} ${ing.unit} ${ing.name}`));
      const rm = el('button', { class: 'mg-btn is-remove', type: 'button', 'aria-label': `Put ${ing.name} back` }, '✕');
      rm.addEventListener('click', () => { removeFromBowl(k); MG.sound.play('spin'); });
      ctl.append(rm);
      row.append(name, ctl);
      dom.bowlRows.append(row);
      // Normalise by stock size so the bowl picture shows rough proportions.
      const share = v / ing.stock;
      total += share;
      dom.bowlFill.append(el('span', { style: `height:${clamp(share * 140, 0, 60)}%;background:${ing.color}` }));
    }
    dom.submit.disabled = false;
  }

  function renderPantry() {
    dom.pantry.innerHTML = '';
    const bowl = bowlOf() || NO_BOWL;
    for (const [k, ing] of Object.entries(INGREDIENTS)) {
      const stock = S.stock[k];
      const out = stock <= EPS;
      const b = el('button', {
        type: 'button',
        class: `jar${bowl.has(k) ? ' is-inbowl' : ''}${stock < ing.step[0] ? ' is-low' : ''}${out && !bowl.has(k) ? ' jar--restock' : ''}`,
        'aria-label': out && !bowl.has(k) ? `${ing.name} out of stock. Restock for ${RESTOCK_COST} points and ${RESTOCK_TIME} seconds` : `${ing.name}, ${fmtAmt(stock, ing.unit)} in stock`
      });
      b.innerHTML = `<span class="jar__icon">${ing.icon}</span><span class="jar__name">${ing.name}</span><span class="jar__stock">${out && !bowl.has(k) ? `Restock −${RESTOCK_COST}` : fmtAmt(stock, ing.unit)}</span>`;
      b.addEventListener('click', () => addToBowl(k));
      dom.pantry.append(b);
    }
  }

  function renderOvens() {
    dom.ovens.innerHTML = '';
    S.ovens.forEach((o, i) => {
      const box = el('div', { class: `oven${o ? ' is-' + o.state : ''}`, 'data-oven': i });
      if (!o) {
        box.innerHTML = `<div class="oven__window" aria-hidden="true">·</div><div class="oven__label"><span>Oven ${i + 1}</span><span>empty</span></div>`;
      } else {
        const t = S.tickets.find((x) => x.id === o.ticketId);
        const r = t ? RECIPES[t.key] : { icon: '?', name: 'Dish' };
        box.innerHTML = `<div class="oven__window" aria-hidden="true">${r.icon}</div>
          <div class="oven__label"><span>${r.name} ×${t ? t.servings : ''}</span><span class="oven__time"></span></div>
          <div class="oven__bar"><span></span></div>`;
        if (o.state === 'ready') {
          const sb = el('button', { class: 'mg-btn mg-btn--good', type: 'button', 'data-serve': i }, '🍽 Serve now!');
          sb.addEventListener('click', () => serve(i));
          box.append(sb);
        } else {
          box.append(el('div', { class: 'oven__label' }, el('span', {}, `Quality: ${o.quality} (${o.accuracy}%)`)));
        }
      }
      dom.ovens.append(box);
    });
  }

  /* ---------------- End of run ---------------- */
  function avgAccuracy() {
    return S.accuracies.length ? Math.round(S.accuracies.reduce((a, b) => a + b, 0) / S.accuracies.length) : 0;
  }
  function computeStars(won) {
    const acc = avgAccuracy();
    if (won) {
      if (acc >= 95 && S.livesLost <= 1) return 3;
      if (acc >= 85) return 2;
      return 1;
    }
    return S.stagesCleared >= 2 ? 2 : S.stagesCleared >= 1 ? 1 : 0;
  }
  function finish(won, title, reason) {
    const acc = avgAccuracy();
    dom.banner.hidden = true;
    this_shell.end({
      won, title, reason,
      stars: computeStars(won),
      stats: [
        ['Stages cleared', `${S.stagesCleared} / ${STAGES.length}`],
        ['Orders served', S.totalServed],
        ['Perfect dishes', S.perfect],
        ['Average accuracy', `${acc}%`],
        ['Lives left', `${Math.max(0, S.lives)} / ${S.maxLives}`],
        ['Play time', MG.fmtTime(this_shell.playTime)],
        ['Dishes ruined / burnt', `${S.wasted} / ${S.burnt}`],
        ['Gold orders', S.goldServed],
        ['Restocks', S.restocks]
      ],
      math: [
        `You measured ${S.accuracies.length} dishes with an average accuracy of <strong>${acc}%</strong> (accuracy = 100% − the worst ingredient's percentage error).`,
        'Scaling a recipe: <strong>scale factor = servings wanted ÷ servings in the recipe</strong>, then multiply every ingredient by the same factor so the ratios stay equal.',
        'Fraction factors: ×3/4 means "divide by 4, multiply by 3" — e.g. 300 g × 3/4 = 225 g.',
        'Percentage changes: 25% less means ×0.75, 50% more means ×1.5. Converting units first (0.3 kg = 300 g, 1½ cups = 375 ml) keeps the arithmetic simple.',
        S.walkouts ? `${S.walkouts} customer(s) walked out — prioritise the tickets with the shortest patience bars.` : 'No customers walked out — great time management!'
      ]
    });
  }

  /* ---------------- Shell wiring ---------------- */
  const this_shell = MG.createShell({
    id: 'recipe-rush',
    title: 'Recipe Rush',
    tagline: 'The dinner rush is ON! Every party wants a different size. Scale each recipe exactly right.',
    goal: 'Serve enough orders in each stage before the clock runs out.',
    steps: [
      ['🎫', 'Tap an order. Check how many people it is for.'],
      ['⚖️', 'Scale every ingredient and measure it into the bowl.'],
      ['🔥', 'Cook it, then serve it before it burns!']
    ],
    keys: [
      ['<kbd>S</kbd>', 'Submit order'],
      ['<kbd>1</kbd>–<kbd>4</kbd>', 'Pick an order'],
      ['<kbd>P</kbd>', 'Pause'],
      ['<kbd>M</kbd>', 'Sound']
    ],
    genre: 'Cooking & resource management',
    topic: 'Ratio, proportion, fractions, percentages, units',
    premise: 'The dinner rush has begun! Customers want recipes scaled up and down for their party sizes — and the head chef measures everything exactly.',
    objective: 'Scale each recipe correctly, measure the ingredients into the bowl, cook the dish and serve it before it burns. Clear all 10 rounds.',
    livesLabel: 'Lives',
    stageLabel: 'Round',
    art: `<svg viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice"><rect width="400" height="500" fill="#9ad9c8"/><path d="M200 330L800 330L791 434ZM200 330L764 535L720 630ZM200 330L660 716L586 790ZM200 330L500 850L405 894ZM200 330L304 921L200 930ZM200 330L96 921L-5 894ZM200 330L-100 850L-186 790ZM200 330L-260 716L-320 630ZM200 330L-364 535L-391 434ZM200 330L-400 330L-391 226ZM200 330L-364 125L-320 30ZM200 330L-260 -56L-186 -130ZM200 330L-100 -190L-5 -234ZM200 330L96 -261L200 -270ZM200 330L304 -261L405 -234ZM200 330L500 -190L586 -130ZM200 330L660 -56L720 30ZM200 330L764 125L791 226Z" fill="#c4ecdf"/><rect y="388" width="400" height="112" fill="#fff7e8"/><g fill="#2a1d17"><rect x="0" y="440" width="40" height="40"/><rect x="40" y="400" width="40" height="40"/><rect x="40" y="480" width="40" height="40"/><rect x="80" y="440" width="40" height="40"/><rect x="120" y="400" width="40" height="40"/><rect x="120" y="480" width="40" height="40"/><rect x="160" y="440" width="40" height="40"/><rect x="200" y="400" width="40" height="40"/><rect x="200" y="480" width="40" height="40"/><rect x="240" y="440" width="40" height="40"/><rect x="280" y="400" width="40" height="40"/><rect x="280" y="480" width="40" height="40"/><rect x="320" y="440" width="40" height="40"/><rect x="360" y="400" width="40" height="40"/><rect x="360" y="480" width="40" height="40"/></g><rect y="378" width="400" height="18" fill="#e23d28" stroke="#2a1d17" stroke-width="4"/><g stroke="#2a1d17" stroke-width="5"><ellipse cx="200" cy="356" rx="150" ry="30" fill="#fff"/><ellipse cx="200" cy="336" rx="100" ry="22" fill="#e9a13b"/><ellipse cx="200" cy="314" rx="100" ry="22" fill="#f2b552"/><ellipse cx="200" cy="292" rx="100" ry="22" fill="#e9a13b"/><ellipse cx="200" cy="270" rx="100" ry="22" fill="#f6c46a"/><rect x="176" y="242" width="46" height="26" rx="5" fill="#ffe38a"/></g><path d="M130 272c10 22 22 20 20 44c18-4 16-28 34-30c14 18 30 10 56 4c10 12 12 30 22 34c4-20 8-34 0-52" fill="#9c4a12" stroke="#2a1d17" stroke-width="4" stroke-linejoin="round"/><g fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".9"><path d="M170 220c-12-18 12-26 0-46"/><path d="M200 210c-12-18 12-26 0-46"/><path d="M230 220c-12-18 12-26 0-46"/></g><g transform="translate(36 52) rotate(-8)"><rect width="150" height="96" fill="#fffdf6" stroke="#2a1d17" stroke-width="5"/><text x="75" y="44" text-anchor="middle" font-family="Caveat, cursive" font-weight="700" font-size="30" fill="#2a1d17">Party of 6</text><text x="75" y="82" text-anchor="middle" font-family="Shrikhand, serif" font-size="30" fill="#e23d28">× 3/2</text></g><g transform="translate(290 70) rotate(10)"><path d="M0 0h70l-6 110H6Z" fill="#dff3ff" stroke="#2a1d17" stroke-width="5"/><path d="M4 50h62l-3 56H7Z" fill="#fff" opacity=".9"/><g stroke="#2a1d17" stroke-width="3"><path d="M44 30h18M48 50h14M44 70h18M48 90h14"/></g></g></svg>`,
    instructions: {
      objective: 'Serve the required number of orders in each of the 10 rounds before the stage timer reaches zero.',
      controls: [
        'Mouse / touch: tap an <strong>order ticket</strong> to show its recipe card; tap pantry jars to add ingredients to the bowl; use the <strong>−/+</strong> buttons to measure.',
        '<strong>Submit Order</strong> (or <kbd>S</kbd>) checks your measurements and sends an accepted dish to a free oven.',
        'Tap <strong>Serve now!</strong> when an oven dish is ready. Keys <kbd>1</kbd>–<kbd>4</kbd> select tickets. <kbd>P</kbd>/<kbd>Esc</kbd> pause, <kbd>M</kbd> toggles sound.'
      ],
      maths: [
        'Scale factor = servings ordered ÷ servings on the recipe card. Multiply <em>every</em> ingredient by it to keep the ratios the same.',
        'Some recipes use fractional factors (3/2, 3/4, 2/3…). Other recipes list amounts in kg, L and cups — convert them to g and ml — and adds percentage requests such as “25% less sugar”.',
        'Accuracy uses percentage error: |used − needed| ÷ needed. Perfect = exact; Close = within 5% (sometimes 3%); further off is Rough or Ruined.'
      ],
      scoring: [
        'Served dish: up to 100 pts × quality (Perfect 100%, Close 75%, Rough 45%) + up to 40 pts for customer patience left.',
        'Gold bonus tickets pay double when the dish is Perfect.',
        'Stage clear: +150 pts + 2 pts per second left. Emergency restock: −30 pts and −8 s.'
      ],
      failure: [
        'You lose a life when a dish is Ruined (its ingredients are wasted), when a dish burns in the oven, or when a regular customer’s patience runs out.',
        'The run ends at 0 lives or when a stage timer reaches 0:00.'
      ],
      timer: [
        'Each stage has its own countdown shown in the HUD; finishing early earns a time bonus.',
        'Pause with the ⏸ button, <kbd>P</kbd> or <kbd>Esc</kbd>: the stage timer, customer patience and ovens all freeze.'
      ]
    },
    stars: [
      '1 star: clear Stage 1 (or finish the whole kitchen).',
      '2 stars: finish all 10 rounds with at least 85% average accuracy (a failed run that reached Stage 3 also earns 2).',
      '3 stars: finish all 10 rounds with at least 95% average accuracy and lose no more than 1 life.'
    ],
    onStart(diff) {
      const cfg = DIFF[diff];
      S = {
        cfg, lives: cfg.lives, maxLives: cfg.lives, nextId: 1, stagesCleared: 0, totalServed: 0, perfect: 0,
        accuracies: [], livesLost: 0, wasted: 0, burnt: 0, walkouts: 0, restocks: 0, goldServed: 0, bannerTime: 0
      };
      this.setLives(S.lives, S.maxLives);
      setupStage(0);
    },
    onUpdate(dt) { if (S) update(dt); },
    onTimeUp() {
      finish(false, 'Out of time!', `The stage timer ran out with ${S.stageServed} of ${STAGES[S.stageIdx].target} orders served. Work on several tickets and keep both ovens busy.`);
    },
    onStop() { dom.banner.hidden = true; }
  });

  /* ---------------- Input (bound once) ---------------- */
  dom.submit.addEventListener('click', submitOrder);
  dom.empty.addEventListener('click', emptyBowl);
  window.addEventListener('keydown', (e) => {
    if (!this_shell.isPlaying() || MG.isTarget(e, 'input')) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); submitOrder(); }
    else if (/^[1-4]$/.test(k)) {
      const t = S.tickets[Number(k) - 1];
      if (t) selectTicket(t.id);
    }
  });

  // Exposed for automated tests only.
  MG.game = { get state() { return S; }, RECIPES, INGREDIENTS, submitOrder, adjust, addToBowl, serve };
})();
