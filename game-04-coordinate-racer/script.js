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

/* Skyline Stack — choose, drag, drop and connect. No written answers. */
(() => {
  'use strict';
  const DIFF={easy:{brace:false},normal:{brace:false,ratios:true},hard:{brace:true,ratios:true}};
  const colors=['#58cfa9','#ffbe64','#ae9bfa'];
  const fmt=n=>String(MG.round(n,2)).replace('-','−');
  const art="<svg viewBox=\"0 0 400 500\" xmlns=\"http://www.w3.org/2000/svg\"><defs><linearGradient id=\"ss-sky\" x2=\"0\" y2=\"1\"><stop stop-color=\"#a9e4f1\"/><stop offset=\"1\" stop-color=\"#e8f7e7\"/></linearGradient></defs><rect width=\"400\" height=\"500\" fill=\"url(#ss-sky)\"/><circle cx=\"310\" cy=\"88\" r=\"36\" fill=\"#fce7ab\"/><g stroke=\"#a1c8da\" opacity=\".12\"><path d=\"M0 100H400M0 200H400M0 300H400M0 400H400M100 0V500M200 0V500M300 0V500\"/></g><g fill=\"#b2d5cf\"><path d=\"M0 500V350H65V300H100V500M290 500V310H340V360H400V500\"/></g><g stroke=\"#65919e\" stroke-width=\"5\"><rect x=\"91\" y=\"360\" width=\"218\" height=\"72\" rx=\"5\" fill=\"#57dfce\"/><rect x=\"110\" y=\"288\" width=\"180\" height=\"72\" rx=\"5\" fill=\"#fac76a\"/><rect x=\"126\" y=\"216\" width=\"148\" height=\"72\" rx=\"5\" fill=\"#57dfce\"/><rect x=\"143\" y=\"110\" width=\"114\" height=\"64\" rx=\"5\" fill=\"#a7b5ff\"/></g><g fill=\"#467589\"><path d=\"M110 375h23v35h-23zm42 0h23v35h-23zm42 0h23v35h-23zm42 0h23v35h-23zm42 0h13v35h-13zM128 304h23v34h-23zm43 0h23v34h-23zm43 0h23v34h-23zm43 0h16v34h-16zM145 232h22v34h-22zm44 0h22v34h-22zm44 0h22v34h-22zM160 127h22v30h-22zm40 0h22v30h-22z\"/></g><g stroke=\"#fac76a\" fill=\"none\" stroke-width=\"5\"><path d=\"M336 430V42H48M315 430V42L336 66L315 90L336 114L315 138L336 162L315 186L336 210L315 234L336 258L315 282L336 306L315 330L336 354L315 378L336 402M48 42L120 14L200 42L280 14L336 42\"/><path d=\"M176 42V96M224 42V96\" stroke=\"#fff9e6\" stroke-width=\"2\"/></g><path d=\"M91 450H310\" stroke=\"#fac76a\" stroke-width=\"6\"/><text x=\"200\" y=\"482\" text-anchor=\"middle\" fill=\"#fff9e6\" font-family=\"Inter,sans-serif\" font-size=\"15\" letter-spacing=\"5\">BUILD SOMETHING HIGHER</text></svg>";
  function shuffle(items){return MG.shuffle([...items]);}
  function createRun(){
    const foundation={x:MG.randInt(0,3),y:-1,w:28,h:1};
    const heights=[...Array.from({length:6},()=>MG.pick([3,4])),4,4,4,8];
    const stages=[];let p=foundation;
    for(let i=0;i<10;i++){
      const h=heights[i],y=p.y+p.h;
      let w=p.w,x=p.x,rule,brief,hint;
      if(i===0){w=24;rule='left';brief='Pick a 24 m block. Line up its LEFT edge with the platform!';hint='Match the two left edges. The block is a little shorter than the platform.';}
      if(i===1){w=20;x=p.x+p.w-w;rule='right';brief='Pick a 20 m block. This time, line up the RIGHT edges!';hint='The right edge is left + width. Slide your block until both right edges meet.';}
      if(i===2){w=16;x=p.x+(p.w-w)/2;rule='centre';brief='A 16 m block goes in the MIDDLE. Leave equal space on both sides!';hint='Find the spare width, then share it equally between the left and right sides.';}
      if(i===3){w=p.w*3/4;x=p.x+(p.w-w)/2;rule='ratio';brief='Build a sky garden! Use 3/4 of the floor below and put it in the middle.';hint='Split the width below into four equal parts. Your new block needs three of them.';}
      if(i===4){w=p.w-2;x=p.x+1;rule='setback';brief='Make two tiny balconies: leave 1 m of space at EACH end.';hint='Two balconies use 2 m altogether. The new block is 2 m shorter than the floor below.';}
      if(i===5){w=p.w*.8;x=p.x+(p.w-w)/2;rule='percent';brief='Time for a rooftop café! Use 80% of the width below. Keep it centred.';hint='80% means 8 out of 10 equal parts. The floor below is 10 m wide.';}
      if(i===6){rule='brace';brief='Keep the same width and left edge. Then help Pip fit a diagonal beam!';hint='Use the same block width and match its left edge to the floor below.';}
      if(i===7){w=p.w-2;x=p.x+1;rule='line';brief='Pick a 6 m block. Its top-right corner must touch the purple guide!';hint='Follow the purple guide to the top of your new floor. That is where its right corner belongs.';}
      if(i===8){rule='negative';brief='Keep this floor centred and the same width. Our next beam leans LEFT!';hint='Both floors have the same width, so line up their edges.';}
      if(i===9){rule='roof';brief='One last floor! Match the width and edges below, then connect the big roof beam.';hint='Choose the same width as the floor below and line up both edges.';}
      const floor={x,y,w,h};
      const stage={i,name:['Hello, builder!','To the right!','Find the middle','Sky garden','Balcony buddies','Rooftop café','Beam team','Follow the guide','Lean to the left','Top of the world!'][i],floor,support:{...p},rule,brief,hint,
        fields:[{key:'x'},{key:'w'}],answer:{x,w},widths:shuffle([w-2,w,w+2]),topic:i<3?'Spatial alignment':i<6?'Fractions & proportions':'Construction geometry'};
      if(i>=6){
        const dx=i===8?-3:i===9?6:3;
        const a={x:x+(i===8?w-1:i===9?0:1),y},b={x:x+(i===8?w-1:i===9?0:1)+dx,y:y+h};
        const mode=i===6||i===8?'slope':'length';
        const options=mode==='slope'?[{run:dx,rise:h},{run:-dx,rise:h},{run:dx,rise:2}]:[4,5,6].map(length=>({length}));
        if(i===9)options.splice(0,3,...[8,10,12].map(length=>({length})));
        stage.brace={a,b,slope:h/dx,length:Math.hypot(dx,h),mode,options:shuffle(options),sockets:i===9?[{x:x+2,y:y+h},{x:x+4,y:y+h},b]:[b]};
        stage.brace.brief=mode==='slope'?`Connect A to B: ${Math.abs(dx)} across ${dx<0?'LEFT':'RIGHT'}, ${h} up. Pick the matching beam!`:i===9?'The roof beam goes 6 across and 8 up. Pick its length, then choose the right roof socket!':'A is 3 across and 4 below B. Which beam reaches both?';
        stage.brace.hint=mode==='slope'?'Compare each beam’s across and up steps. Check which way it leans.':i===9?'6² + 8² = 100. A beam of √100 = 10 m reaches the socket 6 m to the right of A.':'3² + 4² = 25. A beam of √25 = 5 m connects the anchors.';
        if(i===7)stage.guide={m:2,b:y+h-2*(x+w)};
      }
      stages.push(stage);p=floor;
    }
    return{foundation,stages};
  }
  let run=createRun(),STAGES=run.stages,S=null,ctx,drag=null;
  const view={w:0,h:0,scale:18,bottom:-2,minX:0,dpr:1};
  const $=id=>document.getElementById(id);
  const dom={canvas:$('site'),title:$('floorTitle'),brief:$('brief'),facts:$('supportFacts'),tray:$('pieceTray'),trayTitle:$('trayTitle'),feedback:$('buildFeedback'),hint:$('guidanceText'),help:$('guidanceBtn'),drop:$('buildBtn'),next:$('nextBtn'),height:$('towerHeight'),progress:$('floorDots'),overview:$('overviewBtn'),swatches:$('facadeOptions'),status:$('siteStatus'),kicker:$('floorKicker'),position:$('cranePosition'),controls:$('craneControls'),sockets:$('socketChoices')};
  const entryKey=()=>`${S.phase==='brace'?'brace':'floor'}:${S.stageIdx}`;
  function setupStage(i){
    drag=null;S.stageIdx=i;S.cfg=MG.roundConfig(DIFF,i);S.stage=STAGES[i];S.phase='plan';S.elapsed=0;S.fullView=false;S.trial=null;S.plan={x:S.stage.support.x+3,w:null,beam:null,socket:null};
    shell.setStage(`${i+1} / 10`);shell.setResource(`${S.height} m`);shell.setProgress(S.completed/10);shell.stopTimer();shell.setTimerText('Take your time');
    dom.overview.setAttribute('aria-pressed','false');renderPlay();resize();draw();
  }
  function renderPlay(){
    const st=S.stage,brace=S.phase==='brace';
    dom.kicker.textContent=`Floor ${S.stageIdx+1} of 10`;dom.title.textContent=brace?'Let’s connect!':st.name;dom.brief.textContent=brace?st.brace.brief:st.brief;
    dom.facts.replaceChildren();
    const chip=text=>dom.facts.append(MG.el('span',{},text));
    if(brace){chip(`↔ ${Math.abs(st.brace.b.x-st.brace.a.x)} m across`);chip(`↟ ${st.floor.h} m up`);}
    else{chip(`Below: ${st.support.w} m wide`);chip(`Left edge: ${st.support.x} m`);if(st.guide)chip(`Guide: y = 2x ${st.guide.b<0?'−':'+'} ${Math.abs(st.guide.b)}`);}
    dom.trayTitle.textContent=brace?'Pick your beam':'Pick your block';dom.tray.replaceChildren();
    if(brace){
      st.brace.options.forEach((piece,index)=>{
        const title=st.brace.mode==='slope'?`${piece.rise} up · ${Math.abs(piece.run)} ${piece.run<0?'left':'right'}`:`${piece.length} m`;
        const b=MG.el('button',{type:'button',class:'piece beam-piece','data-beam':index,'aria-pressed':'false','aria-label':title});
        const factor=piece.length?piece.length/Math.max(...st.brace.options.map(p=>p.length)):1;
        const startX=piece.run<0?54:piece.length?12:26;
        const endX=piece.length?12+50*factor:startX+piece.run*9;
        const endY=piece.length?45-35*factor:45-piece.rise*9;
        b.append(MG.el('span',{class:'piece-picture',html:`<svg viewBox="0 0 80 56" aria-hidden="true"><path d="M${startX} 45H${endX}V${endY}" fill="none" stroke="#b4c8d3" stroke-width="2" stroke-dasharray="3 3"/><path d="M${startX} 45L${endX} ${endY}" stroke="#8067d3" stroke-width="7" stroke-linecap="round"/></svg>`}),MG.el('strong',{},title));
        dom.tray.append(b);
      });
    }else for(const width of st.widths){
      const b=MG.el('button',{type:'button',class:'piece','data-width':width,'aria-pressed':'false','aria-label':`${width} metre block`});
      b.append(MG.el('span',{class:'piece-picture'},MG.el('span',{class:'mini-block',style:`width:${Math.max(24,width/Math.max(...st.widths)*100)}%;--block:${S.color}`},MG.el('i'),MG.el('i'),MG.el('i'))),MG.el('strong',{},`${width} m`));dom.tray.append(b);
    }
    dom.sockets.replaceChildren();dom.sockets.hidden=!brace||st.brace.sockets.length===1;
    if(brace&&st.brace.sockets.length>1){
      dom.sockets.append(MG.el('span',{},'Roof socket:'));
      st.brace.sockets.forEach((socket,index)=>dom.sockets.append(MG.el('button',{type:'button','data-socket':index,'aria-pressed':'false','aria-label':`Socket ${index+1}, x ${socket.x} metres`},`${index+1} · x=${socket.x}`)));
    }
    dom.feedback.textContent=brace?'Pick a beam, then drag from A to a roof socket. You can also use Connect!':'Pick a block, then drag it sideways. Let go to drop!';dom.feedback.className='build-feedback';dom.hint.hidden=true;dom.help.hidden=false;
    dom.controls.hidden=brace;dom.drop.hidden=false;dom.drop.disabled=true;dom.drop.textContent=brace?'Connect!':'Drop block ↓';dom.next.hidden=true;
    dom.status.textContent=brace?'Beam time! Connect the dots.':'Pick • drag • drop';renderProgress();renderSelection();
  }
  function renderProgress(){dom.height.textContent=`${S.height} m`;dom.progress.replaceChildren(...STAGES.map((st,i)=>MG.el('span',{class:`floor-dot${i<S.completed?' is-built':i===S.stageIdx?' is-current':''}`,'aria-label':`Floor ${i+1}: ${i<S.completed?'built':i===S.stageIdx?'current':'waiting'}`},String(i+1))));}
  function renderSelection(){
    dom.tray.querySelectorAll('[data-width]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.width)===S.plan.w)));
    dom.tray.querySelectorAll('[data-beam]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.beam)===S.plan.beam)));
    dom.sockets.querySelectorAll('[data-socket]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.socket)===S.plan.socket)));
    dom.position.textContent=`x = ${S.plan.x} m`;
    dom.drop.disabled=S.phase==='plan'?S.plan.w===null:S.phase==='brace'?S.plan.beam===null||S.plan.socket===null:true;
  }
  function chooseBlock(width){if(!S||!shell.isPlaying()||S.phase!=='plan'||!S.stage.widths.includes(width))return;S.plan.w=width;S.trial=null;dom.feedback.textContent=`${width} m block ready! Drag it sideways, then let go.`;dom.feedback.className='build-feedback';dom.status.textContent='Drag to move • let go to drop';renderSelection();draw();}
  function moveCrane(delta){
    if(!S||!shell.isPlaying()||S.phase!=='plan'||!Number.isFinite(delta))return;
    S.plan.x=MG.clamp(Math.round(S.plan.x+delta),run.foundation.x-4,run.foundation.x+run.foundation.w+2);S.trial=null;renderSelection();draw();
  }
  function chooseBeam(index){if(!S||!shell.isPlaying()||S.phase!=='brace'||!S.stage.brace.options[index])return;S.plan.beam=index;if(S.stage.brace.sockets.length===1)S.plan.socket=0;S.trial=null;dom.feedback.textContent='Beam ready! Drag from A to a roof socket, or press Connect.';dom.feedback.className='build-feedback';renderSelection();draw();}
  function chooseSocket(index){if(!S||!shell.isPlaying()||S.phase!=='brace'||!S.stage.brace.sockets[index])return;S.plan.socket=index;S.trial=null;renderSelection();draw();}
  function validatePlan(stage,values){return Number.isFinite(values.x)&&Number.isFinite(values.w)&&values.x===stage.floor.x&&values.w===stage.floor.w;}
  function validateBrace(stage,index,socketIndex){
    const b=stage.brace,p=b?.options[index],socket=b?.sockets[socketIndex];if(!p||!socket)return false;
    const fits=b.mode==='slope'?p.run===b.b.x-b.a.x&&p.rise===b.b.y-b.a.y:p.length===b.length;
    return fits&&socket.x===b.b.x&&socket.y===b.b.y;
  }
  function record(correct){shell.maths.record(S.stage.topic,entryKey(),correct);S.attempts++;}
  function submitPlan(){
    if(!S||!shell.isPlaying())return;
    if(S.phase==='brace')return connectBeam();
    if(S.phase!=='plan'||S.plan.w===null)return;
    const values={x:S.plan.x,w:S.plan.w},correct=validatePlan(S.stage,values);record(correct);drag=null;
    S.trial={values,correct};S.phase='drop';S.elapsed=0;dom.drop.disabled=true;dom.help.hidden=true;dom.status.textContent='Going down!';MG.sound.play('select');
    dom.feedback.textContent='Here comes your block…';
  }
  function connectBeam(){
    if(!S||!shell.isPlaying()||S.phase!=='brace'||S.plan.beam===null||S.plan.socket===null)return;
    const correct=validateBrace(S.stage,S.plan.beam,S.plan.socket);record(correct);drag=null;S.trial={beam:S.plan.beam,socket:S.plan.socket,correct};
    S.phase='connect';S.elapsed=0;dom.drop.disabled=true;dom.help.hidden=true;dom.feedback.textContent='Click, clack… does it fit?';
  }
  function award(key){const e=shell.maths.entries.get(key);shell.addScore(e.first?100:e.assisted?50:75,e.first?'Super builder!':'Nice building!',shell.hud.score);}
  function landFloor(){
    if(!S.trial.correct){
      S.phase='plan';dom.help.hidden=false;renderSelection();
      dom.feedback.textContent=S.plan.w!==S.stage.floor.w?(S.plan.w>S.stage.floor.w?'Oops, that block is too wide. Try a smaller one!':'A little too small! Try a wider block.'):(S.plan.x>S.stage.floor.x?'Almost! Slide it a little to the left.':'Almost! Slide it a little to the right.');
      dom.feedback.className='build-feedback is-try';dom.status.textContent='Try again — your tower is safe!';MG.sound.play('error');return;
    }
    S.built.push({...S.stage.floor,color:S.color,beam:null});S.height=S.stage.floor.y+S.stage.floor.h;S.phase='settle';S.elapsed=0;
    award(`floor:${S.stageIdx}`);shell.setResource(`${S.height} m`);renderProgress();dom.feedback.textContent='Perfect fit! Look at your tower grow!';dom.feedback.className='build-feedback is-success';MG.sound.play('success');
  }
  function finishConnection(){
    if(!S.trial.correct){S.phase='brace';dom.help.hidden=false;renderSelection();dom.feedback.textContent='Not quite! Check the beam’s steps or length, and which socket it reaches.';dom.feedback.className='build-feedback is-try';MG.sound.play('error');return;}
    S.built.at(-1).beam={piece:S.stage.brace.options[S.plan.beam],...S.stage.brace};award(`brace:${S.stageIdx}`);MG.sound.play('success');ready();
  }
  function ready(){S.phase='ready';S.completed=S.stageIdx+1;shell.setProgress(S.completed/10);renderProgress();dom.drop.hidden=true;dom.next.hidden=false;dom.help.hidden=true;dom.controls.hidden=true;dom.next.textContent=S.completed===10?'We did it! ★':'Next floor! ↑';dom.status.textContent='High five, builder!';dom.feedback.textContent=S.completed===10?'Ten floors! Pip thinks you deserve a big cheer!':'Woohoo! Ready to build a little higher?';dom.feedback.className='build-feedback is-success';}
  function nextFloor(){if(!S||!shell.isPlaying()||S.phase!=='ready')return;if(S.completed===10)return finish(true);setupStage(S.stageIdx+1);}
  function update(dt){
    if(!S)return;S.clock+=dt;S.elapsed+=dt;const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;const duration=reduced ? .08 : .65;
    if(S.phase==='drop'&&S.elapsed>=duration)landFloor();
    if(S.phase==='settle'&&S.elapsed>duration){if(S.stage.brace){S.phase='brace';S.trial=null;renderPlay();}else ready();}
    if(S.phase==='connect'&&S.elapsed>=duration)finishConnection();draw();
  }
  function finish(won){const independent=[...shell.maths.entries.values()].filter(e=>e.first).length;shell.end({won,title:'You built a whole skyline!',reason:`Ten floors and ${S.height} metres of brilliant building. High five!`,stars:independent>=11?3:independent>=7?2:1,stats:[['Floors built',S.completed],['Tower height',`${S.height} m`],['Build attempts',S.attempts]],math:['You matched edges, shared space equally, used fractions and percentages to choose blocks, and fitted beams using rise, run and diagonal length.']});}
  function resize(){
    const r=dom.canvas.getBoundingClientRect(),changed=Math.round(r.width)!==Math.round(view.w)||Math.round(r.height)!==Math.round(view.h);
    view.w=Math.max(1,r.width);view.h=Math.max(1,r.height);view.dpr=Math.min(window.devicePixelRatio||1,2);dom.canvas.width=Math.round(view.w*view.dpr);dom.canvas.height=Math.round(view.h*view.dpr);ctx=dom.canvas.getContext('2d');drag=null;
    if(S){if(changed){S.camScale=undefined;S.camBottom=undefined;}draw();}
  }
  function camera(){
    const targetScale=Math.max(3,Math.min((view.w-58)/38,S.fullView?(view.h-115)/(S.height+9):26));
    const top=S.stage.floor.y+S.stage.floor.h+7,targetBottom=S.fullView?-2:Math.max(-2,top-(view.h-70)/targetScale);
    const blend=window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches?1:.15;
    S.camScale=S.camScale===undefined?targetScale:S.camScale+(targetScale-S.camScale)*blend;S.camBottom=S.camBottom===undefined?targetBottom:S.camBottom+(targetBottom-S.camBottom)*blend;
    view.scale=S.camScale;view.bottom=S.camBottom;view.minX=run.foundation.x-4-29/view.scale;
  }
  const sx=x=>(x-view.minX)*view.scale,sy=y=>view.h-37-(y-view.bottom)*view.scale;
  function screenPoint(x,y){const r=dom.canvas.getBoundingClientRect();if(Math.round(r.width)!==Math.round(view.w)||Math.round(r.height)!==Math.round(view.h))resize();return{x:r.left+sx(x),y:r.top+sy(y)};}
  function line(x1,y1,x2,y2,color,width=1){ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
  function label(text,x,y,color='#41647c',align='left',size=12){ctx.font=`750 ${size}px Inter,sans-serif`;ctx.fillStyle=color;ctx.textAlign=align;ctx.fillText(text,x,y);}
  function rounded(x,y,w,h,r,fill){ctx.fillStyle=fill;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();}
  function drawFloor(f,alpha=1){
    const x=sx(f.x),y=sy(f.y+f.h),w=f.w*view.scale,h=f.h*view.scale;
    ctx.save();ctx.globalAlpha=alpha;rounded(x+3,y+5,w,h,Math.min(8,h/4),'#24466a2b');rounded(x,y,w,h,Math.min(8,h/4),f.color||S.color);rounded(x+3,y+3,w-6,Math.max(2,h*.1),2,'#ffffff55');
    const count=Math.max(2,Math.floor(f.w/2)),gap=w/(count+1);for(let j=1;j<=count;j++)rounded(x+j*gap-3,y+h*.36,Math.max(4,view.scale*.42),h*.4,2,'#22546f');
    // Two friendly windows and a little smile on the hanging block.
    if(f.face&&w>50){const cx=x+w/2,cy=y+h*.5;ctx.fillStyle='#24466b';ctx.beginPath();ctx.arc(cx-9,cy-3,3,0,7);ctx.arc(cx+9,cy-3,3,0,7);ctx.fill();ctx.beginPath();ctx.arc(cx,cy+1,9,.2,Math.PI-.2);ctx.strokeStyle='#24466b';ctx.lineWidth=2;ctx.stroke();}
    if(f.beam)drawBeam(f.beam.a,f.beam.b,f.beam.piece,'#8669cf');ctx.restore();
  }
  function drawBeam(a,b,piece,color){
    let bx=b.x,by=b.y;
    if(piece.run!==undefined){bx=a.x+piece.run;by=a.y+piece.rise;}
    else{const d=Math.hypot(b.x-a.x,b.y-a.y);bx=a.x+(b.x-a.x)*piece.length/d;by=a.y+(b.y-a.y)*piece.length/d;}
    line(sx(a.x),sy(a.y),sx(bx),sy(by),'#ffffffbb',10);line(sx(a.x),sy(a.y),sx(bx),sy(by),color,6);
  }
  function socket(p,text,selected=false){rounded(sx(p.x)-13,sy(p.y)-13,26,26,13,selected?'#ffcc57':'#ffffff');ctx.strokeStyle='#8b6fd3';ctx.lineWidth=3;ctx.stroke();label(text,sx(p.x),sy(p.y)+4,'#7057b4','center',12);}
  function draw(){
    if(!S||!ctx)return;camera();const{w,h,dpr,scale}=view;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    const sky=ctx.createLinearGradient(0,0,0,h);sky.addColorStop(0,'#b5e8f6');sky.addColorStop(1,'#eef9ed');ctx.fillStyle=sky;ctx.fillRect(0,0,w,h);
    ctx.fillStyle='#ffda72';ctx.beginPath();ctx.arc(w*.79,74,30,0,7);ctx.fill();ctx.fillStyle='#bb8c36';ctx.beginPath();ctx.arc(w*.79-8,72,2.5,0,7);ctx.arc(w*.79+8,72,2.5,0,7);ctx.fill();ctx.beginPath();ctx.arc(w*.79,77,8,.2,Math.PI-.2);ctx.strokeStyle='#bb8c36';ctx.lineWidth=2;ctx.stroke();
    for(let i=0;i<4;i++){const cx=(i*239+90)%w,cy=85+i%2*65;rounded(cx,cy,90,18,9,'#ffffff9c');rounded(cx+20,cy-15,44,28,14,'#ffffff9c');}
    for(let i=0;i<12;i++){const bh=40+(i*31)%90,x=i*w/11-25,y=h-bh+view.bottom*scale*.09;rounded(x,y,45,h,6,i%2?'#b9d9cf':'#c2dfdd');}
    const every=scale<11?4:2;
    for(let x=Math.ceil(view.minX/every)*every;x<view.minX+w/scale;x+=every){line(sx(x),110,sx(x),h-25,'#447b9c10');label(String(x),sx(x),h-13,'#60899a','center',10);}
    for(let y=Math.max(0,Math.ceil(view.bottom/2)*2);y<view.bottom+h/scale;y+=2)line(25,sy(y),w,sy(y),'#447b9c0c');
    const f=run.foundation;rounded(sx(f.x-1),sy(0), (f.w+2)*scale,2*scale,6,'#8ac7aa');rounded(sx(f.x),sy(0),f.w*scale,9,4,'#ecac4a');
    for(const [i,built]of S.built.entries()){
      ctx.save();if(i===S.built.length-1&&S.phase==='settle'&&!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches){const squash=Math.sin(S.elapsed*19)*Math.exp(-S.elapsed*7)*.08,cx=sx(built.x+built.w/2),foot=sy(built.y);ctx.translate(cx,foot);ctx.scale(1+squash*.4,1-squash);ctx.translate(-cx,-foot);}drawFloor(built);ctx.restore();
    }
    const st=S.stage,craneX=sx(f.x+f.w+3),craneY=40;
    line(craneX,craneY,craneX,h,'#e6ab43',5);line(craneX+12,craneY,craneX+12,h,'#f1bd58',4);for(let y=craneY;y<h;y+=30)line(craneX,y,craneX+12,y+30,'#d39a36',2);
    rounded(45,craneY-5,Math.max(40,craneX-20),10,4,'#f6c358');line(45,craneY,craneX,14,'#e0ab47',3);line(craneX,14,craneX,craneY,'#e0ab47',3);
    if(['plan','drop'].includes(S.phase)){
      let drop=0;if(S.phase==='drop'){const t=Math.min(1,S.elapsed/.65);drop=1-Math.pow(1-t,3);}
      const width=S.plan.w??8,block={x:S.plan.x,y:st.floor.y+4*(1-drop),w:width,h:st.floor.h,color:S.plan.w===null?'#b2c7d0':S.color,face:true};
      ctx.setLineDash([5,5]);line(sx(st.support.x),sy(st.floor.y),sx(st.support.x+st.support.w),sy(st.floor.y),'#3e9f8d',2);ctx.setLineDash([]);
      if(S.plan.w!==null){drawFloor({...block,y:st.floor.y,face:false},.18);label(`${width} m`,sx(block.x+width/2),sy(block.y+block.h)-10,'#30617b','center');}
      drawFloor(block);const mid=sx(block.x+width/2),top=sy(block.y+block.h);line(mid-12,craneY,mid-12,top,'#71869b',2);line(mid+12,craneY,mid+12,top,'#71869b',2);rounded(mid-18,craneY-8,36,16,5,'#eeb74f');
      if(S.plan.w===null)label('Pick a block below!',mid,sy(block.y)-15,'#3a6680','center');
      if(st.guide){const y1=st.floor.y-1,y2=st.floor.y+st.floor.h+2;ctx.setLineDash([6,5]);line(sx((y1-st.guide.b)/2),sy(y1),sx((y2-st.guide.b)/2),sy(y2),'#9b79d8',3);ctx.setLineDash([]);label('guide',sx(st.floor.x+st.floor.w)+9,sy(st.floor.y+st.floor.h)-4,'#8061b5');}
      label(`x = ${S.plan.x}`,sx(block.x),sy(st.floor.y)-10,'#426a7d');
    }
    if(['brace','connect'].includes(S.phase)){
      const b=st.brace;
      if(S.plan.beam!==null){const p=b.options[S.plan.beam],to=b.sockets[S.plan.socket??0];ctx.save();ctx.globalAlpha=.65;drawBeam(b.a,to,p,S.trial?.correct===false?'#df8d83':'#9478d6');ctx.restore();}
      socket(b.a,'A',drag?.type==='beam');b.sockets.forEach((p,i)=>socket(p,b.sockets.length===1?'B':String(i+1),S.plan.socket===i));
      if(drag?.type==='beam'&&drag.to)line(sx(b.a.x),sy(b.a.y),drag.to.x,drag.to.y,'#9478d6',4);
    }
    if(S.phase==='settle'){const t=Math.min(1,S.elapsed/.65);for(let i=0;i<10;i++){ctx.fillStyle=`rgba(255,197,79,${1-t})`;ctx.beginPath();ctx.arc(sx(st.floor.x+st.floor.w*i/9)+(i%2?1:-1)*t*13,sy(st.floor.y)-t*16,2+t*2,0,7);ctx.fill();}}
    if(S.completed===10){const last=S.built.at(-1),x=sx(last.x+last.w/2),y=sy(S.height);line(x,y,x,y-36,'#4d7393',3);ctx.fillStyle='#f6a753';ctx.beginPath();ctx.moveTo(x,y-36);ctx.lineTo(x+25,y-27);ctx.lineTo(x,y-18);ctx.fill();}
  }
  function nearestSocket(x,y){
    let hit=-1,best=30;
    S.stage.brace.sockets.forEach((p,i)=>{const d=Math.hypot(x-sx(p.x),y-sy(p.y));if(d<best){best=d;hit=i;}});
    return hit;
  }
  function pointerDown(e){
    if(!S||!shell.isPlaying())return;
    const r=dom.canvas.getBoundingClientRect(),local={x:e.clientX-r.left,y:e.clientY-r.top};
    if(S.phase==='plan'&&S.plan.w!==null){const top=sy(S.stage.floor.y+4+S.stage.floor.h),left=sx(S.plan.x);if(local.x<left-20||local.x>left+S.plan.w*view.scale+20||local.y<top-25||local.y>sy(S.stage.floor.y+4)+25)return;drag={type:'block',start:e.clientX,x:S.plan.x,moved:false,id:e.pointerId};}
    else if(S.phase==='brace'){
      if(S.plan.beam===null){dom.feedback.textContent='Pick a beam from the tray first!';return;}
      const b=S.stage.brace,hit=nearestSocket(local.x,local.y);
      if(hit>=0){chooseSocket(hit);connectBeam();return;}
      if(Math.hypot(local.x-sx(b.a.x),local.y-sy(b.a.y))>30)return;drag={type:'beam',id:e.pointerId,to:local};
    }else return;
    dom.canvas.setPointerCapture(e.pointerId);e.preventDefault();
  }
  function pointerMove(e){if(!drag||drag.id!==e.pointerId||!S||!shell.isPlaying())return;const r=dom.canvas.getBoundingClientRect();if(drag.type==='block'){const dx=e.clientX-drag.start;drag.moved ||=Math.abs(dx)>5;S.plan.x=MG.clamp(Math.round(drag.x+dx/view.scale),run.foundation.x-4,run.foundation.x+run.foundation.w+2);S.trial=null;renderSelection();}else drag.to={x:e.clientX-r.left,y:e.clientY-r.top};draw();}
  function pointerUp(e){
    if(!drag||drag.id!==e.pointerId)return;const ended=drag;drag=null;if(!S||!shell.isPlaying())return;
    if(ended.type==='block'){if(ended.moved)submitPlan();}
    else{const r=dom.canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,index=nearestSocket(x,y);if(index>=0){chooseSocket(index);connectBeam();}}
  }
  const shell=MG.createShell({id:'skyline-stack',title:'Skyline Stack',tagline:'Little blocks. Big adventures!',goal:'Help Pip build a ten-floor tower. Pick, drag, drop — and up we go!',
    steps:[['▰','Pick a block that fits Pip’s building challenge.'],['↔','Drag it into place and let go to drop.'],['★','Connect beams and grow your happy tower!']],
    keys:[['<kbd>←</kbd><kbd>→</kbd>','Move your block'],['<kbd>Space</kbd>','Drop / connect'],['<kbd>Tab</kbd>','Choose blocks and beams']],genre:'Playful tower builder',topic:'Shapes, fractions & spatial thinking',premise:'Pip’s little city needs a big new tower. Choose colourful blocks, drive the crane and connect the beams.',objective:'Complete ten floors by matching edges, choosing proportions and connecting diagonal beams.',livesLabel:'Height',stageLabel:'Floor',timerLabel:'Pace',art,
    instructions:{objective:'Help Pip build all ten floors. Every block and beam choice changes your building.',controls:['Tap a block in the tray. Drag the hanging block sideways and release to drop it. You can also use the left/right buttons and Drop.','Use arrow keys to move a chosen block. Space drops it. Buttons work with Tab and Enter.','For beams, pick a piece, then drag from A to B (or a numbered roof socket). You can also choose a socket and press Connect.'],maths:['Match left edges, right edges and equal spaces. The grid and block labels help you compare lengths.','Choose blocks using fractions, balconies and percentages. All placements snap to whole metres.','Beam pieces show across/up steps or lengths. Later connections introduce slope direction and diagonal lengths.','Hints are optional and mark only that building decision as assisted. There are 14 decisions: ten floors and four beams.'],scoring:['100 points for an independently correct first decision, 75 after retries or 50 with a hint.','Stars reward your decisions, never quick fingers.'],failure:['A block or beam that does not fit can be tried again. Your finished tower stays safe.'],timer:['Take your time! Pause freezes the crane and all building animation.']},
    stars:['Build all ten floors.','Finish with at least 7 independently correct first decisions.','Finish with at least 11 independently correct first decisions.'],
    onStart(){run=createRun();STAGES=run.stages;drag=null;S={built:[],completed:0,height:0,attempts:0,clock:0,color:colors[0]};dom.swatches.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.color===S.color)));setupStage(0);},onUpdate(dt){update(dt);},onPause(){drag=null;},onStop(){drag=null;}
  });
  dom.tray.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-width'))chooseBlock(Number(b.dataset.width));if(b.hasAttribute('data-beam'))chooseBeam(Number(b.dataset.beam));});
  dom.sockets.addEventListener('click',e=>{const b=e.target.closest('[data-socket]');if(b)chooseSocket(Number(b.dataset.socket));});
  $('moveLeft').addEventListener('click',()=>moveCrane(-1));$('moveRight').addEventListener('click',()=>moveCrane(1));dom.drop.addEventListener('click',submitPlan);dom.next.addEventListener('click',nextFloor);
  dom.help.addEventListener('click',()=>{if(!S||!shell.isPlaying()||!['plan','brace'].includes(S.phase))return;shell.maths.assist(S.stage.topic,entryKey());dom.hint.textContent=(S.phase==='brace'?S.stage.brace.hint:S.stage.hint)+' Pip helped with this one.';dom.hint.hidden=false;});
  dom.overview.addEventListener('click',()=>{if(!S||!shell.isPlaying())return;S.fullView=!S.fullView;dom.overview.setAttribute('aria-pressed',String(S.fullView));draw();});
  dom.swatches.addEventListener('click',e=>{const b=e.target.closest('[data-color]');if(!b||!S||!shell.isPlaying()||S.phase!=='plan')return;S.color=b.dataset.color;dom.swatches.querySelectorAll('button').forEach(btn=>btn.setAttribute('aria-pressed',String(btn===b)));renderPlay();});
  dom.canvas.addEventListener('pointerdown',pointerDown);dom.canvas.addEventListener('pointermove',pointerMove);dom.canvas.addEventListener('pointerup',pointerUp);dom.canvas.addEventListener('pointercancel',()=>{drag=null;});dom.canvas.addEventListener('lostpointercapture',()=>{drag=null;});
  window.addEventListener('keydown',e=>{if(!S||!shell.isPlaying()||MG.isTarget(e,'input,textarea,select'))return;if(['ArrowLeft','ArrowRight'].includes(e.key)&&S.phase==='plan'){e.preventDefault();moveCrane(e.key==='ArrowLeft'?-1:1);}else if(e.code==='Space'&&!MG.isTarget(e,'button,a')){e.preventDefault();submitPlan();}});
  window.addEventListener('resize',resize);
  // HUD wrapping and mobile layout can resize the play area without a window resize.
  // Keep the bitmap, camera and pointer targets aligned with its actual CSS size.
  if(window.ResizeObserver)new window.ResizeObserver(resize).observe(dom.canvas);
  MG.game={get state(){return S;},get STAGES(){return STAGES;},createRun,validatePlan,validateBrace,chooseBlock,moveCrane,chooseBeam,chooseSocket,submitPlan,nextFloor,screenPoint,art};
})();
