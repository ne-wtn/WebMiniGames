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
   Algebra Adventure — expressions, linear equations, substitution and
   inequalities drive the world. Terminals hold variables (x, and y in the
   final world). Activating a terminal substitutes the chosen values into
   every linked mechanism at once:
     bridge: length L = f(x, y) must EXACTLY equal the gap width
     lift:   height h = f(x, y) must equal a docking ledge height
     door:   opens only if its inequality is true
     laser:  switches off only if its inequality is true
   Activation is all-or-nothing, so linked mechanisms form a system.
   ========================================================================== */
(() => {
  'use strict';
  const { clamp } = MG;

  /* ---------------- Constants ---------------- */
  const T = 40;               // tile size in world pixels
  const ROWS = 14;
  const GRAVITY = 2200;
  const JUMP_V = 690;         // ~2.6 tiles high, ~4 tiles long
  const RUN = 260;
  const PW = 26, PH = 54;     // player size
  const COYOTE = 0.09;
  const TILE = { EMPTY: 0, GROUND: 1, BRIDGE: 2, DOOR: 3, SPIKE: 4 };

  const DIFF = {
    easy:   { lives: 5, time: 260, charges: 8, showSizes: true,  enemySpeed: 0.8 },
    normal: { lives: 4, time: 200, charges: 6, showSizes: true,  enemySpeed: 1 },
    hard:   { lives: 3, time: 160, charges: 4, showSizes: false, enemySpeed: 1.25 }
  };

  // Mechanism expressions are fixed game data (never player-entered text).
  const BASE_LEVELS = [
    {
      name: 'Meadow of Variables', theme: 'meadow', width: 72, start: [2, 12], goal: [66, 12],
      ground: [[0, 13, 12], [19, 39, 12], [40, 46, 7], [47, 71, 12]],
      spikes: [[58, 59, 11]],
      coins: [[5, 10], [6, 10], [7, 10], [16, 9], [22, 10], [23, 9], [24, 10], [43, 5], [44, 5], [52, 10], [58, 8], [59, 8], [63, 10]],
      batteries: [[32, 11]],
      checkpoints: [[20, 12], [48, 12]],
      enemies: [{ c0: 21, c1: 26, r: 12, speed: 70 }, { c0: 50, c1: 56, r: 12, speed: 90 }],
      mechs: [
        { id: 'b1', type: 'bridge', col: 14, row: 12, gap: 5, text: 'L = x + 2', f: (v) => v.x + 2 },
        { id: 'd1', type: 'door', col: 30, top: 8, h: 4, text: '2x ≥ 8', f: (v) => 2 * v.x >= 8 },
        { id: 'l1', type: 'lift', col: 38, w: 2, base: 12, dock: 5, text: 'h = 2x − 1', f: (v) => 2 * v.x - 1 }
      ],
      terminals: [
        { col: 11, row: 12, vars: { x: [0, 8, 0] }, links: ['b1'] },
        { col: 28, row: 12, vars: { x: [0, 6, 0] }, links: ['d1'] },
        { col: 35, row: 12, vars: { x: [0, 6, 0] }, links: ['l1'] }
      ]
    },
    {
      name: 'Crystal Caverns', theme: 'cave', width: 88, start: [2, 12], goal: [84, 12],
      ground: [[0, 12, 12], [19, 45, 12], [46, 52, 8], [53, 70, 12], [78, 87, 12]],
      spikes: [[57, 58, 11], [63, 64, 11]],
      coins: [[4, 10], [5, 10], [15, 8], [16, 8], [23, 10], [24, 10], [37, 10], [48, 6], [50, 6], [57, 8], [58, 8], [63, 8], [64, 8], [74, 9], [80, 10]],
      batteries: [[36, 11]],
      checkpoints: [[20, 12], [47, 8], [54, 12]],
      enemies: [{ c0: 22, c1: 27, r: 12, speed: 90 }, { c: 39, r0: 7, r1: 11, axis: 'y', speed: 80 }, { c0: 59, c1: 62, r: 12, speed: 80 }],
      mechs: [
        { id: 'b1', type: 'bridge', col: 13, row: 12, gap: 6, text: 'L = 3(x − 1)', f: (v) => 3 * (v.x - 1) },
        { id: 'z1', type: 'laser', col: 31, top: 8, h: 4, text: 'x + 2 < 8', f: (v) => v.x + 2 < 8 },
        { id: 'd1', type: 'door', col: 33, top: 8, h: 4, text: '4x − 3 > 9', f: (v) => 4 * v.x - 3 > 9 },
        { id: 'l1', type: 'lift', col: 44, w: 2, base: 12, dock: 4, text: 'h = 10 − 2x', f: (v) => 10 - 2 * v.x },
        { id: 'b2', type: 'bridge', col: 71, row: 12, gap: 7, text: 'L = −2x + 13', f: (v) => -2 * v.x + 13 }
      ],
      terminals: [
        { col: 10, row: 12, vars: { x: [-3, 8, 0] }, links: ['b1'] },
        { col: 29, row: 12, vars: { x: [0, 9, 0] }, links: ['z1', 'd1'] },
        { col: 41, row: 12, vars: { x: [0, 6, 0] }, links: ['l1'] },
        { col: 68, row: 12, vars: { x: [-2, 8, 0] }, links: ['b2'] }
      ]
    },
    {
      name: 'Sky Fortress', theme: 'sky', width: 92, start: [2, 12], goal: [88, 12],
      ground: [[0, 12, 12], [21, 38, 12], [39, 45, 7], [52, 58, 7], [59, 91, 12]],
      spikes: [[76, 77, 11], [81, 82, 11]],
      coins: [[5, 10], [6, 10], [16, 9], [17, 9], [29, 10], [31, 10], [42, 5], [48, 5], [49, 5], [54, 5], [64, 10], [66, 10], [76, 8], [77, 8], [81, 8], [82, 8], [86, 10]],
      batteries: [[23, 11], [53, 6]],
      checkpoints: [[22, 12], [41, 7], [61, 12]],
      enemies: [{ c0: 28, c1: 33, r: 12, speed: 90 }, { c0: 63, c1: 69, r: 12, speed: 110 }, { c: 73, r0: 7, r1: 11, axis: 'y', speed: 100 }],
      mechs: [
        { id: 'b1', type: 'bridge', col: 13, row: 12, gap: 8, text: 'L = 2x + y', f: (v) => 2 * v.x + v.y },
        { id: 'd1', type: 'door', col: 26, top: 8, h: 4, text: 'x − y ≥ 1', f: (v) => v.x - v.y >= 1 },
        { id: 'l1', type: 'lift', col: 37, w: 2, base: 12, dock: 5, text: 'h = x + y', f: (v) => v.x + v.y },
        { id: 'z1', type: 'laser', col: 43, top: 3, h: 4, text: 'y − x > 0', f: (v) => v.y - v.x > 0 },
        { id: 'b2', type: 'bridge', col: 46, row: 7, gap: 6, text: 'L = 3x − y', f: (v) => 3 * v.x - v.y },
        { id: 'd2', type: 'door', col: 56, top: 3, h: 4, text: 'x + y ≤ 4', f: (v) => v.x + v.y <= 4 }
      ],
      terminals: [
        { col: 9, row: 12, vars: { x: [0, 6, 0], y: [0, 6, 0] }, links: ['b1', 'd1'] },
        { col: 35, row: 12, vars: { x: [0, 6, 0], y: [0, 6, 0] }, links: ['l1', 'z1'] },
        { col: 45, row: 7, vars: { x: [0, 6, 0], y: [0, 6, 0] }, links: ['b2', 'd2'] }
      ]
    }
  ];
  let LEVELS = freshLevels();
  function freshLevels() {
    const seed = MG.randInt(1, 4);
    return Array.from({length:10}, (_,i) => {
      const base = BASE_LEVELS[MG.roundTier(i)], sx = -(seed+i+1), sy = -(seed+2*i+1);
      // There is no word boundary between a coefficient and its variable ("2x").
      // Match mathematical variable tokens, including implicit multiplication.
      const substitute = text => text.replace(/(^|[^A-Za-z_])([xy])(?![A-Za-z_])/g,
        (_, prefix, variable) => prefix+'('+variable+' − '+(-(variable==='x'?sx:sy))+')');
      return {...base, name:base.name+' · Route '+(i+1),
        mechs:base.mechs.map(m=>({...m,text:substitute(m.text),f:v=>m.f({x:v.x+sx,y:v.y+sy})})),
        terminals:base.terminals.map(t=>({...t,vars:Object.fromEntries(Object.entries(t.vars).map(([key,[min,max,start]])=>{const shift=key==='x'?sx:sy;return [key,[min-shift,max-shift,start-shift]];}))}))};
    });
  }

  const THEMES = {
    meadow: { sky: ['#5c94fc', '#bcd8ff'], hill: '#7fd36b', hill2: '#4fae4f', top: '#5ad25a', top2: '#2e8f2e', dirt: '#b8642a', dirt2: '#8e4a1c', cloud: '#ffffff' },
    cave:   { sky: ['#1b1838', '#4a2c88'], hill: '#3b2470', hill2: '#2c1b58', top: '#c58cff', top2: '#8a55d6', dirt: '#4b3576', dirt2: '#33244f', cloud: '#6d55a8' },
    sky:    { sky: ['#ff8a5c', '#ffe0a8'], hill: '#f3b9a2', hill2: '#d98f7a', top: '#eef1f7', top2: '#aab2c4', dirt: '#7f8799', dirt2: '#5d6577', cloud: '#fff4e6' }
  };

  /* ---------------- DOM ---------------- */
  const canvas = document.getElementById('game');
  const dom = {
    term: document.getElementById('terminal'),
    termTitle: document.getElementById('term-title'),
    vars: document.getElementById('termVars'),
    mechs: document.getElementById('termMechs'),
    activate: document.getElementById('activateBtn'),
    charge: document.getElementById('chargeChip'),
    coin: document.getElementById('coinChip'),
    hint: document.getElementById('hintChip')
  };
  const keys = { left: false, right: false, jump: false };
  let S = null;

  /* ---------------- Level construction ---------------- */
  function buildLevel(idx) {
    S.cfg = MG.roundConfig(DIFF, idx);
    const def = LEVELS[idx];
    const grid = Array.from({ length: ROWS }, () => new Array(def.width).fill(TILE.EMPTY));
    for (const [c0, c1, top] of def.ground) for (let c = c0; c <= c1; c++) for (let r = top; r < ROWS; r++) grid[r][c] = TILE.GROUND;
    for (const [c0, c1, r] of def.spikes) for (let c = c0; c <= c1; c++) grid[r][c] = TILE.SPIKE;
    const mechs = def.mechs.map((m) => Object.assign({}, m, { solved: false, anim: 0, planks: 0, jam: 0, liftH: 0, liftT: 0, open: 0 }));
    for (const m of mechs) if (m.type === 'door') for (let r = m.top; r < m.top + m.h; r++) grid[r][m.col] = TILE.DOOR;
    const terminals = def.terminals.map((t, i) => {
      const vals = {};
      for (const [k, [, , start]] of Object.entries(t.vars)) vals[k] = start;
      return Object.assign({}, t, { idx: i, vals, done: false });
    });
    const enemies = def.enemies.map((e) => e.axis === 'y'
      ? { axis: 'y', x: e.c * T + 6, y: e.r0 * T, min: e.r0 * T, max: e.r1 * T - 30, w: 28, h: 30, v: e.speed * S.cfg.enemySpeed, alive: true }
      : { axis: 'x', x: e.c0 * T, y: e.r * T - 30, min: e.c0 * T, max: e.c1 * T + T - 34, w: 34, h: 30, v: e.speed * S.cfg.enemySpeed, alive: true });
    S.level = {
      idx, def, grid, mechs, terminals, enemies,
      coins: def.coins.map(([c, r]) => ({ x: (c + 0.5) * T, y: (r + 0.5) * T, taken: false })),
      batteries: def.batteries.map(([c, r]) => ({ x: (c + 0.5) * T, y: (r + 0.5) * T, taken: false })),
      checkpoints: def.checkpoints.map(([c, r]) => ({ x: (c + 0.5) * T, y: r * T, on: false })),
      goal: { x: def.goal[0] * T, y: def.goal[1] * T - 2 * T, w: T, h: 2 * T }
    };
    S.spawn = { x: def.start[0] * T + 6, y: def.start[1] * T - PH };
    S.player = { x: S.spawn.x, y: S.spawn.y, vx: 0, vy: 0, onGround: false, coyote: 0, face: 1, inv: 0, on: null, squash: 0 };
    S.charges = S.cfg.charges;
    S.cam = Math.max(0, S.player.x - 200);
    S.activeTerm = null;
    S.levelCoins = 0;
    this_shell.setStage(`${idx + 1}/${LEVELS.length} · ${def.name}`);
    this_shell.setTimer(S.cfg.time);
    this_shell.toast(`World ${idx + 1}: ${def.name}`, 'info', 2600);
    updateChips();
    hideTerminal();
  }

  /* ---------------- Collision helpers ---------------- */
  const tileAt = (c, r) => {
    const g = S.level.grid;
    if (r < 0) return TILE.EMPTY;
    if (r >= ROWS || c < 0 || c >= g[0].length) return c < 0 ? TILE.GROUND : TILE.EMPTY;
    return g[r][c];
  };
  const isSolid = (t) => t === TILE.GROUND || t === TILE.BRIDGE || t === TILE.DOOR;
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  function liftRect(m) {
    return { x: m.col * T, y: (m.base - m.liftH) * T, w: m.w * T, h: 12 };
  }

  /** Move the player on one axis and push it out of any solid tile. */
  function moveAxis(p, dx, dy) {
    p.x += dx; p.y += dy;
    const c0 = Math.floor(p.x / T), c1 = Math.floor((p.x + PW - 0.01) / T);
    const r0 = Math.floor(p.y / T), r1 = Math.floor((p.y + PH - 0.01) / T);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (!isSolid(tileAt(c, r))) continue;
        if (dx > 0) p.x = c * T - PW;
        else if (dx < 0) p.x = (c + 1) * T;
        if (dy > 0) { p.y = r * T - PH; p.vy = 0; p.onGround = true; }
        else if (dy < 0) { p.y = (r + 1) * T; p.vy = 0; }
        return true;
      }
    }
    return false;
  }

  /* ---------------- Update ---------------- */
  function update(dt) {
    const L = S.level, p = S.player;
    updateMechanisms(dt);

    // Horizontal input
    const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    p.vx = dir * RUN;
    if (dir) p.face = dir;

    // Jump with a small coyote-time window
    p.coyote = p.onGround ? COYOTE : Math.max(0, p.coyote - dt);
    if (keys.jump && p.coyote > 0) {
      p.vy = -JUMP_V; p.coyote = 0; p.onGround = false; p.on = null;
      MG.sound.play('jump');
    }
    if (!keys.jump && p.vy < -250) p.vy = -250; // variable jump height

    p.vy = Math.min(p.vy + GRAVITY * dt, 1100);

    // Ride lift platforms
    if (p.on && p.on.type === 'lift') {
      const r = liftRect(p.on);
      if (p.x + PW > r.x && p.x < r.x + r.w) p.y = r.y - PH; else p.on = null;
    }

    const prevBottom = p.y + PH;
    moveAxis(p, p.vx * dt, 0);
    p.onGround = false;
    moveAxis(p, 0, p.vy * dt);

    // One-way lift platforms (land from above only)
    for (const m of L.mechs) {
      if (m.type !== 'lift') continue;
      const r = liftRect(m);
      if (p.vy >= 0 && prevBottom <= r.y + 6 && p.y + PH >= r.y && p.x + PW > r.x && p.x < r.x + r.w) {
        p.y = r.y - PH; p.vy = 0; p.onGround = true; p.on = m;
      }
    }
    if (p.on && !p.onGround) p.on = null;
    if (p.inv > 0) p.inv -= dt;

    // Hazards: spikes, active lasers, falling out of the world
    const box = { x: p.x + 3, y: p.y + 4, w: PW - 6, h: PH - 4 };
    for (let r = Math.floor(box.y / T); r <= Math.floor((box.y + box.h) / T); r++) {
      for (let c = Math.floor(box.x / T); c <= Math.floor((box.x + box.w) / T); c++) {
        if (tileAt(c, r) === TILE.SPIKE && overlap(box, { x: c * T + 4, y: r * T + T * 0.45, w: T - 8, h: T * 0.55 })) return hurt('Spikes!');
      }
    }
    for (const m of L.mechs) {
      if (m.type === 'laser' && !m.solved && overlap(box, { x: m.col * T + 14, y: m.top * T, w: 12, h: m.h * T })) return hurt('Laser barrier!');
    }
    if (p.y > ROWS * T + 80) return hurt('You fell!');

    // Enemies: stomp from above, otherwise take damage
    for (const e of L.enemies) {
      if (!e.alive) continue;
      if (e.axis === 'x') { e.x += e.v * dt; if (e.x < e.min || e.x > e.max) { e.v *= -1; e.x = clamp(e.x, e.min, e.max); } }
      else { e.y += e.v * dt; if (e.y < e.min || e.y > e.max) { e.v *= -1; e.y = clamp(e.y, e.min, e.max); } }
      if (overlap(box, e)) {
        if (p.vy > 0 && prevBottom <= e.y + 10) {
          e.alive = false; p.vy = -JUMP_V * 0.6;
          this_shell.addScore(25, 'Stomp', worldToScreen(e.x, e.y));
          MG.sound.play('pop');
        } else if (p.inv <= 0) return hurt('Ouch! A slime got you.');
      }
    }

    // Pick-ups
    for (const c of L.coins) if (!c.taken && Math.abs(c.x - (p.x + PW / 2)) < 22 && Math.abs(c.y - (p.y + PH / 2)) < 34) {
      c.taken = true; S.levelCoins++; S.coins++;
      this_shell.addScore(10, '', worldToScreen(c.x, c.y)); MG.sound.play('coin'); updateChips();
    }
    for (const b of L.batteries) if (!b.taken && Math.abs(b.x - (p.x + PW / 2)) < 24 && Math.abs(b.y - (p.y + PH / 2)) < 36) {
      b.taken = true; S.charges += 2;
      this_shell.addScore(5, '+2 charges', worldToScreen(b.x, b.y)); MG.sound.play('success'); updateChips();
    }
    for (const cp of L.checkpoints) if (!cp.on && Math.abs(cp.x - (p.x + PW / 2)) < 26 && Math.abs(cp.y - (p.y + PH)) < 40) {
      cp.on = true; S.spawn = { x: cp.x - PW / 2, y: cp.y - PH };
      this_shell.toast('Checkpoint reached 🚩', 'good', 1500); MG.sound.play('select');
    }
    if (overlap(box, L.goal)) return levelComplete();

    // Terminal proximity
    let near = null;
    for (const t of L.terminals) {
      const tx = (t.col + 0.5) * T, ty = t.row * T;
      if (Math.abs(tx - (p.x + PW / 2)) < T * 1.3 && Math.abs(ty - (p.y + PH)) < T * 1.2) near = t;
    }
    if (near !== S.activeTerm) { S.activeTerm = near; if (near) showTerminal(near); else hideTerminal(); }

    // Camera follows smoothly
    const view = viewWidth();
    const target = clamp(p.x - view * 0.4, 0, L.def.width * T - view);
    S.cam += (target - S.cam) * Math.min(1, dt * 8);
    this_shell.setProgress(clamp(p.x / L.goal.x, 0, 1), `World ${L.idx + 1} progress`);
    draw();
  }

  function updateMechanisms(dt) {
    for (const m of S.level.mechs) {
      if (m.jam > 0) m.jam -= dt;
      if (m.type === 'bridge' && m.planks < m.targetPlanks) {
        // Extend planks one at a time for a visible animation.
        m.anim += dt;
        while (m.anim > 0.07 && m.planks < m.targetPlanks) {
          m.anim -= 0.07;
          if (m.col + m.planks < S.level.def.width) S.level.grid[m.row][m.col + m.planks] = TILE.BRIDGE;
          m.planks++;
          MG.sound.play('click');
        }
      }
      if (m.type === 'bridge' && m.collapse > 0 && !m.solved && m.planks >= m.targetPlanks) {
        m.collapse -= dt;
        if (m.collapse <= 0) { clearPartialBridge(m); MG.sound.play('whoosh'); }
      }
      if (m.type === 'door' && m.solved && m.open < 1) {
        m.open = Math.min(1, m.open + dt * 1.5);
        if (m.open >= 1) for (let r = m.top; r < m.top + m.h; r++) S.level.grid[r][m.col] = TILE.EMPTY;
      }
      if (m.type === 'lift' && m.solved) {
        // Lift cycles: wait at bottom, rise, wait at top, descend.
        m.liftT = (m.liftT + dt) % 8;
        const t = m.liftT;
        const up = t < 1.5 ? 0 : t < 4 ? (t - 1.5) / 2.5 : t < 5.5 ? 1 : 1 - (t - 5.5) / 2.5;
        m.liftH = m.dock * up;
      }
    }
  }

  /* ---------------- Terminals & activation ---------------- */
  const fmtExprVal = (v) => (v < 0 ? '−' + Math.abs(v) : String(v));

  function showTerminal(t) {
    dom.term.hidden = false;
    renderTerminal();
    dom.hint.textContent = 'Set the variable, then Activate (Enter)';
  }
  function hideTerminal() {
    dom.term.hidden = true;
    if (S) dom.hint.textContent = S.charges > 0 ? 'Walk to a terminal ⌨ to set variables' : 'No charges! Find a 🔋 or press R to reboot';
  }

  function renderTerminal() {
    const t = S.activeTerm;
    if (!t) return;
    const L = S.level;
    dom.termTitle.textContent = `Terminal ${t.idx + 1}${t.done ? ' — ONLINE ✔' : ''}`;
    dom.vars.innerHTML = '';
    for (const k of Object.keys(t.vars)) {
      const [min, max] = t.vars[k];
      const wrap = MG.el('div', { class: 'var' });
      const minus = MG.el('button', { class: 'mg-btn', type: 'button', 'aria-label': `Decrease ${k}` }, '−');
      const plus = MG.el('button', { class: 'mg-btn', type: 'button', 'aria-label': `Increase ${k}` }, '+');
      minus.addEventListener('click', () => changeVar(k, -1));
      plus.addEventListener('click', () => changeVar(k, 1));
      wrap.append(MG.el('span', { class: 'var__name' }, k + ' ='), minus, MG.el('span', { class: 'var__val', 'aria-live': 'polite' }, fmtExprVal(t.vals[k])), plus, MG.el('span', { style: 'font-size:.7rem;opacity:.6' }, `${fmtExprVal(min)}…${max}`));
      dom.vars.append(wrap);
    }
    dom.mechs.innerHTML = '';
    for (const id of t.links) {
      const m = L.mechs.find((x) => x.id === id);
      const li = MG.el('li', { class: m.solved ? 'is-solved' : '' });
      let desc = '';
      if (m.type === 'bridge') desc = `Bridge length <span class="eq">${m.text}</span> tiles · gap ${S.cfg.showSizes ? `= <strong>${m.gap}</strong> tiles` : '= count the tiles!'}`;
      if (m.type === 'lift') desc = `Lift height <span class="eq">${m.text}</span> tiles · ledge ${S.cfg.showSizes ? `= <strong>${m.dock}</strong> tiles up` : 'height: count the tiles!'}`;
      if (m.type === 'door') desc = `Door opens if <span class="eq">${m.text}</span>`;
      if (m.type === 'laser') desc = `Laser switches off if <span class="eq">${m.text}</span>`;
      if (m.solved) desc += ' — <strong>done ✔</strong>';
      else if (t.previewHelp) {
        const ok = mechSatisfied(m, t.vals);
        const val = m.f(t.vals);
        li.classList.add(ok ? 'is-ok' : 'is-bad');
        desc += `<span class="pv">Preview: ${typeof val === 'boolean' ? (val ? 'TRUE ✔' : 'FALSE ✘') : `${m.type === 'bridge' ? 'L' : 'h'} = ${fmtExprVal(val)} ${ok ? '✔' : '✘'}`}</span>`;
      }
      li.innerHTML = desc;
      dom.mechs.append(li);
    }
    dom.activate.disabled = t.done;
    dom.activate.textContent = t.done ? '✔ Mechanisms online' : `⚡ Activate Mechanism (uses 1 of ${S.charges} 🔋)`;
    if (!t.done && !t.previewHelp) {
      const hint = MG.el('button',{class:'mg-btn mg-btn--sm',type:'button'},'Show substitution check (assisted)');
      hint.addEventListener('click',()=>{t.previewHelp=true;this_shell.maths.assist('Algebra','algebra:'+S.level.idx+':'+t.idx);renderTerminal();});
      dom.mechs.append(MG.el('li',{},hint));
    }
  }

  function changeVar(k, d) {
    const t = S && S.activeTerm;
    if (!t || t.done || !this_shell.isPlaying() || !(k in t.vars)) return;
    const [min, max] = t.vars[k];
    t.vals[k] = clamp(t.vals[k] + d, min, max);
    MG.sound.play('click');
    renderTerminal();
  }

  function mechSatisfied(m, v) {
    const val = m.f(v);
    if (m.type === 'bridge') return val === m.gap;
    if (m.type === 'lift') return val === m.dock;
    return val === true;
  }

  /**
   * Activate Mechanism: substitute the variable values into every linked
   * mechanism. Only if ALL are satisfied do they switch on.
   */
  function activate() {
    const t = S && S.activeTerm;
    if (!t || !this_shell.isPlaying()) return;
    if (t.done) { this_shell.toast('This terminal is already online.', 'info'); return; }
    if (S.charges <= 0) {
      this_shell.toast('No charges left! Collect a 🔋 battery or press R to reboot at the checkpoint (costs a life).', 'bad', 3200);
      dom.charge.classList.add('is-flash'); setTimeout(() => dom.charge.classList.remove('is-flash'), 500);
      MG.sound.play('error');
      return;
    }
    S.charges--;
    S.activations++;
    const mechs = t.links.map((id) => S.level.mechs.find((m) => m.id === id));
    const results = mechs.map((m) => ({ m, ok: mechSatisfied(m, t.vals), val: m.f(t.vals) }));
    this_shell.maths.record('Algebra','algebra:'+S.level.idx+':'+t.idx,results.every(r=>r.ok));
    const vals = Object.entries(t.vals).map(([k, v]) => `${k} = ${fmtExprVal(v)}`).join(', ');

    if (results.every((r) => r.ok)) {
      t.done = true;
      S.goodActivations++;
      const firstTry = !t.failed;
      for (const { m } of results) {
        m.solved = true;
        if (m.type === 'bridge') { clearPartialBridge(m); m.targetPlanks = m.gap; m.planks = 0; }
        S.mechsSolved++;
      }
      const pts = (firstTry ? 100 : 50) * results.length;
      this_shell.addScore(pts, firstTry ? 'First try!' : 'Solved', dom.activate);
      this_shell.toast(`✔ ${vals}: every condition is satisfied!`, 'good');
      MG.sound.play('success');
      this_shell.flash('good');
    } else {
      t.failed = true;
      this_shell.addScore(-20, 'Failed activation', dom.activate);
      const why = results.filter((r) => !r.ok).map(({ m, val }) => {
        if (m.type === 'bridge') { showFailedBridge(m, val); return val < m.gap ? `bridge L = ${fmtExprVal(val)} is too short` : `bridge L = ${fmtExprVal(val)} is too long and jams`; }
        if (m.type === 'lift') return `lift h = ${fmtExprVal(val)} has no ledge to dock with`;
        return `${m.type} condition ${m.text} is false for ${vals}`;
      });
      this_shell.toast(`✘ Rejected — ${why.join('; ')}.`, 'bad', 3600);
      MG.sound.play('error');
      this_shell.flash('bad');
    }
    updateChips();
    renderTerminal();
  }

  /** A wrong bridge length still deploys so the player sees the mismatch. */
  function showFailedBridge(m, val) {
    clearPartialBridge(m);
    if (val > m.gap) { m.jam = 1.6; m.jamLen = val; return; }
    // Too short: the planks roll out so the shortfall is visible, then retract,
    // so a wrong answer can never be used as a stepping stone.
    if (val > 0) { m.targetPlanks = val; m.planks = 0; m.shortLen = val; m.collapse = 1.6; }
  }
  function clearPartialBridge(m) {
    for (let i = 0; i < m.gap; i++) if (S.level.grid[m.row][m.col + i] === TILE.BRIDGE) S.level.grid[m.row][m.col + i] = TILE.EMPTY;
    m.targetPlanks = 0; m.planks = 0; m.collapse = 0;
  }

  function reboot() {
    if (!this_shell.isPlaying()) return;
    hurt('Rebooted at the checkpoint', true);
  }

  function hurt(why, reboot = false) {
    S.lives--; S.livesLost++;
    this_shell.setLives(S.lives, S.maxLives);
    this_shell.flash('bad');
    MG.sound.play('hit');
    if (S.lives <= 0) return finish(false, 'Out of lives', `${why} You ran out of lives in ${S.level.def.name}.`);
    this_shell.toast(`${why} −1 life`, 'bad');
    const p = S.player;
    p.x = S.spawn.x; p.y = S.spawn.y; p.vx = 0; p.vy = 0; p.inv = 1.5; p.on = null;
    if (reboot || S.charges < 2) S.charges = Math.max(S.charges, 2);
    updateChips();
  }

  function levelComplete() {
    if (S.level.terminals.some(t=>!t.done)) {
      if (!S.goalWarn || this_shell.playTime-S.goalWarn>3) { S.goalWarn=this_shell.playTime;this_shell.toast('Bring every terminal online before entering the portal.','warn'); }
      return;
    }
    const bonus = 200 + Math.round(this_shell.timeLeft * 2) + S.charges * 15;
    this_shell.addScore(bonus, 'World clear!');
    S.levelsCleared++;
    MG.sound.play('stage');
    this_shell.flash('good');
    if (S.level.idx + 1 >= LEVELS.length) return finish(true, 'Adventure complete!', 'You crossed all 10 rounds by solving their equations and inequalities.');
    buildLevel(S.level.idx + 1);
  }

  function updateChips() {
    dom.charge.textContent = `🔋 Charges: ${S.charges}`;
    const total = S.level.coins.length;
    dom.coin.textContent = `🪙 ${S.levelCoins} / ${total}`;
    if (!S.activeTerm) hideTerminal();
  }

  /* ---------------- Rendering ---------------- */
  let view = { w: 800, h: 560, scale: 1, oy: 0, ctx: null };
  const viewWidth = () => view.w / view.scale;
  function worldToScreen(x, y) {
    const r = canvas.getBoundingClientRect();
    return { x: r.left + (x - S.cam) * view.scale, y: r.top + view.oy + y * view.scale };
  }
  function resize() {
    const f = MG.fitCanvas(canvas);
    // Fit the full height, but always show at least 12 tiles across (portrait phones).
    const scale = Math.min(f.h / (ROWS * T), f.w / (12 * T));
    view = { w: f.w, h: f.h, scale, oy: f.h - ROWS * T * scale, ctx: f.ctx };
  }

  /** Blend two #rrggbb colours (used for the stepped pixel sky). */
  function mix(a, b, t) {
    const p = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
    return '#' + [0, 1, 2].map((i) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * t).toString(16).padStart(2, '0')).join('');
  }
  const PX = '"Pixelify Sans", sans-serif', CRT = 'VT323, monospace', ARCADE = '"Press Start 2P", monospace';

  function draw() {
    if (!view.ctx) resize();
    const ctx = view.ctx, L = S.level, th = THEMES[L.def.theme];
    const sc = view.scale;
    // Sky
    const bands = 8;
    for (let i = 0; i < bands; i++) { ctx.fillStyle = mix(th.sky[0], th.sky[1], i / (bands - 1)); ctx.fillRect(0, Math.floor((i * view.h) / bands), view.w, Math.ceil(view.h / bands) + 1); }
    // Blocky clouds drifting slowly
    const px = Math.max(4, Math.round(6 * sc));
    ctx.fillStyle = th.cloud;
    for (let i = 0; i < 7; i++) {
      const cx = ((i * 330 - S.cam * 0.12) % (view.w + 300) + view.w + 300) % (view.w + 300) - 150, cy = 30 + ((i * 53) % 4) * 34 * sc;
      for (const [x, y, w] of [[2, 0, 4], [0, 1, 9], [1, 2, 10], [-1, 2, 2]]) ctx.fillRect(cx + x * px * 2, cy + y * px * 2, w * px * 2, px * 2);
    }
    // Parallax hills with stepped (pixel) outlines
    for (const [k, col, amp, base] of [[0.2, th.hill, 70, 0.72], [0.45, th.hill2, 50, 0.82]]) {
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(0, view.h);
      for (let x = 0; x <= view.w; x += 16) {
        const wx = x / sc + S.cam * k;
        const y = Math.round((view.h * base - (Math.sin(wx / 120) + Math.sin(wx / 47) * 0.4) * amp * sc) / 8) * 8;
        ctx.lineTo(x, y); ctx.lineTo(x + 16, y);
      }
      ctx.lineTo(view.w, view.h); ctx.fill();
    }

    ctx.save();
    ctx.translate(0, view.oy);
    ctx.scale(sc, sc);
    ctx.translate(-S.cam, 0);
    const c0 = Math.max(0, Math.floor(S.cam / T) - 1), c1 = Math.min(L.def.width - 1, Math.ceil((S.cam + viewWidth()) / T) + 1);

    // Faint measuring grid so tiles can be counted
    ctx.strokeStyle = 'rgba(255,255,255,.13)'; ctx.lineWidth = 1;
    for (let c = c0; c <= c1; c++) { ctx.beginPath(); ctx.moveTo(c * T, 0); ctx.lineTo(c * T, ROWS * T); ctx.stroke(); }
    for (let r = 0; r <= ROWS; r++) { ctx.beginPath(); ctx.moveTo(c0 * T, r * T); ctx.lineTo((c1 + 1) * T, r * T); ctx.stroke(); }

    // Tiles
    for (let r = 0; r < ROWS; r++) for (let c = c0; c <= c1; c++) {
      const t = L.grid[r][c];
      if (t === TILE.GROUND) {
        const top = r === 0 || L.grid[r - 1][c] !== TILE.GROUND;
        ctx.fillStyle = th.dirt; ctx.fillRect(c * T, r * T, T, T);
        const h = (c * 7 + r * 13) % 5;
        ctx.fillStyle = th.dirt2;
        ctx.fillRect(c * T + 4 + h * 4, r * T + 16, 6, 6); ctx.fillRect(c * T + 26 - h * 3, r * T + 30, 6, 6); ctx.fillRect(c * T + 30, r * T + 8 + h * 2, 4, 4);
        ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(c * T, r * T + T - 2, T, 2);
        if (top) {
          ctx.fillStyle = th.top; ctx.fillRect(c * T, r * T, T, 10);
          ctx.fillStyle = th.top2; ctx.fillRect(c * T, r * T + 10, T, 4); ctx.fillRect(c * T + (h * 6) % 30, r * T + 14, 6, 4);
          ctx.fillStyle = th.top; ctx.fillRect(c * T + 6 + h * 2, r * T - 4, 4, 4); ctx.fillRect(c * T + 28 - h, r * T - 4, 4, 4);
        }
      } else if (t === TILE.BRIDGE) {
        ctx.fillStyle = '#0d0b1e'; ctx.fillRect(c * T, r * T - 2, T, 18);
        ctx.fillStyle = '#d08a46'; ctx.fillRect(c * T + 2, r * T, T - 4, 12);
        ctx.fillStyle = '#9a5a26'; ctx.fillRect(c * T + 2, r * T + 8, T - 4, 4); ctx.fillRect(c * T + 6, r * T + 2, 4, 4); ctx.fillRect(c * T + T - 10, r * T + 2, 4, 4);
      } else if (t === TILE.SPIKE) {
        for (let i = 0; i < 3; i++) {
          const x0 = c * T + i * 13 + 1;
          for (let k = 0; k < 5; k++) { ctx.fillStyle = k % 2 ? '#aab2c4' : '#e6e9f0'; ctx.fillRect(x0 + k * 1.3 + 0.5, r * T + 14 + k * 5, 13 - k * 2.6, 5); }
        }
      }
    }

    // Mechanisms
    for (const m of L.mechs) drawMech(ctx, m);

    // Terminals
    for (const t of L.terminals) {
      const x = t.col * T + 4, y = t.row * T - 56;
      ctx.fillStyle = '#2d3354'; roundRect(ctx, x, y, 32, 56, 6); ctx.fill();
      ctx.fillStyle = t.done ? '#22d39b' : (S.activeTerm === t ? '#ffd84d' : '#7fb2ff');
      roundRect(ctx, x + 4, y + 6, 24, 18, 3); ctx.fill();
      ctx.fillStyle = '#04140a'; ctx.font = `18px ${CRT}`; ctx.textAlign = 'center';
      ctx.fillText(t.done ? 'OK' : Object.keys(t.vars).join(','), x + 16, y + 19);
      ctx.fillStyle = '#fff'; ctx.font = `8px ${ARCADE}`; ctx.fillText(`T${t.idx + 1}`, x + 16, y + 44);
    }

    // Checkpoints & goal
    for (const cp of L.checkpoints) {
      ctx.fillStyle = '#ddd'; ctx.fillRect(cp.x - 2, cp.y - 52, 4, 52);
      ctx.fillStyle = cp.on ? '#22d39b' : '#ff5a5a';
      ctx.beginPath(); ctx.moveTo(cp.x + 2, cp.y - 52); ctx.lineTo(cp.x + 26, cp.y - 44); ctx.lineTo(cp.x + 2, cp.y - 36); ctx.fill();
    }
    const gl = L.goal, pulse = (Math.sin(performance.now() / 200) + 1) / 2;
    const pg = ctx.createRadialGradient(gl.x + T / 2, gl.y + T, 4, gl.x + T / 2, gl.y + T, 50);
    pg.addColorStop(0, '#fff'); pg.addColorStop(0.5, '#b38cff'); pg.addColorStop(1, 'rgba(123,63,228,0)');
    ctx.fillStyle = pg; ctx.beginPath(); ctx.ellipse(gl.x + T / 2, gl.y + T, 26 + pulse * 4, 42 + pulse * 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `10px ${ARCADE}`; ctx.textAlign = 'center'; ctx.fillText('GOAL', gl.x + T / 2, gl.y - 8);

    // Pick-ups
    const spin = Math.abs(Math.sin(performance.now() / 260));
    for (const c of L.coins) if (!c.taken) {
      const w = Math.max(4, Math.round((10 * spin + 2) / 2) * 2);
      ctx.fillStyle = '#7a5200'; ctx.fillRect(c.x - w - 2, c.y - 12, w * 2 + 4, 24);
      ctx.fillStyle = '#fcd000'; ctx.fillRect(c.x - w, c.y - 10, w * 2, 20);
      ctx.fillStyle = '#fff3a0'; ctx.fillRect(c.x - w + 2, c.y - 8, Math.max(2, w / 2), 8);
    }
    for (const b of L.batteries) if (!b.taken) {
      ctx.fillStyle = '#22d39b'; roundRect(ctx, b.x - 9, b.y - 14, 18, 28, 4); ctx.fill();
      ctx.fillStyle = '#0d5f45'; ctx.fillRect(b.x - 4, b.y - 18, 8, 4);
      ctx.fillStyle = '#fff'; ctx.font = `600 16px ${PX}`; ctx.fillText('+', b.x, b.y + 5);
    }

    // Enemies
    for (const e of L.enemies) if (e.alive) {
      const ex = Math.round(e.x), ey = Math.round(e.y), wob = Math.floor(performance.now() / 180) % 2 * 2;
      ctx.fillStyle = '#0d0b1e'; ctx.fillRect(ex + 2, ey + 4 + wob, e.w - 4, e.h - 4 - wob); ctx.fillRect(ex, ey + 10 + wob, e.w, e.h - 10 - wob);
      ctx.fillStyle = e.axis === 'y' ? '#ff6b9a' : '#ff7a3d'; ctx.fillRect(ex + 4, ey + 6 + wob, e.w - 8, e.h - 8 - wob); ctx.fillRect(ex + 2, ey + 12 + wob, e.w - 4, e.h - 14 - wob);
      ctx.fillStyle = '#fff'; ctx.fillRect(ex + e.w / 2 - 10, ey + 10 + wob, 7, 7); ctx.fillRect(ex + e.w / 2 + 3, ey + 10 + wob, 7, 7);
      ctx.fillStyle = '#0d0b1e'; ctx.fillRect(ex + e.w / 2 - 8 + Math.sign(e.v) * 2, ey + 12 + wob, 3, 4); ctx.fillRect(ex + e.w / 2 + 5 + Math.sign(e.v) * 2, ey + 12 + wob, 3, 4);
    }

    drawPlayer(ctx);
    ctx.restore();
  }

  function drawMech(ctx, m) {
    ctx.textAlign = 'center';
    if (m.type === 'bridge') {
      const y = m.row * T;
      if (S.cfg.showSizes && !m.solved) {
        // Ruler under the gap
        ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(m.col * T, y + 30); ctx.lineTo((m.col + m.gap) * T, y + 30); ctx.stroke();
        for (let i = 0; i <= m.gap; i++) { ctx.beginPath(); ctx.moveTo((m.col + i) * T, y + 24); ctx.lineTo((m.col + i) * T, y + 36); ctx.stroke(); }
        ctx.fillStyle = '#fff'; ctx.font = `24px ${CRT}`;
        ctx.fillText(`gap ${m.gap} tiles`, (m.col + m.gap / 2) * T, y + 54);
      }
      ctx.fillStyle = '#0d0b1e'; ctx.fillRect(m.col * T + 1, y - 75, 136, 30); ctx.fillStyle = '#04140a'; ctx.fillRect(m.col * T + 4, y - 72, 130, 24);
      ctx.fillStyle = m.solved ? '#39ff7a' : '#fcd000'; ctx.font = `22px ${CRT}`; ctx.textAlign = 'left';
      ctx.fillText(m.text, m.col * T + 12, y - 55);
      if (m.jam > 0) {
        ctx.fillStyle = `rgba(255,60,60,${Math.min(1, m.jam)})`;
        ctx.fillRect(m.col * T, y, Math.min(m.jamLen, m.gap + 1.2) * T, 14);
        ctx.fillStyle = '#fff'; ctx.font = `600 16px ${PX}`; ctx.textAlign = 'center';
        ctx.fillText(`L = ${m.jamLen}: TOO LONG — JAMMED`, (m.col + m.gap / 2) * T, y - 10);
      }
      if (m.collapse > 0 && !m.solved) {
        ctx.fillStyle = `rgba(255,60,60,${0.35 + 0.3 * Math.sin(performance.now() / 70)})`;
        ctx.fillRect(m.col * T, y, m.planks * T, 14);
        ctx.fillStyle = '#fff'; ctx.font = `600 16px ${PX}`; ctx.textAlign = 'center';
        ctx.fillText(`L = ${m.shortLen}: TOO SHORT — RETRACTING`, (m.col + m.gap / 2) * T, y - 10);
      }
    } else if (m.type === 'door') {
      const x = m.col * T, y = m.top * T, h = m.h * T * (1 - m.open);
      if (h > 0) {
        ctx.fillStyle = '#5b6077'; ctx.fillRect(x + 4, y, T - 8, h);
        ctx.strokeStyle = '#2d3354'; ctx.lineWidth = 3; ctx.strokeRect(x + 4, y, T - 8, h);
        ctx.fillStyle = '#ffd84d'; ctx.fillRect(x + 12, y + 8, T - 24, 6);
      }
      drawTag(ctx, `🚪 ${m.text}`, x + T / 2, y - 10, m.solved);
    } else if (m.type === 'laser') {
      const x = m.col * T + T / 2, y = m.top * T;
      ctx.fillStyle = '#444a63'; ctx.fillRect(x - 10, y - 8, 20, 8); ctx.fillRect(x - 10, y + m.h * T - 4, 20, 6);
      if (!m.solved) {
        const a = 0.6 + Math.sin(performance.now() / 60) * 0.3;
        ctx.fillStyle = `rgba(255,40,80,${a})`; ctx.fillRect(x - 4, y, 8, m.h * T - 4);
        ctx.fillStyle = 'rgba(255,40,80,.25)'; ctx.fillRect(x - 10, y, 20, m.h * T - 4);
      }
      drawTag(ctx, `⚠ off if ${m.text}`, x, y - 16, m.solved);
    } else if (m.type === 'lift') {
      const r = liftRect(m);
      ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.setLineDash([6, 6]); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(r.x + r.w / 2, (m.base - m.dock) * T); ctx.lineTo(r.x + r.w / 2, m.base * T); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = m.solved ? '#22d39b' : '#9aa3c7'; roundRect(ctx, r.x, r.y, r.w, r.h, 4); ctx.fill();
      ctx.fillStyle = '#2d3354'; ctx.fillRect(r.x + 6, r.y + 4, r.w - 12, 3);
      if (S.cfg.showSizes && !m.solved) {
        ctx.fillStyle = '#fff'; ctx.font = `22px ${CRT}`;
        ctx.fillText(`ledge ${m.dock} tiles up`, r.x + r.w / 2, (m.base - m.dock) * T - 30);
      }
      drawTag(ctx, `⇕ ${m.text}`, r.x + r.w / 2, (m.base - m.dock) * T - 8, m.solved);
    }
  }

  function drawTag(ctx, text, x, y, solved) {
    ctx.font = `21px ${CRT}`;
    const w = ctx.measureText(text).width + 16;
    ctx.fillStyle = '#0d0b1e'; ctx.fillRect(x - w / 2 - 3, y - 19, w + 6, 28);
    ctx.fillStyle = '#04140a'; ctx.fillRect(x - w / 2, y - 16, w, 22);
    ctx.fillStyle = solved ? '#39ff7a' : '#fcd000'; ctx.textAlign = 'center'; ctx.fillText(text, x, y + 1);
  }

  function drawPlayer(ctx) {
    const p = S.player;
    if (p.inv > 0 && Math.floor(p.inv * 10) % 2) return;
    const x = Math.round(p.x), y = Math.round(p.y), f = p.face;
    const step = Math.abs(p.vx) > 0 && p.onGround ? Math.floor(performance.now() / 110) % 2 : 0;
    const R = (dx, dy, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(f > 0 ? x + dx : x + PW - dx - w, y + dy, w, h); };
    R(-2, 0, PW + 4, PH, '#0d0b1e');                // outline
    R(2, 2, PW - 4, 10, '#ffd7b0');                 // head
    R(0, 0, PW, 6, '#fcd000');                      // headband
    R(PW - 10, 5, 4, 4, '#0d0b1e');                 // eye
    R(0, 14, PW, 24, '#7b3fe4');                    // tunic
    R(4, 18, PW - 8, 4, '#a77bff');
    R(2, 38, 9, 14 - step * 4, '#3b2a7a');          // legs
    R(PW - 11, 38, 9, 10 + step * 4, '#3b2a7a');
    ctx.fillStyle = '#fff'; ctx.font = `italic bold 15px Georgia, serif`; ctx.textAlign = 'center'; ctx.fillText('x', x + PW / 2, y + 34);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  /* ---------------- End of run ---------------- */
  function finish(won, title, reason) {
    const acc = S.activations ? Math.round((S.goodActivations / S.activations) * 100) : 0;
    const totalCoins = LEVELS.reduce((a, l) => a + l.coins.length, 0);
    const coinPct = Math.round((S.coins / totalCoins) * 100);
    let stars;
    if (won) stars = acc >= 80 && S.livesLost <= 1 && coinPct >= 70 ? 3 : acc >= 60 && S.livesLost <= 2 ? 2 : 1;
    else stars = S.levelsCleared >= 2 ? 2 : S.levelsCleared >= 1 ? 1 : 0;
    hideTerminal();
    this_shell.end({
      won, title, reason, stars,
      stats: [
        ['Worlds cleared', `${S.levelsCleared} / ${LEVELS.length}`],
        ['Mechanisms solved', S.mechsSolved],
        ['Activation accuracy', `${acc}% (${S.goodActivations}/${S.activations})`],
        ['Coins', `${S.coins} / ${totalCoins} (${coinPct}%)`],
        ['Lives left', `${Math.max(0, S.lives)} / ${S.maxLives}`],
        ['Lives lost', S.livesLost],
        ['Time remaining (last world)', MG.fmtTime(this_shell.timeLeft)],
        ['Play time', MG.fmtTime(this_shell.playTime)]
      ],
      math: [
        `Activation accuracy: ${acc}% of your activations satisfied every linked condition.`,
        'Bridges and lifts are <strong>equations</strong>: e.g. L = 3(x − 1) must equal 6, so x − 1 = 2 and x = 3.',
        'Doors and lasers are <strong>inequalities</strong>: 4x − 3 > 9 gives x > 3 while x + 2 < 8 gives x < 6, so only x = 4 or 5 satisfy both.',
        'World 3 used two variables: 2x + y = 8 together with x − y ≥ 1 is a <strong>system</strong> — substitute values to test each candidate pair.'
      ]
    });
  }

  /* ---------------- Shell ---------------- */
  const this_shell = MG.createShell({
    id: 'algebra-adventure',
    title: 'Algebra Adventure',
    tagline: 'Every bridge, door and lift in these worlds runs on algebra. Set x right and the way opens!',
    goal: 'Reach the glowing GOAL in all 10 worlds before time runs out.',
    steps: [
      ['🏃', 'Run and jump to a terminal.'],
      ['🧮', 'Set x (and y) so the equation fits the gap.'],
      ['⚡', 'Activate! Wrong answers cost a charge.']
    ],
    keys: [
      ['<kbd>←</kbd><kbd>→</kbd>', 'Move'],
      ['<kbd>Space</kbd>', 'Jump'],
      ['<kbd>Q</kbd><kbd>E</kbd>', 'Change x'],
      ['<kbd>Z</kbd><kbd>C</kbd>', 'Change y'],
      ['<kbd>Enter</kbd>', 'Activate'],
      ['<kbd>R</kbd>', 'Reboot']
    ],
    genre: '2D platformer',
    topic: 'Expressions, equations, substitution, inequalities',
    premise: 'Three worlds of gaps, doors, lasers and lifts — and every one of them is wired to an algebra terminal.',
    objective: 'Run, jump and reach the glowing goal of each world. Set the variables at terminals so bridges are the exact length, lifts dock at the right height and inequalities open the way.',
    stageLabel: 'Round',
    art: `<svg viewBox="0 0 100 125" preserveAspectRatio="xMidYMid slice" shape-rendering="crispEdges"><rect x="0" y="0" width="100" height="16" fill="#3c6ee0"/><rect x="0" y="16" width="100" height="16" fill="#4a7ef0"/><rect x="0" y="32" width="100" height="16" fill="#5c94fc"/><rect x="0" y="48" width="100" height="16" fill="#74a6ff"/><rect x="0" y="64" width="100" height="16" fill="#8fbaff"/><rect x="12" y="10" width="12" height="4" fill="#fff"/><rect x="8" y="14" width="24" height="4" fill="#fff"/><rect x="10" y="18" width="26" height="4" fill="#fff"/><rect x="64" y="22" width="12" height="4" fill="#fff"/><rect x="60" y="26" width="24" height="4" fill="#fff"/><rect x="62" y="30" width="26" height="4" fill="#fff"/><rect x="0" y="70" width="100" height="60" fill="#7fd36b"/><rect x="0" y="66" width="4" height="12" fill="#4fae4f"/><rect x="4" y="64" width="4" height="12" fill="#4fae4f"/><rect x="8" y="62" width="4" height="12" fill="#4fae4f"/><rect x="12" y="60" width="4" height="12" fill="#4fae4f"/><rect x="16" y="58" width="4" height="12" fill="#4fae4f"/><rect x="20" y="58" width="4" height="12" fill="#4fae4f"/><rect x="24" y="58" width="4" height="12" fill="#4fae4f"/><rect x="28" y="60" width="4" height="12" fill="#4fae4f"/><rect x="32" y="62" width="4" height="12" fill="#4fae4f"/><rect x="36" y="64" width="4" height="12" fill="#4fae4f"/><rect x="40" y="66" width="4" height="12" fill="#4fae4f"/><rect x="44" y="64" width="4" height="12" fill="#4fae4f"/><rect x="48" y="62" width="4" height="12" fill="#4fae4f"/><rect x="52" y="60" width="4" height="12" fill="#4fae4f"/><rect x="56" y="58" width="4" height="12" fill="#4fae4f"/><rect x="60" y="58" width="4" height="12" fill="#4fae4f"/><rect x="64" y="58" width="4" height="12" fill="#4fae4f"/><rect x="68" y="60" width="4" height="12" fill="#4fae4f"/><rect x="72" y="62" width="4" height="12" fill="#4fae4f"/><rect x="76" y="64" width="4" height="12" fill="#4fae4f"/><rect x="80" y="66" width="4" height="12" fill="#4fae4f"/><rect x="84" y="64" width="4" height="12" fill="#4fae4f"/><rect x="88" y="62" width="4" height="12" fill="#4fae4f"/><rect x="92" y="60" width="4" height="12" fill="#4fae4f"/><rect x="96" y="58" width="4" height="12" fill="#4fae4f"/><rect x="0" y="96" width="34" height="34" fill="#b8642a"/><rect x="0" y="96" width="34" height="4" fill="#5ad25a"/><rect x="0" y="100" width="34" height="2" fill="#2e8f2e"/><rect x="3" y="108" width="3" height="3" fill="#8e4a1c"/><rect x="11" y="116" width="3" height="3" fill="#8e4a1c"/><rect x="19" y="108" width="3" height="3" fill="#8e4a1c"/><rect x="27" y="116" width="3" height="3" fill="#8e4a1c"/><rect x="70" y="96" width="30" height="34" fill="#b8642a"/><rect x="70" y="96" width="30" height="4" fill="#5ad25a"/><rect x="70" y="100" width="30" height="2" fill="#2e8f2e"/><rect x="73" y="108" width="3" height="3" fill="#8e4a1c"/><rect x="81" y="116" width="3" height="3" fill="#8e4a1c"/><rect x="89" y="108" width="3" height="3" fill="#8e4a1c"/><rect x="34" y="96" width="5" height="4" fill="#d08a46"/><rect x="34" y="99" width="5" height="1" fill="#9a5a26"/><rect x="40" y="96" width="5" height="4" fill="#d08a46"/><rect x="40" y="99" width="5" height="1" fill="#9a5a26"/><rect x="46" y="96" width="5" height="4" fill="#d08a46"/><rect x="46" y="99" width="5" height="1" fill="#9a5a26"/><rect x="52" y="96" width="5" height="4" fill="#d08a46"/><rect x="52" y="99" width="5" height="1" fill="#9a5a26"/><rect x="58" y="96" width="5" height="4" fill="#d08a46"/><rect x="58" y="99" width="5" height="1" fill="#9a5a26"/><rect x="64" y="96" width="5" height="4" fill="#d08a46"/><rect x="64" y="99" width="5" height="1" fill="#9a5a26"/><rect x="34" y="96" width="36" height="1" fill="#0d0b1e"/><rect x="36" y="112" width="32" height="2" fill="#fff"/><rect x="36" y="109" width="1" height="8" fill="#fff"/><rect x="67" y="109" width="1" height="8" fill="#fff"/><rect x="43" y="58" width="10" height="22" fill="#0d0b1e"/><rect x="44" y="59" width="8" height="4" fill="#ffd7b0"/><rect x="44" y="58" width="8" height="2" fill="#fcd000"/><rect x="50" y="60" width="1" height="1" fill="#0d0b1e"/><rect x="44" y="64" width="8" height="9" fill="#7b3fe4"/><rect x="44" y="73" width="3" height="6" fill="#3b2a7a"/><rect x="49" y="73" width="3" height="4" fill="#3b2a7a"/><rect x="14" y="76" width="12" height="20" fill="#2d3354"/><rect x="16" y="78" width="8" height="6" fill="#39ff7a"/><rect x="76" y="54" width="4" height="6" fill="#fcd000"/><rect x="84" y="50" width="4" height="6" fill="#fcd000"/><rect x="92" y="54" width="4" height="6" fill="#fcd000"/><rect x="24" y="30" width="52" height="14" fill="#0d0b1e"/><rect x="25" y="31" width="50" height="12" fill="#04140a"/><text x="50" y="40.5" text-anchor="middle" font-family="VT323, monospace" font-size="11" fill="#39ff7a">L = 2x + 1</text></svg>`,
    instructions: {
      objective: 'Reach the goal portal in all 10 worlds before each world’s timer runs out.',
      controls: [
        'Move: <kbd>←</kbd> <kbd>→</kbd> or <kbd>A</kbd> <kbd>D</kbd>. Jump: <kbd>↑</kbd>, <kbd>W</kbd> or <kbd>Space</kbd> (hold for a higher jump).',
        'At a terminal: <kbd>Q</kbd>/<kbd>E</kbd> change x, <kbd>Z</kbd>/<kbd>C</kbd> change y, <kbd>Enter</kbd> or <kbd>F</kbd> = <strong>Activate Mechanism</strong>. You can also tap the −/+ and Activate buttons.',
        '<kbd>R</kbd> reboots you at the last checkpoint (costs a life, refills charges to 2). Touch screens show ◀ ▶ ⤒ buttons.',
        '<kbd>P</kbd>/<kbd>Esc</kbd> pause, <kbd>M</kbd> sound.'
      ],
      maths: [
        '<strong>Bridges</strong>: the bridge length L is an expression in x. It must exactly equal the gap (count the tiles). Too short and you fall; too long and it jams.',
        '<strong>Lifts</strong>: the height h must equal the ledge height in tiles, or the lift has nowhere to dock.',
        '<strong>Doors and lasers</strong> open only when their inequality is true for your values.',
        'One terminal can drive several mechanisms. They only activate if <em>all</em> their conditions are true at once — solve them together!',
        'Solve fresh equations at every terminal. The optional substitution check is recorded as assisted; all terminals must be online to clear the world.'
      ],
      scoring: [
        'Coins +10, batteries +5 (and +2 charges), stomping a slime +25.',
        'Correct activation: +100 per mechanism on the first try, +50 after a mistake. Failed activation: −20.',
        'World clear: +200, +2 per second left, +15 per unused charge.'
      ],
      failure: [
        'Lose a life for touching spikes, a laser, a slime (unless you stomp it) or falling into a gap.',
        'Each activation uses a charge. With no charges you must find a battery or reboot (costs a life).',
        'The run ends at 0 lives or if a world timer reaches 0:00.'
      ],
      timer: [
        'Each world has its own countdown. Pausing (⏸, <kbd>P</kbd> or <kbd>Esc</kbd>) freezes the player, enemies, lifts and the timer.'
      ]
    },
    stars: [
      '1 star: clear World 1 (or complete the adventure).',
      '2 stars: complete all 10 worlds with ≥60% activation accuracy and at most 2 lives lost (a failed run that cleared 2 worlds also earns 2).',
      '3 stars: complete all 10 worlds with ≥80% activation accuracy, at most 1 life lost and at least 70% of coins.'
    ],
    onStart(diff) {
      const cfg = DIFF[diff];
      LEVELS = freshLevels();
      S = { cfg, lives: cfg.lives, maxLives: cfg.lives, livesLost: 0, coins: 0, activations: 0, goodActivations: 0, mechsSolved: 0, levelsCleared: 0 };
      keys.left = keys.right = keys.jump = false;
      this.setLives(S.lives, S.maxLives);
      resize();
      buildLevel(0);
      draw();
    },
    onUpdate(dt) { update(dt); },
    onTimeUp() { finish(false, 'Time ran out', `The timer in ${S.level.def.name} reached zero.`); },
    onPause() { keys.left = keys.right = keys.jump = false; },
    onStop() { keys.left = keys.right = keys.jump = false; hideTerminal(); }
  });

  /* ---------------- Input (registered once) ---------------- */
  const KEYMAP = { arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right', arrowup: 'jump', w: 'jump', ' ': 'jump' };
  window.addEventListener('keydown', (e) => {
    if (!this_shell.isPlaying()) return;
    const k = e.key.toLowerCase();
    if (KEYMAP[k]) { keys[KEYMAP[k]] = true; e.preventDefault(); return; }
    if (k === 'q') changeVar('x', -1);
    else if (k === 'e') changeVar('x', 1);
    else if (k === 'z') changeVar('y', -1);
    else if (k === 'c') changeVar('y', 1);
    else if (k === 'enter' || k === 'f') { e.preventDefault(); activate(); }
    else if (k === 'r') reboot();
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (KEYMAP[k]) keys[KEYMAP[k]] = false;
  });
  window.addEventListener('resize', () => { resize(); if (S && S.level) draw(); });
  dom.activate.addEventListener('click', activate);
  MG.bindHold(document.getElementById('tLeft'), keys, 'left');
  MG.bindHold(document.getElementById('tRight'), keys, 'right');
  MG.bindHold(document.getElementById('tJump'), keys, 'jump');

  MG.game = { get state() { return S; }, keys, activate, changeVar, get LEVELS() { return LEVELS; } };
})();
