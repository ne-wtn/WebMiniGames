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
   Data Detective — mean, median, mode, range, sorting/filtering data and
   interpreting displays. A fresh case is generated every run. Players
   collect datasets around the city, analyse them in the data lab, pin
   findings (a set of rows + a highlighted statistic) as evidence cards and
   attach them to leads. Submit Case Report checks the evidence logically:
   each lead has a validator that inspects the actual rows and statistic.
   ========================================================================== */
(() => {
  'use strict';
  const { el, clamp, round, pick, shuffle, randInt } = MG;

  /* ---------------- Statistics ---------------- */
  const ST = {
    mean: (a) => a.reduce((s, x) => s + x, 0) / a.length,
    median(a) { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; },
    mode(a) {
      const c = new Map(); a.forEach((x) => c.set(x, (c.get(x) || 0) + 1));
      const max = Math.max(...c.values());
      if (max === 1) return null;
      return [...c.entries()].filter(([, n]) => n === max).map(([v]) => v).sort((x, y) => x - y);
    },
    range: (a) => Math.max(...a) - Math.min(...a)
  };
  const fmtStat = (k, v) => (v == null ? 'none' : Array.isArray(v) ? v.join(', ') : String(round(v, 2)));

  /* ---------------- Case generation ---------------- */
  const SUSPECTS = ['Ada Finch', 'Bram Holt', 'Cleo Marsh', 'Dev Patel', 'Eli Stone', 'Fay Moreno'];
  const DOORS = ['Main Entrance', 'Loading Bay', 'Roof Hatch', 'Staff Door', 'Fire Exit'];
  const STATIONS = ['Museum Quarter', 'Harbour', 'Old Town', 'University'];
  const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  function generateCase(roundIndex = 0) {
    const tier=MG.roundTier(roundIndex);
    const names = shuffle(SUSPECTS);
    const [C, D, A, N, F1, F2] = names;
    const H = pick([1, 2, 3, 4]);
    const C_ = { culprit: C, decoy: D, alibi: A, near: N, far: [F1, F2], hour: H };
    let id = 0;
    const row = (o) => Object.assign({ _id: ++id }, o);

    const sensors = [];
    for (let h = 0; h < 24; h++) {
      const closed = h < 8 || h >= 18;
      const motion = h === H ? randInt(38, 52) : closed ? randInt(0, 4) : randInt(60, 140);
      sensors.push(row({ hour: h, status: closed ? 'Closed' : 'Open', motion, temp: round(19 + Math.random() * 3 + (h === H ? 1.5 : 0), 1) }));
    }
    const doors = [];
    const closedHours = [...Array(24).keys()].filter((h) => h < 8 || h >= 18);
    for (const d of DOORS) for (const h of closedHours) {
      let opens = Math.random() < 0.08 ? 1 : 0;
      if (h === H) opens = d === 'Loading Bay' ? 3 : 0;
      if (d === 'Staff Door' && h === 22) opens = 2; // night guard's rounds (a distractor)
      doors.push(row({ door: d, hour: h, opens }));
    }
    // Metro: four suspects tap out at Museum Quarter within an hour of the break-in.
    const metro = [];
    const win = H * 60;
    metro.push(row({ name: C, station: 'Museum Quarter', time: win - randInt(10, 50), dir: 'exit' }));
    metro.push(row({ name: D, station: 'Museum Quarter', time: win - randInt(5, 55), dir: 'exit' }));
    metro.push(row({ name: N, station: 'Museum Quarter', time: win + randInt(5, 50), dir: 'exit' }));
    const aTime = win - randInt(40, 55);
    metro.push(row({ name: A, station: 'Museum Quarter', time: aTime, dir: 'exit' }));
    metro.push(row({ name: A, station: 'Harbour', time: aTime + randInt(20, 30) > win ? win - 5 : aTime + 25, dir: 'exit' }));
    metro.push(row({ name: F1, station: 'Museum Quarter', time: 14 * 60 + randInt(0, 50), dir: 'exit' }));
    metro.push(row({ name: F2, station: 'Museum Quarter', time: 20 * 60 + randInt(0, 50), dir: 'exit' }));
    for (const nm of names) for (let k = 0; k < 2; k++) {
      const t = pick([randInt(7 * 60, 12 * 60), randInt(15 * 60, 19 * 60), randInt(21 * 60, 23 * 60 + 50)]);
      metro.push(row({ name: nm, station: pick(['Harbour', 'Old Town', 'University']), time: t, dir: pick(['entry', 'exit']) }));
    }
    metro.sort((a, b) => a.time - b.time);

    // Café: the alibi suspect paid for something at the harbour during the break-in.
    const cafe = [];
    const items = [['Coffee', 3.2], ['Tea', 2.6], ['Toastie', 5.5], ['Cake', 4.1], ['Coffee', 3.2]];
    const aReceipt = win + randInt(5, 25);
    const alibiRow = row({ time: aReceipt, customer: A, item: 'Coffee', amount: 3.2 });
    cafe.push(alibiRow);
    for (let k = 0; k < 15; k++) {
      const [it, p] = pick(items);
      let t = (21 * 60 + randInt(0, 9 * 60)) % (24 * 60);
      if (Math.abs(t - win) < 70) t = (t + 150) % (24 * 60);
      cafe.push(row({ time: t, customer: pick([F1, F2, 'Guest', 'Guest', 'Guest']), item: it, amount: p }));
    }
    cafe.sort((a, b) => ((a.time + 240) % 1440) - ((b.time + 240) % 1440));

    const weather = [];
    for (let h = 0; h < 24; h++) weather.push(row({ hour: h, rain: h === H || h === H - 1 ? round(1.2 + Math.random() * 2.3, 1) : 0, wind: randInt(5, 25), temp: round(9 + Math.sin((h - 6) / 24 * Math.PI * 2) * 4, 1) }));

    // Footprints: 7 clean measurements around the culprit's stride + 1 smudged outlier.
    const c = randInt(68, 76);
    const strides = Array.from({ length: 7 + 2*tier }, () => c + (tier===2?randInt(-4,4)/2:randInt(-2,2)));
    const outlier = randInt(138, 146);
    const prints = shuffle([...strides, outlier]).map((s, i) => row({ print: `P${i + 1}`, stride: s, quality: s === outlier ? 'smudged' : 'clear' }));
    const sceneMedian = ST.median(prints.map((p) => p.stride));
    const sceneMean = ST.mean(prints.map((p) => p.stride));

    const gym = [];
    const centre = { [C]: sceneMedian, [D]: Math.round(sceneMean), [N]: c - 14 };
    const usedCentres = [sceneMedian, Math.round(sceneMean), c - 14];
    for (const nm of [A, F1, F2]) {
      let b;
      // Pick a clearly different stride; bounded attempts guarantee termination.
      let tries = 0;
      do { b = randInt(50, 110); } while (usedCentres.some((u) => Math.abs(u - b) < 6) && ++tries < 300);
      usedCentres.push(b); centre[nm] = b;
    }
    for (const nm of names) {
      const offs = shuffle(Array.from({length:5+2*tier},(_,i)=>i-(2+tier))); // mean of the offsets is exactly 0
      offs.forEach((o, k) => gym.push(row({ name: nm, session: k + 1, stride: centre[nm] + o })));
    }
    gym.sort(() => Math.random() - 0.5);

    C_.sceneMedian = sceneMedian; C_.sceneMean = sceneMean; C_.outlier = outlier;
    C_.datasets = {
      sensors: { name: 'Museum sensors', place: 'museum', desc: 'Motion events recorded each hour (00 = midnight). The museum is closed 18:00–08:00.',
        cols: [{ k: 'hour', t: 'hour', l: 'Hour' }, { k: 'status', t: 'cat', l: 'Status' }, { k: 'motion', t: 'num', l: 'Motion' }, { k: 'temp', t: 'num', l: 'Temp °C' }], rows: sensors },
      doors: { name: 'Door log', place: 'museum', desc: 'How many times each door opened during closed hours.',
        cols: [{ k: 'door', t: 'cat', l: 'Door' }, { k: 'hour', t: 'hour', l: 'Hour' }, { k: 'opens', t: 'num', l: 'Opens' }], rows: doors },
      metro: { name: 'Metro taps', place: 'metro', desc: 'Every turnstile tap by the six persons of interest yesterday.',
        cols: [{ k: 'name', t: 'cat', l: 'Name' }, { k: 'station', t: 'cat', l: 'Station' }, { k: 'time', t: 'time', l: 'Time' }, { k: 'dir', t: 'cat', l: 'Entry/exit' }], rows: metro },
      cafe: { name: 'Café receipts', place: 'cafe', desc: 'Receipts from the all-night Harbour Café, 25 minutes from the museum.',
        cols: [{ k: 'time', t: 'time', l: 'Time' }, { k: 'customer', t: 'cat', l: 'Customer' }, { k: 'item', t: 'cat', l: 'Item' }, { k: 'amount', t: 'num', l: 'Amount £' }], rows: cafe },
      weather: { name: 'Weather log', place: 'weather', desc: 'Hourly rainfall (mm), wind (km/h) and temperature.',
        cols: [{ k: 'hour', t: 'hour', l: 'Hour' }, { k: 'rain', t: 'num', l: 'Rain mm' }, { k: 'wind', t: 'num', l: 'Wind' }, { k: 'temp', t: 'num', l: 'Temp °C' }], rows: weather },
      prints: { name: 'Scene footprints', place: 'lab', desc: 'Stride lengths (cm) measured between footprints at the scene.',
        cols: [{ k: 'print', t: 'cat', l: 'Print' }, { k: 'stride', t: 'num', l: 'Stride cm' }, { k: 'quality', t: 'cat', l: 'Quality' }], rows: prints },
      gym: { name: 'Gym treadmill', place: 'gym', desc: `Stride lengths (cm) recorded for each suspect over ${5+2*tier} sessions.`,
        cols: [{ k: 'name', t: 'cat', l: 'Name' }, { k: 'session', t: 'num', l: 'Session' }, { k: 'stride', t: 'num', l: 'Stride cm' }], rows: gym }
    };
    C_.ids = {
      sensorH: sensors.find((r) => r.hour === H)._id,
      doorH: doors.find((r) => r.hour === H && r.door === 'Loading Bay')._id,
      nearby: metro.filter((r) => r.station === 'Museum Quarter' && Math.abs(r.time - win) <= 60).map((r) => r._id),
      alibiReceipt: alibiRow._id,
      weatherH: weather.find((r) => r.hour === H)._id,
      outlierId: prints.find((p) => p.stride === outlier)._id
    };
    return C_;
  }

  /* ---------------- Locations & chapters ---------------- */
  const LOCS = [
    { id: 'museum', name: 'City Museum', x: 160, y: 72, chapter: 0, sets: ['sensors', 'doors'] },
    { id: 'metro', name: 'Metro: Museum Qtr', x: 236, y: 120, chapter: 1, sets: ['metro'] },
    { id: 'cafe', name: 'Harbour Café', x: 70, y: 176, chapter: 1, sets: ['cafe'] },
    { id: 'weather', name: 'Weather Station', x: 268, y: 34, chapter: 1, sets: ['weather'] },
    { id: 'lab', name: 'Police Lab', x: 64, y: 50, chapter: 2, sets: ['prints'] },
    { id: 'gym', name: 'Riverside Gym', x: 226, y: 190, chapter: 2, sets: ['gym'] }
  ];
  const CHAPTERS = [
    { title: 'Chapter 1 · When and how?', leads: ['time', 'entry'] },
    { title: 'Chapter 2 · Who was nearby?', leads: ['nearby', 'alibi', 'weather'] },
    { title: 'Chapter 3 · Who did it?', leads: ['scene', 'match'] }
  ];
  // Each validator receives an evidence card and returns true/false.
  const LEADS = {
    time: { title: 'Time of the break-in', text: 'Pin the one hour when night-time motion was far above the typical (median) closed-hours value.',
      check: (c) => c.ds === 'sensors' && sameSet(c.rows, [K.ids.sensorH]) },
    entry: { title: 'Point of entry', text: 'Pin the door that opened unusually often during the break-in hour.',
      check: (c) => c.ds === 'doors' && sameSet(c.rows, [K.ids.doorH]) },
    nearby: { title: 'Persons near the museum', text: 'Pin every metro exit at Museum Quarter within one hour either side of the break-in.',
      check: (c) => c.ds === 'metro' && sameSet(c.rows, K.ids.nearby) },
    alibi: { title: 'An alibi', text: 'Pin the café receipt(s) of the nearby suspect who was at the harbour during the break-in.',
      check: (c) => c.ds === 'cafe' && c.rows.includes(K.ids.alibiReceipt) && c.rows.every((id) => rowOf('cafe', id).customer === K.alibi) },
    weather: { title: 'BONUS: Conditions', text: 'Optional: pin the weather in the break-in hour (wet ground means clear footprints).', bonus: true,
      check: (c) => c.ds === 'weather' && sameSet(c.rows, [K.ids.weatherH]) },
    scene: { title: 'Typical scene stride', text: 'Pin the scene strides with a statistic that is NOT distorted by the smudged print.',
      check: c => c.ds==='prints'&&c.col==='stride'&&((sameSet(c.rows,K.datasets.prints.rows.map(r=>r._id))&&c.stat==='median')||(sameSet(c.rows,K.datasets.prints.rows.filter(r=>r._id!==K.ids.outlierId).map(r=>r._id))&&(c.stat==='mean'||c.stat==='median'))) },
    match: { title: 'Matching suspect', text: 'Pin one remaining suspect’s gym strides whose average matches the typical scene stride.',
      check: c => c.ds==='gym'&&c.col==='stride'&&sameSet(c.rows,K.datasets.gym.rows.filter(r=>r.name===K.culprit).map(r=>r._id))&&Math.abs(c.value-K.sceneMedian)<.02&&(c.stat==='mean'||c.stat==='median') }
  };
  const sameSet = (a, b) => a.length === b.length && b.every((x) => a.includes(x));
  const rowOf = (ds, id) => K.datasets[ds].rows.find((r) => r._id === id);

  const DIFF = {
    easy:   { time: 720, cred: 4, travel: 8 },
    normal: { time: 560, cred: 3, travel: 12 },
    hard:   { time: 420, cred: 2, travel: 18 }
  };

  /* ---------------- DOM ---------------- */
  const dom = {
    map: document.getElementById('map'), mapHint: document.getElementById('mapHint'), tabs: document.getElementById('dsTabs'),
    desc: document.getElementById('dsDesc'), filters: document.getElementById('filters'), table: document.getElementById('dataTable'),
    colSel: document.getElementById('colSel'), stats: document.getElementById('stats'), statPick: document.getElementById('statPick'),
    chartType: document.getElementById('chartType'), chart: document.getElementById('chart'), pin: document.getElementById('pinBtn'),
    chapter: document.getElementById('chapter'), leads: document.getElementById('leads'), cards: document.getElementById('cards'), submit: document.getElementById('submitBtn')
  };
  let S = null;
  let K = null; // the generated case

  /* ---------------- Map ---------------- */
  function renderMap() {
    const svg = dom.map;
    svg.innerHTML = `
      <rect class="water" x="0" y="150" width="140" height="70"/>
      <path class="water" d="M0 150 Q 70 135 140 150 L140 220 L0 220Z"/>
      <rect class="park" x="190" y="150" width="90" height="60" rx="10"/>
      <path class="road" d="M10 110 H310 M160 10 V210 M60 30 Q 120 90 240 120 M70 176 Q 150 160 226 190"/>`;
    for (const L of LOCS) {
      const locked = L.chapter > S.chapter;
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', `loc${S.visited.has(L.id) ? ' is-visited' : ''}${locked ? ' is-locked' : ''}${S.here === L.id ? ' is-here' : ''}`);
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-label', `${L.name}${locked ? ' (locked until a later chapter)' : S.visited.has(L.id) ? ' (records collected)' : ''}`);
      g.innerHTML = `<circle cx="${L.x}" cy="${L.y}" r="10"></circle><text x="${L.x}" y="${L.y - 15}" text-anchor="middle">${locked ? '🔒 ' : ''}${L.name}</text>`;
      g.addEventListener('click', () => visit(L.id));
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); visit(L.id); } });
      svg.appendChild(g);
    }
  }

  function visit(id) {
    if (!this_shell.isPlaying()) return;
    const L = LOCS.find((x) => x.id === id);
    if (L.chapter > S.chapter) { this_shell.toast(`${L.name} becomes relevant in a later chapter.`, 'warn'); MG.sound.play('error'); return; }
    if (S.here !== id) {
      if (S.here) { this_shell.addTime(-S.cfg.travel); this_shell.toast(`🚕 Travelled to ${L.name} (−${S.cfg.travel} s)`, 'info', 1600); }
      S.here = id;
      MG.sound.play('whoosh');
    }
    if (!S.visited.has(id)) {
      S.visited.add(id);
      L.sets.forEach((d) => S.collected.push(d));
      this_shell.toast(`📁 Collected: ${L.sets.map((d) => K.datasets[d].name).join(', ')}`, 'good');
    }
    openDataset(L.sets[0]);
    renderMap();
  }

  /* ---------------- Data lab ---------------- */
  function openDataset(ds) {
    S.ds = ds;
    if (!S.view[ds]) {
      const firstNum = K.datasets[ds].cols.find((c) => c.t === 'num') || K.datasets[ds].cols.find(isNumCol);
      S.view[ds] = { sort: null, dir: 1, filters: {}, sel: new Set(), col: firstNum.k, stat: 'mean' };
    }
    renderLab();
  }

  const isNumCol = (c) => c.t === 'num' || c.t === 'time' || c.t === 'hour';
  /** Format a statistic for display; clock columns show times and ranges in minutes/hours. */
  function fmtColStat(col, k, v) {
    if (v == null) return 'none';
    if (col.t === 'time') return k === 'range' ? Math.round(v) + ' min' : Array.isArray(v) ? v.map((x) => hhmm(Math.round(x))).join(', ') : hhmm(Math.round(v));
    return fmtStat(k, v);
  }
  const fmtCell = (c, v) => (c.t === 'time' ? hhmm(v) : c.t === 'hour' ? `${String(v).padStart(2, '0')}:00` : v);

  /** Rows after filters and sorting. */
  function visibleRows(ds) {
    const D = K.datasets[ds], V = S.view[ds];
    let rows = D.rows.filter((r) => D.cols.every((c) => {
      const f = V.filters[c.k];
      if (!f) return true;
      if (c.t === 'cat') return f.eq == null || f.eq === '' || r[c.k] === f.eq;
      const v = c.t === 'time' ? r[c.k] / 60 : r[c.k];
      return (f.min == null || f.min === '' || v >= Number(f.min)) && (f.max == null || f.max === '' || v <= Number(f.max));
    }));
    if (V.sort) rows = [...rows].sort((a, b) => (a[V.sort] > b[V.sort] ? 1 : a[V.sort] < b[V.sort] ? -1 : 0) * V.dir);
    return rows;
  }
  /** The rows a finding refers to: the selected rows if any, else every visible row. */
  function findingRows(ds) {
    const V = S.view[ds];
    const vis = visibleRows(ds);
    const sel = vis.filter((r) => V.sel.has(r._id));
    return sel.length ? sel : vis;
  }

  function renderLab() {
    dom.tabs.innerHTML = '';
    for (const d of S.collected) {
      const t = el('button', { type: 'button', class: 'tab', role: 'tab', 'aria-selected': String(d === S.ds) }, K.datasets[d].name);
      t.addEventListener('click', () => { openDataset(d); MG.sound.play('click'); });
      dom.tabs.append(t);
    }
    if (!S.ds) {
      dom.desc.textContent = 'No records yet. Click a location on the city map to start investigating.';
      dom.filters.innerHTML = ''; dom.table.innerHTML = ''; dom.stats.innerHTML = ''; dom.colSel.innerHTML = ''; dom.statPick.innerHTML = '<legend>Highlight statistic</legend>';
      dom.pin.disabled = true;
      clearChart();
      return;
    }
    dom.pin.disabled = false;
    const D = K.datasets[S.ds], V = S.view[S.ds];
    dom.desc.textContent = D.desc + ' Click column headings to sort, rows to select.';
    // Filters
    dom.filters.innerHTML = '';
    for (const c of D.cols) {
      const f = V.filters[c.k] || {};
      const box = el('label', { class: 'filter' }, c.l + ':');
      if (c.t === 'cat') {
        const s = el('select', { 'aria-label': `Filter ${c.l}` }, el('option', { value: '' }, 'All'));
        [...new Set(D.rows.map((r) => r[c.k]))].sort().forEach((v) => s.append(el('option', { value: v, selected: f.eq === v }, v)));
        s.addEventListener('change', () => { V.filters[c.k] = { eq: s.value }; V.sel.clear(); renderLab(); });
        box.append(s);
      } else if (c.k !== 'session' && c.k !== 'temp' && c.k !== 'wind') {
        const unit = c.t === 'time' || c.t === 'hour' ? 'h' : '';
        const mk = (which) => {
          const i = el('input', { type: 'number', step: c.t === 'time' ? '0.25' : 'any', placeholder: which, value: f[which] ?? '', 'aria-label': `${c.l} ${which}${unit ? ' (hours)' : ''}` });
          i.addEventListener('change', () => { V.filters[c.k] = Object.assign({}, V.filters[c.k], { [which]: i.value }); V.sel.clear(); renderLab(); });
          return i;
        };
        box.append(mk('min'), '–', mk('max'), unit);
      } else continue;
      dom.filters.append(box);
    }
    const reset = el('button', { type: 'button', class: 'mg-btn mg-btn--sm' }, 'Reset');
    reset.addEventListener('click', () => { V.filters = {}; V.sel.clear(); V.sort = null; renderLab(); });
    dom.filters.append(reset);

    // Table
    const rows = visibleRows(S.ds);
    const head = `<thead><tr><th scope="col"><span class="mg-sr-only">Selected</span></th>${D.cols.map((c) => `<th scope="col"><button type="button" data-sort="${c.k}">${c.l} ${V.sort === c.k ? (V.dir > 0 ? '▲' : '▼') : '↕'}</button></th>`).join('')}</tr></thead>`;
    const body = rows.map((r) => `<tr data-id="${r._id}" class="${V.sel.has(r._id) ? 'is-sel' : ''}" tabindex="0" aria-selected="${V.sel.has(r._id)}"><td class="chk">${V.sel.has(r._id) ? '☑' : '☐'}</td>${D.cols.map((c) => `<td>${fmtCell(c, r[c.k])}</td>`).join('')}</tr>`).join('');
    dom.table.innerHTML = head + `<tbody>${body || '<tr><td colspan="9">No rows match these filters.</td></tr>'}</tbody>`;
    dom.table.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.sort;
      V.dir = V.sort === k ? -V.dir : 1; V.sort = k; MG.sound.play('click'); renderLab();
    }));
    dom.table.querySelectorAll('tbody tr[data-id]').forEach((tr) => {
      const toggle = () => { const id = Number(tr.dataset.id); V.sel.has(id) ? V.sel.delete(id) : V.sel.add(id); MG.sound.play('click'); renderLab(); };
      tr.addEventListener('click', toggle);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    });

    // Column + statistics
    dom.colSel.innerHTML = '';
    D.cols.filter(isNumCol).forEach((c) => dom.colSel.append(el('option', { value: c.k, selected: V.col === c.k }, c.l)));
    renderStats();
  }

  function currentValues() { return findingRows(S.ds).map((r) => r[S.view[S.ds].col]); }

  function renderStats() {
    const V = S.view[S.ds];
    const vals = currentValues();
    const fr = findingRows(S.ds);
    const sel = fr.some((r) => V.sel.has(r._id));
    const s = vals.length ? { n: vals.length, mean: ST.mean(vals), median: ST.median(vals), mode: ST.mode(vals), range: ST.range(vals), min: Math.min(...vals), max: Math.max(...vals) } : null;
    const col = K.datasets[S.ds].cols.find((c) => c.k === V.col);
    dom.stats.innerHTML = s ? '<div><dt>Records</dt><dd>'+s.n+'</dd></div><div><dt>Finding</dt><dd>Calculate your chosen statistic before pinning.</dd></div>' : '<div><dt>Records</dt><dd>0</dd></div>';
    dom.statPick.innerHTML = '<legend>Highlight statistic</legend>';
    for (const k of ['mean', 'median', 'mode', 'range']) {
      const lab = el('label', {}, el('input', { type: 'radio', name: 'stat', value: k, checked: V.stat === k }), k);
      lab.querySelector('input').addEventListener('change', () => { V.stat = k; drawChart(); });
      dom.statPick.append(lab);
    }
    drawChart();
  }

  function clearChart() { const f = MG.fitCanvas(dom.chart); f.ctx.clearRect(0, 0, f.w, f.h); }

  function drawChart() {
    const f = MG.fitCanvas(dom.chart), ctx = f.ctx;
    ctx.clearRect(0, 0, f.w, f.h);
    const D = K.datasets[S.ds], V = S.view[S.ds];
    const rows = findingRows(S.ds).slice(0, 40);
    if (!rows.length) return;
    const vals = rows.map((r) => r[V.col]);
    const labelCol = D.cols.find((c) => c.t !== 'num') || D.cols[0];
    const max = Math.max(1, ...vals), min = Math.min(0, ...vals);
    const pad = { l: 30, r: 6, t: 10, b: 22 };
    const W = f.w - pad.l - pad.r, H = f.h - pad.t - pad.b;
    const y = (v) => pad.t + H - ((v - min) / (max - min || 1)) * H;
    ctx.strokeStyle = '#e6d9bb'; ctx.fillStyle = '#6b5843'; ctx.font = '11px "Courier Prime", monospace'; ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) { const v = min + ((max - min) * i) / 4; ctx.beginPath(); ctx.moveTo(pad.l, y(v)); ctx.lineTo(f.w - pad.r, y(v)); ctx.stroke(); ctx.fillText(round(v, 1), pad.l - 3, y(v) + 3); }
    const bw = W / rows.length;
    rows.forEach((r, i) => {
      const x = pad.l + i * bw;
      const v = r[V.col];
      ctx.fillStyle = V.sel.has(r._id) ? '#b3261e' : '#8a6a3c';
      if (S.chartType === 'bars') ctx.fillRect(x + bw * 0.15, y(v), bw * 0.7, y(min) - y(v));
      else { ctx.beginPath(); ctx.arc(x + bw / 2, y(v), Math.max(3, Math.min(6, bw / 3)), 0, 7); ctx.fill(); }
      if (rows.length <= 14) { ctx.fillStyle = '#555'; ctx.textAlign = 'center'; ctx.fillText(String(fmtCell(labelCol, r[labelCol.k])).slice(0, 6), x + bw / 2, f.h - 8); }
    });
    // Statistical answers are revealed only on verified evidence cards.
    ctx.lineWidth = 1;
  }

  /** Pin the current finding (rows + column + highlighted statistic) as evidence. */
  function pinFinding() {
    if (!this_shell.isPlaying() || !S.ds) return;
    const V = S.view[S.ds];
    const rows = findingRows(S.ds);
    if (!rows.length) { this_shell.toast('No rows to pin — loosen your filters.', 'warn'); return; }
    if (S.cards.length >= 12) { this_shell.toast('The case board is full — remove a card first.', 'warn'); return; }
    const vals = rows.map((r) => r[V.col]);
    const v = ST[V.stat](vals);
    const ds=S.ds, stat=V.stat, col=V.col, ids=rows.map(r=>r._id).sort((a,b)=>a-b).join(',');
    const signature=()=>S.ds===ds&&S.view[ds].stat===stat&&S.view[ds].col===col&&findingRows(ds).map(r=>r._id).sort((a,b)=>a-b).join(',')===ids;
    const modeCheck=value=>{
      if(v==null)return value.toLowerCase()==='none';
      const values=value.split(',').map(s=>MG.MathsSession.number(s)).sort((a,b)=>a-b);
      return values.length===v.length&&values.every((n,i)=>Number.isFinite(n)&&Math.abs(n-v[i])<.006);
    };
    if(!this_shell.maths.gate({key:'statistic:'+S.round+':'+ds+':'+col+':'+stat+':'+ids,topic:'Calculating statistics',title:'Verify the evidence calculation',
      prompt:'Calculate the <strong>'+stat+'</strong> of the '+rows.length+' records you selected. Use 2 decimal places where needed; time columns use minutes after midnight.',
      fields:[stat==='mode'?{label:'Mode (comma-separated values, or none)',text:true,check:modeCheck}:{label:stat,answer:v,tolerance:.006}],
      hint:'Mean = total ÷ count. Median = middle of sorted values (average the middle pair). Mode = most frequent, or none if every value occurs once. Range = maximum − minimum.',
      container:dom.pin.parentElement,valid:signature,onPass:pinFinding}))return;
    const D = K.datasets[S.ds];
    const labelCol = D.cols[0];
    const card = {
      id: ++S.cardSeq, ds: S.ds, rows: rows.map((r) => r._id), col: V.col, stat: V.stat, value: v,
      label: `${D.name}: ${rows.length} row${rows.length > 1 ? 's' : ''}`,
      summary: rows.slice(0, 4).map((r) => fmtCell(labelCol, r[labelCol.k]) + (D.cols[1] ? ' · ' + fmtCell(D.cols[1], r[D.cols[1].k]) : '')).join('; ') + (rows.length > 4 ? '…' : ''),
      lead: null
    };
    S.cards.push(card);
    S.pins++;
    MG.sound.play('place');
    this_shell.toast(`📌 Pinned: ${card.label}, ${V.stat} ${D.cols.find((c) => c.k === V.col).l} = ${fmtColStat(D.cols.find((c) => c.k === V.col), V.stat, v)}`, 'good');
    renderBoard();
  }

  /* ---------------- Case board ---------------- */
  function renderBoard() {
    const ch = CHAPTERS[S.chapter];
    dom.chapter.innerHTML = `<strong>${ch.title}</strong><br>Attach an evidence card to each lead, then submit the report.`;
    dom.leads.innerHTML = '';
    for (const key of ch.leads) {
      const L = LEADS[key];
      const card = S.cards.find((c) => c.lead === key);
      const li = el('li', { class: `lead${L.bonus ? ' is-bonus' : ''}${S.solved.has(key) ? ' is-solved' : ''}${S.wrong.has(key) ? ' is-wrong' : ''}` });
      li.innerHTML = `<span class="lead__title">${S.solved.has(key) ? '✔ ' : S.wrong.has(key) ? '✘ ' : ''}${L.title}</span>${L.text}
        <div class="lead__slot${card ? ' has-card' : ''}">${card ? `📎 ${card.label} · ${card.stat} = ${fmtColStat(K.datasets[card.ds].cols.find((k) => k.k === card.col), card.stat, card.value)}` : 'No evidence attached'}</div>`;
      dom.leads.append(li);
    }
    dom.cards.innerHTML = '';
    if (!S.cards.length) dom.cards.append(el('p', { class: 'cards__empty' }, 'No evidence yet. Analyse a dataset and press “Pin finding”.'));
    for (const c of S.cards) {
      const D = K.datasets[c.ds];
      const box = el('div', { class: 'card' });
      const sel = el('select', { 'aria-label': `Attach ${c.label} to a lead` }, el('option', { value: '' }, '— attach to lead —'));
      for (const key of ch.leads) if (!S.solved.has(key)) sel.append(el('option', { value: key, selected: c.lead === key }, LEADS[key].title));
      sel.addEventListener('change', () => {
        S.cards.forEach((o) => { if (o.lead === sel.value && o !== c) o.lead = null; });
        c.lead = sel.value || null;
        S.wrong.delete(c.lead);
        MG.sound.play('click');
        renderBoard();
      });
      const x = el('button', { class: 'x', type: 'button', 'aria-label': `Remove card ${c.label}` }, '✕');
      x.addEventListener('click', () => { S.cards = S.cards.filter((o) => o !== c); renderBoard(); });
      box.innerHTML = `<div class="row"><strong>${c.label}</strong></div><div>${c.stat} of ${D.cols.find((k) => k.k === c.col).l}: <strong>${fmtColStat(D.cols.find((k) => k.k === c.col), c.stat, c.value)}</strong></div><div style="color:#6b5a47">${c.summary}</div>`;
      box.querySelector('.row').append(x);
      box.append(sel);
      dom.cards.append(box);
    }
    const required = ch.leads.filter((k) => !LEADS[k].bonus);
    this_shell.setProgress((S.chapter + required.filter((k) => S.solved.has(k)).length / required.length) / CHAPTERS.length, `Case progress · chapter ${S.chapter + 1}/${CHAPTERS.length}`);
  }

  /** Submit Case Report: validate every attached card for this chapter. */
  function submitReport() {
    if (!this_shell.isPlaying()) return;
    const ch = CHAPTERS[S.chapter];
    const required = ch.leads.filter((k) => !LEADS[k].bonus && !S.solved.has(k));
    const missing = required.filter((k) => !S.cards.some((c) => c.lead === k));
    if (missing.length) { this_shell.toast(`Attach evidence to: ${missing.map((k) => LEADS[k].title).join(', ')}.`, 'warn', 3000); MG.sound.play('error'); return; }
    S.reports++;
    S.wrong.clear();
    let wrong = 0;
    for (const key of ch.leads) {
      if (S.solved.has(key)) continue;
      const card = S.cards.find((c) => c.lead === key);
      if (!card) continue;
      const correct=LEADS[key].check(card);
      this_shell.maths.record('Statistical evidence and interpretation','lead:'+S.round+':'+key,correct);
      if (correct) {
        S.solved.add(key);
        const first = !S.leadFails[key];
        const pts = LEADS[key].bonus ? 150 : first ? 200 : 100;
        if (LEADS[key].bonus) S.bonus++;
        this_shell.addScore(pts, LEADS[key].bonus ? 'Bonus lead!' : LEADS[key].title, dom.submit);
      } else {
        S.wrong.add(key); S.leadFails[key] = (S.leadFails[key] || 0) + 1; wrong++;
        card.lead = null;
      }
    }
    if (wrong) {
      S.wrongReports++;
      S.cred--;
      this_shell.setLives(S.cred, S.cfg.cred, '🎖');
      this_shell.addScore(-50, 'Evidence rejected', dom.submit);
      this_shell.flash('bad');
      MG.sound.play('error');
      this_shell.toast(`✘ The chief rejected ${wrong} lead(s). Re-examine the data. −1 credibility`, 'bad', 3200);
      if (S.cred <= 0) return finish(false, 'Taken off the case', 'Your credibility ran out after too many unsupported claims.');
    }
    const done = ch.leads.filter((k) => !LEADS[k].bonus).every((k) => S.solved.has(k));
    if (done) {
      S.chapter++;
      this_shell.addScore(100, 'Chapter solved');
      MG.sound.play('stage');
      this_shell.flash('good');
      S.cards = S.cards.filter((c) => !c.lead);
      if (S.chapter >= CHAPTERS.length) {
        if (S.round === 9) return finish(true, 'All cases closed!', 'You solved all 10 cases.');
        this_shell.toast(`Case closed! ${K.culprit} stole the Meridian Diamond.`, 'good');
        return startCase(S.round + 1);
      }
      this_shell.setStage(`${S.round + 1}/10`);
      this_shell.toast(`✔ Chapter solved! New locations unlocked on the map.`, 'good', 3000);
      renderMap();
    } else if (!wrong) MG.sound.play('success');
    renderBoard();
  }

  function startCase(round) {
    const cfg = MG.roundConfig(DIFF, round);
    const totals = S ? { reports: S.reports, wrongReports: S.wrongReports, bonus: S.bonus, pins: S.pins } : {};
    K = generateCase(round);
    S = { cfg, round, cred: cfg.cred, chapter: 0, visited: new Set(), collected: [], here: null, ds: null, view: {}, cards: [], cardSeq: 0, solved: new Set(), wrong: new Set(), leadFails: {}, reports: 0, wrongReports: 0, bonus: 0, pins: 0, chartType: 'bars', ...totals };
    this_shell.setLives(S.cred, cfg.cred, '🎖');
    this_shell.setStage(`${round + 1}/10`);
    this_shell.setTimer(cfg.time);
    dom.chartType.textContent = 'Chart: bars';
    renderMap(); renderLab(); renderBoard();
  }

  /* ---------------- End ---------------- */
  function finish(won, title, reason) {
    const timeFrac = this_shell.timeLeft / S.cfg.time;
    if (won) this_shell.addScore(Math.round(this_shell.timeLeft), 'Time bonus');
    let stars;
    if (won) stars = S.wrongReports === 0 && timeFrac >= 0.25 ? 3 : S.wrongReports <= 1 ? 2 : 1;
    else stars = S.chapter >= 2 ? 2 : S.chapter >= 1 ? 1 : 0;
    const H = K.hour;
    this_shell.end({
      won, title, reason, stars,
      stats: [
        ['Cases solved', `${S.round + (won ? 1 : 0)} / 10`],
        ['Chapters solved', `${Math.min(S.chapter, CHAPTERS.length)} / ${CHAPTERS.length}`],
        ['Reports submitted', S.reports],
        ['Rejected reports', S.wrongReports],
        ['Credibility left', `${Math.max(0, S.cred)} / ${S.cfg.cred}`],
        ['Bonus leads', S.bonus],
        ['Findings pinned', S.pins],
        ['Locations visited', S.visited.size],
        ['Time remaining', MG.fmtTime(this_shell.timeLeft)]
      ],
      math: [
        `<strong>The solution:</strong> the break-in happened at ${String(H).padStart(2, '0')}:00 through the Loading Bay. Night-time motion is usually 0–4 events (median ≈ 2), so an hour with 40+ events is an outlier.`,
        `Four people left the metro at Museum Quarter within an hour of the break-in. ${K.alibi} has an alibi — a café receipt at the harbour during the break-in.`,
        `The scene strides contain a smudged outlier (${K.outlier} cm). It drags the <strong>mean</strong> up to ${round(K.sceneMean, 1)} cm, pointing at ${K.decoy}. The <strong>median</strong> (${K.sceneMedian} cm) resists outliers and matches ${K.culprit}'s gym average.`,
        'Mean = total ÷ count; median = middle value when sorted; mode = most common value; range = largest − smallest. Choose the statistic that suits the data — the median is safer when there are outliers.'
      ]
    });
  }

  /* ---------------- Shell ---------------- */
  const this_shell = MG.createShell({
    id: 'data-detective',
    title: 'Data Detective',
    tagline: 'The Meridian Diamond has vanished! The chief wants proof. Use the data to crack the case.',
    goal: 'Solve 10 cases before their clocks run out.',
    steps: [
      ['🗺️', 'Visit places on the map to collect records.'],
      ['🔍', 'Sort, filter and pick rows. Find the clue in the numbers.'],
      ['📌', 'Pin your evidence to each lead, then submit.']
    ],
    keys: [
      ['Click', 'Visit, sort, select rows'],
      ['<kbd>Tab</kbd> + <kbd>Enter</kbd>', 'Keyboard control'],
      ['<kbd>P</kbd>', 'Pause']
    ],
    genre: 'Investigation & data analysis',
    topic: 'Mean, median, mode, range, data displays',
    premise: 'The Meridian Diamond has vanished from the City Museum overnight. The chief wants answers backed by data — not hunches.',
    objective: 'Collect records around the city, analyse them in the data lab, pin statistical evidence to the case board and close all three chapters in each of 10 cases.',
    livesLabel: 'Credibility',
    stageLabel: 'Round',
    art: `<svg viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice"><defs><radialGradient id="dd-lamp" cx="50%" cy="0%" r="90%"><stop offset="0" stop-color="#ffd98a" stop-opacity=".55"/><stop offset="1" stop-color="#ffd98a" stop-opacity="0"/></radialGradient></defs><rect width="400" height="500" fill="#140e0a"/><g stroke="#000" stroke-opacity=".35"><path d="M0 0V500"/><path d="M26 0V500"/><path d="M52 0V500"/><path d="M78 0V500"/><path d="M104 0V500"/><path d="M130 0V500"/><path d="M156 0V500"/><path d="M182 0V500"/><path d="M208 0V500"/><path d="M234 0V500"/><path d="M260 0V500"/><path d="M286 0V500"/><path d="M312 0V500"/><path d="M338 0V500"/><path d="M364 0V500"/><path d="M390 0V500"/></g><path d="M150 0h100l130 500H20Z" fill="url(#dd-lamp)"/><path d="M162 0h76l-10 40h-56Z" fill="#2f3a2f"/><rect x="60" y="210" width="290" height="230" rx="4" fill="#c9a560" transform="rotate(-4 205 325)"/><g transform="rotate(-2 210 320)"><rect x="80" y="200" width="270" height="226" fill="#f3e8cf"/><g stroke="#000" stroke-opacity=".06"><path d="M80 226H350"/><path d="M80 248H350"/><path d="M80 270H350"/><path d="M80 292H350"/><path d="M80 314H350"/><path d="M80 336H350"/><path d="M80 358H350"/><path d="M80 380H350"/><path d="M80 402H350"/></g><text x="96" y="230" font-family="Special Elite, Courier New, monospace" font-size="18" fill="#b3261e" letter-spacing="3">CASE No. 7</text><rect x="118" y="324" width="16" height="28" fill="#8a6a3c"/><rect x="142" y="305.8" width="16" height="46" fill="#8a6a3c"/><rect x="166" y="331" width="16" height="21" fill="#8a6a3c"/><rect x="190" y="293.2" width="16" height="59" fill="#8a6a3c"/><rect x="214" y="314.2" width="16" height="38" fill="#8a6a3c"/><rect x="238" y="326.8" width="16" height="25" fill="#8a6a3c"/><rect x="262" y="254" width="16" height="98" fill="#b3261e"/><path d="M110 302H300" stroke="#1565c0" stroke-width="3" stroke-dasharray="8 6"/><path d="M110 318H300" stroke="#2e7d32" stroke-width="3"/><text x="300" y="296" font-family="Special Elite, Courier New, monospace" font-size="13" fill="#1565c0" text-anchor="end">mean</text><text x="300" y="334" font-family="Special Elite, Courier New, monospace" font-size="13" fill="#2e7d32" text-anchor="end">median</text><text x="96" y="404" font-family="Special Elite, Courier New, monospace" font-size="16" fill="#17120e">Outlier: 142 cm ?!</text></g><g transform="translate(300 150) rotate(-30)"><circle r="52" fill="rgba(200,230,255,.18)" stroke="#2a1d15" stroke-width="12"/><circle r="52" fill="none" stroke="#c9a560" stroke-width="5"/><rect x="-9" y="56" width="18" height="78" rx="6" fill="#2a1d15"/></g><g transform="translate(92 120)"><path d="M0 0l22 -20h40l22 20l-42 46Z" fill="#7fe3ff" stroke="#e8fbff" stroke-width="3"/><path d="M0 0h84M22 -20l20 66l20 -66M22 -20L42 0L62 -20" fill="none" stroke="#e8fbff" stroke-width="2" opacity=".8"/></g><text x="200" y="480" text-anchor="middle" font-family="DM Serif Display, Georgia, serif" font-style="italic" font-size="30" fill="#ffd98a">Who took the diamond?</text></svg>`,
    instructions: {
      objective: 'Solve ten fresh cases, each with three chapters. Calculate the chosen statistic before pinning evidence, then interpret which findings support the case.',
      controls: [
        'Click (or focus and press <kbd>Enter</kbd> on) a location on the city map to travel there and collect its records. Travelling costs time.',
        'In the data lab: choose a dataset tab, click column headings to <strong>sort</strong>, use the filters, and click rows to <strong>select</strong> them.',
        'Choose the column to analyse and the statistic to highlight, then press <strong>Pin finding</strong>. The finding uses your selected rows (or all visible rows if none are selected).',
        'On the case board attach each card to a lead using its drop-down, then press <strong>Submit Case Report</strong>. <kbd>P</kbd>/<kbd>Esc</kbd> pause.'
      ],
      maths: [
        'The lab calculates n, mean, median, mode, range, minimum and maximum for whatever rows you are looking at.',
        'The chart shows the data as bars or dots with the mean (dashed blue) and median (green) marked.',
        'Leads need the right data AND the right statistic — e.g. an outlier can distort a mean, but not a median.'
      ],
      scoring: [
        'Lead confirmed: +200 on the first report, +100 after a mistake. Optional bonus lead: +150.',
        'Chapter solved: +100. Case closed: +1 per second left. Rejected report: −50.'
      ],
      failure: [
        'Every report containing a wrong lead costs credibility. At zero credibility you are taken off the case.',
        'The run also ends if the investigation clock reaches 0:00.'
      ],
      timer: [
        'One investigation clock covers the whole case. Travelling between locations deducts seconds. Pausing freezes the clock.'
      ]
    },
    stars: [
      '1 star: solve Chapter 1 (or close the case).',
      '2 stars: close the case with at most 1 rejected report (a failed run that reached Chapter 3 also earns 2).',
      '3 stars: close the case with no rejected reports and at least 25% of the clock remaining.'
    ],
    onStart() { S = null; startCase(0); },
    onUpdate() { /* event-driven game: the shell handles the clock */ },
    onTimeUp() { finish(false, 'Out of time', 'The investigation clock ran out before the case was closed.'); }
  });

  /* ---------------- Input (bound once) ---------------- */
  dom.pin.addEventListener('click', pinFinding);
  dom.submit.addEventListener('click', submitReport);
  dom.colSel.addEventListener('change', () => { if (S && S.ds) { S.view[S.ds].col = dom.colSel.value; renderStats(); } });
  dom.chartType.addEventListener('click', () => { if (!S) return; S.chartType = S.chartType === 'bars' ? 'dots' : 'bars'; dom.chartType.textContent = `Chart: ${S.chartType}`; if (S.ds) drawChart(); });
  window.addEventListener('resize', () => { if (S && S.ds) drawChart(); });

  MG.game = { get state() { return S; }, get kase() { return K; }, visit, openDataset, pinFinding, submitReport, LEADS, visibleRows };
})();
