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
   Integer Maze — positive and negative integers, the number line, integer
   operations and the order of operations. The player carries an energy
   state E (an integer). Orbs change E when stepped on (+(−5), −(−3)…),
   consoles apply expressions such as (E − 3) × (−2), and gates, lifts and
   the exit seal only respond to particular values of E.

   Mazes are generated as perfect mazes. Mechanisms are placed along the
   unique start→exit path and the intended E values are simulated while
   placing them, so every generated level is solvable by construction.
   ========================================================================== */
(() => {
  'use strict';
  const { clamp, pick, randInt, shuffle } = MG;

  /* ---------------- Configuration ---------------- */
  const E_LIMIT = 20;                 // |E| above this overloads the suit
  const PULSE_PERIOD = 2.4, PULSE_ON = 1.0;
  const MOVE_REPEAT = 0.15;
  const LEVELS = MG.expandRounds([
    { name: 'Sector 1 · Signed Steps', cw: 7, ch: 5, start: 0, time: 200,
      plan: [['op', 0.12, [3, 4, 5, 6]], ['op', 0.28, [-2, -3, -4]], ['gate', 0.42, 'ge'], ['door', 0.6], ['op', 0.74, [2, 3, -5, -6]], ['console', 'L1']],
      decoys: 2, chips: 3, traps: 1, pulses: 1 },
    { name: 'Sector 2 · Number-Line Lifts', cw: 9, ch: 6, start: 3, time: 250,
      plan: [['op', 0.08, [-4, -5, -6, -7]], ['gate', 0.24, 'eq'], ['op', 0.34, [2, 3, 4]], ['door', 0.46], ['lift', 0.55, 0.66], ['op', 0.73, [-3, 5, -4, 6]], ['gate', 0.8, 'range'], ['op', 0.86, [2, -2, 3, -3]], ['console', 'L2']],
      decoys: 3, chips: 4, traps: 2, pulses: 2 },
    { name: 'Sector 3 · Core Escape', cw: 10, ch: 7, start: -2, time: 300,
      plan: [['op', 0.08, [5, 6, 7]], ['gate', 0.2, 'le'], ['op', 0.3, [-8, -9, -10]], ['door', 0.42], ['gate', 0.52, 'eq'], ['lift', 0.6, 0.7], ['op', 0.78, [4, -4, 5, -5]], ['console', 'L3']],
      decoys: 4, chips: 4, traps: 2, pulses: 3, core: true }
  ]);
  const DIFF = {
    easy:   { shields: 5, timeMul: 1.3, preview: true,  failCostsShield: false, meltdown: 75 },
    normal: { shields: 4, timeMul: 1,   preview: false, failCostsShield: true,  meltdown: 55 },
    hard:   { shields: 3, timeMul: 0.8, preview: false, failCostsShield: true,  meltdown: 40 }
  };

  const exitKnown = () => !S.L.consoleItem || S.L.consoleItem.used;
  const exitValue = value => exitKnown() ? sgn(value) : '? (program console first)';

  /* ---------------- Number formatting ---------------- */
  const sgn = (n) => (n < 0 ? '−' + Math.abs(n) : String(n));
  const par = (n) => (n < 0 ? `(−${Math.abs(n)})` : String(n));
  /** Text for an orb that changes E by delta, sometimes written with double signs. */
  function opText(delta) {
    const a = Math.abs(delta);
    if (delta > 0) return Math.random() < 0.5 ? `+${a}` : `−(−${a})`;
    return Math.random() < 0.5 ? `−${a}` : `+(−${a})`;
  }
  /** Console expression templates. Each returns { text, f } for the chosen parameters. */
  const CONSOLES = {
    L1: [() => ({ text: 'E × 2', f: (E) => E * 2 }), () => ({ text: 'E × (−1)', f: (E) => -E }), () => ({ text: '3 × E', f: (E) => 3 * E })],
    L2: [
      () => { const a = randInt(1, 5), b = pick([2, -2, 3, -1]); return { text: `(E − ${a}) × ${par(b)}`, f: (E) => (E - a) * b }; },
      () => { const a = randInt(1, 6), b = pick([2, -2, -3]); return { text: `${par(b)} × E + ${a}`, f: (E) => b * E + a }; }
    ],
    L3: [
      () => { const a = randInt(2, 9), b = pick([2, 3, -2]); return { text: `${a} − ${par(b)} × E`, f: (E) => a - b * E }; },
      () => { const a = randInt(1, 4), b = pick([2, 3]); return { text: `(E + ${a}) × (−${b})`, f: (E) => (E + a) * -b }; },
      () => { const a = randInt(2, 9); return { text: `E × E − ${a}`, f: (E) => E * E - a }; }
    ]
  };

  /* ---------------- Maze generation ---------------- */
  function carve(cw, ch) {
    const W = cw * 2 + 1, H = ch * 2 + 1;
    const g = Array.from({ length: H }, () => new Array(W).fill('#'));
    const seen = new Set();
    const stack = [[0, 0]];
    seen.add('0,0');
    g[1][1] = '.';
    while (stack.length) {
      const [x, y] = stack[stack.length - 1];
      const nb = shuffle([[1, 0], [-1, 0], [0, 1], [0, -1]]).map(([dx, dy]) => [x + dx, y + dy, dx, dy]).filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < cw && ny < ch && !seen.has(nx + ',' + ny));
      if (!nb.length) { stack.pop(); continue; }
      const [nx, ny, dx, dy] = nb[0];
      g[y * 2 + 1 + dy][x * 2 + 1 + dx] = '.';
      g[ny * 2 + 1][nx * 2 + 1] = '.';
      seen.add(nx + ',' + ny);
      stack.push([nx, ny]);
    }
    return g;
  }
  const K = (c, r) => c + ',' + r;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function bfs(g, sc, sr) {
    const prev = new Map([[K(sc, sr), null]]), dist = new Map([[K(sc, sr), 0]]);
    const q = [[sc, sr]];
    while (q.length) {
      const [c, r] = q.shift();
      for (const [dx, dy] of DIRS) {
        const nc = c + dx, nr = r + dy;
        if (g[nr] && g[nr][nc] === '.' && !prev.has(K(nc, nr))) { prev.set(K(nc, nr), [c, r]); dist.set(K(nc, nr), dist.get(K(c, r)) + 1); q.push([nc, nr]); }
      }
    }
    return { prev, dist };
  }

  /** Build one level; retries until every planned mechanism can be placed. */
  function generateLevel(def, startE) {
    for (let attempt = 0; attempt < 400; attempt++) {
      const lvl = tryGenerate(def, startE);
      if (lvl) return lvl;
    }
    throw new Error('Could not generate level');
  }

  function tryGenerate(def, startE) {
    const g = carve(def.cw, def.ch);
    const { prev, dist } = bfs(g, 1, 1);
    let far = null, best = -1;
    for (const [k, d] of dist) { const [c, r] = k.split(',').map(Number); if (c % 2 && r % 2 && d > best) { best = d; far = [c, r]; } }
    const path = [];
    for (let p = far; p; p = prev.get(K(p[0], p[1]))) path.unshift(p);
    const L = path.length;
    if (L < def.cw * def.ch * 0.9) return null;
    const pIdx = new Map(path.map(([c, r], i) => [K(c, r), i]));

    // Branches: every non-path floor tile hangs off a path tile (attach index).
    const branchOf = new Map();
    const q = [];
    path.forEach(([c, r], i) => { for (const [dx, dy] of DIRS) { const nc = c + dx, nr = r + dy; if (g[nr][nc] === '.' && !pIdx.has(K(nc, nr)) && !branchOf.has(K(nc, nr))) { const b = { root: [nc, nr], attach: i, tiles: [], used: false }; branchOf.set(K(nc, nr), { b, d: 1 }); q.push([nc, nr]); } } });
    while (q.length) {
      const [c, r] = q.shift();
      const { b, d } = branchOf.get(K(c, r));
      b.tiles.push({ c, r, d });
      for (const [dx, dy] of DIRS) { const nc = c + dx, nr = r + dy; if (g[nr][nc] === '.' && !pIdx.has(K(nc, nr)) && !branchOf.has(K(nc, nr))) { branchOf.set(K(nc, nr), { b, d: d + 1 }); q.push([nc, nr]); } }
    }
    const branches = [...new Set([...branchOf.values()].map((v) => v.b))];
    branches.forEach((b) => { b.tip = b.tiles.reduce((a, t) => (t.d > a.d ? t : a)); b.depth = b.tip.d; });

    const items = new Map();       // "c,r" -> mechanism / pick-up
    const usedPath = new Set([0, L - 1]);
    const chasm = new Set();       // path indices replaced by chasm
    let cursor = 1;
    const freePath = (frac) => {
      let i = Math.max(cursor, Math.round(frac * (L - 1)));
      while (i < L - 1 && (usedPath.has(i) || chasm.has(i))) i++;
      if (i >= L - 2) return -1;
      usedPath.add(i);
      return i;
    };
    const takeBranch = (lo, hi) => {
      const c = branches.filter((b) => !b.used && b.attach >= lo && b.attach < hi && !chasm.has(b.attach));
      if (!c.length) return null;
      const b = pick(c); b.used = true; return b;
    };
    const put = (c, r, it) => { const o = Object.assign({ c, r }, it); items.set(K(c, r), o); return o; };
    const atPath = (i, it) => put(path[i][0], path[i][1], it);

    // Simulate the intended energy along the path as mechanisms are placed.
    let E = startE;
    let simIdx = 0;
    const deltas = new Map();    // path index -> E change happening at that index
    const advance = (to) => { for (let i = simIdx; i < to; i++) if (deltas.has(i)) E = deltas.get(i)(E); simIdx = Math.max(simIdx, to); };
    const addDelta = (i, fn) => { const old = deltas.get(i); deltas.set(i, old ? (x) => fn(old(x)) : fn); };
    let lastOp = 0;
    let consoleItem = null;

    for (const step of def.plan) {
      const kind = step[0];
      if (kind === 'op') {
        const i = freePath(step[1]); if (i < 0) return null;
        const delta = pick(step[2]);
        atPath(i, { type: 'op', delta, text: opText(delta) });
        addDelta(i, (x) => x + delta);
        cursor = i + 1; lastOp = i;
      } else if (kind === 'gate') {
        const g0 = Math.max(cursor + 2, Math.round(step[1] * (L - 1)));
        const b = takeBranch(Math.max(1, simIdx, cursor - 6), g0); if (!b) return null;
        const gi = freePath(Math.max(step[1], (b.attach + 1) / (L - 1))); if (gi < 0 || gi <= b.attach) return null;
        const mode = step[2];
        let r = randInt(2, 5) * (mode === 'le' ? -1 : mode === 'ge' ? 1 : pick([1, -1]));
        put(b.tip.c, b.tip.r, { type: 'op', delta: r, text: opText(r), key: 'req' });
        addDelta(b.attach, (x) => x + r);
        advance(gi);
        const v = E;
        let cond;
        if (mode === 'ge') cond = { text: `E ≥ ${sgn(v)}`, f: (x) => x >= v };
        else if (mode === 'le') cond = { text: `E ≤ ${sgn(v)}`, f: (x) => x <= v };
        else if (mode === 'eq') cond = { text: `E = ${sgn(v)}`, f: (x) => x === v };
        else { const lo = r > 0 ? v - 1 : v - 2, hi = r > 0 ? v + 2 : v + 1; cond = { text: `${sgn(lo)} < E < ${sgn(hi)}`, f: (x) => x > lo && x < hi }; }
        if (Math.abs(v) > E_LIMIT - 2) return null;
        atPath(gi, { type: 'gate', cond, open: false });
        cursor = gi + 1;
      } else if (kind === 'door') {
        const di = Math.max(cursor + 2, Math.round(step[1] * (L - 1)));
        const b = takeBranch(1, di); if (!b) return null;
        put(b.tip.c, b.tip.r, { type: 'key' });
        const i = freePath(di / (L - 1)); if (i < 0 || i <= b.attach) return null;
        atPath(i, { type: 'door', open: false });
        cursor = i + 1;
      } else if (kind === 'lift') {
        const a = freePath(step[1]); if (a < 0) return null;
        const bI = Math.round(step[2] * (L - 1));
        if (bI - a < 3 || bI >= L - 3) return null;
        for (let i = a + 1; i < bI; i++) { if (usedPath.has(i)) return null; chasm.add(i); }
        usedPath.add(bI);
        advance(a + 1);
        const v = E;
        let cond;
        if (v < 0) cond = { text: 'E < 0 (negative)', f: (x) => x < 0 };
        else if (v > 0 && v % 2 === 0) cond = { text: 'E is even and positive', f: (x) => x > 0 && x % 2 === 0 };
        else if (v > 0) cond = { text: 'E > 0 (positive)', f: (x) => x > 0 };
        else cond = { text: 'E = 0', f: (x) => x === 0 };
        atPath(a, { type: 'lift', cond, to: path[bI] });
        atPath(bI, { type: 'lift', cond, to: path[a] });
        cursor = bI + 1;
      } else if (kind === 'console') {
        const b = takeBranch(lastOp + 1, L - 2); if (!b) return null;
        advance(L);
        // Apply everything up to the console's branch, then choose a useful expression.
        let made = null;
        for (let k = 0; k < 30 && !made; k++) {
          const tpl = pick(CONSOLES[step[1]])();
          const T = tpl.f(E);
          if (T !== E && Math.abs(T) <= E_LIMIT - 2 && Number.isInteger(T)) made = Object.assign(tpl, { target: T });
        }
        if (!made) return null;
        consoleItem = put(b.tip.c, b.tip.r, { type: 'console', text: made.text, f: made.f, used: false, core: !!def.core });
        E = made.target;
      }
    }
    advance(L);
    const target = E;
    // Reject plans whose intended route would overload the suit.
    let sim = startE;
    for (let i = 0; i < L; i++) { if (deltas.has(i)) sim = deltas.get(i)(sim); if (Math.abs(sim) > E_LIMIT - 2) return null; }
    atPath(L - 1, { type: 'exit', target, open: false });
    // Checkpoints
    for (const fr of [0.33, 0.66]) { let i = Math.round(fr * (L - 1)); while (i < L - 1 && (usedPath.has(i) || chasm.has(i))) i++; if (i < L - 1) { usedPath.add(i); atPath(i, { type: 'checkpoint' }); } }
    // Pulse barriers on free path tiles
    for (let k = 0; k < def.pulses; k++) { let i = randInt(3, L - 4), tries = 0; while ((usedPath.has(i) || chasm.has(i)) && tries++ < 40) i = randInt(3, L - 4); if (!usedPath.has(i) && !chasm.has(i)) { usedPath.add(i); atPath(i, { type: 'pulse', phase: Math.random() * PULSE_PERIOD }); } }
    // Optional content in the remaining branches: secret room, decoys, chips, traps
    const spare = shuffle(branches.filter((b) => !b.used && !chasm.has(b.attach)));
    const secret = spare.find((b) => b.depth >= 2);
    let secretRoot = null;
    if (secret) {
      secret.used = true;
      secretRoot = secret.root;
      put(secret.tip.c, secret.tip.r, { type: 'chip', secret: true });
      const mid = secret.tiles.find((t) => t.d === 2);
      if (mid && (mid.c !== secret.tip.c || mid.r !== secret.tip.r)) put(mid.c, mid.r, { type: 'chip', secret: true });
    }
    const rest = spare.filter((b) => !b.used);
    let decoys = def.decoys, chips = def.chips, traps = def.traps;
    for (const b of rest) {
      if (decoys > 0) {
        const d = pick([-6, -5, -3, 4, 5, 7]);
        put(b.tip.c, b.tip.r, { type: 'op', delta: d, text: opText(d), key: 'decoy' });
        const mid = b.tiles.find((t) => t.d === 1 && (t.c !== b.tip.c || t.r !== b.tip.r));
        if (mid && traps > 0) { put(mid.c, mid.r, { type: 'trap' }); traps--; }
        decoys--;
      } else if (chips > 0) { put(b.tip.c, b.tip.r, { type: 'chip' }); chips--; }
    }
    // Top up data chips part-way along any longer side passage.
    for (const b of shuffle(branches)) {
      if (chips <= 0) break;
      if (chasm.has(b.attach) || b === secret || b.depth < 2) continue;
      const t = b.tiles.find((x) => x.d === 1);
      if (t && !items.has(K(t.c, t.r))) { put(t.c, t.r, { type: 'chip' }); chips--; }
    }
    const grid = g.map((row, r) => row.map((ch, c) => (ch === '#' ? 'wall' : 'floor')));
    for (const i of chasm) grid[path[i][1]][path[i][0]] = 'chasm';
    if (secretRoot) grid[secretRoot[1]][secretRoot[0]] = 'crack';
    return { grid, items, path, start: path[0], target, startE, cols: g[0].length, rows: g.length, consoleItem, chipTotal: [...items.values()].filter((i) => i.type === 'chip').length };
  }

  /* ---------------- DOM ---------------- */
  const canvas = document.getElementById('maze');
  const lineCanvas = document.getElementById('numline');
  const dom = {
    e: document.getElementById('eValue'), log: document.getElementById('log'), near: document.getElementById('nearInfo'),
    act: document.getElementById('activateBtn'), reboot: document.getElementById('rebootBtn'), inv: document.getElementById('inv'), alarm: document.getElementById('alarm')
  };
  const held = { up: false, down: false, left: false, right: false };
  let S = null;
  let view = { w: 0, h: 0, t: 30, ox: 0, oy: 0, ctx: null };

  /* ---------------- Level flow ---------------- */
  function loadLevel(i) {
    S.cfg = MG.roundConfig(DIFF, i);
    const def = LEVELS[i];
    S.lvIdx = i;
    S.L = generateLevel(def, def.start);
    S.pos = S.L.start.slice();
    S.draw = { x: S.pos[0], y: S.pos[1] };
    S.E = def.start;
    S.keys = 0;
    S.levelChips = 0;
    S.meltdown = false;
    S.furthest = 0;
    S.log = [];
    dom.alarm.hidden = true;
    snapshot();
    S.startSave = S.save; // a checkpoint can save a bad E, so the sector start is kept too
    S.lastReboot = -99;
    this_shell.setStage(`${i + 1}/${LEVELS.length}`);
    this_shell.setTimer(def.time * S.cfg.timeMul);
    this_shell.toast(`${def.name}: reach the exit seal with E = ${exitValue(S.L.target)}`, 'info', 3600);
    addLog(`Start: E = ${sgn(S.E)}`);
    resize();
    refresh();
  }

  /** Checkpoint snapshot of everything the player can change. */
  function snapshot() {
    S.save = {
      pos: S.pos.slice(), E: S.E, keys: S.keys,
      items: [...S.L.items.entries()].map(([k, it]) => [k, { used: it.used, open: it.open, taken: it.taken }]),
      grid: S.L.grid.map((r) => r.slice())
    };
  }
  function restore() {
    const sv = S.save;
    S.pos = sv.pos.slice(); S.draw = { x: S.pos[0], y: S.pos[1] };
    S.E = sv.E; S.keys = sv.keys;
    sv.items.forEach(([k, st]) => Object.assign(S.L.items.get(k), st));
    S.L.grid = sv.grid.map((r) => r.slice());
    addLog(`Restored checkpoint: E = ${sgn(S.E)}`);
    refresh();
  }

  function addLog(text) {
    S.log.unshift(text);
    S.log = S.log.slice(0, 8);
    dom.log.innerHTML = S.log.map((t) => `<li>${t}</li>`).join('');
  }

  function setE(next, how) {
    const before = S.E;
    S.E = next;
    addLog(`${sgn(before)} ${how} = <b>${sgn(next)}</b>`);
    dom.e.classList.remove('is-bump'); void dom.e.offsetWidth; dom.e.classList.add('is-bump');
    if (Math.abs(S.E) > E_LIMIT) { damage(`Overload! |E| = ${Math.abs(S.E)} is beyond ±${E_LIMIT}.`); return false; }
    return true;
  }

  function damage(why) {
    S.shields--; S.shieldsLost++;
    this_shell.setLives(S.shields, S.cfg.shields, '🛡');
    this_shell.flash('bad');
    MG.sound.play('hit');
    if (S.shields <= 0) { finish(false, 'Shields depleted', `${why} Your suit shut down in ${LEVELS[S.lvIdx].name}.`); return; }
    this_shell.toast(`${why} −1 shield. Back to the last checkpoint.`, 'bad', 3000);
    restore();
  }

  /* ---------------- Movement ---------------- */
  const itemAt = (c, r) => S.L.items.get(K(c, r));
  function tryMove(dx, dy) {
    if (!this_shell.isPlaying()) return;
    const c = S.pos[0] + dx, r = S.pos[1] + dy;
    const tile = S.L.grid[r] && S.L.grid[r][c];
    if (!tile || tile === 'wall') { return; }
    if (tile === 'chasm') { this_shell.toast('A chasm! Use a lift pad to cross.', 'warn', 1400); MG.sound.play('error'); return; }
    if (tile === 'crack') {
      S.L.grid[r][c] = 'floor';
      S.secrets++;
      this_shell.addScore(100, 'Secret room!', toScreen(c, r));
      this_shell.toast('🧱 The cracked wall crumbles — a secret room!', 'good');
      MG.sound.play('success');
    }
    const it = itemAt(c, r);
    if (it) {
      if (it.type === 'gate' && !it.open) { this_shell.toast(`Gate locked: needs ${it.cond.text}. Stand next to it and Activate.`, 'warn', 1800); MG.sound.play('error'); return; }
      if (it.type === 'exit' && !it.open) { this_shell.toast(`Exit seal: activate it with E = ${exitValue(it.target)}${S.L.consoleItem && !S.L.consoleItem.used ? ' after programming the energy console' : ''}.`, 'warn', 2200); MG.sound.play('error'); return; }
      if (it.type === 'door' && !it.open) {
        if (S.keys > 0) { S.keys--; it.open = true; this_shell.addScore(30, 'Door unlocked', toScreen(c, r)); MG.sound.play('select'); }
        else { this_shell.toast('Locked door — find the key ⚿ in a side passage.', 'warn', 1800); MG.sound.play('error'); return; }
      }
    }
    S.pos = [c, r];
    MG.sound.play('click');
    const pi = S.L.path.findIndex(([pc, pr]) => pc === c && pr === r);
    if (pi > S.furthest) S.furthest = pi;
    enterTile(c, r);
    refresh();
  }

  function enterTile(c, r) {
    const it = itemAt(c, r);
    if (!it) return;
    if (it.type === 'op' && !it.taken) {
      it.taken = true;
      MG.sound.play('pop');
      setE(S.E + it.delta, it.text);
    } else if (it.type === 'chip' && !it.taken) {
      it.taken = true; S.chips++; S.levelChips++;
      this_shell.addScore(20, 'Data chip', toScreen(c, r)); MG.sound.play('coin');
    } else if (it.type === 'key' && !it.taken) {
      it.taken = true; S.keys++;
      this_shell.toast('⚿ Key collected!', 'good', 1400); MG.sound.play('coin');
    } else if (it.type === 'trap') {
      MG.sound.play('error');
      setE(S.E - 2, '−2 (drain trap)');
    } else if (it.type === 'checkpoint' && !it.used) {
      it.used = true;
      snapshot();
      this_shell.toast('✔ Checkpoint saved', 'good', 1400); MG.sound.play('select');
    } else if (it.type === 'pulse') {
      if (pulseOn(it)) damage('Zapped by a pulse barrier!');
    } else if (it.type === 'exit' && it.open) levelComplete();
  }
  const pulseOn = (it) => ((S.clock + it.phase) % PULSE_PERIOD) < PULSE_ON;

  /* ---------------- Mechanisms ---------------- */
  function nearbyMechanism() {
    const [c, r] = S.pos;
    const here = itemAt(c, r);
    if (here && (here.type === 'lift' || (here.type === 'console' && !here.used))) return here;
    for (const [dx, dy] of DIRS) {
      const it = itemAt(c + dx, r + dy);
      if (!it) continue;
      if ((it.type === 'gate' || it.type === 'exit') && !it.open) return it;
      if (it.type === 'console' && !it.used) return it;
    }
    return null;
  }

  /** Activate Mechanism: tests the current E against the mechanism. */
  function activate() {
    if (!this_shell.isPlaying()) return;
    const m = nearbyMechanism();
    if (!m) { this_shell.toast('Nothing to activate here.', 'info', 1200); return; }
    S.activations++;
    if (m.type === 'console') {
      const key='integer:'+S.lvIdx+':'+m.c+','+m.r+':'+S.E;
      const before=S.E;
      if (!this_shell.maths.gate({key,topic:'Signed integers and order of operations',title:'Program the energy console',
        prompt:'Current energy is <strong>'+sgn(before)+'</strong>. Evaluate <strong>'+m.text+'</strong> before applying it.',
        fields:[{label:'New energy E',answer:m.f(before),tolerance:0}],hint:'Substitute the current E. Work through brackets, powers, multiplication and addition in that order.',
        container:dom.act.parentElement,valid:()=>nearbyMechanism()===m&&S.E===before&&!m.used,onPass:activate}))return;
      m.used = true;
      this_shell.addScore(30, 'Console', toScreen(m.c, m.r));
      MG.sound.play('select');
      const v = m.f(S.E);
      const ok = setE(v, `→ ${m.text.replace(/E/g, par(S.E))}`);
      if (ok && m.core) startMeltdown();
      refresh();
      return;
    }
    const pass = m.type === 'exit' ? S.E === m.target && (!S.L.consoleItem || S.L.consoleItem.used) : m.cond.f(S.E);
    if (!pass) return failActivation(m);
    if (m.type === 'gate') { m.open = true; this_shell.addScore(50, 'Gate open', toScreen(m.c, m.r)); }
    if (m.type === 'exit') { m.open = true; this_shell.addScore(50, 'Seal open', toScreen(m.c, m.r)); this_shell.toast('🌀 Exit seal open — step into the portal!', 'good'); }
    if (m.type === 'lift') {
      S.pos = m.to.slice(); S.draw = { x: S.pos[0], y: S.pos[1] };
      if (!m.usedOnce) { m.usedOnce = true; this_shell.addScore(40, 'Lift', toScreen(S.pos[0], S.pos[1])); }
      const pi = S.L.path.findIndex(([pc, pr]) => pc === S.pos[0] && pr === S.pos[1]);
      if (pi > S.furthest) S.furthest = pi;
      MG.sound.play('whoosh');
    }
    S.goodActivations++;
    MG.sound.play('success');
    refresh();
  }

  function failActivation(m) {
    S.failed++;
    this_shell.addScore(-25, 'Short circuit', toScreen(m.c, m.r));
    const need = m.type === 'exit' ? `E = ${exitValue(m.target)}${S.L.consoleItem && S.L.consoleItem.core && !S.L.consoleItem.used ? ' and the core console used' : ''}` : m.cond.text;
    MG.sound.play('error');
    if (S.cfg.failCostsShield) {
      S.shields--; S.shieldsLost++;
      this_shell.setLives(S.shields, S.cfg.shields, '🛡');
      this_shell.flash('bad');
      if (S.shields <= 0) return finish(false, 'Shields depleted', 'A short circuit drained your last shield.');
      this_shell.toast(`⚡ Short circuit! Needs ${need}, but E = ${sgn(S.E)}. −1 shield`, 'bad', 3000);
    } else this_shell.toast(`⚡ Short circuit! Needs ${need}, but E = ${sgn(S.E)}.`, 'bad', 3000);
  }

  function startMeltdown() {
    S.meltdown = true;
    dom.alarm.hidden = false;
    const t = Math.min(this_shell.timeLeft, S.cfg.meltdown);
    this_shell.setTimer(t);
    MG.sound.play('alarm');
    this_shell.toast(`☢ Core overloaded! ${Math.round(t)} seconds to reach the exit!`, 'bad', 3600);
    snapshot(); // a safe restart point for the escape
  }

  /** Reboot to the last checkpoint; a second reboot straight after restarts the sector. */
  function reboot() {
    if (!this_shell.isPlaying()) return;
    S.reboots++;
    this_shell.addScore(-30, 'Reboot');
    MG.sound.play('whoosh');
    if (S.clock - S.lastReboot < 5 && S.save !== S.startSave) {
      S.save = S.startSave;
      S.L.items.forEach((it) => { if (it.type === 'checkpoint') it.used = false; });
      restore();
      S.save = S.startSave;
      this_shell.toast('↺ Sector restarted from the beginning.', 'info', 2400);
      S.lastReboot = -99;
      return;
    }
    restore();
    S.lastReboot = S.clock;
    if (S.save !== S.startSave) this_shell.toast('Back at the checkpoint. Press Reboot again within 5 s to restart the whole sector.', 'info', 3200);
  }

  function levelComplete() {
    const bonus = 200 + Math.round(this_shell.timeLeft) + S.shields * 10;
    this_shell.addScore(bonus, 'Sector clear!');
    S.levelsDone++;
    MG.sound.play('stage');
    this_shell.flash('good');
    dom.alarm.hidden = true;
    if (S.lvIdx + 1 >= LEVELS.length) return finish(true, 'You escaped the vault!', 'All 10 sectors cleared and the core escape completed.');
    S.chipTotalAll += S.L.chipTotal; // chips available in finished sectors
    loadLevel(S.lvIdx + 1);
  }

  /* ---------------- Panels ---------------- */
  function refresh() {
    if (!S || !S.L) return;
    dom.e.textContent = `E = ${sgn(S.E)}`;
    dom.e.classList.toggle('is-neg', S.E < 0);
    const m = nearbyMechanism();
    if (!m) dom.near.innerHTML = 'Move next to a gate ▣, console ⌨, lift ⇅ or the exit 🌀.';
    else {
      let html = '';
      if (m.type === 'gate') html = `Gate opens if <b>${m.cond.text}</b>`;
      if (m.type === 'lift') html = `Lift works if <b>${m.cond.text}</b>`;
      if (m.type === 'exit') html = `Exit seal opens at <b>E = ${exitValue(m.target)}</b>${S.L.consoleItem ? (S.L.consoleItem.used ? ' (console verified ✔)' : ' — first program the energy console') : ''}`;
      if (m.type === 'console') html = `${m.core ? '☢ CORE console' : 'Console'}: E becomes <b>${m.text}</b>`;
      if (S.cfg.preview && m.type !== 'console' && (m.type !== 'exit' || exitKnown())) {
        if (m.type === 'console') html += `<br>Preview: ${m.text.replace(/E/g, par(S.E))} = <b>${sgn(m.f(S.E))}</b>`;
        else {
          const ok = m.type === 'exit' ? S.E === m.target : m.cond.f(S.E);
          html += `<br>With E = ${sgn(S.E)}: <span class="${ok ? 'ok' : 'bad'}">${ok ? '✔ will work' : '✘ will short-circuit'}</span>`;
        }
      }
      dom.near.innerHTML = html;
    }
    dom.act.disabled = !m;
    dom.inv.innerHTML = `⚿ Keys: ${S.keys}<br>◆ Data chips: ${S.levelChips} / ${S.L.chipTotal} (total ${S.chips})<br>🎯 Exit target: E = ${exitValue(S.L.target)}`;
    this_shell.setProgress(S.furthest / (S.L.path.length - 1), `Path explored`);
    drawLine();
  }

  function drawLine() {
    const f = MG.fitCanvas(lineCanvas), ctx = f.ctx;
    ctx.clearRect(0, 0, f.w, f.h);
    const x = (v) => 10 + ((v + E_LIMIT) / (2 * E_LIMIT)) * (f.w - 20);
    const y = 30;
    ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x(-E_LIMIT), y); ctx.lineTo(x(E_LIMIT), y); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.font = '600 10px Oxanium, monospace'; ctx.textAlign = 'center';
    for (let v = -E_LIMIT; v <= E_LIMIT; v++) {
      const big = v % 5 === 0;
      ctx.fillRect(x(v) - 0.5, y - (big ? 6 : 3), 1, big ? 12 : 6);
      if (big) ctx.fillText(sgn(v), x(v), y + 18);
    }
    if (S.L && exitKnown()) { ctx.fillStyle = '#7dffb0'; ctx.beginPath(); ctx.moveTo(x(S.L.target), y - 8); ctx.lineTo(x(S.L.target) - 4, y - 14); ctx.lineTo(x(S.L.target) + 4, y - 14); ctx.fill(); }
    const e = clamp(S.E, -E_LIMIT, E_LIMIT);
    ctx.shadowColor = S.E < 0 ? '#ff2fd6' : '#00f0ff'; ctx.shadowBlur = 12;
    ctx.fillStyle = S.E < 0 ? '#ff2fd6' : '#00f0ff';
    ctx.beginPath(); ctx.arc(x(e), y, 6, 0, 7); ctx.fill();
    ctx.shadowBlur = 0;
  }

  /* ---------------- Rendering ---------------- */
  function resize() {
    if (!S || !S.L) return;
    const f = MG.fitCanvas(canvas);
    const t = Math.floor(Math.min(f.w / S.L.cols, f.h / S.L.rows));
    view = { w: f.w, h: f.h, t, ox: Math.floor((f.w - t * S.L.cols) / 2), oy: Math.floor((f.h - t * S.L.rows) / 2), ctx: f.ctx };
  }
  const tx = (c) => view.ox + c * view.t, ty = (r) => view.oy + r * view.t;
  function toScreen(c, r) { const b = canvas.getBoundingClientRect(); return { x: b.left + tx(c) + view.t / 2, y: b.top + ty(r) }; }

  function draw(dt) {
    const { ctx, t } = view;
    if (!ctx) return;
    ctx.fillStyle = '#0b0420'; ctx.fillRect(0, 0, view.w, view.h);
    const G = S.L.grid;
    for (let r = 0; r < S.L.rows; r++) for (let c = 0; c < S.L.cols; c++) {
      const k = G[r][c], x = tx(c), y = ty(r);
      if (k === 'wall' || k === 'crack') {
        ctx.fillStyle = '#3b1683'; ctx.fillRect(x, y, t, t);
        ctx.fillStyle = '#5a25b8'; ctx.fillRect(x, y, t, Math.max(2, t * 0.12));
        ctx.strokeStyle = 'rgba(255,47,214,.85)'; ctx.lineWidth = 1.5; ctx.strokeRect(x + 1, y + 1, t - 2, t - 2);
        if (k === 'crack') { ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.beginPath(); ctx.moveTo(x + t * 0.3, y + 3); ctx.lineTo(x + t * 0.5, y + t * 0.45); ctx.lineTo(x + t * 0.35, y + t * 0.7); ctx.lineTo(x + t * 0.6, y + t - 3); ctx.stroke(); }
      } else if (k === 'chasm') {
        ctx.fillStyle = '#000'; ctx.fillRect(x, y, t, t);
        ctx.fillStyle = 'rgba(160,120,255,.6)'; for (let i = 0; i < 3; i++) ctx.fillRect(x + ((c * 7 + i * 13) % t), y + ((r * 11 + i * 17) % t), 1.5, 1.5);
      } else { ctx.fillStyle = '#07021a'; ctx.fillRect(x, y, t, t); ctx.fillStyle = 'rgba(0,240,255,.18)'; ctx.fillRect(x + t / 2 - 1, y + t / 2 - 1, 2, 2); }
    }
    const fs = Math.max(8, Math.floor(t * 0.3));
    for (const it of S.L.items.values()) {
      const x = tx(it.c), y = ty(it.r), cx = x + t / 2, cy = y + t / 2;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const glow = (col) => { ctx.shadowColor = col; ctx.shadowBlur = 10; ctx.fillStyle = col; };
      if (it.type === 'op' && !it.taken) { glow(it.delta >= 0 ? '#00f0ff' : '#ff2fd6'); ctx.beginPath(); ctx.arc(cx, cy, t * 0.34, 0, 7); ctx.globalAlpha = 0.25; ctx.fill(); ctx.globalAlpha = 1; ctx.font = `bold ${fs}px Oxanium, monospace`; ctx.fillText(it.text, cx, cy); }
      else if (it.type === 'chip' && !it.taken) { glow('#ffd84d'); ctx.font = `${Math.floor(t * 0.5)}px sans-serif`; ctx.fillText('◆', cx, cy); }
      else if (it.type === 'key' && !it.taken) { glow('#7dffb0'); ctx.font = `bold ${Math.floor(t * 0.55)}px sans-serif`; ctx.fillText('⚿', cx, cy); }
      else if (it.type === 'door' && !it.open) { glow('#7dffb0'); ctx.fillRect(x + 3, y + 3, t - 6, t - 6); ctx.shadowBlur = 0; ctx.fillStyle = '#062'; ctx.font = `bold ${Math.floor(t * 0.5)}px sans-serif`; ctx.fillText('⚿', cx, cy); }
      else if (it.type === 'gate' && !it.open) { glow('#ff9b3d'); ctx.fillRect(x + 2, y + 2, t - 4, t - 4); ctx.shadowBlur = 0; ctx.fillStyle = '#1a0a00'; ctx.font = `bold ${Math.max(7, Math.floor(t * 0.22))}px Oxanium, monospace`; ctx.fillText(it.cond.text, cx, cy); }
      else if (it.type === 'console') { glow(it.used ? '#555' : it.core ? '#ff2a4a' : '#b18cff'); ctx.fillRect(x + 4, y + 4, t - 8, t - 8); ctx.shadowBlur = 0; ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.max(7, Math.floor(t * 0.2))}px Oxanium, monospace`; ctx.fillText(it.used ? 'USED' : it.text, cx, cy); }
      else if (it.type === 'lift') { glow('#4dffea'); ctx.strokeStyle = '#4dffea'; ctx.lineWidth = 2; ctx.strokeRect(x + 4, y + 4, t - 8, t - 8); ctx.font = `bold ${Math.floor(t * 0.4)}px sans-serif`; ctx.fillText('⇅', cx, cy); }
      else if (it.type === 'trap') { glow('#ff3d6e'); ctx.font = `bold ${fs}px Oxanium, monospace`; ctx.globalAlpha = 0.8; ctx.fillText('−2', cx, cy); ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(255,61,110,.6)'; ctx.strokeRect(x + 3, y + 3, t - 6, t - 6); }
      else if (it.type === 'checkpoint') { glow(it.used ? '#7dffb0' : '#8899cc'); ctx.font = `${Math.floor(t * 0.45)}px sans-serif`; ctx.fillText('⚑', cx, cy); }
      else if (it.type === 'pulse') { const on = pulseOn(it); glow(on ? '#ff2a4a' : '#552233'); ctx.globalAlpha = on ? 0.8 : 0.3; ctx.fillRect(x + 2, y + t * 0.42, t - 4, t * 0.16); ctx.fillRect(x + t * 0.42, y + 2, t * 0.16, t - 4); ctx.globalAlpha = 1; }
      else if (it.type === 'exit') { const pul = 0.5 + Math.sin(S.clock * 4) * 0.5; glow(it.open ? '#7dffb0' : '#00f0ff'); ctx.lineWidth = 3; ctx.strokeStyle = ctx.fillStyle; ctx.beginPath(); ctx.arc(cx, cy, t * (0.3 + pul * 0.08), 0, 7); ctx.stroke(); ctx.shadowBlur = 0; ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.max(7, Math.floor(t * 0.24))}px Oxanium, monospace`; ctx.fillText(`E=${exitValue(it.target)}`, cx, cy); }
      ctx.shadowBlur = 0;
    }
    // Player (smoothly tweened)
    const k = Math.min(1, dt * 18);
    S.draw.x += (S.pos[0] - S.draw.x) * k; S.draw.y += (S.pos[1] - S.draw.y) * k;
    const px = tx(S.draw.x) + t / 2, py = ty(S.draw.y) + t / 2;
    ctx.shadowColor = S.E < 0 ? '#ff2fd6' : '#00f0ff'; ctx.shadowBlur = 18;
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(px, py, t * 0.36, 0, 7); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = '#0d1030'; ctx.font = `bold ${Math.max(8, Math.floor(t * 0.32))}px Oxanium, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(sgn(S.E), px, py + 1);
    if (S.meltdown) { ctx.fillStyle = `rgba(255,0,40,${0.08 + Math.sin(S.clock * 8) * 0.06})`; ctx.fillRect(0, 0, view.w, view.h); }
  }

  /* ---------------- End ---------------- */
  function finish(won, title, reason) {
    dom.alarm.hidden = true;
    const chipTotal = S.chipTotalAll + (S.L ? S.L.chipTotal : 0);
    const chipPct = chipTotal ? Math.round((S.chips / chipTotal) * 100) : 0;
    let stars;
    if (won) stars = S.shieldsLost === 0 && S.failed <= 1 && chipPct >= 60 ? 3 : S.shieldsLost <= 2 ? 2 : 1;
    else stars = S.levelsDone >= 2 ? 2 : S.levelsDone >= 1 ? 1 : 0;
    this_shell.end({
      won, title, reason, stars,
      stats: [
        ['Sectors cleared', `${S.levelsDone} / ${LEVELS.length}`],
        ['Final energy E', sgn(S.E)],
        ['Shields left', `${Math.max(0, S.shields)} / ${S.cfg.shields}`],
        ['Shields lost', S.shieldsLost],
        ['Successful activations', S.goodActivations],
        ['Short circuits', S.failed],
        ['Data chips', `${S.chips} (${chipPct}% of those seen)`],
        ['Secret rooms', S.secrets],
        ['Reboots', S.reboots],
        ['Time left', MG.fmtTime(this_shell.timeLeft)]
      ],
      math: [
        'Adding a negative is the same as subtracting: 3 + (−5) = −2. Subtracting a negative is the same as adding: 3 − (−5) = 8.',
        'Multiplying by a negative flips the sign on the number line: (−4) × (−2) = 8 but 4 × (−2) = −8.',
        'Order of operations: brackets first, then multiplication, then addition/subtraction. (E − 3) × (−2) with E = 1 gives (−2) × (−2) = 4, while E − 3 × (−2) gives 1 + 6 = 7.',
        'Inequalities on the number line: −2 < E < 3 means E can be −1, 0, 1 or 2.',
        `You completed ${S.goodActivations} activation(s) with ${S.failed} short circuit(s).`
      ]
    });
  }

  /* ---------------- Shell ---------------- */
  const this_shell = MG.createShell({
    id: 'integer-maze',
    title: 'Integer Maze',
    tagline: 'You’re trapped in the Number Vault. Your energy E opens every door, if it’s exactly right.',
    goal: 'Reach each exit with exactly the right energy E. Escape all 10 sectors!',
    steps: [
      ['🕹️', 'Move around the maze. Orbs change E: +(−5), −(−3)…'],
      ['🚪', 'Gates and lifts only work for the right E.'],
      ['🌀', 'Reach the exit with E on target to escape!']
    ],
    keys: [
      ['<kbd>←</kbd><kbd>↑</kbd><kbd>→</kbd><kbd>↓</kbd>', 'Move'],
      ['<kbd>Space</kbd>', 'Activate'],
      ['<kbd>R</kbd>', 'Reboot (twice = restart sector)'],
      ['<kbd>P</kbd>', 'Pause']
    ],
    genre: 'Maze & escape room',
    topic: 'Integers, number line, order of operations',
    premise: 'You are trapped in the Number Vault. Your suit carries an energy value E — and every door, lift and console in the vault reads it.',
    objective: 'Navigate 10 generated maze sectors. Collect the right energy orbs, open gates, ride lifts and reach the exit seal with exactly the right value of E. Escape the final core meltdown!',
    livesLabel: 'Shields',
    stageLabel: 'Round',
    art: `<svg viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="im-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b0420"/><stop offset=".6" stop-color="#4a0e6e"/><stop offset=".6" stop-color="#0b0420"/></linearGradient><linearGradient id="im-sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd36b"/><stop offset=".55" stop-color="#ff8a3d"/><stop offset="1" stop-color="#ff2fd6"/></linearGradient><filter id="im-glow"><feGaussianBlur stdDeviation="2.5"/></filter></defs><rect width="400" height="500" fill="url(#im-sky)"/><circle cx="0" cy="0" r="1.8" fill="#fff" opacity=".7"/><circle cx="89" cy="37" r="1" fill="#fff" opacity=".7"/><circle cx="178" cy="74" r="1" fill="#fff" opacity=".7"/><circle cx="267" cy="111" r="1" fill="#fff" opacity=".7"/><circle cx="356" cy="148" r="1.8" fill="#fff" opacity=".7"/><circle cx="45" cy="5" r="1" fill="#fff" opacity=".7"/><circle cx="134" cy="42" r="1" fill="#fff" opacity=".7"/><circle cx="223" cy="79" r="1" fill="#fff" opacity=".7"/><circle cx="312" cy="116" r="1.8" fill="#fff" opacity=".7"/><circle cx="1" cy="153" r="1" fill="#fff" opacity=".7"/><circle cx="90" cy="10" r="1" fill="#fff" opacity=".7"/><circle cx="179" cy="47" r="1" fill="#fff" opacity=".7"/><circle cx="268" cy="84" r="1.8" fill="#fff" opacity=".7"/><circle cx="357" cy="121" r="1" fill="#fff" opacity=".7"/><circle cx="46" cy="158" r="1" fill="#fff" opacity=".7"/><circle cx="135" cy="15" r="1" fill="#fff" opacity=".7"/><circle cx="224" cy="52" r="1.8" fill="#fff" opacity=".7"/><circle cx="313" cy="89" r="1" fill="#fff" opacity=".7"/><circle cx="2" cy="126" r="1" fill="#fff" opacity=".7"/><circle cx="91" cy="163" r="1" fill="#fff" opacity=".7"/><circle cx="180" cy="20" r="1.8" fill="#fff" opacity=".7"/><circle cx="269" cy="57" r="1" fill="#fff" opacity=".7"/><circle cx="358" cy="94" r="1" fill="#fff" opacity=".7"/><circle cx="47" cy="131" r="1" fill="#fff" opacity=".7"/><circle cx="136" cy="168" r="1.8" fill="#fff" opacity=".7"/><circle cx="225" cy="25" r="1" fill="#fff" opacity=".7"/><circle cx="314" cy="62" r="1" fill="#fff" opacity=".7"/><circle cx="3" cy="99" r="1" fill="#fff" opacity=".7"/><circle cx="92" cy="136" r="1.8" fill="#fff" opacity=".7"/><circle cx="181" cy="173" r="1" fill="#fff" opacity=".7"/><circle cx="200" cy="230" r="108" fill="url(#im-sun)"/><rect x="80" y="226" width="240" height="2" fill="#0b0420"/><rect x="80" y="240" width="240" height="3.6" fill="#0b0420"/><rect x="80" y="254" width="240" height="5.2" fill="#0b0420"/><rect x="80" y="268" width="240" height="6.800000000000001" fill="#0b0420"/><rect x="80" y="282" width="240" height="8.4" fill="#0b0420"/><rect x="80" y="296" width="240" height="10" fill="#0b0420"/><rect y="298" width="400" height="202" fill="#0b0420"/><path d="M0 302.6H400" stroke="#ff2fd6" stroke-opacity="0.32" stroke-width="2"/><path d="M0 310.4H400" stroke="#ff2fd6" stroke-opacity="0.39" stroke-width="2"/><path d="M0 323.4H400" stroke="#ff2fd6" stroke-opacity="0.46" stroke-width="2"/><path d="M0 341.6H400" stroke="#ff2fd6" stroke-opacity="0.53" stroke-width="2"/><path d="M0 365.0H400" stroke="#ff2fd6" stroke-opacity="0.60" stroke-width="2"/><path d="M0 393.6H400" stroke="#ff2fd6" stroke-opacity="0.67" stroke-width="2"/><path d="M0 427.4H400" stroke="#ff2fd6" stroke-opacity="0.74" stroke-width="2"/><path d="M0 466.4H400" stroke="#ff2fd6" stroke-opacity="0.81" stroke-width="2"/><path d="M0 510.6H400" stroke="#ff2fd6" stroke-opacity="0.88" stroke-width="2"/><path d="M200 300L-500 520" stroke="#00f0ff" stroke-opacity=".5" stroke-width="1.5"/><path d="M200 300L-430 520" stroke="#00f0ff" stroke-opacity=".5" stroke-width="1.5"/><path d="M200 300L-360 520" stroke="#00f0ff" stroke-opacity=".5" stroke-width="1.5"/><path d="M200 300L-290 520" stroke="#00f0ff" stroke-opacity=".5" stroke-width="1.5"/><path d="M200 300L-220 520" stroke="#00f0ff" stroke-opacity=".5" stroke-width="1.5"/><path d="M200 300L-150 520" stroke="#00f0ff" stroke-opacity=".5" stroke-width="1.5"/><path d="M200 300L-80 520" stroke="#00f0ff" stroke-opacity=".5" stroke-width="1.5"/><path d="M200 300L-10 520" stroke="#00f0ff" stroke-opacity=".5" stroke-width="1.5"/><path d="M200 300L60 520" stroke="#00f0ff" stroke-opacity=".5" stroke-width="1.5"/><path d="M200 300L130 520" stroke="#00f0ff" stroke-opacity=".5" stroke-width="1.5"/><path d="M200 300L200 520" stroke="#00f0ff" stroke-opacity=".5" stroke-width="1.5"/><path d="M200 300L270 520" stroke="#00f0ff" stroke-opacity=".5" stroke-width="1.5"/><path d="M200 300L340 520" stroke="#00f0ff" stroke-opacity=".5" stroke-width="1.5"/><path d="M200 300L410 520" stroke="#00f0ff" stroke-opacity=".5" stroke-width="1.5"/><path d="M200 300L480 520" stroke="#00f0ff" stroke-opacity=".5" stroke-width="1.5"/><path d="M200 300L550 520" stroke="#00f0ff" stroke-opacity=".5" stroke-width="1.5"/><path d="M200 300L620 520" stroke="#00f0ff" stroke-opacity=".5" stroke-width="1.5"/><path d="M200 300L690 520" stroke="#00f0ff" stroke-opacity=".5" stroke-width="1.5"/><path d="M200 300L760 520" stroke="#00f0ff" stroke-opacity=".5" stroke-width="1.5"/><path d="M200 300L830 520" stroke="#00f0ff" stroke-opacity=".5" stroke-width="1.5"/><path d="M200 300L900 520" stroke="#00f0ff" stroke-opacity=".5" stroke-width="1.5"/><path d="M40 418H360" stroke="#00f0ff" stroke-width="4" filter="url(#im-glow)"/><path d="M40 418H360" stroke="#fff" stroke-width="2"/><path d="M50 406v24" stroke="#fff" stroke-width="2"/><text x="50" y="450" text-anchor="middle" font-family="Oxanium, monospace" font-weight="700" font-size="16" fill="#fff">−5</text><path d="M80 412v12" stroke="#fff" stroke-width="2"/><path d="M110 412v12" stroke="#fff" stroke-width="2"/><path d="M140 412v12" stroke="#fff" stroke-width="2"/><path d="M170 412v12" stroke="#fff" stroke-width="2"/><path d="M200 406v24" stroke="#fff" stroke-width="2"/><text x="200" y="450" text-anchor="middle" font-family="Oxanium, monospace" font-weight="700" font-size="16" fill="#fff">0</text><path d="M230 412v12" stroke="#fff" stroke-width="2"/><path d="M260 412v12" stroke="#fff" stroke-width="2"/><path d="M290 412v12" stroke="#fff" stroke-width="2"/><path d="M320 412v12" stroke="#fff" stroke-width="2"/><path d="M350 406v24" stroke="#fff" stroke-width="2"/><text x="350" y="450" text-anchor="middle" font-family="Oxanium, monospace" font-weight="700" font-size="16" fill="#fff">5</text><circle cx="110" cy="418" r="13" fill="#ff2fd6" filter="url(#im-glow)"/><circle cx="110" cy="418" r="9" fill="#fff"/><g transform="translate(84 96)"><circle r="30" fill="#ff2fd6" fill-opacity=".18" stroke="#ff2fd6" stroke-width="3" filter="url(#im-glow)"/><text y="7" text-anchor="middle" font-family="Oxanium, monospace" font-weight="700" font-size="19" fill="#fff">+(−5)</text></g><g transform="translate(316 120)"><circle r="30" fill="#00f0ff" fill-opacity=".18" stroke="#00f0ff" stroke-width="3" filter="url(#im-glow)"/><text y="7" text-anchor="middle" font-family="Oxanium, monospace" font-weight="700" font-size="19" fill="#fff">−(−3)</text></g><g transform="translate(200 476)"><rect x="-58" y="-18" width="116" height="30" rx="6" fill="#0b0420" stroke="#ff2fd6" stroke-width="2"/><text y="4" text-anchor="middle" font-family="Audiowide, sans-serif" font-size="17" fill="#fff">E = −3</text></g></svg>`,
    instructions: {
      objective: 'Clear 3 sectors. Each sector’s exit seal only opens when your energy E equals its target value.',
      controls: [
        'Move one tile at a time with <kbd>←</kbd> <kbd>↑</kbd> <kbd>→</kbd> <kbd>↓</kbd> or <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> (hold to keep moving). Touch screens show a D-pad.',
        '<strong>Activate Mechanism</strong> (<kbd>Space</kbd>, <kbd>E</kbd> or ⚡) next to a gate, console or exit, or while standing on a lift pad.',
        '<kbd>R</kbd> reboots to the last checkpoint (−30 pts) if you get stuck. <kbd>P</kbd>/<kbd>Esc</kbd> pause.'
      ],
      maths: [
        'Orbs change E when you step on them: +4, −3, +(−5) (add a negative) or −(−2) (subtract a negative). Each orb works once.',
        'Gates and lifts test E: equalities (E = −3), inequalities (E ≥ 4, −2 < E < 3) or properties (negative, even).',
        'Consoles replace E with an expression such as (E − 3) × (−2) — use the order of operations. Drain traps subtract 2 every time you step on them.',
        'Plan your route! Side passages hold the orbs you need — and decoy orbs that will spoil your total. If |E| ever exceeds 20 your suit overloads.',
        'Program every energy console by calculating its expression. The exit target is revealed only after the console is verified.'
      ],
      scoring: [
        'Data chip +20, door +30, console +30, lift +40, gate or exit seal +50, secret room +100.',
        'Sector clear: +200, +1 per second left, +10 per shield. Short circuit −25, reboot −30.'
      ],
      failure: [
        'You lose a shield for overloading (|E| > 20), touching an active pulse barrier, or when the mechanism penalises errors activating a mechanism with the wrong E. You then return to the last checkpoint.',
        'At 0 shields, or when a sector timer runs out, the run ends. In Sector 3, overloading the core starts a short escape countdown.'
      ],
      timer: [
        'Each sector has its own countdown. Pausing freezes the timer, the pulse barriers and the meltdown.'
      ]
    },
    stars: [
      '1 star: clear Sector 1 (or escape the vault).',
      '2 stars: escape with at most 2 shields lost (a failed run that cleared 2 sectors also earns 2).',
      '3 stars: escape with no shields lost, at most 1 short circuit and at least 60% of the data chips collected.'
    ],
    onStart(diff) {
      const cfg = DIFF[diff];
      S = { cfg, shields: cfg.shields, shieldsLost: 0, chips: 0, chipTotalAll: 0, secrets: 0, failed: 0, activations: 0, goodActivations: 0, reboots: 0, levelsDone: 0, clock: 0, moveT: 0 };
      Object.keys(held).forEach((k) => { held[k] = false; });
      this.setLives(S.shields, cfg.shields, '🛡');
      loadLevel(0);
    },
    onUpdate(dt) {
      S.clock += dt;
      // Held keys repeat movement
      S.moveT -= dt;
      if (S.moveT <= 0) {
        const d = held.up ? [0, -1] : held.down ? [0, 1] : held.left ? [-1, 0] : held.right ? [1, 0] : null;
        if (d) { tryMove(d[0], d[1]); S.moveT = MOVE_REPEAT; }
      }
      if (!this_shell.isPlaying()) return;
      // Standing on a pulse barrier when it switches on hurts
      const it = itemAt(S.pos[0], S.pos[1]);
      if (it && it.type === 'pulse' && pulseOn(it)) { damage('Zapped by a pulse barrier!'); if (!this_shell.isPlaying()) return; }
      draw(dt);
    },
    onTimeUp() { finish(false, S.meltdown ? 'Meltdown!' : 'Out of time', S.meltdown ? 'The core melted down before you reached the exit.' : `The timer ran out in ${LEVELS[S.lvIdx].name}.`); },
    onPause() { Object.keys(held).forEach((k) => { held[k] = false; }); },
    onStop() { dom.alarm.hidden = true; }
  });

  /* ---------------- Input (bound once) ---------------- */
  const KEYMAP = { arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right' };
  window.addEventListener('keydown', (e) => {
    if (!this_shell.isPlaying()) return;
    const k = e.key.toLowerCase();
    if (KEYMAP[k]) {
      e.preventDefault();
      if (!held[KEYMAP[k]]) { held[KEYMAP[k]] = true; S.moveT = 0; }
    } else if ((k === ' ' || k === 'e') && !MG.isTarget(e, 'button')) { e.preventDefault(); activate(); }
    else if (k === 'r') reboot();
  });
  window.addEventListener('keyup', (e) => { const k = e.key.toLowerCase(); if (KEYMAP[k]) held[KEYMAP[k]] = false; });
  document.querySelectorAll('#dpad [data-dir]').forEach((b) => {
    const dir = b.dataset.dir;
    if (dir === 'act') { b.addEventListener('click', activate); return; }
    MG.bindHold(b, held, dir);
    b.addEventListener('pointerdown', () => { if (S) S.moveT = 0; });
  });
  dom.act.addEventListener('click', activate);
  dom.reboot.addEventListener('click', reboot);
  window.addEventListener('resize', () => { resize(); if (S && S.L) drawLine(); });

  MG.game = { get state() { return S; }, tryMove, activate, generateLevel, LEVELS, nearbyMechanism };
})();
