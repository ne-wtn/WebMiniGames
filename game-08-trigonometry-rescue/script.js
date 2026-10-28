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
   Trigonometry Rescue — right-angled trigonometry, angles of elevation,
   bearings and distance. The drone flies in straight legs:
     side view:  Δx = d·cos θ, Δy = d·sin θ   (θ = angle of elevation)
     top view:   Δx = d·sin b, Δy = d·cos b   (b = bearing from north)
   Wind adds drift proportional to flight time. The winch cable hangs at
   angle φ from vertical: hook = (x + L·sin φ, y − L·cos φ).
   ========================================================================== */
(() => {
  'use strict';
  const { clamp, round } = MG;

  /* ---------------- Configuration ---------------- */
  const SPEED = 40;               // drone speed, m/s (animation and wind drift)
  const FUEL_PER_M = 0.08;        // fuel per metre flown
  const FUEL_PER_CLIMB = 0.08;    // extra fuel per metre climbed
  const HOOK_TOL = 2.5;           // hook must end within this distance of the person (m)
  const deg = (r) => (r * 180) / Math.PI;
  const rad = (d) => (d * Math.PI) / 180;

  let MISSIONS=freshMissions();
  function freshMissions(){
    const seed=Math.floor(Math.random()*3);
    return Array.from({length:10},(_,i)=>{
      if(i<6){
        const dx=80+10*(i+seed),rise=60+10*(i%3),offset=i<3?0:16+4*(i-3);
        const x=40+dx,hover={x:x-offset,y:20+rise};
        return {name:'Ridge survey '+(i+1),view:'side',w:400,h:250,wind:i<3?0:[1,-2,2][i-3],fuel:100,par:3,
          terrain:[[0,20],[260,20],[290,85],[320,50],[355,180],[400,150]],pads:[{id:'base',x0:20,x1:60,h:20,label:'BASE'}],
          people:[{x,y:20,label:'Climber'}],rocks:[],cabin:null,waypoints:[hover,{x:40,y:20+rise},{x:40,y:20}],
          brief:'Program a flight to hover at ('+hover.x+', '+hover.y+'). Rescue the climber at ('+x+', 20) with the cable, fly to (40, '+(20+rise)+'), then land at base (40, 20). Calculate each distance and elevation before launching.'};
      }
      const k=i-6,people=[{bearing:55+10*k+seed*3,dist:80+10*k+seed*5,label:'Hiker A'},{bearing:210+10*k+seed*3,dist:90+7*k+seed*5,label:'Hiker B'}];
      const waypoints=people.map(p=>({x:p.dist*Math.sin(p.bearing*Math.PI/180),y:p.dist*Math.cos(p.bearing*Math.PI/180)}));waypoints.push({x:0,y:0});
      return {name:'Bearing operation '+(k+1),view:'top',w:400,h:400,wind:[-2,2,-3,3][k],fuel:100,par:3,peaks:[{x:175,y:175,r:12}],people,waypoints,
        brief:'Rescue Hiker A, then Hiker B, then return to base. Their bearings and distances are measured from BASE. Calculate each new bearing and distance, accounting for wind. The route is shown only after launch.'};
    });
  }

  const DIFF = {
    easy:   { drones: 4, time: 300 },
    normal: { drones: 3, time: 240 },
    hard:   { drones: 2, time: 190 }
  };

  /* ---------------- DOM ---------------- */
  const canvas = document.getElementById('scene');
  const $ = (id) => document.getElementById(id);
  const dom = {
    brief: $('brief'), angle: $('angle'), angleOut: $('angleOut'), angleLabel: $('angleLabel'), dist: $('dist'), distOut: $('distOut'),
    dir: $('dirBtn'), land: $('landBtn'), legInfo: $('legInfo'), launch: $('launchBtn'), winchPane: $('winchPane'),
    cable: $('cable'), cableOut: $('cableOut'), cangle: $('cangle'), cangleOut: $('cangleOut'), winch: $('winchBtn'), sensors: $('sensors'), abort: $('abortBtn')
  };
  let S = null;
  let view = { w: 0, h: 0, s: 1, ox: 0, oy: 0, ctx: null };

  /* ---------------- Geometry ---------------- */
  function groundAt(M, x) {
    const t = M.terrain;
    if (x <= t[0][0]) return t[0][1];
    for (let i = 1; i < t.length; i++) {
      if (x <= t[i][0]) { const [x0, y0] = t[i - 1], [x1, y1] = t[i]; return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0); }
    }
    return t[t.length - 1][1];
  }
  const padAt = (M, x) => (M.pads || []).find((p) => x >= p.x0 && x <= p.x1);
  const inRock = (M, x, y, m = 2) => (M.rocks || []).some((r) => x > r.x - m && x < r.x + r.w + m && y > r.y - m && y < r.y + r.h + m);
  /** Does segment AB pass through rectangle r? (sampled — rocks are small) */
  const segHitsRect = (ax, ay, bx, by, r) => { for (let i = 0; i <= 40; i++) { const t = i / 40, x = ax + (bx - ax) * t, y = ay + (by - ay) * t; if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return true; } return false; };
  const personPos = (M, p) => (M.view === 'top' ? { x: p.dist * Math.sin(rad(p.bearing)), y: p.dist * Math.cos(rad(p.bearing)) } : { x: p.x, y: p.y });

  /** The planned leg from the current controls. */
  function plannedLeg(withWind) {
    const M = S.M, d = Number(dom.dist.value), a = Number(dom.angle.value);
    let dx, dy;
    if (M.view === 'top') { dx = d * Math.sin(rad(a)); dy = d * Math.cos(rad(a)); }
    else { dx = S.dir * d * Math.cos(rad(a)); dy = d * Math.sin(rad(a)); }
    const t = d / SPEED;
    const drift = withWind ? M.wind * t : 0;
    const fuel = d * FUEL_PER_M + Math.max(0, dy) * FUEL_PER_CLIMB;
    return { d, a, dx, dy, t, drift, fuel, ex: S.drone.x + dx + drift, ey: S.drone.y + dy };
  }

  /* ---------------- Mission flow ---------------- */
  function loadMission(i) {
    S.cfg = MG.roundConfig(DIFF, i);
    S.mIdx = i;
    S.routeIndex=0;S.flightHelp=false;
    const M = S.M = MISSIONS[i];
    S.dir = 1;
    S.fuel = M.fuel;
    S.legs = 0;
    S.cable = null;
    S.flight = null;
    S.rescued = new Set();
    S.delivered = false;
    S.landed = true;
    S.trail = [];
    if (M.view === 'top') { S.drone = { x: 0, y: 0 }; dom.angle.min = 0; dom.angle.max = 359; dom.angle.value = 60; dom.angleLabel.textContent = 'Bearing b (° clockwise from north)'; }
    else { const b = M.pads[0]; S.drone = { x: (b.x0 + b.x1) / 2, y: b.h }; dom.angle.min = -90; dom.angle.max = 90; dom.angle.value = 45; dom.angleLabel.textContent = 'Angle of elevation θ (negative = descend)'; }
    S.trail.push({ x: S.drone.x, y: S.drone.y });
    dom.dist.value = 60;
    dom.dir.hidden = M.view === 'top';
    dom.land.hidden = M.view === 'top';
    this_shell.setStage(`${i + 1}/${MISSIONS.length}`);
    this_shell.setTimer(S.cfg.time);
    resize();
    syncControls();
    renderBrief();
  }

  function objectives() {
    const M = S.M, list = [];
    M.people.forEach((p, k) => list.push({ text: `Rescue ${p.label}`, done: S.rescued.has(k) }));
    if (M.cabin) list.push({ text: 'Deliver supplies to the cabin pad', done: S.delivered });
    list.push({ text: 'Return and land at base', done: false });
    return list;
  }
  function renderBrief() {
    const M = S.M;
    dom.brief.innerHTML = `<h2>Mission ${S.mIdx + 1}: ${M.name}</h2><p style="margin:0 0 4px">${M.brief}</p><ul>${objectives().map((o) => `<li class="${o.done ? 'is-done' : ''}">${o.text}</li>`).join('')}</ul>`;
    const done = objectives().filter((o) => o.done).length;
    this_shell.setProgress(done / objectives().length, `Mission ${S.mIdx + 1} objectives`);
    this_shell.setResource(`⛽ ${Math.round(S.fuel)}% · 🚁×${S.drones}`, S.fuel < 25 || S.drones <= 1);
  }

  /** Launch Rescue: commit the planned leg and fly it. */
  function launch() {
    if (!this_shell.isPlaying() || S.flight) return;
    if([dom.angle,dom.dist].some(input=>!input.value.trim()||!input.checkValidity())){this_shell.toast('Enter a valid angle and positive distance.','warn');return;}
    const L = plannedLeg(true);
    const goal=S.M.waypoints[S.routeIndex];
    if(!goal)return;
    if(S.M.view==='side'&&S.routeIndex===1&&!S.rescued.has(0)){this_shell.toast('Rescue the climber with the winch before starting the return route.','warn');return;}
    const key='flight:'+S.mIdx+':'+S.routeIndex;
    const accurate=Math.hypot(L.ex-goal.x,L.ey-goal.y)<=1.5;
    this_shell.maths.record(S.M.view==='top'?'Bearings and wind vectors':'Right-triangle flight planning',key,accurate);
    if(!accurate){
      dom.legInfo.textContent='Committed plan ends at ('+round(L.ex,1)+', '+round(L.ey,1)+'). That misses the required waypoint. Recalculate distance, direction and angle; no flight fuel was spent.';
      this_shell.toast('Flight plan rejected. Check the geometry before launching.','warn');return;
    }
    if (L.d <= 0) return;
    if (S.landed && S.M.view === 'side' && L.dy <= 0) { this_shell.toast('You are on the ground. Use a positive angle to take off first.', 'warn', 2600); MG.sound.play('error'); return; }
    if (L.fuel > S.fuel + 1e-9) { this_shell.toast(`Not enough fuel: this leg needs ${round(L.fuel, 1)}%, you have ${round(S.fuel, 1)}%. Shorten it or abort.`, 'bad', 3200); MG.sound.play('error'); return; }
    S.fuel -= L.fuel;
    S.fuelUsed += L.fuel;
    S.legs++; S.totalLegs++;
    const wasLanded = S.landed;
    S.landed = false;
    S.cable = null;
    S.flight = { sx: S.drone.x, sy: S.drone.y, L, t: 0, fromGround: wasLanded };
    MG.sound.play('whoosh');
    renderBrief();
  }

  function updateFlight(dt) {
    const F = S.flight;
    if (!F) return;
    const M = S.M;
    F.t = Math.min(F.L.t, F.t + dt);
    const k = F.L.t ? F.t / F.L.t : 1;
    const x = F.sx + F.L.dx * k + F.L.drift * k, y = F.sy + F.L.dy * k;
    S.drone.x = x; S.drone.y = y;
    if (Math.random() < dt * 8) MG.sound.play('engine');
    if (Math.floor(k * 30) !== F.lastTrail) { F.lastTrail = Math.floor(k * 30); S.trail.push({ x, y }); }
    // Collision checks along the way
    if (M.view === 'side') {
      if (x < 0 || x > M.w || y > M.h) return crash('Flew out of the mission area!');
      const g = groundAt(M, x);
      // Ignore ground contact for the first few metres of a take-off.
      if (y <= g + 1.5 && !(F.fromGround && k * F.L.d < 5 && F.L.dy > 0)) {
        const pad = padAt(M, x);
        if (pad && Math.abs(g - pad.h) < 0.01) { S.fuel += F.L.fuel * (1 - k); S.fuelUsed -= F.L.fuel * (1 - k); return touchdown(pad); }
        return crash('Hit the mountainside!');
      }
      if (inRock(M, x, y)) return crash('Hit the rock overhang!');
    } else {
      if (Math.abs(x) > M.w / 2 || Math.abs(y) > M.h / 2) return crash('Lost in the blizzard — flew off the map!');
      for (const p of M.peaks) if (Math.hypot(x - p.x, y - p.y) < p.r) return crash('Crashed into a peak!');
    }
    if (F.t >= F.L.t) endLeg();
  }

  function endLeg() {
    S.flight = null;
    const M = S.M;
    const goal=M.waypoints[S.routeIndex];
    if(goal&&Math.hypot(S.drone.x-goal.x,S.drone.y-goal.y)<=2)S.routeIndex++;
    if (M.view === 'top') {
      M.people.forEach((p, k) => {
        if (S.rescued.has(k)) return;
        const pp = personPos(M, p);
        if (Math.hypot(S.drone.x - pp.x, S.drone.y - pp.y) <= 10) rescue(k);
      });
      if (Math.hypot(S.drone.x, S.drone.y) <= 12) { S.landed = true; checkBase(); }
    }
    renderBrief();
  }

  function touchdown(pad) {
    S.flight = null;
    S.landed = true;
    S.drone.y = pad.h;
    const goal=S.M.waypoints[S.routeIndex];
    if(goal&&pad.id==='base'&&Math.hypot(S.drone.x-goal.x,S.drone.y-goal.y)<=2)S.routeIndex++;
    MG.sound.play('place');
    if (pad.id === 'cabin' && !S.delivered) {
      S.delivered = true;
      this_shell.addScore(200, 'Supplies delivered', toScreen(S.drone.x, S.drone.y));
      this_shell.toast('📦 Supplies delivered to the cabin!', 'good');
      MG.sound.play('success');
    } else if (pad.id === 'base') checkBase();
    else this_shell.toast(`Landed safely on the ${pad.label} pad.`, 'info');
    renderBrief();
  }

  function checkBase() {
    const remaining = objectives().filter((o) => !o.done && !o.text.startsWith('Return'));
    if (remaining.length) { this_shell.toast(`Landed at base — still to do: ${remaining.map((o) => o.text).join(', ')}.`, 'info', 2600); return; }
    if(S.routeIndex<S.M.waypoints.length)return;
    missionComplete();
  }

  /** Lower Cable: the hook ends at (x + L sin φ, y − L cos φ). */
  function lowerCable() {
    if (!this_shell.isPlaying() || S.flight || S.M.view === 'top') return;
    if (S.landed) { this_shell.toast('Take off first — the winch only works while hovering.', 'warn'); return; }
    if([dom.cable,dom.cangle].some(input=>!input.value.trim()||!input.checkValidity())){this_shell.toast('Enter a valid cable length and angle.','warn');return;}
    const L = Number(dom.cable.value), phi = rad(Number(dom.cangle.value));
    const hx = S.drone.x + L * Math.sin(phi), hy = S.drone.y - L * Math.cos(phi);
    S.cable = { hx, hy, t: 0 };
    S.winches++;
    const M = S.M;
    const snag = (M.rocks || []).some((r) => segHitsRect(S.drone.x, S.drone.y, hx, hy, r));
    if (snag) { this_shell.maths.record('Right-triangle cables','cable:'+S.mIdx,false); S.fuel = Math.max(0, S.fuel - 2); this_shell.toast('🪨 The cable snagged on the rock! Reposition and try an angled cable. (−2% fuel)', 'bad', 3000); MG.sound.play('error'); S.cable.bad = true; renderBrief(); return; }
    let hit = -1, best = Infinity;
    M.people.forEach((p, k) => {
      if (S.rescued.has(k)) return;
      const d = Math.hypot(hx - p.x, hy - p.y);
      if (d < best) { best = d; hit = k; }
    });
    this_shell.maths.record('Right-triangle cables','cable:'+S.mIdx,hit>=0&&best<=HOOK_TOL);
    if (hit >= 0 && best <= HOOK_TOL) { rescue(hit); return; }
    if (hy < groundAt(M, hx) - 1) { S.fuel = Math.max(0, S.fuel - 2); this_shell.toast('The hook hit the ground before reaching anyone. (−2% fuel)', 'bad'); MG.sound.play('error'); S.cable.bad = true; renderBrief(); return; }
    S.fuel = Math.max(0, S.fuel - 2);
    S.cable.bad = true;
    this_shell.toast(`Hook missed by ${round(best, 1)} m. (−2% fuel hovering)`, 'warn');
    MG.sound.play('error');
    renderBrief();
  }

  function rescue(k) {
    S.rescued.add(k);
    S.rescues++;
    const p = S.M.people[k];
    this_shell.addScore(300, `${p.label} rescued!`, toScreen(S.drone.x, S.drone.y));
    this_shell.toast(`🙌 ${p.label} is safely aboard!`, 'good');
    MG.sound.play('success');
    this_shell.flash('good');
    renderBrief();
  }

  function crash(why) {
    S.flight = null;
    S.crashes++;
    S.drones--;
    this_shell.addScore(-100, 'Crash', toScreen(S.drone.x, S.drone.y));
    this_shell.flash('bad');
    MG.sound.play('hit');
    if (S.drones <= 0) return finish(false, 'No drones left', `${why} The last drone was lost on mission ${S.mIdx + 1}.`);
    this_shell.toast(`💥 ${why} Drone lost — the mission restarts with a fresh drone.`, 'bad', 3200);
    loadMission(S.mIdx);
  }

  function abort() {
    if (!this_shell.isPlaying() || S.flight) return;
    S.drones--; S.aborts++;
    this_shell.flash('bad');
    if (S.drones <= 0) return finish(false, 'No drones left', 'The mission was aborted with no drones in reserve.');
    this_shell.toast('Mission aborted — restarting with a fresh drone.', 'warn');
    loadMission(S.mIdx);
  }

  function missionComplete() {
    const M = S.M;
    const fuelPct = Math.round(S.fuel);
    const legBonus = Math.max(0, M.par - S.legs) * 30;
    this_shell.addScore(150 + fuelPct * 2 + legBonus, 'Mission complete');
    S.reports.push({ name: M.name, legs: S.legs, fuel: fuelPct, par: M.par });
    S.fuelLeft.push(fuelPct);
    S.missionsDone++;
    MG.sound.play('stage');
    this_shell.flash('good');
    if (S.mIdx + 1 >= MISSIONS.length) return finish(true, 'All rescues complete!', 'Every stranded person is safe and every drone is home.');
    this_shell.toast(`✔ ${M.name} report: ${S.legs} legs (par ${M.par}), ${fuelPct}% fuel left.`, 'good', 3600);
    loadMission(S.mIdx + 1);
  }

  /* ---------------- Controls ---------------- */
  function syncControls() {
    const M=S.M,goal=M.waypoints[S.routeIndex];
    dom.angleOut.textContent=Number(dom.angle.value)+'°';dom.distOut.textContent=Number(dom.dist.value)+' m';
    dom.dir.textContent=S.dir>0?'Facing: Right ▶':'◀ Facing: Left';dom.cableOut.textContent=dom.cable.value;dom.cangleOut.textContent=dom.cangle.value+'°';
    dom.winchPane.classList.toggle('is-off',M.view==='top');dom.winch.disabled=M.view==='top';
    const route=M.view==='top'&&S.routeIndex<M.people.length?'Next target: '+M.people[S.routeIndex].label+' at bearing '+M.people[S.routeIndex].bearing+'°, '+M.people[S.routeIndex].dist+' m from BASE.':goal?'Next waypoint ('+round(goal.x,1)+', '+round(goal.y,1)+'). From the drone: Δx '+round(goal.x-S.drone.x,1)+' m, Δy '+round(goal.y-S.drone.y,1)+' m.':'Route complete.';
    dom.legInfo.textContent=route+' Drone speed is 40 m/s. Wind is '+M.wind+' m/s horizontally. Commit a distance and angle; the endpoint is checked after submission.';
    const help=MG.el('button',{class:'mg-btn mg-btn--sm',type:'button'},'Show route guidance (assisted)');
    help.addEventListener('click',()=>{
      this_shell.maths.assist(M.view==='top'?'Bearings and wind vectors':'Right-triangle flight planning','flight:'+S.mIdx+':'+S.routeIndex);
      const text=MG.el('p',{},M.view==='top'?'Bearings: east = d sin b, north = d cos b. Wind adds w × d/40 to east. Convert each target to coordinates before finding the new displacement.':'Without wind: d = √(Δx² + Δy²); θ = atan2(Δy, |Δx|). With wind: Δx = facing × d cos θ + w × d/40; Δy = d sin θ. A calculator is allowed.');
      dom.legInfo.append(text);help.disabled=true;
    });dom.legInfo.append(help);renderSensors();
  }

  function renderSensors() {
    const M=S.M;
    const lines=['Drone ('+round(S.drone.x,1)+', '+round(S.drone.y,1)+') · '+(S.landed?'LANDED':S.flight?'FLYING':'HOVERING')];
    M.people.forEach((p,k)=>{if(!S.rescued.has(k))lines.push(M.view==='top'?p.label+': bearing '+p.bearing+'°, '+p.dist+' m from BASE':p.label+' at ('+p.x+', '+p.y+'). Calculate cable length and angle from vertical.');});
    lines.push('Wind '+M.wind+' m/s horizontally. Calculator allowed; use degrees.');dom.sensors.innerHTML=lines.join('<br>');
  }

  function adjust(which, delta) {
    if (!S || !this_shell.isPlaying()) return;
    const inp = which === 'angle' ? dom.angle : dom.dist;
    let v = Number(inp.value) + delta;
    if (which === 'angle' && S.M.view === 'top') v = (v + 360) % 360;
    inp.value = clamp(v, Number(inp.min), Number(inp.max));
    MG.sound.play('click');
    syncControls();
  }

  /** Convenience: point straight down to the ground below. */
  function setLanding() {
    if(!S||S.M.view==='top')return;
    dom.angle.value=-90;
    this_shell.toast('Vertical descent selected. Calculate the distance and account for any wind before launching.','info');syncControls();
  }

  /* ---------------- Rendering ---------------- */
  function resize() {
    const f = MG.fitCanvas(canvas);
    const M = S.M;
    const s = Math.min(f.w / M.w, f.h / M.h);
    view = { w: f.w, h: f.h, s, ox: (f.w - M.w * s) / 2, oy: (f.h - M.h * s) / 2, ctx: f.ctx };
  }
  // World → canvas. Side view: y up from the bottom. Top view: centred origin, north up.
  function wx(x) { return S.M.view === 'top' ? view.ox + (x + S.M.w / 2) * view.s : view.ox + x * view.s; }
  function wy(y) { return S.M.view === 'top' ? view.oy + (S.M.h / 2 - y) * view.s : view.oy + (S.M.h - y) * view.s; }
  function toScreen(x, y) { const r = canvas.getBoundingClientRect(); return { x: r.left + wx(x), y: r.top + wy(y) }; }

  function draw(time) {
    const { ctx } = view;
    if (!ctx) return;
    ctx.clearRect(0, 0, view.w, view.h);
    if (S.M.view === 'side') drawSide(ctx, time); else drawTop(ctx, time);
  }

  function drawSide(ctx, time) {
    const M = S.M, s = view.s;
    const g = ctx.createLinearGradient(0, 0, 0, view.h);
    g.addColorStop(0, '#7fbbe6'); g.addColorStop(1, '#eef6fb');
    ctx.fillStyle = g; ctx.fillRect(0, 0, view.w, view.h);
    // Grid every 50 m with labels
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.fillStyle = 'rgba(16,32,48,.6)'; ctx.font = '10px B612, sans-serif';
    for (let x = 0; x <= M.w; x += 50) { ctx.beginPath(); ctx.moveTo(wx(x), wy(0)); ctx.lineTo(wx(x), wy(M.h)); ctx.stroke(); ctx.fillText(x, wx(x) + 2, wy(0) - 3); }
    for (let y = 0; y <= M.h; y += 50) { ctx.beginPath(); ctx.moveTo(wx(0), wy(y)); ctx.lineTo(wx(M.w), wy(y)); ctx.stroke(); ctx.fillText(y + ' m', wx(0) + 2, wy(y) - 3); }
    // Mountains
    ctx.fillStyle = '#56697b'; ctx.beginPath(); ctx.moveTo(wx(0), wy(0));
    M.terrain.forEach(([x, y]) => ctx.lineTo(wx(x), wy(y)));
    ctx.lineTo(wx(M.w), wy(0)); ctx.closePath(); ctx.fill();
    ctx.fillRect(0, wy(0), view.w, view.h - wy(0));
    ctx.strokeStyle = '#eef6ff'; ctx.lineWidth = 4; ctx.beginPath();
    M.terrain.forEach(([x, y], i) => (i ? ctx.lineTo(wx(x), wy(y)) : ctx.moveTo(wx(x), wy(y)))); ctx.stroke(); ctx.lineWidth = 1;
    for (const r of M.rocks) { ctx.fillStyle = '#3f4a55'; ctx.fillRect(wx(r.x), wy(r.y + r.h), r.w * s, r.h * s); ctx.fillStyle = '#fff'; ctx.font = '10px B612, sans-serif'; ctx.fillText('overhang', wx(r.x), wy(r.y + r.h) - 3); }
    for (const p of M.pads) {
      ctx.fillStyle = p.id === 'base' ? '#ff6a00' : '#2e7d32'; ctx.fillRect(wx(p.x0), wy(p.h) - 4, (p.x1 - p.x0) * s, 5);
      ctx.fillStyle = '#102030'; ctx.font = 'bold 11px B612, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(p.label, wx((p.x0 + p.x1) / 2), wy(p.h) + 14);
      if (p.id === 'cabin') { const cx = wx(p.x1 - 6); ctx.fillStyle = '#8d5524'; ctx.fillRect(cx - 10, wy(p.h) - 18, 18, 14); ctx.fillStyle = '#b71c1c'; ctx.beginPath(); ctx.moveTo(cx - 13, wy(p.h) - 18); ctx.lineTo(cx - 1, wy(p.h) - 28); ctx.lineTo(cx + 11, wy(p.h) - 18); ctx.fill(); }
    }
    M.people.forEach((p, k) => { if (!S.rescued.has(k)) drawPerson(ctx, wx(p.x), wy(p.y), time, p.label); });
    // Wind sock
    if (M.wind) { ctx.fillStyle = '#102030'; ctx.font = 'bold 12px B612, sans-serif'; ctx.textAlign = 'left'; ctx.fillText(`Wind ${M.wind > 0 ? '→' : '←'} ${Math.abs(M.wind)} m/s`, view.w - 120, 20); }
    drawTrail(ctx);
    drawPreview(ctx);
    drawCable(ctx);
    drawDrone(ctx, time);
  }

  function drawTop(ctx, time) {
    const M = S.M, s = view.s;
    ctx.fillStyle = '#eef4f8'; ctx.fillRect(0, 0, view.w, view.h);
    ctx.strokeStyle = 'rgba(29,43,56,.07)'; for (let r = 30; r < Math.max(view.w, view.h); r += 26) { ctx.beginPath(); ctx.arc(view.w * 0.3, view.h * 0.4, r, 0, 7); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(80,110,140,.2)'; ctx.fillStyle = 'rgba(16,32,48,.55)'; ctx.font = '10px B612, sans-serif'; ctx.textAlign = 'left';
    for (let v = -200; v <= 200; v += 50) {
      ctx.beginPath(); ctx.moveTo(wx(v), wy(-200)); ctx.lineTo(wx(v), wy(200)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(wx(-200), wy(v)); ctx.lineTo(wx(200), wy(v)); ctx.stroke();
      if (v) { ctx.fillText(v, wx(v) + 2, wy(0) - 2); ctx.fillText(v, wx(0) + 2, wy(v) - 2); }
    }
    // Snow flurries
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    for (let i = 0; i < 70; i++) { const x = (i * 97 + time * 40 * (1 + (i % 3))) % view.w, y = (i * 53 + time * 25) % view.h; ctx.fillRect(view.w - x, y, 2, 2); }
    for (const p of M.peaks) {
      for (let k = 3; k >= 1; k--) { ctx.fillStyle = `rgba(90,110,130,${0.25 + (3 - k) * 0.2})`; ctx.beginPath(); ctx.arc(wx(p.x), wy(p.y), p.r * s * (k / 3 + 0.2), 0, 7); ctx.fill(); }
      ctx.strokeStyle = '#3a4a5a'; ctx.beginPath(); ctx.arc(wx(p.x), wy(p.y), p.r * s, 0, 7); ctx.stroke();
    }
    // Compass and base
    ctx.fillStyle = '#ff6a00'; ctx.beginPath(); ctx.arc(wx(0), wy(0), 12 * s, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px B612, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('H', wx(0), wy(0) + 4);
    ctx.fillStyle = '#102030'; ctx.font = 'bold 14px B612, sans-serif'; ctx.fillText('N ↑', view.w - 26, 22);
    // Hikers are hidden in the blizzard until you are within 30 m
    M.people.forEach((p, k) => {
      if (S.rescued.has(k)) return;
      const pp = personPos(M, p);
      if (Math.hypot(pp.x - S.drone.x, pp.y - S.drone.y) < 30) drawPerson(ctx, wx(pp.x), wy(pp.y), time, p.label);
      else { ctx.strokeStyle = 'rgba(255,106,0,.35)'; ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.moveTo(wx(0), wy(0)); ctx.lineTo(wx(0) + Math.sin(rad(p.bearing)) * 60, wy(0) - Math.cos(rad(p.bearing)) * 60); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = 'rgba(255,106,0,.8)'; ctx.font = '10px B612, sans-serif'; ctx.fillText(`${String(p.bearing).padStart(3, '0')}°`, wx(0) + Math.sin(rad(p.bearing)) * 72, wy(0) - Math.cos(rad(p.bearing)) * 72); }
    });
    drawTrail(ctx);
    drawPreview(ctx);
    drawDrone(ctx, time);
  }

  function drawPerson(ctx, x, y, time, label) {
    const wave = Math.sin(time * 6) * 4;
    ctx.strokeStyle = '#d32f2f'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x, y - 16); ctx.moveTo(x, y - 13); ctx.lineTo(x + 7, y - 20 + wave); ctx.moveTo(x, y - 4); ctx.lineTo(x - 4, y); ctx.moveTo(x, y - 4); ctx.lineTo(x + 4, y); ctx.stroke();
    ctx.fillStyle = '#ffd7b0'; ctx.beginPath(); ctx.arc(x, y - 20, 4, 0, 7); ctx.fill();
    ctx.lineWidth = 1; ctx.fillStyle = '#102030'; ctx.font = 'bold 10px B612, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(label, x, y - 28);
  }
  function drawTrail(ctx) {
    ctx.strokeStyle = 'rgba(255,106,0,.5)'; ctx.lineWidth = 2; ctx.beginPath();
    S.trail.forEach((p, i) => (i ? ctx.lineTo(wx(p.x), wy(p.y)) : ctx.moveTo(wx(p.x), wy(p.y)))); ctx.stroke(); ctx.lineWidth = 1;
  }
  function drawPreview(ctx) {
    // Flight and cable results appear only after commitment; no live aiming ray.
  }
  function drawCable(ctx) {
    if (!S.cable || S.flight) return;
    ctx.strokeStyle = S.cable.bad ? '#d32f2f' : '#222'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(wx(S.drone.x), wy(S.drone.y)); ctx.lineTo(wx(S.cable.hx), wy(S.cable.hy)); ctx.stroke(); ctx.lineWidth = 1;
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(wx(S.cable.hx), wy(S.cable.hy), 3, 0, 7); ctx.fill();
  }
  function drawDrone(ctx, time) {
    const x = wx(S.drone.x), y = wy(S.drone.y);
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = '#102030'; ctx.fillRect(-12, -4, 24, 8);
    ctx.fillStyle = '#ff6a00'; ctx.fillRect(-6, -7, 12, 6);
    const spin = Math.abs(Math.sin(time * 40)) * 10 + 2;
    ctx.fillStyle = 'rgba(16,32,48,.6)'; ctx.fillRect(-16 - spin / 2, -10, spin, 2); ctx.fillRect(16 - spin / 2, -10, spin, 2);
    ctx.restore();
  }

  /* ---------------- End ---------------- */
  function finish(won, title, reason) {
    S.flight = null;
    const avgFuel = S.fuelLeft.length ? Math.round(S.fuelLeft.reduce((a, b) => a + b, 0) / S.fuelLeft.length) : 0;
    let stars;
    if (won) stars = S.crashes === 0 && S.aborts === 0 && avgFuel >= 30 ? 3 : S.crashes + S.aborts <= 1 ? 2 : 1;
    else stars = S.missionsDone >= 2 ? 2 : S.missionsDone >= 1 ? 1 : 0;
    this_shell.end({
      won, title, reason, stars,
      stats: [
        ['Missions complete', `${S.missionsDone} / ${MISSIONS.length}`],
        ['People rescued', S.rescues],
        ['Crashes', S.crashes],
        ['Drones left', Math.max(0, S.drones)],
        ['Average fuel left', `${avgFuel}%`],
        ['Total legs flown', S.totalLegs],
        ['Winch attempts', S.winches],
        ['Mission reports', S.reports.map((r) => `${r.name}: ${r.legs} legs (par ${r.par}), ${r.fuel}% fuel`).join(' · ') || '—']
      ],
      math: [
        'Each leg is the hypotenuse d of a right-angled triangle: horizontal Δx = d cos θ and vertical Δy = d sin θ.',
        'To reach a point Δx across and Δy up: θ = tan⁻¹(Δy ÷ Δx) and d = √(Δx² + Δy²).',
        'Angled cable: if the person is a metres across and b metres below, φ = tan⁻¹(a ÷ b) from the vertical and L = √(a² + b²).',
        'Bearings are measured clockwise from north, so east = d sin b and north = d cos b. Bearing 210° points south-west.',
        'Wind drift = wind speed × flight time (time = distance ÷ 40 m/s). Aim upwind to compensate.'
      ]
    });
  }

  /* ---------------- Shell ---------------- */
  const this_shell = MG.createShell({
    id: 'trig-rescue',
    title: 'Trigonometry Rescue',
    tagline: 'Climbers are stranded on the ridge. Fly the rescue drone using angles and distances!',
    goal: 'Rescue everyone in all 10 missions and land back at base.',
    steps: [
      ['📐', 'Set an angle and a distance for the next leg.'],
      ['🚁', 'Launch! The drone flies d·cos θ across, d·sin θ up.'],
      ['🪝', 'Hover near people and lower the winch cable.']
    ],
    keys: [
      ['<kbd>←</kbd><kbd>→</kbd>', 'Angle'],
      ['<kbd>↑</kbd><kbd>↓</kbd>', 'Distance'],
      ['<kbd>Enter</kbd>', 'Launch'],
      ['<kbd>W</kbd>', 'Lower cable'],
      ['<kbd>F</kbd>', 'Flip direction']
    ],
    genre: 'Physics & navigation puzzle',
    topic: 'Right-angled trigonometry, elevation, bearings',
    premise: 'Storms have stranded climbers and hikers across the Ridgeback Mountains. You are the pilot of the rescue team’s drone.',
    objective: 'Plan straight flight legs with angles and distances, lower the winch to stranded people, deliver supplies and land safely — without running out of fuel or drones.',
    livesLabel: 'Fuel · drones',
    stageLabel: 'Round',
    art: `<svg viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="tr-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fbbe6"/><stop offset="1" stop-color="#eef6fb"/></linearGradient></defs><rect width="400" height="500" fill="url(#tr-sky)"/><circle cx="320" cy="70" r="30" fill="#fff6d6"/><path d="M-10 300L70 210L120 250L210 120L290 230L340 180L410 260V500H-10Z" fill="#9fb4c6"/><path d="M190 148L210 120L232 152L218 146L206 160Z M58 224L70 210L84 222Z M330 190L340 180L352 192Z" fill="#fff"/><path d="M-10 420L60 340L130 380L170 330L200 360L260 300L300 330L410 290V500H-10Z" fill="#56697b"/><path d="M250 310l10 -10l14 12l-8 -2Z" fill="#fff"/><path d="M200 360h70v8h-70Z" fill="#eef6fb"/><g transform="translate(236 344)"><path d="M0 0v-14M0 -11l8 -8M0 0l-4 6M0 0l4 6" stroke="#c62828" stroke-width="3" stroke-linecap="round"/><circle cx="0" cy="-18" r="4" fill="#ffd7b0"/></g><path d="M60 460L236 236" stroke="#ff5a1f" stroke-width="4" stroke-dasharray="12 9"/><path d="M60 460H236V236" fill="none" stroke="#1d2b38" stroke-width="2.5" stroke-dasharray="5 5"/><path d="M100 460A40 40 0 0 0 85 428" fill="none" stroke="#1d2b38" stroke-width="3"/><text x="106" y="448" font-family="B612 Mono, monospace" font-weight="700" font-size="18" fill="#1d2b38">θ</text><text x="148" y="486" font-family="B612 Mono, monospace" font-weight="700" font-size="15" fill="#1d2b38" text-anchor="middle">d cos θ</text><text x="226" y="300" font-family="B612 Mono, monospace" font-weight="700" font-size="15" fill="#fff" transform="rotate(-90 226 300)" text-anchor="middle">d sin θ</text><g transform="translate(236 236)"><path d="M0 0v96" stroke="#1d2b38" stroke-width="2"/><rect x="-24" y="-8" width="48" height="14" rx="4" fill="#1d2b38"/><rect x="-12" y="-16" width="24" height="10" rx="3" fill="#ff5a1f"/><rect x="-40" y="-20" width="26" height="4" rx="2" fill="#1d2b38"/><rect x="14" y="-20" width="26" height="4" rx="2" fill="#1d2b38"/></g><rect x="40" y="460" width="44" height="8" fill="#ff5a1f"/><g transform="translate(40 30)"><rect width="120" height="40" rx="8" fill="#fff" stroke="#1d2b38" stroke-width="3"/><text x="60" y="27" text-anchor="middle" font-family="B612 Mono, monospace" font-weight="700" font-size="18" fill="#ff5a1f">✚ RESCUE</text></g></svg>`,
    instructions: {
      objective: 'Complete 10 missions: rescue every stranded person, deliver supplies where needed and land back at base.',
      controls: [
        'Set the angle (θ, or a bearing in Mission 3) and the distance d with the sliders, −/+ buttons or keys: <kbd>←</kbd> <kbd>→</kbd> angle (hold <kbd>Shift</kbd> for ±5), <kbd>↑</kbd> <kbd>↓</kbd> distance (Shift ±10).',
        '<kbd>F</kbd> flips the facing direction in side view. <strong>Set landing</strong> points straight down to the ground.',
        '<strong>Launch Rescue</strong> (<kbd>Enter</kbd> or <kbd>Space</kbd>) flies the planned leg. <strong>Lower Cable</strong> (<kbd>W</kbd>) uses the winch while hovering.',
        '<kbd>P</kbd>/<kbd>Esc</kbd> pause. Touch: all controls are large buttons and sliders.'
      ],
      maths: [
        'A leg of length d at angle θ moves the drone Δx = d cos θ across and Δy = d sin θ up (negative θ descends).',
        'In the blizzard mission you fly bearings: east = d sin b, north = d cos b.',
        'The winch hook lands at L sin φ across and L cos φ below the drone — under the rock overhang you need an angled cable.',
        'Wind adds drift = wind speed × flight time. Account for any drift not included in the preview.',
        'Fuel per leg = 0.08 × d + 0.08 × (metres climbed).'
      ],
      scoring: [
        'Rescue +300, supply delivery +200. Mission complete: +150 + 2 × fuel % left + 30 for each leg under par.',
        'Crash −100.'
      ],
      failure: [
        'Hitting terrain, a rock or a peak, or leaving the map, destroys the drone and restarts the mission. Aborting also costs a drone.',
        'Missed or snagged cables cost 2% fuel. When the last drone is lost, the run ends. Running out of time also ends the run.'
      ],
      timer: [
        'Each mission has a countdown, shown in the HUD. Pausing freezes the drone, the wind and the countdown.'
      ]
    },
    stars: [
      '1 star: complete Mission 1 (or all missions).',
      '2 stars: complete all missions with at most 1 crash or abort (a failed run that completed 2 missions also earns 2).',
      '3 stars: complete all missions with no crashes or aborts and at least 30% fuel left on average.'
    ],
    onStart(diff) {
      const cfg = DIFF[diff];
      MISSIONS=freshMissions();
      S = { cfg, drones: cfg.drones, crashes: 0, aborts: 0, rescues: 0, winches: 0, totalLegs: 0, fuelUsed: 0, missionsDone: 0, reports: [], fuelLeft: [], clock: 0 };
      dom.cable.value = 20; dom.cangle.value = 0;
      loadMission(0);
    },
    onUpdate(dt) {
      S.clock += dt;
      const wasFlying=!!S.flight;
      updateFlight(dt);
      if(wasFlying&&!S.flight&&this.isPlaying())syncControls();
      if (!this_shell.isPlaying()) return;
      if (S.flight || Math.floor(S.clock * 4) !== S.lastSync) { S.lastSync = Math.floor(S.clock * 4); renderSensors(); }
      draw(S.clock);
    },
    onTimeUp() { finish(false, 'Out of time', `Mission ${S.mIdx + 1} (${S.M.name}) ran out of time.`); },
    onStop() { if (S) S.flight = null; }
  });

  /* ---------------- Input (bound once) ---------------- */
  document.querySelectorAll('[data-adj]').forEach((b) => b.addEventListener('click', () => { const [w, d] = b.dataset.adj.split(':'); adjust(w, Number(d)); }));
  [dom.angle, dom.dist, dom.cable, dom.cangle].forEach((i) => i.addEventListener('input', () => { if (S) syncControls(); }));
  dom.dir.addEventListener('click', () => { if (!S || !this_shell.isPlaying()) return; S.dir *= -1; MG.sound.play('click'); syncControls(); });
  dom.land.addEventListener('click', setLanding);
  dom.launch.addEventListener('click', launch);
  dom.winch.addEventListener('click', lowerCable);
  dom.abort.addEventListener('click', abort);
  window.addEventListener('resize', () => { if (S) resize(); });
  window.addEventListener('keydown', (e) => {
    if (!this_shell.isPlaying() || MG.isTarget(e, 'input, select, textarea')) return;
    const big = e.shiftKey;
    const k = e.key;
    if (k === 'ArrowLeft') { e.preventDefault(); adjust('angle', big ? -5 : -1); }
    else if (k === 'ArrowRight') { e.preventDefault(); adjust('angle', big ? 5 : 1); }
    else if (k === 'ArrowUp') { e.preventDefault(); adjust('dist', big ? 10 : 1); }
    else if (k === 'ArrowDown') { e.preventDefault(); adjust('dist', big ? -10 : -1); }
    else if ((k === 'Enter' || k === ' ') && !MG.isTarget(e, 'button')) { e.preventDefault(); launch(); }
    else if (k === 'w' || k === 'W') lowerCable();
    else if (k === 'f' || k === 'F') dom.dir.click();
  });

  MG.game = { get state() { return S; }, launch, lowerCable, setLanding, groundAt, get MISSIONS(){return MISSIONS;}, syncControls, dom };
})();
