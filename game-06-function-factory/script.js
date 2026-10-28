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
   Function Factory — functions, input → output rules, composition,
   linear functions and sequences. Each machine is a function (x + k, kx,
   x ÷ k, x², −x). Crates travel along the belt through the machines in
   order, so the line computes a composite function. A contract is met
   only when every crate in the batch leaves with its required value.
   ========================================================================== */
(() => {
  'use strict';
  const { el, clamp, round, fraction } = MG;

  /* ---------------- Machines ---------------- */
  const MACHINES = {
    add: { name: 'Adder', icon: '+', color: '#66bb6a', energy: 1, min: -12, max: 12, start: 1, desc: 'adds k (k can be negative)',
      rule: (k) => (k < 0 ? `− ${-k}` : `+ ${k}`), fx: (k) => `f(x) = x ${k < 0 ? '−' : '+'} ${Math.abs(k)}`, apply: (x, k) => x + k },
    mul: { name: 'Multiplier', icon: '×', color: '#ffca28', energy: 2, min: -5, max: 5, start: 2, skip0: true, desc: 'multiplies by k',
      rule: (k) => `× ${k < 0 ? '(−' + -k + ')' : k}`, fx: (k) => `f(x) = ${k < 0 ? '−' : ''}${Math.abs(k)}x`, apply: (x, k) => x * k },
    div: { name: 'Divider', icon: '÷', color: '#29b6f6', energy: 2, min: 2, max: 5, start: 2, desc: 'divides by k',
      rule: (k) => `÷ ${k}`, fx: (k) => `f(x) = x/${k}`, apply: (x, k) => x / k },
    sq: { name: 'Squarer', icon: 'x²', color: '#ef5350', energy: 3, desc: 'squares the value',
      rule: () => 'x²', fx: () => 'f(x) = x²', apply: (x) => x * x },
    neg: { name: 'Negator', icon: '−x', color: '#ab47bc', energy: 1, desc: 'changes the sign',
      rule: () => '× (−1)', fx: () => 'f(x) = −x', apply: (x) => -x }
  };

  /* ---------------- Contracts ----------------
     target(n) is the required output for input n. show: 'rule' prints the
     rule, 'table' only gives the input/output table, 'sequence' gives terms. */

  let STAGES = freshContracts();
  function freshContracts() {
    return Array.from({length:10},(_,i)=>{
      const m=MG.randInt(2,5), b=MG.randInt(2,9), shift=MG.randInt(1,4);
      const plans=[
        {rule:'n + '+b,target:n=>n+b,solution:[['add',b]]},
        {rule:m+'n + '+(2+b%4),target:n=>m*n+(2+b%4),solution:[['mul',m],['add',2+b%4]]},
        {target:n=>m*(n+6+b%4),solution:[['add',6+b%4],['mul',m]]},
        {target:n=>m*n-b,solution:[['mul',m],['add',-b]]},
        {rule:m+'(n + '+(3+shift%2)+')',target:n=>m*(n+3+shift%2),solution:[['add',3+shift%2],['mul',m]]},
        {target:n=>(m%2?m:3)*n/2-b,solution:[['mul',m%2?m:3],['div',2],['add',-b]]},
        {target:n=>-m*n+b,solution:[['mul',-m],['add',b]]},
        {target:n=>n*n+b,solution:[['sq'],['add',b]]},
        {target:n=>(n+shift)**2,solution:[['add',shift],['sq']]},
        {target:n=>(n-shift)**2+b,solution:[['add',-shift],['sq'],['add',b]]}
      ];
      const p=plans[i], inv={};p.solution.forEach(([type])=>inv[type]=(inv[type]||0)+1);
      const show=i<2||i===4?'rule':i<6?'table':'sequence';
      return {name:'Production order '+(i+1),slots:i<3?3:4,contracts:[{title:'Batch '+(i+1),show,rule:p.rule,inputs:[1,2,3,4,5],target:p.target,inv,par:p.solution.length,solution:p.solution}]};
    });
  }

  const DIFF = {
    easy:   { time: 300, spare: 20 },
    normal: { time: 240, spare: 12 },
    hard:   { time: 190, spare: 6,  preview: false }
  };
  const BATCH = 5;
  const EPS = 1e-9;

  /* ---------------- Polynomial helpers (for the composite rule) ---------------- */
  // A polynomial is an array of coefficients [c0, c1, c2, ...].
  const polyMul = (a, b) => { const r = new Array(a.length + b.length - 1).fill(0); a.forEach((x, i) => b.forEach((y, j) => { r[i + j] += x * y; })); return r; };
  function composite(line) {
    let p = [0, 1]; // starts as n
    for (const m of line) {
      if (!m) continue;
      if (m.type === 'add') p[0] += m.k;
      else if (m.type === 'mul') p = p.map((c) => c * m.k);
      else if (m.type === 'div') p = p.map((c) => c / m.k);
      else if (m.type === 'neg') p = p.map((c) => -c);
      else if (m.type === 'sq') p = polyMul(p, p);
    }
    return p;
  }
  function polyText(p) {
    const terms = [];
    for (let i = p.length - 1; i >= 0; i--) {
      const c = round(p[i], 6);
      if (Math.abs(c) < EPS) continue;
      const abs = Math.abs(c);
      const coef = i > 0 && abs === 1 ? '' : fraction(abs, 12, true);
      const v = i === 0 ? '' : i === 1 ? 'n' : `n${'²³⁴'[i - 2] || '^' + i}`;
      terms.push({ neg: c < 0, s: coef + v });
    }
    if (!terms.length) return '0';
    return terms.map((t, i) => (i === 0 ? (t.neg ? '−' : '') + t.s : (t.neg ? ' − ' : ' + ') + t.s)).join('');
  }
  const fmtVal = (v) => (Number.isInteger(round(v, 9)) ? String(round(v, 9)) : String(round(v, 2))).replace('-', '−');

  /* ---------------- DOM ---------------- */
  const belt = document.getElementById('belt');
  const dom = {
    tag: document.getElementById('contractTag'), brief: document.getElementById('contractBrief'), io: document.getElementById('ioTable'),
    palette: document.getElementById('palette'), slots: document.getElementById('slots'), info: document.getElementById('lineInfo'),
    start: document.getElementById('startBtn'), clear: document.getElementById('clearBtn'), report: document.getElementById('report')
  };
  let S = null;

  /* ---------------- Stage / contract flow ---------------- */
  function setupStage(idx) {
    S.cfg = MG.roundConfig(DIFF, idx);
    const st = STAGES[idx];
    S.stageIdx = idx;
    S.contractIdx = 0;
    S.materials = st.contracts.length * BATCH + S.cfg.spare;
    S.maxMaterials = S.materials;
    this_shell.setStage(`${idx + 1}/${STAGES.length}`);
    this_shell.setTimer(S.cfg.time);
    this_shell.toast(`Factory floor ${idx + 1}: ${st.name}`, 'info', 2600);
    setupContract();
  }
  function setupContract() {
    const st = STAGES[S.stageIdx];
    S.contract = st.contracts[S.contractIdx];
    S.line = new Array(st.slots).fill(null);
    S.armed = null;
    S.runs = 0;
    S.previewHelp = false;
    S.run = null;
    renderAll();
    updateMaterials();
  }

  const used = (type) => S.line.filter((m) => m && m.type === type).length;
  const available = (type) => (S.contract.inv[type] || 0) - used(type);

  /* ---------------- Line editing ---------------- */
  function arm(type) {
    if (!this_shell.isPlaying() || S.run) return;
    S.armed = S.armed === type ? null : type;
    MG.sound.play('click');
    renderPalette(); renderSlots();
  }
  function place(slot, type = S.armed) {
    if (!this_shell.isPlaying() || S.run || !type) return;
    if (S.line[slot]) { this_shell.toast('That slot is occupied — remove the machine first.', 'warn'); return; }
    if (available(type) <= 0) { this_shell.toast(`No ${MACHINES[type].name}s left for this contract.`, 'warn'); MG.sound.play('error'); return; }
    S.line[slot] = { type, k: MACHINES[type].start };
    if (available(type) <= 0) S.armed = null;
    MG.sound.play('place');
    renderAll();
  }
  function removeAt(slot) { if (S.run) return; S.line[slot] = null; MG.sound.play('whoosh'); renderAll(); }
  function move(slot, d) {
    if (S.run) return;
    const j = slot + d;
    if (j < 0 || j >= S.line.length) return;
    [S.line[slot], S.line[j]] = [S.line[j], S.line[slot]];
    MG.sound.play('click');
    renderAll();
  }
  function tune(slot, d) {
    if (S.run) return;
    const m = S.line[slot], def = MACHINES[m.type];
    let k = m.k + d;
    if (def.skip0 && k === 0) k += d;
    m.k = clamp(k, def.min, def.max);
    MG.sound.play('click');
    renderAll();
  }
  function clearLine() { if (!this_shell.isPlaying() || S.run) return; S.line = S.line.map(() => null); MG.sound.play('whoosh'); renderAll(); }

  /* ---------------- Production ---------------- */
  function startProduction() {
    if (!this_shell.isPlaying() || S.run) return;
    const machines = S.line.filter(Boolean);
    if (!machines.length) { this_shell.toast('The line is empty — place at least one machine.', 'warn'); MG.sound.play('error'); return; }
    if (S.materials < BATCH) return outOfMaterials();
    S.materials -= BATCH;
    updateMaterials();
    S.runs++; S.totalRuns++;
    const gap = 0.9 + 0.25 * machines.length; // more machines = slower throughput
    S.run = {
      gap, spawnT: 0, spawned: 0, speed: 0, crates: [], results: [],
      inputs: S.contract.inputs.slice()
    };
    MG.sound.play('engine');
    renderAll();
  }

  /** Slot centre positions on the belt canvas, matched to the slot cards. */
  function slotXs() {
    const br = belt.getBoundingClientRect();
    return [...dom.slots.children].map((c) => { const r = c.getBoundingClientRect(); return r.left + r.width / 2 - br.left; });
  }

  function updateRun(dt) {
    const R = S.run;
    if (!R) return;
    const w = belt.getBoundingClientRect().width;
    R.speed = Math.max(90, w / 5);
    R.spawnT -= dt;
    if (R.spawned < R.inputs.length && R.spawnT <= 0) {
      const n = R.inputs[R.spawned];
      R.crates.push({ n, v: n, x: 10, next: 0, done: false, flash: 0 });
      R.spawned++;
      R.spawnT = R.gap;
    }
    const xs = slotXs();
    for (const c of R.crates) {
      if (c.done) continue;
      c.x += R.speed * dt;
      if (c.flash > 0) c.flash -= dt;
      // Apply each machine in order as the crate passes its centre.
      while (c.next < S.line.length && c.x >= xs[c.next]) {
        const m = S.line[c.next];
        if (m) { c.v = MACHINES[m.type].apply(c.v, m.k); c.flash = 0.25; MG.sound.play('place'); }
        c.next++;
      }
      if (c.x >= w - 30) {
        c.done = true;
        const need = S.contract.target(c.n);
        const ok = Math.abs(c.v - need) < 1e-6;
        R.results.push({ n: c.n, out: c.v, need, ok });
        MG.sound.play(ok ? 'coin' : 'error');
        renderIO(R.results);
      }
    }
    if (R.results.length === R.inputs.length) finishRun();
  }

  function finishRun() {
    const R = S.run;
    S.run = null;
    const good = R.results.filter((r) => r.ok).length;
    const waste = R.results.length - good;
    S.waste += waste;
    S.crates += R.results.length;
    const machines = S.line.filter(Boolean);
    const energy = machines.reduce((a, m) => a + MACHINES[m.type].energy, 0);
    const rate = round(60 / R.gap, 1);
    const comp = polyText(composite(S.line));
    const rows = R.results.map((r) => `<tr><td>${fmtVal(r.n)}</td><td>${fmtVal(r.out)}</td><td>${fmtVal(r.need)}</td><td class="${r.ok ? 'ok' : 'bad'}">${r.ok ? '✔' : '✘'}</td></tr>`).join('');
    const complete = waste === 0;
    this_shell.maths.record('Functions and sequences','factory:'+S.stageIdx,complete);
    let sum;
    if (complete) {
      const extra = Math.max(0, machines.length - S.contract.par);
      let pts = 200 + (S.runs === 1 ? 100 : 0) + Math.max(0, 100 - extra * 40);
      this_shell.addScore(pts, S.runs === 1 ? 'Contract, first run!' : 'Contract complete', dom.start);
      S.contractsDone++;
      if (S.runs === 1) S.firstTry++;
      if (machines.length <= S.contract.par) S.parBuilds++;
      sum = `<div class="rep-sum is-good"><strong>✔ Contract fulfilled!</strong><br>Your line computes <strong>${comp}</strong>.<br>Machines: ${machines.length} (par ${S.contract.par}) · energy ${energy}/crate · rate ${rate} crates/min</div>`;
      MG.sound.play('success');
      this_shell.flash('good');
    } else {
      this_shell.addScore(-10 * waste, `${waste} crate(s) scrapped`, dom.start);
      sum = `<div class="rep-sum is-bad"><strong>✘ ${waste} of ${R.results.length} crates failed inspection</strong> and were scrapped.<br>Your line computes <strong>${comp}</strong> — compare it with the required outputs.</div>`;
      MG.sound.play('error');
      this_shell.flash('bad');
    }
    dom.report.innerHTML = sum + `<table class="rep"><thead><tr><th>In</th><th>Out</th><th>Need</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
    if (complete) nextContract();
    else if (S.materials < BATCH) outOfMaterials();
    else renderAll();
  }

  function nextContract() {
    const st = STAGES[S.stageIdx];
    S.contractIdx++;
    if (S.contractIdx >= st.contracts.length) {
      const bonus = Math.round(this_shell.timeLeft) + S.materials * 5;
      this_shell.addScore(bonus, 'Floor complete');
      S.stagesDone++;
      MG.sound.play('stage');
      if (S.stageIdx + 1 >= STAGES.length) return finish(true, 'Factory fully automated!', 'Every production contract has been fulfilled.');
      return setupStage(S.stageIdx + 1);
    }
    setupContract();
  }

  function outOfMaterials() {
    finish(false, 'Out of raw materials', 'There are not enough crates left for another production run. Plan the pipeline before pressing Start — every failed run scraps a whole batch.');
  }
  function updateMaterials() {
    this_shell.setResource(`📦 ${S.materials}`, S.materials < BATCH * 2);
    const st = STAGES[S.stageIdx];
    this_shell.setProgress(S.contractIdx / st.contracts.length, `Contracts ${S.contractIdx}/${st.contracts.length}`);
  }

  /* ---------------- Rendering ---------------- */
  function renderAll() { renderContract(); renderPalette(); renderSlots(); renderInfo(); }

  function renderContract() {
    const c = S.contract, st = STAGES[S.stageIdx];
    dom.tag.textContent = `Floor ${S.stageIdx + 1} · contract ${S.contractIdx + 1}/${st.contracts.length}`;
    let brief = `<strong>${c.title}:</strong> `;
    if (c.show === 'rule') brief += `every crate numbered <em>n</em> must leave as <strong>${c.rule}</strong>.`;
    else if (c.show === 'table') brief += 'find the rule from the table and build a line that produces every output.';
    else brief += 'crates numbered 1–5 must become these sequence terms. Find the n-th term rule.';
    brief += ` Batch: ${BATCH} crates.`;
    dom.brief.innerHTML = brief;
    renderIO(null);
  }
  function renderIO(results) {
    const c = S.contract;
    const head = c.show === 'sequence' ? ['Position n', 'Term'] : ['Input n', 'Output'];
    const outs = c.inputs.map((n, i) => {
      const r = results && results[i];
      return `<td class="${r ? (r.ok ? 'is-ok' : 'is-bad') : ''}">${fmtVal(c.target(n))}</td>`;
    }).join('');
    dom.io.innerHTML = `<tr><th>${head[0]}</th>${c.inputs.map((n) => `<td>${fmtVal(n)}</td>`).join('')}</tr><tr><th>${head[1]}</th>${outs}</tr>`;
  }

  function renderPalette() {
    dom.palette.innerHTML = '';
    for (const [type, m] of Object.entries(MACHINES)) {
      const have = S.contract.inv[type] || 0;
      if (!have) continue;
      const left = available(type);
      const b = el('button', { type: 'button', class: 'mach', draggable: 'true', 'aria-pressed': String(S.armed === type), disabled: left <= 0 || !!S.run, 'aria-label': `${m.name}: ${m.desc}. ${left} available` });
      b.innerHTML = `<span class="mach__icon" style="background:${m.color}">${m.icon}</span><span class="mach__name">${m.name}<small>${m.desc} · ⚡${m.energy}</small></span><span class="mach__count">×${left}</span>`;
      b.addEventListener('click', () => arm(type));
      b.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', type); S.armed = type; });
      dom.palette.append(b);
    }
  }

  function renderSlots() {
    const n = S.line.length;
    dom.slots.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
    dom.slots.innerHTML = '';
    S.line.forEach((m, i) => {
      if (!m) {
        const s = el('button', { type: 'button', class: 'slot' + (S.armed ? ' is-target' : ''), 'aria-label': `Empty slot ${i + 1}${S.armed ? ', place ' + MACHINES[S.armed].name : ''}` }, el('strong', {}, `Slot ${i + 1}`), S.armed ? `Place ${MACHINES[S.armed].name}` : 'empty');
        s.addEventListener('click', () => place(i));
        s.addEventListener('dragover', (e) => { e.preventDefault(); s.classList.add('is-over'); });
        s.addEventListener('dragleave', () => s.classList.remove('is-over'));
        s.addEventListener('drop', (e) => { e.preventDefault(); s.classList.remove('is-over'); place(i, e.dataTransfer.getData('text/plain')); });
        dom.slots.append(s);
        return;
      }
      const def = MACHINES[m.type];
      const card = el('div', { class: 'slot is-filled', role: 'group', 'aria-label': `Slot ${i + 1}: ${def.name} ${def.rule(m.k)}` });
      card.append(el('span', { class: 'slot__rule', style: `color:${def.color}` }, def.rule(m.k)), el('span', { class: 'slot__fx' }, def.fx(m.k)));
      const ctl = el('div', { class: 'slot__ctl' });
      const btn = (label, aria, fn, cls = '') => { const b = el('button', { type: 'button', class: 'mg-btn ' + cls, 'aria-label': aria, disabled: !!S.run }, label); b.addEventListener('click', fn); ctl.append(b); };
      if ('min' in def) { btn('−', `Decrease k for ${def.name}`, () => tune(i, -1)); btn('+', `Increase k for ${def.name}`, () => tune(i, 1)); }
      btn('◀', 'Move machine left', () => move(i, -1));
      btn('▶', 'Move machine right', () => move(i, 1));
      btn('✕', `Remove ${def.name}`, () => removeAt(i), 'is-del');
      card.append(ctl);
      dom.slots.append(card);
    });
  }

  function renderInfo() {
    const machines = S.line.filter(Boolean);
    const energy = machines.reduce((a, m) => a + MACHINES[m.type].energy, 0);
    const rate = machines.length ? round(60 / (0.9 + 0.25 * machines.length), 1) : 0;
    let html = `Machines <strong>${machines.length}</strong> (par ${S.contract.par}) · energy <strong>${energy}</strong>/crate · rate <strong>${rate}</strong> crates/min · materials <strong>${S.materials}</strong>`;
    if (S.previewHelp && machines.length) {
      const n = S.contract.inputs[0];
      let v = n;
      const steps = [fmtVal(n)];
      for (const m of S.line) if (m) { v = MACHINES[m.type].apply(v, m.k); steps.push(`${MACHINES[m.type].rule(m.k)} → ${fmtVal(v)}`); }
      const ok = Math.abs(v - S.contract.target(n)) < 1e-6;
      html += `<br>Preview: ${steps.join(' ')} ${ok ? '✔' : `✘ need ${fmtVal(S.contract.target(n))}`} · line rule = ${polyText(composite(S.line))}`;
    }
    dom.info.innerHTML = html;
    dom.start.disabled = !!S.run;
    dom.clear.disabled = !!S.run;
    dom.start.textContent = S.run ? '⚙ Producing…' : '▶ Start Production';
    if (!S.previewHelp) {
      const hint=el('button',{class:'mg-btn mg-btn--sm',type:'button'},'Inspect one crate (assisted)');
      hint.addEventListener('click',()=>{S.previewHelp=true;this_shell.maths.assist('Functions and sequences','factory:'+S.stageIdx);renderInfo();});dom.info.append(hint);
    }
  }

  /* ---------------- Belt canvas ---------------- */
  function draw(time) {
    const f = MG.fitCanvas(belt), ctx = f.ctx;
    ctx.clearRect(0, 0, f.w, f.h);
    const by = f.h * 0.62, bh = 34;
    // Belt
    ctx.fillStyle = '#15181b'; ctx.fillRect(0, by - bh / 2, f.w, bh);
    const off = S.run ? (time * S.run.speed) % 24 : 0;
    ctx.strokeStyle = '#3c434b'; ctx.lineWidth = 3;
    for (let x = -24 + off; x < f.w; x += 24) { ctx.beginPath(); ctx.moveTo(x, by - bh / 2); ctx.lineTo(x + 10, by + bh / 2); ctx.stroke(); }
    // Hopper and shipping bin
    ctx.fillStyle = '#4f7d68'; ctx.fillRect(0, by - bh / 2 - 46, 50, 46); ctx.strokeStyle = '#1c1f1e'; ctx.lineWidth = 2; ctx.strokeRect(1, by - bh / 2 - 45, 48, 44);
    ctx.fillStyle = '#efe6cf'; ctx.font = '700 13px "Saira Condensed", sans-serif'; ctx.textAlign = 'center'; ctx.fillText('INPUT', 25, by - bh / 2 - 20);
    ctx.fillStyle = '#ff7a1a'; ctx.fillRect(f.w - 54, by - bh / 2 - 46, 54, 46); ctx.strokeStyle = '#1c1f1e'; ctx.lineWidth = 2; ctx.strokeRect(f.w - 53, by - bh / 2 - 45, 52, 44);
    ctx.fillStyle = '#1c1f1e'; ctx.fillText('QC', f.w - 27, by - bh / 2 - 20);
    // Machines above the belt at slot positions
    const xs = slotXs();
    S.line.forEach((m, i) => {
      const x = xs[i];
      if (x == null) return;
      if (!m) { ctx.strokeStyle = '#59626d'; ctx.setLineDash([5, 4]); ctx.strokeRect(x - 30, by - bh / 2 - 66, 60, 60); ctx.setLineDash([]); return; }
      const def = MACHINES[m.type];
      const active = S.run && S.run.crates.some((c) => !c.done && Math.abs(c.x - x) < 26);
      ctx.fillStyle = '#2c4a3d'; ctx.fillRect(x - 32, by - bh / 2 - 70, 64, 64);
      ctx.fillStyle = '#c4ccd0'; for (const [rx, ry] of [[-28, -66], [28, -66], [-28, -12], [28, -12]]) { ctx.beginPath(); ctx.arc(x + rx, by - bh / 2 + ry, 2, 0, 7); ctx.fill(); }
      ctx.fillStyle = def.color; ctx.fillRect(x - 26, by - bh / 2 - 64, 52, 40);
      ctx.fillStyle = '#1c1f1e'; ctx.font = '19px "Share Tech Mono", monospace'; ctx.fillText(def.rule(m.k).replace('× (−1)', '−x'), x, by - bh / 2 - 38);
      // Pistons pump while a crate passes
      const pump = active ? Math.abs(Math.sin(time * 18)) * 8 : 0;
      ctx.fillStyle = '#9aa3ad'; ctx.fillRect(x - 6, by - bh / 2 - 24, 12, 10 + pump);
      // Warning stripes
      ctx.fillStyle = '#ffc21a'; for (let k = -30; k < 30; k += 12) ctx.fillRect(x + k, by - bh / 2 - 8, 6, 4);
    });
    // Crates
    if (S.run) for (const c of S.run.crates) {
      if (c.done) continue;
      const s = 38;
      ctx.fillStyle = c.flash > 0 ? '#fff59d' : '#c58b4e'; ctx.fillRect(c.x - s / 2, by - bh / 2 - s + 6, s, s);
      ctx.strokeStyle = '#7a5025'; ctx.lineWidth = 2; ctx.strokeRect(c.x - s / 2, by - bh / 2 - s + 6, s, s);
      ctx.fillStyle = '#1c1f1e'; ctx.font = `${String(fmtVal(c.v)).length > 3 ? 13 : 18}px "Share Tech Mono", monospace`; ctx.fillText(fmtVal(c.v), c.x, by - bh / 2 - s / 2 + 11);
    }
  }

  /* ---------------- End ---------------- */
  function finish(won, title, reason) {
    S.run = null;
    const total = STAGES.reduce((a, s) => a + s.contracts.length, 0);
    const wastePct = S.crates ? Math.round((S.waste / S.crates) * 100) : 0;
    let stars;
    if (won) stars = S.firstTry >= Math.ceil(total * 0.8) && wastePct <= 10 ? 3 : S.firstTry >= Math.ceil(total * 0.5) ? 2 : 1;
    else stars = S.stagesDone >= 2 ? 2 : S.stagesDone >= 1 ? 1 : 0;
    this_shell.end({
      won, title, reason, stars,
      stats: [
        ['Factory floors', `${S.stagesDone} / ${STAGES.length}`],
        ['Contracts fulfilled', `${S.contractsDone} / ${total}`],
        ['First-run successes', S.firstTry],
        ['Builds at par', S.parBuilds],
        ['Production runs', S.totalRuns],
        ['Crates scrapped', `${S.waste} (${wastePct}%)`],
        ['Materials left', S.materials],
        ['Play time', MG.fmtTime(this_shell.playTime)]
      ],
      math: [
        'Each machine is a function. A line of machines is a <strong>composite function</strong>: ×3 then +2 gives 3n + 2, but +2 then ×3 gives 3(n + 2) = 3n + 6 — order matters.',
        'From a table: the output goes up by the same amount each step (the common difference) → that is the multiplier; then adjust with the adder. E.g. 7, 9, 11… goes up by 2 → 2n + 5.',
        'Sequence n-th term: 9, 7, 5, 3, 1 has difference −2, so the rule is −2n + 11.',
        'Non-linear: 2, 5, 10, 17, 26 has differences 3, 5, 7, 9 (not constant) → it involves n²: n² + 1.',
        `You fulfilled ${S.firstTry} contract(s) on the first run and scrapped ${wastePct}% of crates.`
      ]
    });
  }

  /* ---------------- Shell ---------------- */
  const this_shell = MG.createShell({
    id: 'function-factory',
    title: 'Function Factory',
    tagline: 'Numbered crates roll in. Clients want them changed into exact values. Build the machine line that does it!',
    goal: 'Complete every work order on all 10 factory floors.',
    steps: [
      ['📋', 'Read the work order. What must each crate become?'],
      ['⚙️', 'Put machines on the line and set their numbers.'],
      ['▶️', 'Start production. Every crate must pass QC!']
    ],
    keys: [
      ['<kbd>Enter</kbd>', 'Start production'],
      ['<kbd>C</kbd>', 'Clear the line'],
      ['<kbd>P</kbd>', 'Pause']
    ],
    genre: 'Production & automation puzzle',
    topic: 'Functions, composition, linear rules, sequences',
    premise: 'Numbered crates roll off the supply line and clients want them transformed into exact values. Your tools: adders, multipliers, dividers and squarers.',
    objective: 'Build production lines that turn every input crate into the required output. Complete ten fresh production contracts before time or materials run out.',
    livesLabel: 'Materials',
    stageLabel: 'Round',
    art: `<svg viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice"><rect width="400" height="500" fill="#2a2e2d"/><path d="M4 14l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M4 54l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M4 94l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M4 134l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M4 174l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M4 214l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M4 254l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M4 294l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M4 334l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M4 374l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M4 414l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M4 454l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M4 494l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M4 534l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M24 34l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M24 74l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M24 114l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M24 154l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M24 194l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M24 234l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M24 274l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M24 314l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M24 354l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M24 394l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M24 434l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M24 474l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M24 514l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M24 554l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M44 14l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M44 54l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M44 94l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M44 134l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M44 174l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M44 214l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M44 254l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M44 294l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M44 334l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M44 374l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M44 414l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M44 454l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M44 494l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M44 534l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M64 34l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M64 74l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M64 114l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M64 154l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M64 194l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M64 234l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M64 274l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M64 314l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M64 354l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M64 394l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M64 434l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M64 474l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M64 514l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M64 554l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M84 14l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M84 54l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M84 94l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M84 134l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M84 174l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M84 214l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M84 254l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M84 294l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M84 334l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M84 374l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M84 414l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M84 454l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M84 494l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M84 534l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M104 34l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M104 74l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M104 114l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M104 154l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M104 194l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M104 234l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M104 274l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M104 314l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M104 354l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M104 394l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M104 434l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M104 474l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M104 514l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M104 554l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M124 14l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M124 54l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M124 94l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M124 134l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M124 174l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M124 214l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M124 254l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M124 294l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M124 334l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M124 374l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M124 414l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M124 454l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M124 494l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M124 534l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M144 34l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M144 74l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M144 114l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M144 154l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M144 194l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M144 234l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M144 274l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M144 314l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M144 354l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M144 394l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M144 434l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M144 474l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M144 514l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M144 554l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M164 14l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M164 54l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M164 94l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M164 134l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M164 174l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M164 214l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M164 254l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M164 294l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M164 334l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M164 374l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M164 414l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M164 454l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M164 494l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M164 534l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M184 34l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M184 74l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M184 114l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M184 154l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M184 194l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M184 234l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M184 274l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M184 314l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M184 354l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M184 394l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M184 434l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M184 474l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M184 514l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M184 554l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M204 14l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M204 54l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M204 94l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M204 134l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M204 174l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M204 214l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M204 254l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M204 294l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M204 334l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M204 374l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M204 414l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M204 454l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M204 494l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M204 534l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M224 34l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M224 74l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M224 114l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M224 154l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M224 194l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M224 234l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M224 274l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M224 314l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M224 354l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M224 394l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M224 434l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M224 474l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M224 514l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M224 554l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M244 14l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M244 54l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M244 94l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M244 134l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M244 174l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M244 214l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M244 254l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M244 294l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M244 334l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M244 374l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M244 414l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M244 454l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M244 494l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M244 534l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M264 34l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M264 74l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M264 114l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M264 154l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M264 194l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M264 234l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M264 274l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M264 314l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M264 354l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M264 394l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M264 434l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M264 474l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M264 514l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M264 554l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M284 14l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M284 54l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M284 94l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M284 134l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M284 174l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M284 214l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M284 254l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M284 294l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M284 334l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M284 374l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M284 414l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M284 454l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M284 494l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M284 534l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M304 34l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M304 74l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M304 114l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M304 154l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M304 194l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M304 234l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M304 274l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M304 314l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M304 354l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M304 394l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M304 434l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M304 474l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M304 514l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M304 554l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M324 14l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M324 54l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M324 94l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M324 134l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M324 174l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M324 214l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M324 254l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M324 294l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M324 334l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M324 374l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M324 414l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M324 454l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M324 494l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M324 534l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M344 34l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M344 74l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M344 114l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M344 154l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M344 194l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M344 234l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M344 274l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M344 314l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M344 354l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M344 394l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M344 434l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M344 474l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M344 514l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M344 554l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M364 14l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M364 54l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M364 94l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M364 134l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M364 174l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M364 214l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M364 254l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M364 294l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M364 334l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M364 374l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M364 414l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M364 454l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M364 494l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M364 534l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M384 34l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M384 74l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M384 114l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M384 154l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M384 194l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M384 234l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M384 274l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M384 314l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M384 354l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M384 394l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M384 434l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M384 474l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M384 514l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M384 554l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M404 14l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M404 54l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M404 94l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M404 134l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M404 174l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M404 214l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M404 254l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M404 294l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M404 334l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M404 374l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M404 414l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M404 454l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M404 494l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M404 534l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M424 34l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M424 74l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M424 114l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M424 154l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M424 194l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M424 234l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M424 274l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M424 314l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M424 354l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M424 394l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M424 434l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M424 474l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M424 514l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M424 554l10 -8" stroke="#3d4442" stroke-width="3" stroke-linecap="round"/><path d="M354.3 80.0L351.6 96.8L343.7 94.2L337.2 107.0L343.9 111.9L331.9 123.9L327.0 117.2L314.2 123.7L316.8 131.6L300.0 134.3L300.0 126.0L285.8 123.7L283.2 131.6L268.1 123.9L273.0 117.2L262.8 107.0L256.1 111.9L248.4 96.8L256.3 94.2L254.0 80.0L245.7 80.0L248.4 63.2L256.3 65.8L262.8 53.0L256.1 48.1L268.1 36.1L273.0 42.8L285.8 36.3L283.2 28.4L300.0 25.7L300.0 34.0L314.2 36.3L316.8 28.4L331.9 36.1L327.0 42.8L337.2 53.0L343.9 48.1L351.6 63.2L343.7 65.8L346.0 80.0Z" fill="#c9a03d" stroke="#1c1f1e" stroke-width="3"/><circle cx="300" cy="80" r="16.1" fill="#1c1f1e"/><path d="M267.4 128.0L264.7 141.5L259.7 139.5L253.2 149.2L257.0 153.0L245.5 160.7L243.5 155.7L232.0 158.0L232.0 163.4L218.5 160.7L220.5 155.7L210.8 149.2L207.0 153.0L199.3 141.5L204.3 139.5L202.0 128.0L196.6 128.0L199.3 114.5L204.3 116.5L210.8 106.8L207.0 103.0L218.5 95.3L220.5 100.3L232.0 98.0L232.0 92.6L245.5 95.3L243.5 100.3L253.2 106.8L257.0 103.0L264.7 114.5L259.7 116.5L262.0 128.0Z" fill="#9aa3a8" stroke="#1c1f1e" stroke-width="3"/><circle cx="232" cy="128" r="10.5" fill="#1c1f1e"/><rect x="70" y="150" width="260" height="190" rx="8" fill="#4f7d68" stroke="#1c1f1e" stroke-width="5"/><rect x="88" y="168" width="224" height="40" rx="4" fill="#efe6cf" stroke="#1c1f1e" stroke-width="3"/><text x="200" y="198" text-anchor="middle" font-family="Saira Stencil One, Impact, sans-serif" font-size="26" fill="#2c4a3d">f(x) = 3x + 2</text><circle cx="140" cy="270" r="44" fill="#efe6cf" stroke="#1c1f1e" stroke-width="5"/><path d="M110 280A32 32 0 0 1 170 280" fill="none" stroke="#c62828" stroke-width="6"/><path d="M140 270L166 246" stroke="#1c1f1e" stroke-width="5" stroke-linecap="round"/><circle cx="140" cy="270" r="6" fill="#1c1f1e"/><g fill="#c4ccd0"><circle cx="82" cy="162" r="4"/><circle cx="318" cy="162" r="4"/><circle cx="82" cy="328" r="4"/><circle cx="318" cy="328" r="4"/></g><rect x="210" y="236" width="96" height="40" rx="3" fill="#0f1312" stroke="#5d6a66" stroke-width="3"/><text x="258" y="265" text-anchor="middle" font-family="Share Tech Mono, monospace" font-size="26" fill="#8dffb4">× 3</text><rect x="210" y="284" width="96" height="40" rx="3" fill="#0f1312" stroke="#5d6a66" stroke-width="3"/><text x="258" y="313" text-anchor="middle" font-family="Share Tech Mono, monospace" font-size="26" fill="#8dffb4">+ 2</text><rect x="0" y="412" width="400" height="26" fill="#111413" stroke="#1c1f1e" stroke-width="3"/><path d="M0 414l8 22" stroke="#3c434b" stroke-width="3"/><path d="M20 414l8 22" stroke="#3c434b" stroke-width="3"/><path d="M40 414l8 22" stroke="#3c434b" stroke-width="3"/><path d="M60 414l8 22" stroke="#3c434b" stroke-width="3"/><path d="M80 414l8 22" stroke="#3c434b" stroke-width="3"/><path d="M100 414l8 22" stroke="#3c434b" stroke-width="3"/><path d="M120 414l8 22" stroke="#3c434b" stroke-width="3"/><path d="M140 414l8 22" stroke="#3c434b" stroke-width="3"/><path d="M160 414l8 22" stroke="#3c434b" stroke-width="3"/><path d="M180 414l8 22" stroke="#3c434b" stroke-width="3"/><path d="M200 414l8 22" stroke="#3c434b" stroke-width="3"/><path d="M220 414l8 22" stroke="#3c434b" stroke-width="3"/><path d="M240 414l8 22" stroke="#3c434b" stroke-width="3"/><path d="M260 414l8 22" stroke="#3c434b" stroke-width="3"/><path d="M280 414l8 22" stroke="#3c434b" stroke-width="3"/><path d="M300 414l8 22" stroke="#3c434b" stroke-width="3"/><path d="M320 414l8 22" stroke="#3c434b" stroke-width="3"/><path d="M340 414l8 22" stroke="#3c434b" stroke-width="3"/><path d="M360 414l8 22" stroke="#3c434b" stroke-width="3"/><path d="M380 414l8 22" stroke="#3c434b" stroke-width="3"/><path d="M400 414l8 22" stroke="#3c434b" stroke-width="3"/><g transform="translate(94 388)"><rect x="-24" y="-24" width="48" height="48" fill="#c58b4e" stroke="#1c1f1e" stroke-width="3"/><path d="M-24 -24L24 24M24 -24L-24 24" stroke="#7a5025" stroke-width="2" opacity=".5"/><text y="8" text-anchor="middle" font-family="Share Tech Mono, monospace" font-size="26" fill="#1c1f1e">4</text></g><g transform="translate(306 388)"><rect x="-24" y="-24" width="48" height="48" fill="#c58b4e" stroke="#1c1f1e" stroke-width="3"/><path d="M-24 -24L24 24M24 -24L-24 24" stroke="#7a5025" stroke-width="2" opacity=".5"/><text y="8" text-anchor="middle" font-family="Share Tech Mono, monospace" font-size="22" fill="#1c1f1e">14</text></g><path d="M132 388h26M242 388h26" stroke="#ff7a1a" stroke-width="6" stroke-linecap="round"/><path d="M150 376l14 12l-14 12M262 376l14 12l-14 12" fill="none" stroke="#ff7a1a" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><rect y="480" width="400" height="20" fill="#1c1f1e"/><path d="M-40 500l20 -20h10l-20 20Z" fill="#ffc21a"/><path d="M-20 500l20 -20h10l-20 20Z" fill="#ffc21a"/><path d="M0 500l20 -20h10l-20 20Z" fill="#ffc21a"/><path d="M20 500l20 -20h10l-20 20Z" fill="#ffc21a"/><path d="M40 500l20 -20h10l-20 20Z" fill="#ffc21a"/><path d="M60 500l20 -20h10l-20 20Z" fill="#ffc21a"/><path d="M80 500l20 -20h10l-20 20Z" fill="#ffc21a"/><path d="M100 500l20 -20h10l-20 20Z" fill="#ffc21a"/><path d="M120 500l20 -20h10l-20 20Z" fill="#ffc21a"/><path d="M140 500l20 -20h10l-20 20Z" fill="#ffc21a"/><path d="M160 500l20 -20h10l-20 20Z" fill="#ffc21a"/><path d="M180 500l20 -20h10l-20 20Z" fill="#ffc21a"/><path d="M200 500l20 -20h10l-20 20Z" fill="#ffc21a"/><path d="M220 500l20 -20h10l-20 20Z" fill="#ffc21a"/><path d="M240 500l20 -20h10l-20 20Z" fill="#ffc21a"/><path d="M260 500l20 -20h10l-20 20Z" fill="#ffc21a"/><path d="M280 500l20 -20h10l-20 20Z" fill="#ffc21a"/><path d="M300 500l20 -20h10l-20 20Z" fill="#ffc21a"/><path d="M320 500l20 -20h10l-20 20Z" fill="#ffc21a"/><path d="M340 500l20 -20h10l-20 20Z" fill="#ffc21a"/><path d="M360 500l20 -20h10l-20 20Z" fill="#ffc21a"/><path d="M380 500l20 -20h10l-20 20Z" fill="#ffc21a"/><path d="M400 500l20 -20h10l-20 20Z" fill="#ffc21a"/><path d="M420 500l20 -20h10l-20 20Z" fill="#ffc21a"/><path d="M440 500l20 -20h10l-20 20Z" fill="#ffc21a"/><path d="M460 500l20 -20h10l-20 20Z" fill="#ffc21a"/></svg>`,
    instructions: {
      objective: 'Fulfil every contract on all 10 factory floors. A contract is fulfilled when a production run delivers every crate with exactly the required output.',
      controls: [
        'Tap a machine in the Machines list, then tap an empty slot to install it (desktop: you can also drag a machine onto a slot).',
        'On an installed machine use −/+ to set k, ◀ ▶ to change its position and ✕ to remove it.',
        '<strong>Start Production</strong> (or <kbd>Enter</kbd>) runs a batch of 5 crates along the belt. <kbd>C</kbd> clears the line. <kbd>P</kbd>/<kbd>Esc</kbd> pause.'
      ],
      maths: [
        'Each machine applies a function to the number on a crate. Machines act in order from left to right, so the whole line is a composite function.',
        'Contracts give a rule, a table of inputs/outputs or a sequence of terms. Look at how the outputs change to find the rule.',
        'After each run, Quality Control shows the rule your line actually computes (e.g. 3n + 6) so you can compare it with the target.',
        'The optional crate inspection is recorded as assisted. Independent accuracy is measured before any preview.'
      ],
      scoring: [
        'Contract fulfilled: +200, +100 if it worked on the first run, and up to +100 for using no more machines than par (−40 per extra machine).',
        'Scrapped crates: −10 each. Finishing a floor: +1 per second left and +5 per spare crate.'
      ],
      failure: [
        'Every production run uses 5 crates of raw material, and wrong outputs are scrapped. If you cannot afford another batch, the factory closes.',
        'The run also ends if a floor timer reaches 0:00.'
      ],
      timer: [
        'Each factory floor has a countdown. Pausing freezes the belt, the crates and the timer.'
      ]
    },
    stars: [
      '1 star: complete Floor 1 (or the whole factory).',
      '2 stars: complete all floors with at least half the contracts fulfilled on their first run (a failed run that completed 2 floors also earns 2).',
      '3 stars: complete all floors with at least 80% first-run successes and no more than 10% of crates scrapped.'
    ],
    onStart(diff) {
      STAGES = freshContracts();
      S = { cfg: DIFF[diff], waste: 0, crates: 0, contractsDone: 0, firstTry: 0, parBuilds: 0, totalRuns: 0, stagesDone: 0 };
      dom.report.innerHTML = '<p class="hint">Run the line to see the inspection report.</p>';
      setupStage(0);
    },
    onUpdate(dt) {
      S.clock = (S.clock || 0) + dt;
      updateRun(dt);
      if (this_shell.isPlaying()) draw(S.clock);
    },
    onTimeUp() { finish(false, 'Shift over', `The timer ran out on floor ${S.stageIdx + 1} with contract ${S.contractIdx + 1} unfinished.`); },
    onStop() { if (S) S.run = null; }
  });

  /* ---------------- Input (bound once) ---------------- */
  dom.start.addEventListener('click', startProduction);
  dom.clear.addEventListener('click', clearLine);
  window.addEventListener('keydown', (e) => {
    if (!this_shell.isPlaying()) return;
    if (e.key === 'Enter' && !MG.isTarget(e, 'button')) { e.preventDefault(); startProduction(); }
    else if (e.key === 'c' || e.key === 'C') clearLine();
  });

  MG.game = { get state() { return S; }, arm, place, tune, move, startProduction, composite, polyText, get STAGES(){return STAGES;} };
})();
