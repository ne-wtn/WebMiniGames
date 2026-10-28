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
   Geometry City — area, perimeter, volume, surface area, Pythagoras and
   angles. Players design districts on a 1 m grid. Every structure is a
   rectangle (or right-angled triangle) with live measurements. Approve
   Construction checks the actual layout against the planning brief.
   ========================================================================== */
(() => {
  'use strict';
  const { el, clamp, round } = MG;

  /* ---------------- Configuration ---------------- */
  const TYPES = {
    house:  { name: 'House',     color: '#f08a4b', key: '1', icon: '🏠', desc: 'Cost $40 per m² of floor' },
    park:   { name: 'Park',      color: '#5cc15c', key: '2', icon: '🌳', desc: '$10 per m² + $5 per m of fence (perimeter)' },
    road:   { name: 'Road',      color: '#5a6070', key: '3', icon: '🛣', desc: '$8 per m²' },
    pool:   { name: 'Pool',      color: '#3aa7e8', key: '4', icon: '🏊', desc: '$15 per m³ of water (l × w × depth)' },
    civic:  { name: 'Library',   color: '#8a5cd6', key: '5', icon: '🏛', desc: '$10 per m² footprint + $6 per m² of surface area' },
    garden: { name: 'Tri-garden',color: '#9bd36a', key: '6', icon: '◺',  desc: 'Right-angled triangle. $12 per m²' }
  };
  const DECOR = [
    { id: 'tree', icon: '🌲', name: 'Pine tree', unlock: 0 },
    { id: 'bench', icon: '🪑', name: 'Bench', unlock: 0 },
    { id: 'flowers', icon: '🌷', name: 'Flower bed', unlock: 1 },
    { id: 'fountain', icon: '⛲', name: 'Fountain', unlock: 1 },
    { id: 'statue', icon: '🗿', name: 'Statue', unlock: 2 },
    { id: 'lamp', icon: '💡', name: 'Street lamp', unlock: 2 }
  ];
  const DECOR_COST = 20;
  const DECOR_POINTS = 10;
  const DECOR_CAP = 6;          // decorations that score per stage (prevents farming)

  /* ---- Geometry of a structure (all lengths in metres) ---- */
  const G = {
    area: (s) => (s.type === 'garden' ? (s.w * s.h) / 2 : s.w * s.h),
    perimeter: (s) => (s.type === 'garden' ? s.w + s.h + Math.hypot(s.w, s.h) : 2 * (s.w + s.h)),
    volume: (s) => s.w * s.h * (s.type === 'pool' ? s.depth : s.height),
    surface: (s) => 2 * (s.w * s.h + s.w * s.height + s.h * s.height),
    hyp: (s) => Math.hypot(s.w, s.h),
    angleA: (s) => (Math.atan2(s.h, s.w) * 180) / Math.PI, // angle at the end of the horizontal leg
    cost(s) {
      switch (s.type) {
        case 'house': return 40 * s.w * s.h;
        case 'park': return 10 * s.w * s.h + 5 * 2 * (s.w + s.h);
        case 'road': return 8 * s.w * s.h;
        case 'pool': return 15 * s.w * s.h * s.depth;
        case 'civic': return 10 * s.w * s.h + 6 * G.surface(s);
        case 'garden': return Math.round(12 * (s.w * s.h) / 2);
        case 'decor': return DECOR_COST;
      }
      return 0;
    }
  };
  const fmt$ = (n) => '$' + Math.round(n).toLocaleString('en-GB');
  const touching = (a, b) => {
    const xOverlap = a.x < b.x + b.w && b.x < a.x + a.w;
    const yOverlap = a.y < b.y + b.h && b.y < a.y + a.h;
    return (xOverlap && (a.y + a.h === b.y || b.y + b.h === a.y)) || (yOverlap && (a.x + a.w === b.x || b.x + b.w === a.x));
  };

  /* ---------------- Stages (planning briefs) ---------------- */
  // Each requirement returns { ok, detail } from the current layout.
  let STAGES = freshBriefs();
  function freshBriefs() {
    const seed=MG.randInt(0,2);
    return Array.from({length:10},(_,i)=>{
      const tier=MG.roundTier(i), side=3+(i+seed)%4, width=3+(i+seed)%3, height=3+Math.floor(i/3)%3;
      const houseArea=width*height, parkA=2+(i+seed)%3, parkB=3+i%3;
      const area=(type,value)=>({text:'A '+TYPES[type].name.toLowerCase()+' with area <strong>'+value+' m²</strong>',check:L=>best(L,type,s=>G.area(s)===value,s=>'area '+G.area(s)+' m²')});
      const road=type=>({text:'Every '+TYPES[type].name.toLowerCase()+' must touch a road',check:L=>allTouch(L,type)});
      let tools=['house','park','road'],reqs=[area('house',houseArea),{text:'A park with perimeter <strong>'+2*(parkA+parkB)+' m</strong>',check:L=>best(L,'park',s=>G.perimeter(s)===2*(parkA+parkB),s=>'perimeter '+G.perimeter(s)+' m')},road('house')];
      if(tier===1){const volume=(3+i%3)*3*(1+i%3);tools.push('pool');reqs=[{text:'A pool with volume <strong>'+volume+' m³</strong> (depth 1–3 m)',check:L=>best(L,'pool',s=>G.volume(s)===volume,s=>'volume '+G.volume(s)+' m³')},area('house',houseArea),road('house'),{text:'A park with area <strong>'+parkA*parkB+' m²</strong> and perimeter <strong>'+2*(parkA+parkB)+' m</strong>',check:L=>best(L,'park',s=>G.area(s)===parkA*parkB&&G.perimeter(s)===2*(parkA+parkB),s=>'area '+G.area(s)+', perimeter '+G.perimeter(s))}];}
      if(tier===2){const h=2+i%3,v=3*4*h,sa=2*(12+3*h+4*h),triple=i%2?[5,12,13]:[3,4,5];tools.push('civic','garden');reqs=[{text:'A library with volume <strong>'+v+' m³</strong> and surface area under <strong>'+(sa+5)+' m²</strong>',check:L=>best(L,'civic',s=>G.volume(s)===v&&G.surface(s)<sa+5,s=>'volume '+G.volume(s)+', surface '+G.surface(s))},road('civic'),{text:'A right-triangle garden with hypotenuse <strong>'+triple[2]+' m</strong>',check:L=>best(L,'garden',s=>Math.abs(G.hyp(s)-triple[2])<1e-8,s=>'hypotenuse '+round(G.hyp(s),2))},area('park',side*side),{text:'The park must be square',check:L=>best(L,'park',s=>s.w===s.h,s=>'dimensions '+s.w+' × '+s.h)}];}
      return {name:'District '+(i+1),cols:22,rows:16,budget:tier===0?3000:5200,blocked:[[21,15]],blockKind:'oak',tools,reqs,
        bonus:{text:'Bonus: keep spending below 80% of budget',check:(L,cost,st)=>({ok:cost<=st.budget*.8,detail:Math.round(cost/st.budget*100)+'% used'})}};
    });
  }

  function rectCells(x, y, w, h) { const out = []; for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) out.push([x + i, y + j]); return out; }
  function best(L, type, pred, describe) {
    const list = L.filter((s) => s.type === type);
    if (!list.length) return { ok: false, detail: `no ${TYPES[type].name.toLowerCase()} built yet` };
    const hit = list.find(pred);
    return hit ? { ok: true, detail: describe(hit) } : { ok: false, detail: list.map(describe).join('; ') };
  }
  function allTouch(L, type) {
    const list = L.filter((s) => s.type === type);
    if (!list.length) return { ok: false, detail: `no ${TYPES[type].name.toLowerCase()} built yet` };
    const bad = list.filter((s) => !L.some((r) => r.type === 'road' && touching(s, r)));
    return { ok: !bad.length, detail: bad.length ? `${bad.length} ${TYPES[type].name.toLowerCase()}(s) not touching a road` : 'all connected' };
  }
  const sumArea = (L, type) => L.filter((s) => s.type === type).reduce((a, s) => a + G.area(s), 0);

  const DIFF = {
    easy:   { permits: 5, time: 330 },
    normal: { permits: 4, time: 260 },
    hard:   { permits: 3, time: 200 }
  };

  /* ---------------- DOM ---------------- */
  const canvas = document.getElementById('plot');
  const dom = {
    tools: document.getElementById('tools'), decor: document.getElementById('decor'),
    reqs: document.getElementById('reqs'), briefName: document.getElementById('briefName'),
    cost: document.getElementById('cost'), costBar: document.getElementById('costBar'),
    insp: document.getElementById('inspector'), approve: document.getElementById('approveBtn'), tip: document.getElementById('tip')
  };
  let S = null;
  let view = { cell: 30, ox: 0, oy: 0, w: 0, h: 0, ctx: null };

  /* ---------------- Stage setup ---------------- */
  function setupStage(idx) {
    S.cfg = MG.roundConfig(DIFF, idx);
    const st = STAGES[idx];
    S.stageIdx = idx;
    S.items = [];
    S.selected = null;
    S.tool = st.tools[0];
    S.decorId = null;
    S.drag = null;
    S.lastCheck = null;
    S.blocked = new Set(st.blocked.map(([x, y]) => x + ',' + y));
    this_shell.setStage(`${idx + 1}/${STAGES.length}`);
    this_shell.setTimer(S.cfg.time);
    this_shell.toast(`District ${idx + 1}: ${st.name}`, 'info');
    buildToolbar();
    renderBrief();
    renderInspector();
    resize();
  }

  /* ---------------- Validity ---------------- */
  function invalidReason(s, ignore) {
    const st = STAGES[S.stageIdx];
    if (s.w < 1 || s.h < 1) return 'Too small';
    if (s.x < 0 || s.y < 0 || s.x + s.w > st.cols || s.y + s.h > st.rows) return 'Outside the plot boundary';
    for (let i = 0; i < s.w; i++) for (let j = 0; j < s.h; j++) {
      if (S.blocked.has(s.x + i + ',' + (s.y + j))) return st.blockKind === 'lake' ? 'Cannot build on the lake' : st.blockKind === 'rock' ? 'Bedrock in the way' : 'Protected oak tree in the way';
    }
    for (const o of S.items) {
      if (o === ignore) continue;
      if (s.x < o.x + o.w && o.x < s.x + s.w && s.y < o.y + o.h && o.y < s.y + s.h) return `Overlaps the ${o.type === 'decor' ? 'decoration' : TYPES[o.type].name.toLowerCase()}`;
    }
    return null;
  }

  function totalCost() { return S.items.reduce((a, s) => a + G.cost(s), 0); }

  function makeItem(type, x, y, w, h) {
    const s = { id: S.nextId++, type, x, y, w, h };
    if (type === 'pool') s.depth = 1;
    if (type === 'civic') s.height = 3;
    if (type === 'garden') s.orient = 0;
    if (type === 'decor') { s.decor = S.decorId; s.w = 1; s.h = 1; }
    return s;
  }

  /* ---------------- Pointer interaction ---------------- */
  function cellAt(e) {
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left - view.ox, py = e.clientY - r.top - view.oy;
    return { x: Math.floor(px / view.cell), y: Math.floor(py / view.cell), px: e.clientX - r.left, py: e.clientY - r.top };
  }
  const itemAt = (c) => [...S.items].reverse().find((s) => c.x >= s.x && c.x < s.x + s.w && c.y >= s.y && c.y < s.y + s.h);

  canvas.addEventListener('pointerdown', (e) => {
    if (!this_shell.isPlaying()) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const c = cellAt(e);
    if (S.tool === 'bulldoze') {
      const it = itemAt(c);
      if (it) removeItem(it);
      return;
    }
    if (S.tool === 'select') {
      const it = itemAt(c);
      select(it || null);
      if (it) S.drag = { mode: 'move', item: it, dx: c.x - it.x, dy: c.y - it.y, ghost: Object.assign({}, it) };
      return;
    }
    if (S.tool === 'decor') {
      if (!S.decorId) return;
      const s = makeItem('decor', c.x, c.y, 1, 1);
      tryPlace(s);
      return;
    }
    S.drag = { mode: 'draw', x0: c.x, y0: c.y, ghost: makeItem(S.tool, c.x, c.y, 1, 1) };
    updateTip(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!S || !this_shell.isPlaying()) return;
    const c = cellAt(e);
    S.hover = c;
    if (!S.drag) { dom.tip.hidden = true; return; }
    const g = S.drag.ghost;
    if (S.drag.mode === 'draw') {
      g.x = Math.min(S.drag.x0, c.x); g.y = Math.min(S.drag.y0, c.y);
      g.w = Math.abs(c.x - S.drag.x0) + 1; g.h = Math.abs(c.y - S.drag.y0) + 1;
    } else { g.x = c.x - S.drag.dx; g.y = c.y - S.drag.dy; }
    updateTip(e);
  });
  const endDrag = () => {
    if (!S || !S.drag) return;
    const d = S.drag;
    S.drag = null;
    dom.tip.hidden = true;
    if (!this_shell.isPlaying()) return;
    if (d.mode === 'draw') tryPlace(d.ghost);
    else {
      const why = invalidReason(d.ghost, d.item);
      if (why) { if (d.ghost.x !== d.item.x || d.ghost.y !== d.item.y) { this_shell.toast(`Can’t move there: ${why}.`, 'bad'); MG.sound.play('error'); } }
      else { Object.assign(d.item, { x: d.ghost.x, y: d.ghost.y }); MG.sound.play('place'); changed(); }
    }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', () => { if (S) { S.drag = null; dom.tip.hidden = true; } });

  function updateTip(e) {
    const g = S.drag.ghost;
    const why = invalidReason(g, S.drag.item);
    const r = canvas.getBoundingClientRect();
    dom.tip.hidden = false;
    dom.tip.style.left = e.clientX - r.left + 'px';
    dom.tip.style.top = e.clientY - r.top + 'px';
    dom.tip.classList.toggle('is-bad', !!why);
    dom.tip.textContent = why ? `✘ ${why}` : describeShort(g);
  }
  function describeShort(s) {
    return s.w+' × '+s.h+' m dimensions. Calculate the measurement before inspection.';
  }

  function tryPlace(s) {
    const why = invalidReason(s);
    if (why) { this_shell.toast(`Invalid placement: ${why}.`, 'bad'); MG.sound.play('error'); return false; }
    S.items.push(s);
    select(s.type === 'decor' ? null : s);
    MG.sound.play('place');
    changed();
    return true;
  }
  function removeItem(it) {
    S.items = S.items.filter((x) => x !== it);
    if (S.selected === it) S.selected = null;
    MG.sound.play('whoosh');
    changed();
  }
  function select(it) { S.selected = it; renderInspector(); if (it) MG.sound.play('click'); }

  /** Resize / move / rotate the selected structure only if the result is valid. */
  function modify(fn) {
    const it = S && S.selected;
    if (!it || !this_shell.isPlaying()) return;
    const copy = Object.assign({}, it);
    fn(copy);
    const why = invalidReason(copy, it);
    if (why) { this_shell.toast(`Not possible: ${why}.`, 'bad'); MG.sound.play('error'); return; }
    Object.assign(it, copy);
    MG.sound.play('click');
    changed();
  }

  function changed() { S.lastCheck=null; this_shell.maths.clearPrompt(); renderBrief(); renderInspector(); }

  /* ---------------- Approval ---------------- */
  function evaluate() {
    const st = STAGES[S.stageIdx];
    const L = S.items;
    const cost = totalCost();
    const res = st.reqs.map((r) => Object.assign({ text: r.text }, r.check(L, cost, st)));
    const budgetOk = cost <= st.budget;
    const bonus = Object.assign({ text: st.bonus.text }, st.bonus.check(L, cost, st));
    return { res, budgetOk, cost, bonus };
  }

  function approve() {
    if (!this_shell.isPlaying()) return;
    if (!S.items.some((s) => s.type !== 'decor')) {
      this_shell.toast('Nothing to approve yet — build something first.', 'warn');
      MG.sound.play('error');
      return;
    }
    const st = STAGES[S.stageIdx];
    const signature=JSON.stringify(S.items.map(s=>[s.type,s.x,s.y,s.w,s.h,s.depth,s.height]));
    const stage=S.stageIdx;
    const shapes=S.items.filter(s=>s.type!=='decor'&&s.type!=='road');
    const fields=shapes.flatMap((s,index)=>{
      const label=TYPES[s.type].name+' '+(index+1)+' ('+s.w+' × '+s.h+(s.depth?' × '+s.depth:s.height?' × '+s.height:'')+' m)';
      if(s.type==='civic')return [{label:label+' volume (m³)',answer:G.volume(s)},{label:label+' surface area (m²)',answer:G.surface(s)}];
      if(s.type==='pool')return [{label:label+' volume (m³)',answer:G.volume(s)}];
      if(s.type==='garden')return [{label:label+' hypotenuse (m; 2 decimals)',answer:G.hyp(s),tolerance:.006}];
      return [{label:label+(s.type==='park'?' perimeter (m)':' area (m²)'),answer:s.type==='park'?G.perimeter(s):G.area(s)}];
    });
    if(!fields.length){this_shell.toast('Include a building or park in the blueprint.','warn');return;}
    if(!this_shell.maths.gate({key:'geometry:'+stage+':'+signature,topic:'Area, perimeter, volume and Pythagoras',title:'Sign the construction blueprint',prompt:'Calculate the measurements from your chosen dimensions before the inspection.',fields,
      hint:'Rectangle: A = length × width, P = 2(length + width). Cuboid: V = lwh, surface = 2(lw + lh + wh). Right triangle: hypotenuse = √(a² + b²).',container:dom.approve.parentElement,
      valid:()=>stage===S.stageIdx&&signature===JSON.stringify(S.items.map(s=>[s.type,s.x,s.y,s.w,s.h,s.depth,s.height])),onPass:approve}))return;
    const ev = evaluate();
    this_shell.maths.record('Construction constraints','layout:'+stage,ev.res.every(r=>r.ok)&&ev.budgetOk);
    S.lastCheck = ev;
    S.approvals++;
    renderBrief();
    const failed = ev.res.filter((r) => !r.ok);
    if (failed.length || !ev.budgetOk) {
      S.failedApprovals++; S.stageFails++;
      S.permits--;
      this_shell.setLives(S.permits, S.maxPermits, '📜');
      this_shell.addScore(-50, 'Rejected', dom.approve);
      this_shell.flash('bad');
      MG.sound.play('error');
      const msg = !ev.budgetOk ? `over budget by ${fmt$(ev.cost - st.budget)}` : `${failed.length} requirement(s) not met`;
      this_shell.toast(`✘ Planning rejected: ${msg}. −1 permit`, 'bad', 3200);
      if (S.permits <= 0) finish(false, 'Permits revoked', 'The council rejected too many plans. Read each failed requirement’s measurement carefully before approving.');
      return;
    }
    // Approved!
    const decorCount = Math.min(DECOR_CAP, S.items.filter((s) => s.type === 'decor').length);
    const saving = Math.round((st.budget - ev.cost) / 10);
    const timeB = Math.round(this_shell.timeLeft);
    let pts = 100 * ev.res.length + saving + timeB + decorCount * DECOR_POINTS;
    if (!S.stageFails) pts += 150;
    if (ev.bonus.ok) { pts += 100; S.bonuses++; }
    this_shell.addScore(pts, 'Approved!', dom.approve);
    S.budgetUse.push(ev.cost / st.budget);
    S.decorPlaced += decorCount;
    S.stagesDone++;
    S.unlocked = Math.max(S.unlocked, S.stageIdx + 1);
    MG.sound.play('stage');
    this_shell.flash('good');
    this_shell.toast(`✔ ${st.name} approved! ${ev.bonus.ok ? 'Bonus objective met! ' : ''}${S.stageIdx + 1 < STAGES.length ? 'New decorations unlocked.' : ''}`, 'good', 3000);
    if (S.stageIdx + 1 >= STAGES.length) return finish(true, 'City complete!', 'All 10 districts passed inspection.');
    S.stageFails = 0;
    setupStage(S.stageIdx + 1);
  }

  /* ---------------- Rendering: panels ---------------- */
  function buildToolbar() {
    const st = STAGES[S.stageIdx];
    dom.tools.innerHTML = '';
    const tools = [['select', 'Select / move', '#ffffff', '↖', 'V'], ...st.tools.map((t) => [t, TYPES[t].name, TYPES[t].color, TYPES[t].icon, TYPES[t].key]), ['bulldoze', 'Bulldoze', '#ffd1d1', '✕', 'X']];
    for (const [id, name, color, icon, key] of tools) {
      const b = el('button', { type: 'button', class: 'tool', 'aria-pressed': String(S.tool === id), 'data-tool': id, title: id in TYPES ? TYPES[id].desc : name });
      b.innerHTML = `<span class="tool__sw" style="background:${color}">${icon}</span>${name}<span class="tool__key">${key}</span>`;
      b.addEventListener('click', () => setTool(id));
      dom.tools.append(b);
    }
    dom.decor.innerHTML = '';
    for (const d of DECOR) {
      const locked = d.unlock > S.unlocked;
      const b = el('button', { type: 'button', class: 'decor__btn', 'aria-pressed': String(S.tool === 'decor' && S.decorId === d.id), disabled: locked, title: locked ? `${d.name} — unlocks after district ${d.unlock}` : `${d.name} ($${DECOR_COST}, +${DECOR_POINTS} beauty)`, 'aria-label': locked ? `${d.name}, locked` : d.name }, d.icon);
      b.addEventListener('click', () => { S.decorId = d.id; setTool('decor'); });
      dom.decor.append(b);
    }
  }
  function setTool(id) {
    if (!S) return;
    S.tool = id;
    if (id !== 'decor') S.decorId = S.decorId || null;
    dom.tools.querySelectorAll('.tool').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === id)));
    dom.decor.querySelectorAll('.decor__btn').forEach((b, i) => b.setAttribute('aria-pressed', String(id === 'decor' && DECOR[i].id === S.decorId)));
    canvas.style.cursor = id === 'select' ? 'pointer' : id === 'bulldoze' ? 'not-allowed' : 'crosshair';
    MG.sound.play('click');
  }

  function renderBrief() {
    const st = STAGES[S.stageIdx];
    dom.briefName.textContent = `District ${S.stageIdx + 1}: ${st.name} · plot ${st.cols} m × ${st.rows} m`;
    const live = null;
    const shown = live || S.lastCheck;
    dom.reqs.innerHTML = '';
    st.reqs.forEach((r, i) => {
      const c = shown && shown.res[i];
      const li = el('li', { class: c ? (c.ok ? 'is-ok' : 'is-bad') : '' });
      li.innerHTML = r.text + (c ? `<span class="detail">${c.detail}</span>` : '');
      dom.reqs.append(li);
    });
    const cost = totalCost();
    const b = el('li', { class: 'is-bonus' + (shown ? (shown.bonus.ok ? ' is-ok' : '') : '') });
    b.innerHTML = st.bonus.text + (shown ? `<span class="detail">${shown.bonus.detail}</span>` : '');
    dom.reqs.append(b);
    const budgetLi = el('li', { class: cost <= st.budget ? (cost ? 'is-ok' : '') : 'is-bad' });
    budgetLi.innerHTML = `Stay within the budget of <strong>${fmt$(st.budget)}</strong>`;
    dom.reqs.append(budgetLi);
    dom.cost.textContent = `${fmt$(cost)} of ${fmt$(st.budget)}`;
    const f = cost / st.budget;
    dom.costBar.style.width = clamp(f, 0, 1) * 100 + '%';
    dom.costBar.className = f > 1 ? 'is-over' : f > 0.85 ? 'is-warn' : '';
    const ok = shown ? shown.res.filter((r) => r.ok).length : 0;
    this_shell.setProgress(shown ? ok / st.reqs.length : 0, shown ? `Requirements ${ok}/${st.reqs.length}${live ? '' : ' (last check)'}` : 'Approve to check requirements');
  }

  function renderInspector() {
    const s = S && S.selected;
    if (!s || !S.items.includes(s)) {
      dom.insp.innerHTML = '<p class="insp__empty">Drag on the grid to build. Tap <strong>Select</strong> to edit a building here.</p>';
      return;
    }
    const rows = [];
    const t = TYPES[s.type];
    rows.push(['Dimensions',s.w+' × '+s.h+' m']);
    if(s.depth)rows.push(['Depth',s.depth+' m']);
    if(s.height)rows.push(['Height',s.height+' m']);
    rows.push(['Position', `(${s.x}, ${s.y})`], ['Cost', fmt$(G.cost(s))]);
    dom.insp.innerHTML = `<h3 style="margin:0 0 6px">${t.icon} ${t.name}</h3><table>${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>`;
    const ctl = (label, val, dec, inc) => {
      const wrap = el('div', { class: 'insp__ctl' });
      const m = el('button', { class: 'mg-btn', type: 'button', 'aria-label': `Decrease ${label}` }, '−');
      const p = el('button', { class: 'mg-btn', type: 'button', 'aria-label': `Increase ${label}` }, '+');
      m.addEventListener('click', dec); p.addEventListener('click', inc);
      wrap.append(m, el('span', {}, `${label}: ${val}`), p);
      dom.insp.append(wrap);
    };
    ctl('length', `${s.w} m`, () => modify((c) => { c.w--; }), () => modify((c) => { c.w++; }));
    ctl('width', `${s.h} m`, () => modify((c) => { c.h--; }), () => modify((c) => { c.h++; }));
    if (s.type === 'pool') ctl('depth', `${s.depth} m`, () => modify((c) => { c.depth = clamp(c.depth - 1, 1, 3); }), () => modify((c) => { c.depth = clamp(c.depth + 1, 1, 3); }));
    if (s.type === 'civic') ctl('height', `${s.height} m`, () => modify((c) => { c.height = clamp(c.height - 1, 1, 6); }), () => modify((c) => { c.height = clamp(c.height + 1, 1, 6); }));
    const row = el('div', { class: 'insp__row' });
    const rot = el('button', { class: 'mg-btn', type: 'button' }, '⟳ Rotate (R)');
    rot.addEventListener('click', () => modify((c) => { [c.w, c.h] = [c.h, c.w]; if (c.type === 'garden') c.orient = (c.orient + 1) % 4; }));
    const del = el('button', { class: 'mg-btn mg-btn--danger', type: 'button' }, '🗑 Remove');
    del.addEventListener('click', () => removeItem(s));
    row.append(rot, del);
    dom.insp.append(row);
  }

  /* ---------------- Rendering: canvas ---------------- */
  function resize() {
    if (!S) return;
    const f = MG.fitCanvas(canvas);
    const st = STAGES[S.stageIdx];
    const pad = 34;
    const cell = Math.max(12, Math.floor(Math.min((f.w - pad - 10) / st.cols, (f.h - pad - 10) / st.rows)));
    view = { cell, ox: Math.floor((f.w - cell * st.cols) / 2 + pad / 2), oy: Math.floor((f.h - cell * st.rows) / 2 + pad / 2), w: f.w, h: f.h, ctx: f.ctx };
  }

  function draw() {
    const { ctx, cell: c, ox, oy } = view;
    if (!ctx) return;
    const st = STAGES[S.stageIdx];
    ctx.clearRect(0, 0, view.w, view.h);
    // Plot
    ctx.fillStyle = '#1a5fb8'; ctx.fillRect(ox, oy, st.cols * c, st.rows * c);
    // Blocked cells
    for (const k of S.blocked) {
      const [x, y] = k.split(',').map(Number);
      const bx = ox + x * c, by = oy + y * c;
      if (st.blockKind === 'lake') {
        ctx.fillStyle = 'rgba(110, 205, 255, .55)'; ctx.fillRect(bx, by, c, c);
        ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1.2; ctx.beginPath();
        for (const fy of [0.35, 0.7]) { ctx.moveTo(bx + c * 0.15, by + c * fy); ctx.quadraticCurveTo(bx + c * 0.32, by + c * (fy - 0.12), bx + c * 0.5, by + c * fy); ctx.quadraticCurveTo(bx + c * 0.68, by + c * (fy + 0.12), bx + c * 0.85, by + c * fy); }
        ctx.stroke();
      } else if (st.blockKind === 'rock') {
        ctx.fillStyle = '#8d97a6'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath();
        ctx.moveTo(bx + c * 0.2, by + c * 0.8); ctx.lineTo(bx + c * 0.3, by + c * 0.3); ctx.lineTo(bx + c * 0.6, by + c * 0.18); ctx.lineTo(bx + c * 0.85, by + c * 0.55); ctx.lineTo(bx + c * 0.7, by + c * 0.85); ctx.closePath(); ctx.fill(); ctx.stroke();
      } else {
        ctx.fillStyle = '#2f9e4a'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; ctx.arc(bx + c / 2 + Math.cos(a) * c * 0.2, by + c / 2 + Math.sin(a) * c * 0.2, c * 0.2, 0, 7); } ctx.fill();
        ctx.beginPath(); ctx.arc(bx + c / 2, by + c / 2, c * 0.4, 0, 7); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(bx + c / 2, by + c / 2, 2, 0, 7); ctx.fill();
      }
    }
    // Grid lines
    ctx.lineWidth = 1;
    for (let x = 0; x <= st.cols; x++) { ctx.strokeStyle = x % 5 ? 'rgba(255,255,255,.2)' : 'rgba(255,255,255,.45)'; ctx.beginPath(); ctx.moveTo(ox + x * c + 0.5, oy); ctx.lineTo(ox + x * c + 0.5, oy + st.rows * c); ctx.stroke(); }
    for (let y = 0; y <= st.rows; y++) { ctx.strokeStyle = y % 5 ? 'rgba(255,255,255,.2)' : 'rgba(255,255,255,.45)'; ctx.beginPath(); ctx.moveTo(ox, oy + y * c + 0.5); ctx.lineTo(ox + st.cols * c, oy + y * c + 0.5); ctx.stroke(); }
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.strokeRect(ox - 1.5, oy - 1.5, st.cols * c + 3, st.rows * c + 3);
    ctx.strokeStyle = '#ffcc00'; ctx.lineWidth = 2; ctx.setLineDash([10, 6]); ctx.strokeRect(ox - 6, oy - 6, st.cols * c + 12, st.rows * c + 12); ctx.setLineDash([]);
    // Axis labels (metres)
    ctx.fillStyle = '#e8f1ff'; ctx.font = `${Math.max(11, c * 0.42)}px "Architects Daughter", cursive`; ctx.textAlign = 'center';
    for (let x = 0; x <= st.cols; x += 2) ctx.fillText(x, ox + x * c, oy - 10);
    ctx.textAlign = 'right';
    for (let y = 0; y <= st.rows; y += 2) ctx.fillText(y, ox - 10, oy + y * c + 4);
    ctx.textAlign = 'left'; ctx.fillText('scale: 1 square = 1 m', ox, oy + st.rows * c + 22);

    for (const s of S.items) drawItem(s, false);
    if (S.drag) drawItem(S.drag.ghost, true, !!invalidReason(S.drag.ghost, S.drag.item));
    if (S.selected) {
      const s = S.selected, a = 0.6 + Math.sin(performance.now() / 180) * 0.4;
      ctx.strokeStyle = `rgba(255,179,0,${a})`; ctx.lineWidth = 4;
      ctx.strokeRect(ox + s.x * c - 2, oy + s.y * c - 2, s.w * c + 4, s.h * c + 4);
    }
    // Hover highlight
    if (S.hover && !S.drag && S.tool !== 'select' && S.tool !== 'bulldoze') {
      const h = S.hover;
      if (h.x >= 0 && h.y >= 0 && h.x < st.cols && h.y < st.rows) { ctx.fillStyle = 'rgba(255,204,0,.4)'; ctx.fillRect(ox + h.x * c, oy + h.y * c, c, c); }
    }
  }

  function drawItem(s, ghost, bad) {
    const { ctx, cell: c, ox, oy } = view;
    const x = ox + s.x * c, y = oy + s.y * c, w = s.w * c, h = s.h * c;
    ctx.save();
    if (ghost) ctx.globalAlpha = 0.6;
    if (s.type === 'decor') {
      ctx.font = `${c * 0.8}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText((DECOR.find((d) => d.id === s.decor) || DECOR[0]).icon, x + c / 2, y + c / 2 + 1);
      ctx.restore(); return;
    }
    const col = bad ? '#e53935' : TYPES[s.type].color;
    if (s.type === 'garden') {
      // Right angle at a chosen corner (orient 0-3)
      const pts = [[x, y + h], [x + w, y + h], [x, y], [x + w, y]];
      const right = [[0, 1, 2], [1, 0, 3], [3, 2, 1], [2, 3, 0]][s.orient || 0];
      ctx.fillStyle = col; ctx.beginPath(); right.forEach((i, k) => (k ? ctx.lineTo(...pts[i]) : ctx.moveTo(...pts[i]))); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      const [rx, ry] = pts[right[0]];
      const sx = rx === x ? 1 : -1, sy = ry === y ? 1 : -1, q = Math.min(12, c * 0.4);
      ctx.strokeRect(Math.min(rx, rx + sx * q), Math.min(ry, ry + sy * q), q, q);
    } else {
      ctx.fillStyle = col; ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
      if (s.type === 'road') {
        ctx.strokeStyle = '#f5f5f5'; ctx.setLineDash([c * 0.3, c * 0.25]); ctx.lineWidth = 2; ctx.beginPath();
        if (s.w >= s.h) { ctx.moveTo(x + 4, y + h / 2); ctx.lineTo(x + w - 4, y + h / 2); } else { ctx.moveTo(x + w / 2, y + 4); ctx.lineTo(x + w / 2, y + h - 4); }
        ctx.stroke(); ctx.setLineDash([]);
      } else if (s.type === 'house') {
        ctx.strokeStyle = 'rgba(120,40,0,.45)'; ctx.lineWidth = 2;
        for (let i = c / 2; i < w + h; i += c / 2) { ctx.beginPath(); ctx.moveTo(x + Math.max(0, i - h), y + Math.min(h, i)); ctx.lineTo(x + Math.min(w, i), y + Math.max(0, i - w)); ctx.stroke(); }
      } else if (s.type === 'park') {
        ctx.fillStyle = '#2f8f3a';
        for (let i = 0; i < s.w; i++) for (let j = 0; j < s.h; j++) if ((i + j) % 2 === 0) { ctx.beginPath(); ctx.arc(x + (i + 0.5) * c, y + (j + 0.5) * c, c * 0.18, 0, 7); ctx.fill(); }
        ctx.strokeStyle = '#7a5a2a'; ctx.lineWidth = 3; ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
      } else if (s.type === 'pool') {
        ctx.fillStyle = `rgba(0,60,140,${0.15 * s.depth})`; ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
      } else if (s.type === 'civic') {
        ctx.fillStyle = 'rgba(255,255,255,.35)';
        for (let i = x + 6; i < x + w - 4; i += Math.max(8, c * 0.5)) ctx.fillRect(i, y + 6, 3, h - 12);
      }
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    }
    // Dimension label
    if (w > 34 && h > 18) {
      ctx.fillStyle = '#fff'; ctx.strokeStyle = 'rgba(11,53,111,.85)'; ctx.lineWidth = 4;
      ctx.font = `700 ${clamp(c * 0.48, 11, 18)}px "Barlow Semi Condensed", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      let label = `${s.w}×${s.h}`;
      if (s.type === 'pool') label += `×${s.depth}`;
      if (s.type === 'civic') label += ` h${s.height}`;
      ctx.strokeText(label, x + w / 2, y + h / 2); ctx.fillText(label, x + w / 2, y + h / 2);
    }
    ctx.restore();
  }

  /* ---------------- End of run ---------------- */
  function finish(won, title, reason) {
    const avgUse = S.budgetUse.length ? S.budgetUse.reduce((a, b) => a + b, 0) / S.budgetUse.length : 0;
    let stars;
    if (won) stars = S.failedApprovals <= 1 && avgUse <= 0.8 ? 3 : S.failedApprovals <= 3 ? 2 : 1;
    else stars = S.stagesDone >= 2 ? 2 : S.stagesDone >= 1 ? 1 : 0;
    this_shell.end({
      won, title, reason, stars,
      stats: [
        ['Districts approved', `${S.stagesDone} / ${STAGES.length}`],
        ['Approval attempts', S.approvals],
        ['Rejected plans', S.failedApprovals],
        ['Permits left', `${Math.max(0, S.permits)} / ${S.maxPermits}`],
        ['Average budget used', S.budgetUse.length ? `${Math.round(avgUse * 100)}%` : '—'],
        ['Bonus objectives', `${S.bonuses} / ${STAGES.length}`],
        ['Scoring decorations', S.decorPlaced],
        ['Play time', MG.fmtTime(this_shell.playTime)]
      ],
      math: [
        'Rectangle: area = length × width, perimeter = 2(length + width). Different rectangles can share an area (4×6 and 3×8 both make 24 m²) but have different perimeters.',
        'Pool volume = length × width × depth: 36 m³ could be 6×3×2, 4×3×3 or 6×6×1.',
        'Cuboid surface area = 2(lw + lh + wh). With the same volume (60 m³), a more cube-like shape (5×4×3, SA = 94 m²) needs less cladding than a flat one (10×3×2, SA = 112 m²).',
        'Pythagoras: a right-angled garden with legs 3 m and 4 m has hypotenuse √(9 + 16) = 5 m; its angles are 36.9° and 53.1° (tan θ = opposite ÷ adjacent).',
        `Your average budget use was ${S.budgetUse.length ? Math.round(avgUse * 100) + '%' : 'not recorded'} — efficient layouts score a savings bonus.`
      ]
    });
  }

  /* ---------------- Shell ---------------- */
  const this_shell = MG.createShell({
    id: 'geometry-city',
    title: 'Geometry City',
    tagline: 'You are the city architect. Draw buildings that fit the brief to the exact square metre.',
    goal: 'Get all 10 districts approved by the council before the deadline.',
    steps: [
      ['📐', 'Pick a tool and drag on the grid to build.'],
      ['📋', 'Match the brief: area, perimeter, volume…'],
      ['✅', 'Stay in budget, then stamp Approve!']
    ],
    keys: [
      ['<kbd>1</kbd>–<kbd>6</kbd>', 'Pick a tool'],
      ['<kbd>V</kbd>', 'Select'],
      ['<kbd>←</kbd><kbd>→</kbd>', 'Move it'],
      ['<kbd>Shift</kbd>+<kbd>→</kbd>', 'Resize'],
      ['<kbd>R</kbd>', 'Rotate'],
      ['<kbd>Enter</kbd>', 'Approve']
    ],
    genre: 'Building & construction simulator',
    topic: 'Area, perimeter, volume, surface area, angles',
    premise: 'The city council has hired you as chief architect. Each district comes with a planning brief, a budget and a tricky plot of land.',
    objective: 'Design layouts that meet every requirement in the brief, stay within budget, and get them approved before the deadline.',
    livesLabel: 'Permits',
    stageLabel: 'Round',
    art: `<svg viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice"><rect width="400" height="500" fill="#1655a8"/><line x1="0" y1="0" x2="0" y2="500" stroke="#fff" stroke-opacity="0.2"/><line x1="20" y1="0" x2="20" y2="500" stroke="#fff" stroke-opacity="0.08"/><line x1="40" y1="0" x2="40" y2="500" stroke="#fff" stroke-opacity="0.08"/><line x1="60" y1="0" x2="60" y2="500" stroke="#fff" stroke-opacity="0.08"/><line x1="80" y1="0" x2="80" y2="500" stroke="#fff" stroke-opacity="0.08"/><line x1="100" y1="0" x2="100" y2="500" stroke="#fff" stroke-opacity="0.2"/><line x1="120" y1="0" x2="120" y2="500" stroke="#fff" stroke-opacity="0.08"/><line x1="140" y1="0" x2="140" y2="500" stroke="#fff" stroke-opacity="0.08"/><line x1="160" y1="0" x2="160" y2="500" stroke="#fff" stroke-opacity="0.08"/><line x1="180" y1="0" x2="180" y2="500" stroke="#fff" stroke-opacity="0.08"/><line x1="200" y1="0" x2="200" y2="500" stroke="#fff" stroke-opacity="0.2"/><line x1="220" y1="0" x2="220" y2="500" stroke="#fff" stroke-opacity="0.08"/><line x1="240" y1="0" x2="240" y2="500" stroke="#fff" stroke-opacity="0.08"/><line x1="260" y1="0" x2="260" y2="500" stroke="#fff" stroke-opacity="0.08"/><line x1="280" y1="0" x2="280" y2="500" stroke="#fff" stroke-opacity="0.08"/><line x1="300" y1="0" x2="300" y2="500" stroke="#fff" stroke-opacity="0.2"/><line x1="320" y1="0" x2="320" y2="500" stroke="#fff" stroke-opacity="0.08"/><line x1="340" y1="0" x2="340" y2="500" stroke="#fff" stroke-opacity="0.08"/><line x1="360" y1="0" x2="360" y2="500" stroke="#fff" stroke-opacity="0.08"/><line x1="380" y1="0" x2="380" y2="500" stroke="#fff" stroke-opacity="0.08"/><line x1="400" y1="0" x2="400" y2="500" stroke="#fff" stroke-opacity="0.2"/><line x1="0" y1="0" x2="400" y2="0" stroke="#fff" stroke-opacity="0.2"/><line x1="0" y1="20" x2="400" y2="20" stroke="#fff" stroke-opacity="0.08"/><line x1="0" y1="40" x2="400" y2="40" stroke="#fff" stroke-opacity="0.08"/><line x1="0" y1="60" x2="400" y2="60" stroke="#fff" stroke-opacity="0.08"/><line x1="0" y1="80" x2="400" y2="80" stroke="#fff" stroke-opacity="0.08"/><line x1="0" y1="100" x2="400" y2="100" stroke="#fff" stroke-opacity="0.2"/><line x1="0" y1="120" x2="400" y2="120" stroke="#fff" stroke-opacity="0.08"/><line x1="0" y1="140" x2="400" y2="140" stroke="#fff" stroke-opacity="0.08"/><line x1="0" y1="160" x2="400" y2="160" stroke="#fff" stroke-opacity="0.08"/><line x1="0" y1="180" x2="400" y2="180" stroke="#fff" stroke-opacity="0.08"/><line x1="0" y1="200" x2="400" y2="200" stroke="#fff" stroke-opacity="0.2"/><line x1="0" y1="220" x2="400" y2="220" stroke="#fff" stroke-opacity="0.08"/><line x1="0" y1="240" x2="400" y2="240" stroke="#fff" stroke-opacity="0.08"/><line x1="0" y1="260" x2="400" y2="260" stroke="#fff" stroke-opacity="0.08"/><line x1="0" y1="280" x2="400" y2="280" stroke="#fff" stroke-opacity="0.08"/><line x1="0" y1="300" x2="400" y2="300" stroke="#fff" stroke-opacity="0.2"/><line x1="0" y1="320" x2="400" y2="320" stroke="#fff" stroke-opacity="0.08"/><line x1="0" y1="340" x2="400" y2="340" stroke="#fff" stroke-opacity="0.08"/><line x1="0" y1="360" x2="400" y2="360" stroke="#fff" stroke-opacity="0.08"/><line x1="0" y1="380" x2="400" y2="380" stroke="#fff" stroke-opacity="0.08"/><line x1="0" y1="400" x2="400" y2="400" stroke="#fff" stroke-opacity="0.2"/><line x1="0" y1="420" x2="400" y2="420" stroke="#fff" stroke-opacity="0.08"/><line x1="0" y1="440" x2="400" y2="440" stroke="#fff" stroke-opacity="0.08"/><line x1="0" y1="460" x2="400" y2="460" stroke="#fff" stroke-opacity="0.08"/><line x1="0" y1="480" x2="400" y2="480" stroke="#fff" stroke-opacity="0.08"/><line x1="0" y1="500" x2="400" y2="500" stroke="#fff" stroke-opacity="0.2"/><g fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round"><path d="M80 380V240L200 160L320 240V380Z"/><path d="M80 240H320"/><rect x="180" y="300" width="40" height="80"/><rect x="105" y="265" width="50" height="40"/><rect x="245" y="265" width="50" height="40"/><path d="M110 265v40M130 265v40M250 265v40M270 265v40" stroke-width="1.5"/></g><g stroke="#ffcc00" stroke-width="2" fill="#ffcc00"><path d="M80 410H320M80 402v16M320 402v16"/><path d="M50 240V380M42 240h16M42 380h16"/></g><text x="200" y="438" text-anchor="middle" font-family="Architects Daughter, cursive" font-size="26" fill="#ffcc00">6 m</text><text x="34" y="318" text-anchor="middle" font-family="Architects Daughter, cursive" font-size="26" fill="#ffcc00" transform="rotate(-90 34 318)">4 m</text><text x="200" y="232" text-anchor="middle" font-family="Architects Daughter, cursive" font-size="22" fill="#fff">A = 24 m²</text><g transform="translate(72 30)" fill="none" stroke="#fff" stroke-width="3"><path d="M0 120V0L90 120Z"/><path d="M0 104h16v16" stroke-width="2"/></g><g font-family="Architects Daughter, cursive" fill="#fff" font-size="20"><text x="54" y="98">4</text><text x="112" y="172">3</text><text x="130" y="94" fill="#ffcc00">5</text></g><g transform="translate(276 100)" fill="none" stroke="#fff" stroke-width="2.5"><path d="M-60 0A60 60 0 0 1 60 0Z"/><path d="M0 0L-36 -48" stroke="#ffcc00"/></g><text x="262" y="88" text-anchor="middle" font-family="Architects Daughter, cursive" font-size="18" fill="#ffcc00">53°</text><g transform="translate(130 452)"><rect width="140" height="40" fill="#0b356f" stroke="#fff" stroke-width="2"/><text x="70" y="27" text-anchor="middle" font-family="Big Shoulders Stencil Display, Impact, sans-serif" font-weight="800" font-size="20" fill="#fff" letter-spacing="2">SHEET 01</text></g></svg>`,
    instructions: {
      objective: 'Get all 10 districts approved. Each district has a brief of requirements, a budget and a time limit.',
      controls: [
        'Pick a tool (or press <kbd>1</kbd>–<kbd>6</kbd>), then <strong>drag on the grid</strong> to draw a rectangle. Each square is 1 m × 1 m.',
        '<strong>Select</strong> (<kbd>V</kbd>): tap a structure to inspect it; drag it to move it. In the Inspector use −/+ to resize, change depth or height, rotate or remove.',
        'Keyboard with a selection: arrow keys move, <kbd>Shift</kbd>+arrows resize, <kbd>R</kbd> rotates, <kbd>Delete</kbd> removes. <kbd>X</kbd> = bulldoze tool.',
        '<strong>Approve Construction</strong> (or <kbd>Enter</kbd>) submits the plan to the council. <kbd>P</kbd>/<kbd>Esc</kbd> pause.'
      ],
      maths: [
        'Live readouts show length, width, area (l × w), perimeter 2(l + w), volume (l × w × depth/height) and surface area 2(lw + lh + wh).',
        'Costs depend on the measurements: parks pay for fencing per metre of perimeter, pools for every cubic metre of water, libraries for every square metre of surface area.',
        'The triangle garden is right-angled: area = ½ab, hypotenuse = √(a² + b²), angles from tan θ = opposite ÷ adjacent.',
        'Structures cannot overlap, leave the plot or cover protected land — the game checks the boundary and every cell.'
      ],
      scoring: [
        'Approval: +100 per requirement, +1 pt per $10 left in the budget, +1 per second left, +150 if approved first time.',
        'Optional bonus objective: +100. Decorations: +10 beauty each (max 6 per district), cost $20.',
        'A rejected plan: −50.'
      ],
      failure: [
        'Every rejected plan costs a planning permit. Lose all permits and the run ends.',
        'The run also ends if a district timer reaches 0:00.'
      ],
      timer: [
        'Each district has a countdown. Pause with ⏸, <kbd>P</kbd> or <kbd>Esc</kbd> — the timer stops and the grid is locked.',
        'Choose dimensions, then calculate their measurements in the construction blueprint. Inspection follows only after the figures are verified.'
      ]
    },
    stars: [
      '1 star: get District 1 approved (or finish the city).',
      '2 stars: finish all 10 districts with no more than 3 rejected plans (a failed run that finished 2 districts also earns 2).',
      '3 stars: finish all 10 districts with at most 1 rejected plan and an average budget use of 80% or less.'
    ],
    onStart(diff) {
      const cfg = DIFF[diff];
      STAGES = freshBriefs();
      S = { cfg, permits: cfg.permits, maxPermits: cfg.permits, nextId: 1, approvals: 0, failedApprovals: 0, stageFails: 0, stagesDone: 0, budgetUse: [], bonuses: 0, decorPlaced: 0, unlocked: 0 };
      this.setLives(S.permits, S.maxPermits, '📜');
      setupStage(0);
    },
    onUpdate() { draw(); },
    onTimeUp() { finish(false, 'Deadline missed', `The council deadline for ${STAGES[S.stageIdx].name} passed before the plans were approved.`); },
    onStop() { if (S) S.drag = null; dom.tip.hidden = true; }
  });

  /* ---------------- Input (bound once) ---------------- */
  dom.approve.addEventListener('click', approve);
  window.addEventListener('resize', resize);
  window.addEventListener('keydown', (e) => {
    if (!this_shell.isPlaying() || MG.isTarget(e, 'input')) return;
    const k = e.key;
    const st = STAGES[S.stageIdx];
    const byKey = st.tools.find((t) => TYPES[t].key === k);
    if (byKey) return setTool(byKey);
    if (k === 'v' || k === 'V') return setTool('select');
    if (k === 'x' || k === 'X') return setTool('bulldoze');
    if (k === 'Enter' && !MG.isTarget(e, 'button')) { e.preventDefault(); return approve(); }
    if (!S.selected) return;
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[k]) {
      e.preventDefault();
      const [dx, dy] = arrows[k];
      if (e.shiftKey) modify((c) => { c.w += dx; c.h += dy; });
      else modify((c) => { c.x += dx; c.y += dy; });
    } else if (k === 'r' || k === 'R') modify((c) => { [c.w, c.h] = [c.h, c.w]; if (c.type === 'garden') c.orient = (c.orient + 1) % 4; });
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); removeItem(S.selected); }
  });

  MG.game = { get state() { return S; }, tryPlace, makeItem, approve, setTool, select, modify, G, invalidReason, get STAGES(){return STAGES;} };
})();
