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
   Probability Carnival — probability, relative frequency, expected value.
   The player designs three attractions (prize wheel, bag draw, plinko).
   Every design has exact theoretical probabilities; every run is a real
   random experiment. The operator earns the ticket price and pays out
   prizes, so expected profit per play = price − E[payout]. Visitors are
   happier with a higher chance of winning and better value, so the player
   must balance risk, reward and satisfaction.
   ========================================================================== */
(() => {
  'use strict';
  const { el, clamp, round, gcd } = MG;

  /* ---------------- Configuration ---------------- */
  const WHEEL_SECTORS = 12;
  const PLINKO_ROWS = 6;
  const PLINKO_PRIZES = [24, 6, 4, 2, 2, 0, 0];   // the prize cards the player arranges
  const TEST_COST = 2;
  const TEST_PLAYS = 10;
  const ANIMATED_PLAYS = 3;                       // the rest of a wave is simulated instantly

  const NIGHTS=Array.from({length:10},(_,i)=>{
    const booth=i<3?'wheel':i<6?'bag':i%2===0?'plinko':'bag';
    const pair=booth==='bag'&&i!==3;
    return {name:['Opening Fair','Prize Parade','Wheel Showcase','Lucky Dip','Double Draw','Pair Challenge','Ball-Drop Debut','Gold-Pair Gala','Binomial Festival','Final Fair'][i],booths:[booth],required:booth,
      waves:4,target:12+i*2,sat:i<3?45:i<6?50:55,base:14+i,bagMode:pair?'pair':'single',price:booth==='plinko'?4+(i-6)*.25:booth==='bag'?(pair?3:2)+(i-3)*.25:3+i*.25};
  });

  const DIFF = {
    easy:   { time: 200 },
    normal: { time: 160 },
    hard:   { time: 130 }
  };
  const BOOTH_NAMES = { wheel: '🎡 Prize Wheel', bag: '👜 Lucky Bag', plinko: '🔻 Ball Drop' };

  /* ---------------- Probability models ---------------- */
  const frac = (n, d) => { if (!d) return '—'; const g = gcd(n, d) || 1; return n === 0 ? '0' : `${n / g}/${d / g}`; };
  const choose = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };

  /** Each model lists outcomes with exact probability (num/den) and payout. */
  const MODELS = {
    wheel: {
      price: 3,
      outcomes(d) {
        const blank = WHEEL_SECTORS - d.J - d.P - d.S;
        return [
          { id: 'J', label: 'Jackpot', color: '#f2b705', pay: 15, num: d.J, den: WHEEL_SECTORS },
          { id: 'P', label: 'Prize', color: '#c8102e', pay: 4, num: d.P, den: WHEEL_SECTORS },
          { id: 'S', label: 'Small prize', color: '#1b998b', pay: 2, num: d.S, den: WHEEL_SECTORS },
          { id: 'B', label: 'Blank', color: '#cdbf9f', pay: 0, num: blank, den: WHEEL_SECTORS }
        ];
      }
    },
    bag: {
      price: 2,
      outcomes(d, mode) {
        const n = d.g + d.s + d.r;
        if (mode === 'pair') {
          // Two draws WITHOUT replacement: P(both gold) = g/n × (g−1)/(n−1)
          const den = n * (n - 1);
          const gg = d.g * (d.g - 1), ss = d.s * (d.s - 1), rr = d.r * (d.r - 1);
          return [
            { id: 'GG', label: 'Gold pair', color: '#f2b705', pay: 20, num: gg, den },
            { id: 'SS', label: 'Silver pair', color: '#b0bec5', pay: 6, num: ss, den },
            { id: 'RR', label: 'Red pair', color: '#c8102e', pay: 2, num: rr, den },
            { id: 'X', label: 'Mixed colours', color: '#6b4c9a', pay: 0, num: den - gg - ss - rr, den }
          ];
        }
        return [
          { id: 'G', label: 'Gold ball', color: '#f2b705', pay: 8, num: d.g, den: n },
          { id: 'S', label: 'Silver ball', color: '#b0bec5', pay: 3, num: d.s, den: n },
          { id: 'R', label: 'Red ball', color: '#c8102e', pay: 0, num: d.r, den: n }
        ];
      }
    },
    plinko: {
      price: 4,
      outcomes(d) {
        // Binomial: a ball bounces right with probability 1/2 at each of 6 rows.
        return d.bins.map((pay, k) => ({ id: 'b' + k, label: `Bin ${k}`, color: ['#14213d', '#2b4c7e', '#1b998b', '#f2b705', '#1b998b', '#2b4c7e', '#14213d'][k], pay, num: choose(PLINKO_ROWS, k), den: 2 ** PLINKO_ROWS }));
      }
    }
  };
  const priceOf = (b) => S.night.price;
  const outcomesOf = (b) => MODELS[b].outcomes(S.design[b], S.night.bagMode);
  function stats(b) {
    const oc = outcomesOf(b);
    const ev = oc.reduce((a, o) => a + (o.num / o.den) * o.pay, 0);
    const pWin = oc.reduce((a, o) => a + (o.pay > 0 ? o.num / o.den : 0), 0);
    const price = priceOf(b);
    // Visitor satisfaction: 60% from chance of any prize, 40% from value for money.
    const sat = clamp(pWin / 0.6, 0, 1) * 0.6 + clamp(ev / price / 0.85, 0, 1) * 0.4;
    return { oc, ev, pWin, price, sat, profit: price - ev };
  }
  const designKey = (b) => b + ':' + S.night.bagMode + ':' + JSON.stringify(S.design[b]);
  function validDesign(b) {
    const d = S.design[b];
    if (b === 'bag') { const n = d.g + d.s + d.r; return S.night.bagMode === 'pair' ? n >= 2 : n >= 1; }
    return true;
  }

  /** Draw one random outcome according to the exact probabilities. */
  function sample(b) {
    const d = S.design[b];
    if (b === 'wheel') { const k = Math.floor(Math.random() * WHEEL_SECTORS); return { id: S.wheelLayout[k], sector: k }; }
    if (b === 'bag') {
      const balls = [...Array(d.g).fill('G'), ...Array(d.s).fill('S'), ...Array(d.r).fill('R')];
      const i = Math.floor(Math.random() * balls.length);
      if (S.night.bagMode !== 'pair') return { id: balls[i], balls: [balls[i]] };
      const rest = balls.filter((_, k) => k !== i); // without replacement
      const j = rest[Math.floor(Math.random() * rest.length)];
      return { id: balls[i] === j ? balls[i] + j : 'X', balls: [balls[i], j] };
    }
    const path = Array.from({ length: PLINKO_ROWS }, () => (Math.random() < 0.5 ? 0 : 1));
    return { id: 'b' + path.reduce((a, x) => a + x, 0), path };
  }

  /** Spread the wheel's sector types evenly around the wheel. */
  function buildWheelLayout() {
    const d = S.design.wheel;
    const counts = { J: d.J, P: d.P, S: d.S, B: WHEEL_SECTORS - d.J - d.P - d.S };
    const items = [];
    for (const [t, c] of Object.entries(counts)) for (let k = 0; k < c; k++) items.push({ t, pos: (k + 0.5) / c + Math.random() * 1e-3 });
    S.wheelLayout = items.sort((a, b) => a.pos - b.pos).map((x) => x.t);
  }

  /* ---------------- DOM ---------------- */
  const boothCanvas = document.getElementById('booth');
  const freqCanvas = document.getElementById('freq');
  const convCanvas = document.getElementById('conv');
  const dom = {
    booths: document.getElementById('booths'), price: document.getElementById('price'), controls: document.getElementById('controls'),
    probs: document.getElementById('probs'), ev: document.getElementById('ev'), sign: document.getElementById('boothSign'),
    result: document.getElementById('boothResult'), test: document.getElementById('testBtn'), run: document.getElementById('runBtn'),
    freqTitle: document.getElementById('freqTitle'), log: document.getElementById('log')
  };
  let S = null;

  /* ---------------- Night flow ---------------- */
  function startNight(i) {
    S.cfg = MG.roundConfig(DIFF, i);
    S.nightIdx = i;
    S.night = NIGHTS[i];
    S.wavesLeft = S.night.waves;
    S.nightStartBank = S.bank;
    S.nightSats = [];
    S.expectedNet = 0;
    S.booth=S.night.required;
    if(S.booth==='wheel')S.design.wheel={J:MG.randInt(0,1),P:MG.randInt(1,3),S:MG.randInt(1,4)};
    if(S.booth==='bag')S.design.bag={g:MG.randInt(1,3),s:MG.randInt(2,5),r:MG.randInt(5,9)};
    if(S.booth==='plinko')S.design.plinko={bins:MG.shuffle(PLINKO_PRIZES)};
    S.nightStrikes = 0;
    if (!S.night.booths.includes(S.booth)) S.booth = S.night.booths[0];
    this_shell.setStage(`${i + 1}/${NIGHTS.length}`);
    this_shell.setTimer(S.cfg.time);
    this_shell.toast(`🌙 Night ${i + 1}: ${S.night.name} — make +${S.night.target} 🪙 with ≥${S.night.sat}% satisfaction in ${S.night.waves} waves.`, 'info', 4200);
    renderAll();
  }

  function endNight(reason) {
    const profit = S.bank - S.nightStartBank;
    const avgSat = S.nightSats.length ? S.nightSats.reduce((a, b) => a + b, 0) / S.nightSats.length : 0;
    const met = S.expectedNet >= S.night.target && avgSat >= S.night.sat;
    S.nightsDone++;
    if (met) {
      S.goalsMet++;
      this_shell.addScore(200 + (S.nightStrikes ? 0 : 50), `Night goal met${S.nightStrikes ? '' : ' (no strikes)'}`);
      this_shell.toast(`✔ ${S.night.name} closed: profit ${profit >= 0 ? '+' : ''}${profit} 🪙, satisfaction ${Math.round(avgSat)}%. Forecast target met!`, 'good', 3600);
      MG.sound.play('stage');
    } else {
      addStrike(`${reason ? reason + ' ' : ''}Night goal missed (expected profit ${round(S.expectedNet,2)}/${S.night.target}, satisfaction ${Math.round(avgSat)}%/${S.night.sat}%)`);
      if (!this_shell.isPlaying()) return;
    }
    if (S.nightIdx + 1 >= NIGHTS.length) return finish(true, 'Season complete!', `Your carnival survived all ${NIGHTS.length} nights.`);
    startNight(S.nightIdx + 1);
  }

  function addStrike(why) {
    S.strikes++; S.nightStrikes++;
    this_shell.flash('bad');
    MG.sound.play('error');
    this_shell.toast(`⚠ Strike ${S.strikes}/3: ${why}`, 'bad', 3800);
    updateBank();
    if (S.strikes >= 3) finish(false, 'Licence revoked', 'The fair inspectors issued three strikes. Keep visitors happy (higher P(win) and fair value) while keeping price above the expected payout.');
  }

  /* ---------------- Running attractions ---------------- */
  function run(kind) {
    if (!this_shell.isPlaying() || S.anim) return;
    const b = S.booth;
    if (!validDesign(b)) { this_shell.toast('This design is impossible — add more objects first.', 'warn'); MG.sound.play('error'); return; }
    const forecastKey='probability:'+S.nightIdx+':'+designKey(b)+':'+priceOf(b);
    if(kind==='wave'){
      const st=stats(b),night=S.nightIdx,design=designKey(b);
      if(!this_shell.maths.gate({key:forecastKey,topic:S.night.bagMode==='pair'?'Dependent probability and expected value':b==='plinko'?'Binomial probability and expected value':'Probability and expected value',title:'Sign the attraction forecast',
        prompt:'Use your attraction’s counts and prizes to forecast one play before admitting visitors. Probabilities can be entered as fractions or decimals.',
        fields:[{label:'Probability of any prize (0–1)',answer:st.pWin,tolerance:.005},{label:'Expected payout per play (tokens; 2 decimals)',answer:st.ev,tolerance:.006},{label:'Expected profit per play (tokens; 2 decimals)',answer:st.profit,tolerance:.006}],
        hint:b==='bag'&&S.night.bagMode==='pair'?'Without replacement: P(a matching pair) = c/n × (c−1)/(n−1), summed over colours. Expected payout = sum of probability × prize. Profit = price − expected payout.':b==='plinko'?'For six rows, the bin counts are 1, 6, 15, 20, 15, 6, 1 out of 64. Multiply each probability by its prize and add. Profit = price − expected payout.':'Probability = winning sectors ÷ total sectors. Expected payout = sum of probability × prize. Profit = ticket price − expected payout.',
        container:dom.run.parentElement.parentElement,valid:()=>S.nightIdx===night&&S.booth===b&&designKey(b)===design&&!S.anim,onPass:()=>run(kind)}))return;
    }else this_shell.maths.assist(S.night.bagMode==='pair'?'Dependent probability and expected value':b==='plinko'?'Binomial probability and expected value':'Probability and expected value',forecastKey);
    let n;
    if (kind === 'test') {
      if (S.bank < TEST_COST) { this_shell.toast('Not enough tokens for a test run.', 'bad'); MG.sound.play('error'); return; }
      S.bank -= TEST_COST;
      S.tests++;
      n = TEST_PLAYS;
    } else {
      if (S.wavesLeft <= 0) return;
      const st = stats(b);
      n = Math.max(1, Math.round(S.night.base * (0.6 + 0.4 * st.sat)));
    }
    if (b === 'wheel') buildWheelLayout();
    const plays = Array.from({ length: n }, () => sample(b));
    S.anim = { kind, booth: b, plays, i: 0, t: 0, dur: b === 'wheel' ? 1.1 : b === 'plinko' ? 1.2 : 0.9, animCount: Math.min(ANIMATED_PLAYS, n), shown: 0 };
    if (b === 'wheel') startSpin(plays[0]);
    updateButtons();
    MG.sound.play(kind === 'test' ? 'click' : 'whoosh');
  }

  function startSpin(play) {
    const step = (Math.PI * 2) / WHEEL_SECTORS;
    const target = -Math.PI / 2 - (play.sector + 0.5) * step;
    const TAU = Math.PI * 2;
    const mod = (a) => ((a % TAU) + TAU) % TAU;
    // Three full turns plus whatever is needed to stop on the chosen sector.
    S.spin = { from: S.wheelRot, to: S.wheelRot + TAU * 3 + mod(target - S.wheelRot) };
  }

  function updateAnim(dt) {
    const A = S.anim;
    if (!A) return;
    A.t += dt;
    const p = clamp(A.t / A.dur, 0, 1);
    if (A.booth === 'wheel' && S.spin) {
      const e = 1 - Math.pow(1 - p, 3);
      S.wheelRot = S.spin.from + (S.spin.to - S.spin.from) * e;
      if (Math.random() < dt * 20 * (1 - p)) MG.sound.play('spin');
    }
    if (p >= 1) {
      const play = A.plays[A.i];
      const o = outcomesOf(A.booth).find((x) => x.id === play.id);
      dom.result.textContent = `${o.label}! ${o.pay ? `Pays ${o.pay} 🪙` : 'No prize'}`;
      MG.sound.play(o.pay >= 10 ? 'win' : o.pay > 0 ? 'coin' : 'click');
      A.i++; A.t = 0;
      if (A.i < A.animCount) { if (A.booth === 'wheel') startSpin(A.plays[A.i]); }
      else completeRun();
    }
  }

  /** Apply the outcomes of a finished run: tokens, records, satisfaction. */
  function completeRun() {
    const A = S.anim;
    S.anim = null;
    S.spin = null;
    const b = A.booth;
    const st = stats(b);
    const oc = st.oc;
    let payout = 0, wins = 0;
    const counts = {};
    for (const p of A.plays) {
      const o = oc.find((x) => x.id === p.id);
      counts[p.id] = (counts[p.id] || 0) + 1;
      if (o.pay > 0) wins++;
      if (A.kind === 'wave') payout += o.pay;
      recordObs(b, p.id, o.pay > 0);
    }
    const n = A.plays.length;
    const freqText = oc.filter((o) => counts[o.id]).map((o) => `${o.label} ${counts[o.id]}`).join(', ');
    if (A.kind === 'wave') {
      const income = n * st.price;
      const net = income - payout;
      S.bank += net;
      S.expectedNet += n*st.profit;
      S.expectedProfitTotal += n*st.profit;
      S.wavesLeft--;
      S.visitors += n;
      const sat = Math.round(st.sat * 100);
      S.nightSats.push(sat); S.allSats.push(sat);
      S.plays += n; S.wins += wins;
      S.log.push({ night: S.nightIdx + 1, booth: b, kind: 'Wave', n, wins, net, detail: freqText });
      const pts = Math.max(0, net) * 4 + Math.round(sat / 5);
      this_shell.addScore(pts, `Wave: ${net >= 0 ? '+' : ''}${net} 🪙`, dom.run);
      dom.result.textContent = `${n} visitors · ${wins} winners · paid out ${payout} · net ${net >= 0 ? '+' : ''}${net} 🪙 · satisfaction ${sat}%`;
      MG.sound.play(net >= 0 ? 'cash' : 'error');
      if (sat < 35) addStrike(`Visitors complained (satisfaction ${sat}%).`);
      if (!this_shell.isPlaying()) return;
      if (S.bank < 0) return finish(false, 'Bankrupt!', `Prize payouts exceeded your takings and the bank fell to ${S.bank} 🪙. Expected profit per play is price − E[payout] — keep it positive, and beware of big jackpots on small token reserves.`);
    } else {
      S.log.push({ night: S.nightIdx + 1, booth: b, kind: 'Test', n, wins, net: -TEST_COST, detail: freqText });
      dom.result.textContent = `Test run: ${freqText} (relative frequency of a win ${wins}/${n})`;
    }
    renderAll();
    if (A.kind === 'wave' && S.wavesLeft <= 0) endNight();
  }

  function recordObs(b, id, win) {
    const key = designKey(b);
    let O = S.obs[b];
    if (!O || O.key !== key) O = S.obs[b] = { key, counts: {}, n: 0, wins: 0, series: [] };
    O.counts[id] = (O.counts[id] || 0) + 1;
    O.n++;
    if (win) O.wins++;
    O.series.push(O.wins / O.n);
    if (O.series.length > 400) O.series.shift();
  }

  /* ---------------- Design controls ---------------- */
  function change(fn) {
    if (!this_shell.isPlaying() || S.anim) return;
    fn(S.design[S.booth]);
    if (S.booth === 'wheel') buildWheelLayout();
    MG.sound.play('click');
    renderAll();
  }

  function renderControls() {
    const b = S.booth, d = S.design[b];
    dom.controls.innerHTML = '';
    const row = (label, sub, color, val, dec, inc) => {
      const r = el('div', { class: 'ctl' });
      const m = el('button', { class: 'mg-btn', type: 'button', 'aria-label': `Fewer ${label}` }, '−');
      const p = el('button', { class: 'mg-btn', type: 'button', 'aria-label': `More ${label}` }, '+');
      m.addEventListener('click', dec); p.addEventListener('click', inc);
      const name = el('div', { class: 'ctl__name', html: `<span class="swatch" style="background:${color}"></span>${label}<small>${sub}</small>` });
      r.append(name, m, el('span', { class: 'ctl__val' }, val), p);
      dom.controls.append(r);
    };
    if (b === 'wheel') {
      const free = WHEEL_SECTORS - d.J - d.P - d.S;
      row('Jackpot sectors', 'pays 15 🪙', '#ffc400', d.J, () => change((x) => { x.J = Math.max(0, x.J - 1); }), () => change((x) => { if (free > 0) x.J++; }));
      row('Prize sectors', 'pays 4 🪙', '#d81b60', d.P, () => change((x) => { x.P = Math.max(0, x.P - 1); }), () => change((x) => { if (free > 0) x.P++; }));
      row('Small-prize sectors', 'pays 2 🪙', '#26c6da', d.S, () => change((x) => { x.S = Math.max(0, x.S - 1); }), () => change((x) => { if (free > 0) x.S++; }));
      dom.controls.append(el('p', { class: 'ctl__name', style: 'margin:0;font-weight:600' }, `Blank sectors: ${free} (12 sectors in total)`));
    } else if (b === 'bag') {
      const pair = S.night.bagMode === 'pair';
      row('Gold balls', pair ? 'gold pair pays 20' : 'pays 8 🪙', '#ffc400', d.g, () => change((x) => { x.g = Math.max(0, x.g - 1); }), () => change((x) => { x.g = Math.min(10, x.g + 1); }));
      row('Silver balls', pair ? 'silver pair pays 6' : 'pays 3 🪙', '#b0bec5', d.s, () => change((x) => { x.s = Math.max(0, x.s - 1); }), () => change((x) => { x.s = Math.min(10, x.s + 1); }));
      row('Red balls', pair ? 'red pair pays 2' : 'no prize', '#e53935', d.r, () => change((x) => { x.r = Math.max(0, x.r - 1); }), () => change((x) => { x.r = Math.min(10, x.r + 1); }));
      dom.controls.append(el('p', { class: 'ctl__name', style: 'margin:0;font-weight:600' }, pair ? 'Grand Gala rules: draw TWO balls without replacement. Matching colours win.' : 'One ball is drawn at random.'));
    } else {
      dom.controls.append(el('p', { class: 'ctl__name', style: 'margin:0;font-weight:600' }, 'Tap one bin, then another, to swap their prize cards. Payouts in 🪙:'));
      const bins = el('div', { class: 'bins' });
      d.bins.forEach((pay, k) => {
        const btn = el('button', { type: 'button', class: 'bin' + (S.binSel === k ? ' is-sel' : ''), 'aria-label': `Bin ${k}, pays ${pay}` }, String(pay), el('small', {}, `bin ${k}`));
        btn.addEventListener('click', () => {
          if (!this_shell.isPlaying() || S.anim) return;
          if (S.binSel == null) { S.binSel = k; MG.sound.play('click'); renderControls(); return; }
          const j = S.binSel; S.binSel = null;
          change((x) => { [x.bins[j], x.bins[k]] = [x.bins[k], x.bins[j]]; });
        });
        bins.append(btn);
      });
      dom.controls.append(bins);
    }
  }

  /* ---------------- Rendering ---------------- */
  function renderAll() {
    renderTabs(); renderControls(); renderProbs(); renderLog(); updateButtons(); updateBank(); drawCharts();
  }
  function renderTabs() {
    dom.booths.innerHTML = '';
    for (const b of ['wheel', 'bag', 'plinko']) {
      const open = S.night.booths.includes(b);
      const t = el('button', { type: 'button', class: 'tab', role: 'tab', 'aria-selected': String(S.booth === b), disabled: !open, title: open ? '' : 'Opens on a later night' }, BOOTH_NAMES[b] + (open ? '' : ' 🔒'));
      t.addEventListener('click', () => { if (S.anim || !this_shell.isPlaying()) return; S.booth = b; S.binSel = null; dom.result.textContent = ''; MG.sound.play('select'); renderAll(); });
      dom.booths.append(t);
    }
    const profit = S.bank - S.nightStartBank;
    dom.booths.append(el('span', { class: 'goal-chip' }, `🌙 ${S.night.name}: profit ${profit >= 0 ? '+' : ''}${profit}/${S.night.target} 🪙 · waves left ${S.wavesLeft}`));
    dom.sign.textContent = BOOTH_NAMES[S.booth];
  }
  function renderProbs() {
    const b=S.booth;
    if(!validDesign(b)){dom.probs.textContent='Add objects to create a valid attraction.';dom.ev.textContent='';return;}
    const st=stats(b);
    dom.price.innerHTML='Ticket price: <strong>'+st.price+' tokens</strong> per play';
    dom.probs.innerHTML='<thead><tr><th>Outcome</th><th>Favourable / total</th><th>Prize</th></tr></thead><tbody>'+st.oc.map(o=>'<tr><td>'+o.label+'</td><td>'+o.num+' / '+o.den+'</td><td>'+o.pay+'</td></tr>').join('')+'</tbody>';
    dom.ev.textContent='Commit a probability and expected-value forecast before opening. Night target: expected profit '+S.night.target+' tokens; satisfaction '+S.night.sat+'%. Verified expected profit so far: '+round(S.expectedNet,2)+'. Observed winnings vary; maths results are recorded separately.';
  }
  function renderLog() {
    dom.log.innerHTML = `<thead><tr><th>#</th><th>Night · booth</th><th>Plays</th><th>Wins</th><th>Rel. freq</th><th>Net 🪙</th></tr></thead><tbody>${S.log.map((r, i) =>
      `<tr title="${r.detail}"><td>${i + 1}</td><td>N${r.night} ${r.kind} · ${r.booth}</td><td>${r.n}</td><td>${r.wins}</td><td>${round(r.wins / r.n, 2)}</td><td class="${r.net >= 0 ? 'pos' : 'neg'}">${r.net >= 0 ? '+' : ''}${r.net}</td></tr>`).reverse().join('')}</tbody>`;
  }
  function updateButtons() {
    const busy = !!S.anim;
    dom.run.disabled = busy || S.wavesLeft <= 0;
    dom.test.disabled = busy || S.bank < TEST_COST;
    dom.run.textContent = `🎪 Run Attraction (${S.wavesLeft} wave${S.wavesLeft === 1 ? '' : 's'} left)`;
  }
  function updateBank() {
    this_shell.setResource(`🪙 ${S.bank} · ⚠ ${S.strikes}/3`, S.bank < 15 || S.strikes >= 2);
    const avg = S.nightSats.length ? S.nightSats.reduce((a, b) => a + b, 0) / S.nightSats.length : 0;
    this_shell.setProgress((S.night.waves - S.wavesLeft) / S.night.waves, `Waves ${S.night.waves - S.wavesLeft}/${S.night.waves} · avg sat ${Math.round(avg)}%`);
  }

  function drawCharts() {
    const b = S.booth;
    const O = S.obs[b] && S.obs[b].key === designKey(b) ? S.obs[b] : null;
    const st = validDesign(b) ? stats(b) : null;
    dom.freqTitle.textContent = O ? `Current design: ${O.n} plays observed (bars) vs theoretical probability (◆)` : 'Run the attraction to collect data for this design.';
    let f = MG.fitCanvas(freqCanvas), ctx = f.ctx;
    ctx.clearRect(0, 0, f.w, f.h);
    if (st) {
      const oc = st.oc, pad = 26, bw = (f.w - pad - 8) / oc.length;
      ctx.strokeStyle = '#ddd'; ctx.fillStyle = '#888'; ctx.font = '600 11px "Alegreya Sans", sans-serif'; ctx.textAlign = 'right';
      for (const v of [0, 0.25, 0.5, 0.75, 1]) { const y = f.h - 20 - v * (f.h - 30); ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(f.w, y); ctx.stroke(); ctx.fillText(v, pad - 3, y + 3); }
      oc.forEach((o, i) => {
        const x = pad + i * bw + 4, h = f.h - 30;
        const obs = O ? (O.counts[o.id] || 0) / O.n : 0;
        ctx.fillStyle = o.color; ctx.fillRect(x, f.h - 20 - obs * h, bw - 8, obs * h);
        const ty = f.h - 20 - (o.num / o.den) * h;
        ctx.fillStyle = '#222'; ctx.beginPath(); ctx.moveTo(x + bw / 2 - 4, ty); ctx.lineTo(x + bw / 2, ty - 5); ctx.lineTo(x + bw / 2 + 4, ty); ctx.lineTo(x + bw / 2, ty + 5); ctx.fill();
        ctx.fillStyle = '#333'; ctx.textAlign = 'center'; ctx.fillText(o.label.split(' ')[0], x + bw / 2 - 4, f.h - 6);
      });
    }
    f = MG.fitCanvas(convCanvas); ctx = f.ctx;
    ctx.clearRect(0, 0, f.w, f.h);
    if (st) {
      const y = (v) => f.h - 8 - v * (f.h - 16);
      ctx.strokeStyle = '#c8102e'; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(0, y(st.pWin)); ctx.lineTo(f.w, y(st.pWin)); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#c8102e'; ctx.font = '600 11px "Alegreya Sans", sans-serif'; ctx.textAlign = 'left'; ctx.fillText(`theory ${round(st.pWin, 3)}`, 4, y(st.pWin) - 4);
      if (O && O.series.length > 1) {
        ctx.strokeStyle = '#14213d'; ctx.lineWidth = 2; ctx.beginPath();
        O.series.forEach((v, i) => { const x = (i / (O.series.length - 1)) * f.w; i ? ctx.lineTo(x, y(v)) : ctx.moveTo(x, y(v)); });
        ctx.stroke(); ctx.lineWidth = 1;
        ctx.fillStyle = '#14213d'; ctx.textAlign = 'right'; ctx.fillText(`observed ${round(O.wins / O.n, 3)} (n=${O.n})`, f.w - 4, 12);
      }
    }
  }

  /* ---------------- Booth animation canvas ---------------- */
  function drawBooth() {
    const f = MG.fitCanvas(boothCanvas), ctx = f.ctx;
    ctx.clearRect(0, 0, f.w, f.h);
    const b = S.booth;
    if (!validDesign(b)) return;
    if (b === 'wheel') drawWheel(ctx, f);
    else if (b === 'bag') drawBag(ctx, f);
    else drawPlinko(ctx, f);
  }

  function drawWheel(ctx, f) {
    const cx = f.w / 2, cy = f.h / 2 + 6, R = Math.min(f.w, f.h) * 0.42;
    const oc = outcomesOf('wheel');
    const step = (Math.PI * 2) / WHEEL_SECTORS;
    S.wheelLayout.forEach((t, k) => {
      const o = oc.find((x) => x.id === t);
      const a0 = S.wheelRot + k * step;
      ctx.fillStyle = o.color; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a0, a0 + step); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(a0 + step / 2);
      ctx.fillStyle = o.id === 'P' ? '#fff' : '#14213d'; ctx.font = `${Math.max(13, R * 0.14)}px Rye, serif`; ctx.textAlign = 'right';
      ctx.fillText(o.pay ? o.pay : '✕', R - 10, 5);
      ctx.restore();
    });
    ctx.fillStyle = '#f2b705'; ctx.beginPath(); ctx.arc(cx, cy, R * 0.14, 0, 7); ctx.fill();
    ctx.strokeStyle = '#14213d'; ctx.lineWidth = 3; ctx.stroke();
    ctx.strokeStyle = '#c8102e'; ctx.lineWidth = 12; ctx.beginPath(); ctx.arc(cx, cy, R + 6, 0, 7); ctx.stroke();
    // Chasing bulbs around the rim
    const chase = Math.floor(performance.now() / 250) % 2;
    for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; ctx.fillStyle = (k + chase) % 2 ? '#fff6b0' : '#8a6a10'; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * (R + 6), cy + Math.sin(a) * (R + 6), 3.5, 0, 7); ctx.fill(); }
    // Pointer at the top
    ctx.fillStyle = '#f2b705'; ctx.beginPath(); ctx.moveTo(cx - 14, cy - R - 18); ctx.lineTo(cx + 14, cy - R - 18); ctx.lineTo(cx, cy - R + 12); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#14213d'; ctx.lineWidth = 3; ctx.stroke();
  }

  function drawBag(ctx, f) {
    const d = S.design.bag;
    const cx = f.w / 2, by = f.h * 0.92, bw = Math.min(f.w * 0.6, 280), bh = Math.min(f.h * 0.55, 220);
    ctx.fillStyle = '#7a2440'; ctx.beginPath();
    ctx.moveTo(cx - bw * 0.35, by - bh); ctx.quadraticCurveTo(cx - bw * 0.7, by - bh * 0.3, cx - bw / 2, by);
    ctx.lineTo(cx + bw / 2, by); ctx.quadraticCurveTo(cx + bw * 0.7, by - bh * 0.3, cx + bw * 0.35, by - bh); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f2b705'; ctx.fillRect(cx - bw * 0.38, by - bh - 8, bw * 0.76, 14);
    const balls = [...Array(d.g).fill('#f2b705'), ...Array(d.s).fill('#b8c2cc'), ...Array(d.r).fill('#c8102e')];
    const r = Math.max(7, Math.min(14, bw / 22));
    balls.forEach((c, i) => {
      const col = i % 8, row = Math.floor(i / 8);
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(cx - r * 7 + col * r * 2, by - r * 1.4 - row * r * 1.9, r * 0.9, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.stroke();
    });
    const A = S.anim;
    const shown = A && A.booth === 'bag' ? A.plays[A.i] : S.lastBag;
    if (A && A.booth === 'bag') S.lastBag = A.plays[A.i];
    if (shown) {
      const p = A ? clamp(A.t / A.dur, 0, 1) : 1;
      const e = 1 - Math.pow(1 - p, 2);
      const cols = { G: '#f2b705', S: '#b8c2cc', R: '#c8102e' };
      shown.balls.forEach((bc, k) => {
        const x = cx + (k - (shown.balls.length - 1) / 2) * r * 4;
        const y = by - bh - (f.h * 0.22) * e;
        ctx.fillStyle = cols[bc]; ctx.beginPath(); ctx.arc(x, y, r * 1.6, 0, 7); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke(); ctx.lineWidth = 1;
      });
    }
  }

  function drawPlinko(ctx, f) {
    const d = S.design.plinko;
    const top = 20, gapY = (f.h - 90) / (PLINKO_ROWS + 1), gapX = Math.min(f.w / 9, gapY * 1.3), cx = f.w / 2;
    ctx.fillStyle = '#ffe082';
    for (let r = 0; r < PLINKO_ROWS; r++) for (let k = 0; k <= r; k++) { ctx.beginPath(); ctx.arc(cx + (k - r / 2) * gapX, top + (r + 1) * gapY, 4, 0, 7); ctx.fill(); }
    const binY = top + (PLINKO_ROWS + 1) * gapY;
    d.bins.forEach((pay, k) => {
      const x = cx + (k - PLINKO_ROWS / 2) * gapX;
      ctx.fillStyle = pay >= 10 ? '#f2b705' : pay > 0 ? '#1b998b' : '#3a4a6b';
      ctx.fillRect(x - gapX / 2 + 3, binY, gapX - 6, 34);
      ctx.fillStyle = pay > 0 && pay < 10 ? '#fff' : pay ? '#14213d' : '#f8ecd1'; ctx.font = '16px Rye, serif'; ctx.textAlign = 'center'; ctx.fillText(pay, x, binY + 17);
      ctx.font = '600 11px "Alegreya Sans", sans-serif'; ctx.fillText(`${choose(PLINKO_ROWS, k)}/64`, x, binY + 30);
    });
    const A = S.anim;
    if (A && A.booth === 'plinko') {
      const path = A.plays[A.i].path;
      const p = clamp(A.t / A.dur, 0, 1) * (PLINKO_ROWS + 1);
      const row = Math.floor(p), fr = p - row;
      const posAt = (r) => { let rights = 0; for (let i = 0; i < Math.min(r, PLINKO_ROWS); i++) rights += path[i]; return { x: cx + (rights - Math.min(r, PLINKO_ROWS) / 2) * gapX, y: top + r * gapY + gapY * 0.6 }; };
      const a = posAt(row), b2 = posAt(Math.min(row + 1, PLINKO_ROWS + 1));
      const x = a.x + (b2.x - a.x) * fr, y = a.y + (b2.y - a.y) * fr - Math.sin(fr * Math.PI) * 8;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.fill();
    }
  }

  /* ---------------- End of run ---------------- */
  function finish(won, title, reason) {
    if (S.anim) S.anim = null;
    const avgSat = S.allSats.length ? Math.round(S.allSats.reduce((a, b) => a + b, 0) / S.allSats.length) : 0;
    let stars;
    if (won) stars = S.goalsMet === NIGHTS.length && S.strikes === 0 ? 3 : S.goalsMet >= 2 ? 2 : 1;
    else stars = S.goalsMet >= 2 ? 2 : S.goalsMet >= 1 ? 1 : 0;
    const math = [
      `Overall your visitors won ${S.wins} of ${S.plays} plays — a relative frequency of ${S.plays ? round(S.wins / S.plays, 3) : 0}.`,
      'Theoretical probability = favourable outcomes ÷ total outcomes (e.g. 3 jackpot sectors out of 12 = 3/12 = 1/4).',
      'Expected payout E = Σ P(outcome) × prize. If the ticket price is bigger than E, the attraction makes a profit in the long run — but short runs vary!',
      'Drawing two balls without replacement multiplies: P(gold pair) = g/n × (g − 1)/(n − 1).',
      'The ball drop follows a binomial distribution: bin k has probability C(6, k)/64, so the middle bin (20/64) is most likely and the edges (1/64) are rare.'
    ];
    for (const b of ['wheel', 'bag', 'plinko']) {
      const O = S.obs[b];
      if (O && O.n >= 10) math.push(`${BOOTH_NAMES[b]}: observed win frequency ${round(O.wins / O.n, 3)} over the last design's ${O.n} plays.`);
    }
    this_shell.end({
      won, title, reason, stars,
      stats: [
        ['Nights completed', `${S.nightsDone} / ${NIGHTS.length}`],
        ['Night goals met', `${S.goalsMet} / ${NIGHTS.length}`],
        ['Final bank', `${S.bank} 🪙`],
        ['Strikes', `${S.strikes} / 3`],
        ['Visitors served', S.visitors],
        ['Average satisfaction', `${avgSat}%`],
        ['Test runs', S.tests],
        ['Play time', MG.fmtTime(this_shell.playTime)]
      ],
      math
    });
  }

  /* ---------------- Shell ---------------- */
  const this_shell = MG.createShell({
    id: 'probability-carnival',
    title: 'Probability Carnival',
    tagline: 'Roll up, roll up! You run the fair. Design the games, pay the prizes and keep the crowds smiling.',
    goal: 'Hit each night’s profit target with happy visitors, for 3 nights.',
    steps: [
      ['🎡', 'Design a stall: choose the prizes and the chances.'],
      ['🧪', 'Test it and check the chance of a win.'],
      ['🎪', 'Open to visitors. Make a profit AND keep them happy!']
    ],
    keys: [
      ['<kbd>R</kbd>', 'Run attraction'],
      ['<kbd>T</kbd>', 'Test run ×10'],
      ['<kbd>P</kbd>', 'Pause']
    ],
    genre: 'Arcade & probability simulation',
    topic: 'Probability, relative frequency, expected value',
    premise: 'You run the fairground stalls. Design the prize wheel, fill the lucky bag and arrange the ball-drop prizes — then let the visitors play.',
    objective: 'Survive 10 nights. Each night reach the profit target while keeping visitors satisfied, without going bankrupt or collecting three strikes.',
    livesLabel: 'Bank · strikes',
    stageLabel: 'Round',
    art: `<svg viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice"><rect width="400" height="500" fill="#14213d"/><circle cx="0" cy="0" r="2" fill="#fff" opacity=".8"/><circle cx="97" cy="53" r="1.2" fill="#fff" opacity=".8"/><circle cx="194" cy="106" r="1.2" fill="#fff" opacity=".8"/><circle cx="291" cy="159" r="2" fill="#fff" opacity=".8"/><circle cx="388" cy="12" r="1.2" fill="#fff" opacity=".8"/><circle cx="85" cy="65" r="1.2" fill="#fff" opacity=".8"/><circle cx="182" cy="118" r="2" fill="#fff" opacity=".8"/><circle cx="279" cy="171" r="1.2" fill="#fff" opacity=".8"/><circle cx="376" cy="24" r="1.2" fill="#fff" opacity=".8"/><circle cx="73" cy="77" r="2" fill="#fff" opacity=".8"/><circle cx="170" cy="130" r="1.2" fill="#fff" opacity=".8"/><circle cx="267" cy="183" r="1.2" fill="#fff" opacity=".8"/><circle cx="364" cy="36" r="2" fill="#fff" opacity=".8"/><circle cx="61" cy="89" r="1.2" fill="#fff" opacity=".8"/><circle cx="158" cy="142" r="1.2" fill="#fff" opacity=".8"/><circle cx="255" cy="195" r="2" fill="#fff" opacity=".8"/><circle cx="352" cy="48" r="1.2" fill="#fff" opacity=".8"/><circle cx="49" cy="101" r="1.2" fill="#fff" opacity=".8"/><circle cx="146" cy="154" r="2" fill="#fff" opacity=".8"/><circle cx="243" cy="7" r="1.2" fill="#fff" opacity=".8"/><circle cx="340" cy="60" r="1.2" fill="#fff" opacity=".8"/><circle cx="37" cy="113" r="2" fill="#fff" opacity=".8"/><circle cx="134" cy="166" r="1.2" fill="#fff" opacity=".8"/><circle cx="231" cy="19" r="1.2" fill="#fff" opacity=".8"/><circle cx="328" cy="72" r="2" fill="#fff" opacity=".8"/><circle cx="25" cy="125" r="1.2" fill="#fff" opacity=".8"/><path d="M0 58Q200 100 400 58" fill="none" stroke="#f8ecd1" stroke-width="2"/><path d="M10 76l18 0l-9 20Z" fill="#c8102e"/><path d="M54 72l18 0l-9 20Z" fill="#f2b705"/><path d="M98 68l18 0l-9 20Z" fill="#1b998b"/><path d="M142 64l18 0l-9 20Z" fill="#c8102e"/><path d="M186 60l18 0l-9 20Z" fill="#f2b705"/><path d="M230 64l18 0l-9 20Z" fill="#1b998b"/><path d="M274 68l18 0l-9 20Z" fill="#c8102e"/><path d="M318 72l18 0l-9 20Z" fill="#f2b705"/><path d="M362 76l18 0l-9 20Z" fill="#1b998b"/><path d="M200 120L40 330H56Z" fill="#c8102e"/><path d="M200 120L72 330H88Z" fill="#f8ecd1"/><path d="M200 120L104 330H120Z" fill="#c8102e"/><path d="M200 120L136 330H152Z" fill="#f8ecd1"/><path d="M200 120L168 330H184Z" fill="#c8102e"/><path d="M200 120L200 330H216Z" fill="#f8ecd1"/><path d="M200 120L232 330H248Z" fill="#c8102e"/><path d="M200 120L264 330H280Z" fill="#f8ecd1"/><path d="M200 120L296 330H312Z" fill="#c8102e"/><path d="M200 120L328 330H344Z" fill="#f8ecd1"/><path d="M200 120L40 330H360Z" fill="none" stroke="#14213d" stroke-width="4"/><path d="M40 330q16 22 32 0" fill="#f8ecd1" stroke="#14213d" stroke-width="3"/><path d="M72 330q16 22 32 0" fill="#c8102e" stroke="#14213d" stroke-width="3"/><path d="M104 330q16 22 32 0" fill="#f8ecd1" stroke="#14213d" stroke-width="3"/><path d="M136 330q16 22 32 0" fill="#c8102e" stroke="#14213d" stroke-width="3"/><path d="M168 330q16 22 32 0" fill="#f8ecd1" stroke="#14213d" stroke-width="3"/><path d="M200 330q16 22 32 0" fill="#c8102e" stroke="#14213d" stroke-width="3"/><path d="M232 330q16 22 32 0" fill="#f8ecd1" stroke="#14213d" stroke-width="3"/><path d="M264 330q16 22 32 0" fill="#c8102e" stroke="#14213d" stroke-width="3"/><path d="M296 330q16 22 32 0" fill="#f8ecd1" stroke="#14213d" stroke-width="3"/><path d="M328 330q16 22 32 0" fill="#c8102e" stroke="#14213d" stroke-width="3"/><path d="M200 120V84" stroke="#f8ecd1" stroke-width="4"/><path d="M200 84l30 9l-30 9Z" fill="#f2b705"/><rect x="0" y="352" width="400" height="148" fill="#22345c"/><g transform="translate(200 410)"><circle r="84" fill="#c8102e" stroke="#14213d" stroke-width="4"/><path d="M0 0L70.0 0.0A70 70 0 0 1 60.6 35.0Z" fill="#f2b705" stroke="#14213d" stroke-width="2"/><path d="M0 0L60.6 35.0A70 70 0 0 1 35.0 60.6Z" fill="#c8102e" stroke="#14213d" stroke-width="2"/><path d="M0 0L35.0 60.6A70 70 0 0 1 0.0 70.0Z" fill="#1b998b" stroke="#14213d" stroke-width="2"/><path d="M0 0L0.0 70.0A70 70 0 0 1 -35.0 60.6Z" fill="#cdbf9f" stroke="#14213d" stroke-width="2"/><path d="M0 0L-35.0 60.6A70 70 0 0 1 -60.6 35.0Z" fill="#f2b705" stroke="#14213d" stroke-width="2"/><path d="M0 0L-60.6 35.0A70 70 0 0 1 -70.0 0.0Z" fill="#c8102e" stroke="#14213d" stroke-width="2"/><path d="M0 0L-70.0 0.0A70 70 0 0 1 -60.6 -35.0Z" fill="#1b998b" stroke="#14213d" stroke-width="2"/><path d="M0 0L-60.6 -35.0A70 70 0 0 1 -35.0 -60.6Z" fill="#cdbf9f" stroke="#14213d" stroke-width="2"/><path d="M0 0L-35.0 -60.6A70 70 0 0 1 -0.0 -70.0Z" fill="#f2b705" stroke="#14213d" stroke-width="2"/><path d="M0 0L-0.0 -70.0A70 70 0 0 1 35.0 -60.6Z" fill="#c8102e" stroke="#14213d" stroke-width="2"/><path d="M0 0L35.0 -60.6A70 70 0 0 1 60.6 -35.0Z" fill="#1b998b" stroke="#14213d" stroke-width="2"/><path d="M0 0L60.6 -35.0A70 70 0 0 1 70.0 -0.0Z" fill="#cdbf9f" stroke="#14213d" stroke-width="2"/><circle cx="78.0" cy="0.0" r="4" fill="#f2b705"/><circle cx="72.1" cy="29.8" r="4" fill="#fff6b0"/><circle cx="55.2" cy="55.2" r="4" fill="#f2b705"/><circle cx="29.8" cy="72.1" r="4" fill="#fff6b0"/><circle cx="0.0" cy="78.0" r="4" fill="#f2b705"/><circle cx="-29.8" cy="72.1" r="4" fill="#fff6b0"/><circle cx="-55.2" cy="55.2" r="4" fill="#f2b705"/><circle cx="-72.1" cy="29.8" r="4" fill="#fff6b0"/><circle cx="-78.0" cy="0.0" r="4" fill="#f2b705"/><circle cx="-72.1" cy="-29.8" r="4" fill="#fff6b0"/><circle cx="-55.2" cy="-55.2" r="4" fill="#f2b705"/><circle cx="-29.8" cy="-72.1" r="4" fill="#fff6b0"/><circle cx="-0.0" cy="-78.0" r="4" fill="#f2b705"/><circle cx="29.8" cy="-72.1" r="4" fill="#fff6b0"/><circle cx="55.2" cy="-55.2" r="4" fill="#f2b705"/><circle cx="72.1" cy="-29.8" r="4" fill="#fff6b0"/><circle r="10" fill="#f2b705" stroke="#14213d" stroke-width="3"/></g><path d="M186 318h28l-14 26Z" fill="#f2b705" stroke="#14213d" stroke-width="3"/><g transform="translate(200 186) rotate(-4)"><rect x="-120" y="-24" width="240" height="44" fill="#f2b705" stroke="#14213d" stroke-width="4"/><text x="0" y="8" text-anchor="middle" font-family="Rye, serif" font-size="26" fill="#14213d">STEP RIGHT UP</text></g></svg>`,
    instructions: {
      objective: 'Complete 10 carnival nights. Predict the probabilities, expected payout and profit before each new design opens. Night profit goals use expected value; observed winnings vary.',
      controls: [
        'Choose an attraction tab, then use the −/+ buttons to change its design (wheel sectors, bag balls) or tap two ball-drop bins to swap their prizes.',
        '<strong>Test Run ×10</strong> (costs 2 🪙) plays 10 practice rounds to collect data. <strong>Run Attraction</strong> opens the booth to a wave of visitors.',
        'Keyboard: <kbd>Tab</kbd>/<kbd>Enter</kbd> work on every button; <kbd>R</kbd> runs the attraction, <kbd>T</kbd> runs a test. <kbd>P</kbd>/<kbd>Esc</kbd> pause.'
      ],
      maths: [
        'The design table shows exact theoretical probabilities as fractions and percentages.',
        'Expected payout E = Σ P(outcome) × prize. Your expected profit per play = ticket price − E.',
        'Every run uses real random numbers — compare the observed relative frequencies (bars) with the theory (◆) and watch the frequency settle down as plays increase.',
        'Night 3 bag: two draws without replacement. Ball drop: a binomial distribution with C(6, k)/64.',
        'Satisfaction depends on P(any prize) and value for money (E compared with the price). More satisfied visitors also bring bigger waves.'
      ],
      scoring: [
        'Each wave: +4 pts per token of profit and up to +20 for satisfaction.',
        'Night goal met: +200 (+50 more with no strikes that night). Test runs give data, not points.'
      ],
      failure: [
        'A strike is given if a wave’s satisfaction is below 35% or a night goal is missed. Three strikes ends the run.',
        'If your bank drops below 0 tokens you are bankrupt and the run ends.'
      ],
      timer: [
        'Each night has a countdown. When it reaches zero the night closes, even if waves remain. Pause freezes the timer and every animation.'
      ]
    },
    stars: [
      '1 star: finish all 10 nights (or meet at least one night goal in a failed run).',
      '2 stars: meet at least 2 of the 3 night goals.',
      '3 stars: finish all 10 nights, meet every night goal and receive no strikes.'
    ],
    onStart(diff) {
      const cfg = DIFF[diff];
      S = {
        cfg, expectedProfitTotal:0, strikes: 0, goalsMet: 0, nightsDone: 0, visitors: 0, plays: 0, wins: 0, tests: 0,
        allSats: [], log: [], obs: {}, booth: 'wheel', binSel: null, anim: null, spin: null, wheelRot: 0, lastBag: null,
        design: { wheel: { J: 1, P: 1, S: 2 }, bag: { g: 1, s: 3, r: 6 }, plinko: { bins: [2, 6, 0, 24, 0, 4, 2] } } // a permutation of PLINKO_PRIZES, deliberately poor
      };
      buildWheelLayout();
      dom.result.textContent = '';
      startNight(0);
    },
    onUpdate(dt) {
      updateAnim(dt);
      if (!this_shell.isPlaying()) return;
      drawBooth();
    },
    onTimeUp() {
      const night = S.nightIdx;
      if (S.anim) completeRun();
      // completeRun may already have closed the night (last wave).
      if (this_shell.isPlaying() && S.nightIdx === night) endNight('Time ran out.');
    },
    onStop() { if (S) S.anim = null; }
  });

  /* ---------------- Input (bound once) ---------------- */
  dom.run.addEventListener('click', () => run('wave'));
  dom.test.addEventListener('click', () => run('test'));
  window.addEventListener('keydown', (e) => {
    if (!this_shell.isPlaying() || MG.isTarget(e, 'input')) return;
    if (e.key === 'r' || e.key === 'R') run('wave');
    else if (e.key === 't' || e.key === 'T') run('test');
  });
  window.addEventListener('resize', () => { if (S && this_shell.isPlaying()) drawCharts(); });

  MG.game = { get state() { return S; }, run, stats, change, completeRun, NIGHTS };
})();
