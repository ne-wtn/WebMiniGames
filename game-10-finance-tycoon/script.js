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
   Finance Tycoon — percentages, profit and loss, discounts, simple
   interest, budgeting. Over 10 business days the player buys stock (with
   bulk discounts), sets prices and promotions, spends on marketing, uses
   loans/savings (simple interest) and buys upgrades. A demand model turns
   these decisions into sales. All money is stored in whole pence (integers)
   so totals never suffer from floating-point rounding.
   ========================================================================== */
(() => {
  'use strict';
  const { el, clamp, round, pick } = MG;

  /* ---------------- Configuration ---------------- */
  const DAYS = 10;
  const PRODUCTS = {
    lemonade: { name: 'Lemonade', icon: '🍋', cost: 40, ref: 150, base: 42, spoil: 0.3, unlock: 1, color: '#f4d03f' },
    cookie:   { name: 'Cookies',  icon: '🍪', cost: 60, ref: 200, base: 30, spoil: 0.1, unlock: 4, color: '#b9770e' },
    smoothie: { name: 'Smoothies', icon: '🥤', cost: 120, ref: 350, base: 24, spoil: 0.5, unlock: 7, color: '#e74c8b' }
  };
  const PHASES = [
    { from: 1, name: 'Street Stand', rent: 1000, wages: 0, capacity: 70 },
    { from: 4, name: 'Market Kiosk', rent: 2500, wages: 1500, capacity: 120 },
    { from: 7, name: 'High-Street Shop', rent: 4500, wages: 3000, capacity: 190 }
  ];
  const UPGRADES = [
    { id: 'fridge', name: '🧊 Fridge', cost: 12000, desc: 'Spoilage overnight falls to 5%' },
    { id: 'sign', name: '💡 Neon sign', cost: 8000, desc: '+15% customers' },
    { id: 'counter', name: '🪑 Bigger counter', cost: 15000, desc: '+50 customer capacity' },
    { id: 'card', name: '💳 Card reader', cost: 6000, desc: '+5% customers, +5 satisfaction' }
  ];
  const WEATHER = [
    { id: 'sunny', name: '☀ Sunny', mult: { lemonade: 1.3, cookie: 1, smoothie: 1.2 } },
    { id: 'cloudy', name: '☁ Cloudy', mult: { lemonade: 1, cookie: 1, smoothie: 1 } },
    { id: 'rain', name: '🌧 Rainy', mult: { lemonade: 0.6, cookie: 1.1, smoothie: 0.6 } },
    { id: 'heat', name: '🔥 Heatwave', mult: { lemonade: 1.7, cookie: 0.8, smoothie: 1.5 } }
  ];
  const EVENTS = [
    { id: 'festival', text: '🎪 Street festival: +40% customers', demand: 1.4 },
    { id: 'hike', text: '🚚 Supplier price rise: stock costs +25% today', costMul: 1.25 },
    { id: 'inspector', text: '🧑‍⚕️ Health inspection: £20 fine unless you own a fridge', fine: 2000 },
    { id: 'rival', text: '🏪 A rival opened nearby: −20% customers', demand: 0.8 },
    { id: 'influencer', text: '📱 An influencer posted about you: +30% customers', demand: 1.3 }
  ];
  const LOAN_STEP = 10000, LOAN_MAX = 40000, LOAN_RATE = 0.02;   // 2% simple interest per day
  const SAVE_STEP = 5000, SAVE_RATE = 0.01;                       // 1% simple interest per day
  const DIFF = {
    easy:   { cash: 25000, dayTime: 180, target: 55000, elasticity: 1.3 },
    normal: { cash: 20000, dayTime: 210, target: 70000, elasticity: 1.6 },
    hard:   { cash: 15000, dayTime: 240, target: 80000, elasticity: 1.9 }
  };

  /* ---------------- Money helpers ---------------- */
  const gbp = (p) => `${p < 0 ? '−' : ''}£${(Math.abs(Math.round(p)) / 100).toFixed(2)}`;
  const phaseOf = (day) => [...PHASES].reverse().find((p) => day >= p.from);
  /** Bulk discount rate for an order quantity. */
  const bulkRate = (q) => (q >= 100 ? 0.2 : q >= 50 ? 0.1 : 0);
  /** Cost of buying q units today, in pence: unit × q × (1 − bulk discount). */
  function orderCost(key, q) {
    const unit = Math.round(PRODUCTS[key].cost * (S.event && S.event.costMul ? S.event.costMul : 1));
    return { unit, gross: unit * q, rate: bulkRate(q), total: Math.round(unit * q * (1 - bulkRate(q))) };
  }

  /* ---------------- DOM ---------------- */
  const shopCanvas = document.getElementById('shop');
  const dom = {
    forecast: document.getElementById('forecast'), report: document.getElementById('report'), stock: document.getElementById('stock'),
    prices: document.getElementById('prices'), discount: document.getElementById('discount'), marketing: document.getElementById('marketing'),
    mktOut: document.getElementById('mktOut'), bank: document.getElementById('bank'), upgrades: document.getElementById('upgrades'),
    endDay: document.getElementById('endDayBtn'), kpis: document.getElementById('kpis'), cashChart: document.getElementById('chartCash'),
    plChart: document.getElementById('chartPL'), objectives: document.getElementById('objectives')
  };
  let S = null;

  /* ---------------- Day flow ---------------- */
  function startDay() {
    S.cfg = MG.roundConfig(DIFF, S.day - 1);
    S.phase = 'plan';
    S.quote={quantity:MG.randInt(3,9)*10,price:MG.randInt(15,35)*10,cost:MG.randInt(3,9)*10,discount:MG.pick([10,20,25]),principal:MG.randInt(1,4)*10000,days:MG.randInt(2,5)};
    S.dayVerified=false;
    S.weather = pick(S.day === 1 ? WEATHER.slice(0, 2) : WEATHER);
    S.event = S.day > 1 && Math.random() < 0.45 ? pick(EVENTS) : null;
    S.order = { lemonade: 0, cookie: 0, smoothie: 0 };
    const ph = phaseOf(S.day);
    if (S.day === ph.from && S.day > 1) this_shell.toast(`🎉 You expanded into a ${ph.name}! ${S.day === 4 ? 'Cookies' : 'Smoothies'} unlocked — but rent and wages rise.`, 'good', 4200);
    this_shell.setStage(`${S.day}/${DAYS} · ${ph.name}`);
    this_shell.setTimer(S.cfg.dayTime);
    dom.report.hidden = true;
    renderAll();
  }

  /** End Business Day: simulate customers and settle the accounts. */
  function endDay() {
    if (!this_shell.isPlaying() || S.phase !== 'plan') return;
    if(Object.values(S.stock).reduce((sum,n)=>sum+n,0)<10){this_shell.toast('Buy at least 10 items to trade before opening.','warn');return;}
    const q=S.quote,day=S.day,ph=phaseOf(day),sale=q.price*(1-q.discount/100),margin=q.price-q.cost;
    const bulk=q.quantity>=100?.2:q.quantity>=50?.1:0;
    const offers=[q.principal*.02*q.days,Math.round(q.principal*.055)];
    const tasks=[
      {prompt:'A customer asks for '+q.quantity+' items at '+gbp(q.price)+' each. Quote the sales total.',fields:[{label:'Sales total (£)',answer:q.quantity*q.price/100}],hint:'Multiply quantity by selling price.'},
      {prompt:'An item sells for '+gbp(q.price)+' and costs '+gbp(q.cost)+' to buy. Calculate gross profit per item.',fields:[{label:'Gross profit per item (£)',answer:margin/100}],hint:'Gross profit per item = selling price − supplier cost.'},
      {prompt:'Approve a '+q.discount+'% promotion on an item priced '+gbp(q.price)+'.',fields:[{label:'Discounted selling price (£; 2 decimals)',answer:sale/100}],hint:'Multiply the price by (1 − discount/100).'},
      {prompt:'The supplier quotes '+q.quantity+' items at '+gbp(q.cost)+' each, with '+bulk*100+'% bulk discount.',fields:[{label:'Discounted invoice (£)',answer:q.quantity*q.cost*(1-bulk)/100}],hint:'Quantity × unit price × (1 − bulk discount).'},
      {prompt:'A firm order is for '+q.quantity+' items. Selling price '+gbp(q.price)+', promotion '+q.discount+'%, unit supplier cost '+gbp(q.cost)+'. Calculate gross profit.',fields:[{label:'Order gross profit (£)',answer:q.quantity*(sale-q.cost)/100}],hint:'Find the discounted price, subtract unit cost, then multiply by quantity.'},
      {prompt:'Today’s fixed rent and wages total '+gbp(ph.rent+ph.wages)+'. Selling price is '+gbp(q.price)+' and unit cost '+gbp(q.cost)+'. How many sales cover those fixed costs?',fields:[{label:'Break-even units (round UP)',answer:Math.ceil((ph.rent+ph.wages)/margin),tolerance:0}],hint:'Divide fixed costs by profit per item, then round up to the next whole unit.'},
      {prompt:'The bank offers '+gbp(q.principal)+' at 2% simple interest per day for '+q.days+' days. Quote the interest before deciding.',fields:[{label:'Interest (£)',answer:q.principal*.02*q.days/100}],hint:'Simple interest = principal × daily rate × days.'},
      {prompt:'Compare two loans of '+gbp(q.principal)+': A charges 2% per day for '+q.days+' days; B charges a one-off 5.5%.',fields:[{label:'A: total borrowing charge (£)',answer:offers[0]/100},{label:'B: total borrowing charge (£)',answer:offers[1]/100},{label:'Cheaper offer',options:[{value:'A',label:'Offer A'},{value:'B',label:'Offer B'}],answer:offers[0]<offers[1]?'A':'B'}],hint:'Compare charges, not the original amount borrowed. Both are simple fees, not compound interest.'},
      {prompt:'A supplier invoice covers '+q.quantity+' items at '+gbp(q.cost)+' each. Apply '+bulk*100+'% bulk discount, then an additional '+q.discount+'% loyalty discount.',fields:[{label:'Final invoice (£; 2 decimals)',answer:q.quantity*q.cost*(1-bulk)*(1-q.discount/100)/100}],hint:'Successive discounts multiply: gross × (1 − first rate) × (1 − second rate).'},
      {prompt:'Close a firm-order forecast: '+q.quantity+' items at '+gbp(q.price)+', '+q.discount+'% off; supplier cost '+gbp(q.cost)+' per item; rent '+gbp(ph.rent)+', wages '+gbp(ph.wages)+'. Ignore other expenses for this quote.',fields:[{label:'Forecast net profit or loss (£)',answer:(q.quantity*(sale-q.cost)-ph.rent-ph.wages)/100}],hint:'Net profit = discounted revenue − stock cost − rent − wages. A loss is negative.'}
    ];
    const task=tasks[day-1];
    task.fields.forEach(field=>{if(typeof field.answer==='number'&&field.label.includes('?'))field.answer=MG.round(field.answer,2);});
    if(!this_shell.maths.gate({key:'finance-day:'+day,topic:day<4?'Money and percentages':day<7?'Profit and break-even':'Interest and financial comparisons',title:'Approve the day’s business quote',...task,
      container:dom.endDay.parentElement,valid:()=>S.day===day&&S.phase==='plan',onPass:endDay}))return;
    S.dayVerified=true;
    S.phase = 'sim';
    this_shell.stopTimer();
    const r = simulate();
    S.sim = { r, t: 0, dur: 4, shown: 0, walkers: [] };
    MG.sound.play('whoosh');
    renderAll();
  }

  function simulate() {
    const ph = phaseOf(S.day);
    const has = (id) => S.owned.has(id);
    const mkt = S.marketing;
    const mktMul = 1 + 0.4 * (1 - Math.exp(-mkt / 2000));     // diminishing returns on marketing
    const repMul = 0.7 + 0.6 * S.reputation;
    const signMul = (has('sign') ? 1.15 : 1) * (has('card') ? 1.05 : 1);
    const evMul = S.event && S.event.demand ? S.event.demand : 1;
    const disc = S.discount / 100;
    const capacity = ph.capacity + (has('counter') ? 50 : 0);
    const lines = [];
    let wanted = 0;
    for (const [key, P] of Object.entries(PRODUCTS)) {
      if (S.day < P.unlock) continue;
      const price = S.prices[key];
      const eff = Math.round(price * (1 - disc));
      // Price elasticity: demand falls as the sale price rises above the reference price.
      const demand = P.base * S.weather.mult[key] * evMul * mktMul * repMul * signMul * Math.pow(P.ref / Math.max(1, eff), S.cfg.elasticity);
      lines.push({ key, P, price, eff, demand });
      wanted += demand;
    }
    const capMul = wanted > capacity ? capacity / wanted : 1;
    let revenue = 0, cogs = 0, sold = 0, unmet = 0, demandTotal = 0;
    for (const L of lines) {
      L.demand = Math.round(L.demand * capMul);
      L.sold = Math.min(L.demand, S.stock[L.key]);
      L.unmet = L.demand - L.sold;
      L.revenue = L.sold * L.eff;
      L.cogs = Math.round(L.sold * S.avgCost[L.key]);
      revenue += L.revenue; cogs += L.cogs; sold += L.sold; unmet += L.unmet; demandTotal += L.demand;
    }
    // Expenses
    const interest = Math.round(S.loan * LOAN_RATE);
    const savingsInterest = Math.round(S.savings * SAVE_RATE);
    const fine = S.event && S.event.fine && !has('fridge') ? S.event.fine : 0;
    const expenses = ph.rent + ph.wages + mkt + interest + fine;
    // Overnight spoilage of the stock that is left
    const spoilRate = (k) => (has('fridge') ? 0.05 : PRODUCTS[k].spoil);
    let spoilCost = 0;
    const spoiled = {};
    for (const L of lines) {
      const left = S.stock[L.key] - L.sold;
      spoiled[L.key] = Math.floor(left * spoilRate(L.key));
      spoilCost += Math.round(spoiled[L.key] * S.avgCost[L.key]);
    }
    const profit = revenue + savingsInterest - cogs - spoilCost - expenses;
    // Satisfaction: fair prices, discounts and no sell-outs keep customers happy.
    const priceRatio = lines.length ? lines.reduce((a, L) => a + L.eff / L.P.ref, 0) / lines.length : 1;
    const stockout = demandTotal ? unmet / demandTotal : 0;
    const sat = clamp(Math.round(92 - Math.max(0, priceRatio - 1) * 70 + Math.max(0, 1 - priceRatio) * 25 - stockout * 60 + (has('card') ? 5 : 0) - (S.weather.id === 'rain' ? 3 : 0)), 0, 100);
    return { lines, revenue, cogs, sold, unmet, demandTotal, interest, savingsInterest, fine, expenses, rent: ph.rent, wages: ph.wages, marketing: mkt, spoilCost, spoiled, profit, sat, capacity, capped: capMul < 1 };
  }

  /** Apply a simulated day to the books. */
  function settle(r) {
    for (const L of r.lines) {
      S.stock[L.key] -= L.sold;
      S.stock[L.key] -= r.spoiled[L.key];
      if (S.stock[L.key] <= 0) { S.stock[L.key] = 0; S.avgCost[L.key] = 0; }
    }
    S.cash += r.revenue + r.savingsInterest - r.expenses;
    S.reputation = clamp(S.reputation * 0.6 + (r.sat / 100) * 0.4, 0, 1);
    S.history.push({ day: S.day, revenue: r.revenue, costs: r.cogs + r.spoilCost + r.expenses, profit: r.profit, cash: S.cash, net: netWorth(), sat: r.sat, sold: r.sold });
    S.sats.push(r.sat);
    S.bestDay = Math.max(S.bestDay, r.profit);
    S.totals.revenue += r.revenue; S.totals.expenses += r.expenses + r.cogs + r.spoilCost; S.totals.interest += r.interest; S.totals.sold += r.sold;
    const pts = Math.max(0, Math.round(r.profit / 100)) + Math.round(r.sat / 5);
    this_shell.addScore(pts, `Day ${S.day}`);
  }

  function showReport(r) {
    const rows = r.lines.map((L) => `<tr><td>${L.P.icon} ${L.sold} × ${gbp(L.eff)}${S.discount ? ` <small>(${gbp(L.price)} − ${S.discount}%)</small>` : ''}</td><td>${gbp(L.revenue)}</td></tr>`).join('');
    const neg = (label, v) => (v ? `<tr><td>${label}</td><td class="neg">−${gbp(v)}</td></tr>` : '');
    dom.report.innerHTML = `<div class="report__card">
      <h2 id="report-title">Day ${S.day} report</h2>
      <table>
        ${rows}
        <tr><td><strong>Revenue</strong></td><td>${gbp(r.revenue)}</td></tr>
        ${neg('Cost of goods sold', r.cogs)}${neg('Spoiled stock', r.spoilCost)}${neg('Rent', r.rent)}${neg('Wages', r.wages)}${neg('Marketing', r.marketing)}${neg(`Loan interest (${gbp(S.loan)} × 2%)`, r.interest)}${neg('Inspection fine', r.fine)}
        ${r.savingsInterest ? `<tr><td>Savings interest (${gbp(S.savings)} × 1%)</td><td class="pos">+${gbp(r.savingsInterest)}</td></tr>` : ''}
        <tr class="total"><td>Net ${r.profit >= 0 ? 'profit' : 'loss'}</td><td class="${r.profit >= 0 ? 'pos' : 'neg'}">${gbp(r.profit)}</td></tr>
      </table>
      <p style="font-size:.85rem;margin:8px 0 0">Customers wanted ${r.demandTotal}, you served ${r.sold}${r.unmet ? ` (${r.unmet} left disappointed — sold out!)` : ''}${r.capped ? ' · your shop hit full capacity' : ''}.<br>
      Profit margin: ${r.revenue ? round((r.profit / r.revenue) * 100, 1) : 0}% · satisfaction ${r.sat}% · cash now ${gbp(S.cash)}</p>
      <button class="mg-btn mg-btn--primary" type="button" id="nextDayBtn">${S.day >= DAYS ? '📊 See final report' : '☀ Next day'}</button>
    </div>`;
    dom.report.hidden = false;
    const next = document.getElementById('nextDayBtn');
    next.addEventListener('click', nextDay);
    setTimeout(() => next.focus({ preventScroll: true }), 30);
    MG.sound.play(r.profit >= 0 ? 'cash' : 'error');
    if (r.profit >= 0) this_shell.flash('good');
  }

  function nextDay() {
    if (!this_shell.isPlaying() || S.phase !== 'report') return;
    if (S.cash < 0) return bankrupt();
    if (S.day >= DAYS) return finalReport();
    S.day++;
    startDay();
  }

  function bankrupt() {
    finish(false, 'Bankrupt!', `Your cash fell to ${gbp(S.cash)} and the business could not pay its bills. Keep enough cash for rent, wages and interest before spending on stock and upgrades.`);
  }

  /* ---------------- Player decisions ---------------- */
  function changeOrder(key, d) {
    if (!canPlan()) return;
    S.order[key] = clamp(S.order[key] + d, 0, 300);
    MG.sound.play('click');
    renderStock();
  }
  function buy(key) {
    if (!canPlan()) return;
    const q = S.order[key];
    if (q <= 0) { this_shell.toast('Choose a quantity first.', 'warn'); return; }
    const c = orderCost(key, q);
    if(c.total>S.cash){this_shell.toast('Not enough cash for this order.','warn');return;}
    const day=S.day;
    if(!this_shell.maths.gate({key:'invoice:'+day+':'+key+':'+q+':'+c.unit,topic:'Invoices and bulk discounts',title:'Approve the supplier invoice',prompt:q+' '+PRODUCTS[key].name+' at '+gbp(c.unit)+' each, less '+c.rate*100+'% bulk discount.',fields:[{label:'Amount to pay (£)',answer:c.total/100}],hint:'Calculate quantity × unit price, then multiply by (1 − discount/100).',container:dom.endDay.parentElement,valid:()=>S.day===day&&S.phase==='plan'&&S.order[key]===q&&orderCost(key,q).unit===c.unit,onPass:()=>buy(key)}))return;
    if (c.total > S.cash) { this_shell.toast(`You can’t afford that: ${gbp(c.total)} needed, ${gbp(S.cash)} in cash.`, 'bad'); MG.sound.play('error'); return; }
    // Weighted average cost of the stock now held.
    const unitPaid = c.total / q;
    S.avgCost[key] = (S.stock[key] * S.avgCost[key] + q * unitPaid) / (S.stock[key] + q);
    S.stock[key] += q;
    S.cash -= c.total;
    S.order[key] = 0;
    MG.sound.play('cash');
    this_shell.toast(`Bought ${q} ${PRODUCTS[key].name.toLowerCase()} for ${gbp(c.total)}${c.rate ? ` (saved ${gbp(c.gross - c.total)} with ${c.rate * 100}% bulk discount)` : ''}.`, 'good');
    renderAll();
  }
  function setPrice(key, d) {
    if (!canPlan()) return;
    S.prices[key] = clamp(S.prices[key] + d, 10, 1000);
    MG.sound.play('click');
    renderStock();
  }
  function bank(action) {
    if (!canPlan()) return;
    if (action === 'borrow') {
      if (S.loan + LOAN_STEP > LOAN_MAX) { this_shell.toast('The bank will not lend you more than £400.', 'warn'); return; }
      S.loan += LOAN_STEP; S.cash += LOAN_STEP; S.borrowed += LOAN_STEP;
    } else if (action === 'repay') {
      const amt = Math.min(LOAN_STEP, S.loan);
      if (!amt) return;
      if (S.cash < amt) { this_shell.toast('Not enough cash to repay.', 'bad'); return; }
      S.loan -= amt; S.cash -= amt;
    } else if (action === 'save') {
      if (S.cash < SAVE_STEP) { this_shell.toast('Not enough cash to save.', 'bad'); return; }
      S.cash -= SAVE_STEP; S.savings += SAVE_STEP;
    } else if (action === 'withdraw') {
      const amt = Math.min(SAVE_STEP, S.savings);
      if (!amt) return;
      S.savings -= amt; S.cash += amt;
    }
    MG.sound.play('cash');
    renderAll();
  }
  function buyUpgrade(id) {
    if (!canPlan()) return;
    const u = UPGRADES.find((x) => x.id === id);
    if (S.owned.has(id)) return;
    if (S.cash < u.cost) { this_shell.toast(`${u.name} costs ${gbp(u.cost)} — not enough cash.`, 'bad'); MG.sound.play('error'); return; }
    S.cash -= u.cost;
    S.owned.add(id);
    this_shell.addScore(40, 'Upgrade');
    MG.sound.play('success');
    renderAll();
  }
  const canPlan = () => S && this_shell.isPlaying() && S.phase === 'plan';

  /* ---------------- Rendering ---------------- */
  const netWorth = () => S.cash + S.savings - S.loan + Object.keys(PRODUCTS).reduce((a, k) => a + Math.round(S.stock[k] * S.avgCost[k]), 0);

  function renderAll() { renderForecast(); renderStock(); renderBank(); renderUpgrades(); renderDash(); dom.endDay.disabled = S.phase !== 'plan'; }

  function renderForecast() {
    const ph = phaseOf(S.day);
    dom.forecast.innerHTML = `<strong>Day ${S.day} forecast:</strong> ${S.weather.name}${S.event ? ` · ${S.event.text}` : ''}<br>Rent ${gbp(ph.rent)} + wages ${gbp(ph.wages)} today · capacity ${ph.capacity + (S.owned.has('counter') ? 50 : 0)} customers`;
  }

  function renderStock() {
    dom.stock.innerHTML = '';
    dom.prices.innerHTML = '';
    for (const [key, P] of Object.entries(PRODUCTS)) {
      const locked = S.day < P.unlock;
      const c = orderCost(key, S.order[key]);
      const row = el('div', { class: 'prod' + (locked ? ' is-locked' : '') });
      row.innerHTML = `<span class="prod__name">${P.icon} ${P.name}<small>${locked ? `Unlocks on day ${P.unlock}` : `In stock: ${S.stock[key]} · supplier ${gbp(c.unit)}/unit · spoils ${S.owned.has('fridge') ? 5 : P.spoil * 100}% overnight`}</small></span>`;
      if (!locked) {
        const ctl = el('div', { class: 'prod__ctl' });
        const b = (label, fn, aria) => { const x = el('button', { class: 'mg-btn', type: 'button', 'aria-label': aria, disabled: S.phase !== 'plan' }, label); x.addEventListener('click', fn); ctl.append(x); };
        b('−10', () => changeOrder(key, -10), `Order 10 fewer ${P.name}`);
        ctl.append(el('output', { 'aria-live': 'polite' }, S.order[key]));
        b('+10', () => changeOrder(key, 10), `Order 10 more ${P.name}`);
        b('Buy', () => buy(key), `Buy ${S.order[key]} ${P.name}`);
        row.append(ctl);
        row.append(el('div', { class: 'prod__calc', html: S.order[key] ? `${S.order[key]} × ${gbp(c.unit)}${c.rate ? ` less ${c.rate * 100}% bulk discount` : ''}. Calculate the invoice before paying.` : 'Choose a quantity, then Buy.' }));
      }
      dom.stock.append(row);
      if (locked) continue;
      const pr = el('div', { class: 'prod' });
      const eff = Math.round(S.prices[key] * (1 - S.discount / 100));
      const margin = S.avgCost[key] || c.unit;
      pr.innerHTML = `<span class="prod__name">${P.icon} Price ${gbp(S.prices[key])}<small>Typical price ${gbp(P.ref)}${S.discount ? ` · on sale at ${gbp(eff)}` : ''}</small></span>`;
      const ctl = el('div', { class: 'prod__ctl' });
      for (const [label, d] of [['−10p', -10], ['+10p', 10]]) { const x = el('button', { class: 'mg-btn', type: 'button', disabled: S.phase !== 'plan', 'aria-label': `${label} on ${P.name} price` }, label); x.addEventListener('click', () => setPrice(key, d)); ctl.append(x); }
      pr.append(ctl);
      pr.append(el('div', { class: 'prod__calc' }, `Unit cost ${gbp(margin)}. Calculate your margin before approving a quote.`));
      dom.prices.append(pr);
    }
    dom.mktOut.textContent = gbp(S.marketing);
  }

  function renderBank() {
    dom.bank.innerHTML = '';
    const g = el('div', { class: 'bank__grid' });
    const b = (label, act) => { const x = el('button', { class: 'mg-btn', type: 'button', disabled: S.phase !== 'plan' }, label); x.addEventListener('click', () => bank(act)); g.append(x); };
    b('Borrow £100', 'borrow'); b('Repay £100', 'repay'); b('Save £50', 'save'); b('Withdraw £50', 'withdraw');
    dom.bank.append(g);
    const daysLeft = DAYS - S.day + 1;
    dom.bank.append(el('div', { class: 'bank__info', html: `Loan ${gbp(S.loan)} at 2%/day simple interest: I = P × r × t = ${gbp(S.loan)} × 0.02 × ${daysLeft} = <strong>calculate P × r × t</strong> if kept to the end.<br>Savings ${gbp(S.savings)} earn 1%/day: principal × 0.01 per day.` }));
  }

  function renderUpgrades() {
    dom.upgrades.innerHTML = '';
    for (const u of UPGRADES) {
      const owned = S.owned.has(u.id);
      const row = el('div', { class: 'upg' + (owned ? ' is-owned' : '') }, el('span', {}, `${u.name} — ${u.desc}`));
      if (owned) row.append(el('span', {}, 'Owned ✔'));
      else { const x = el('button', { class: 'mg-btn', type: 'button', disabled: S.phase !== 'plan' }, gbp(u.cost)); x.addEventListener('click', () => buyUpgrade(u.id)); row.append(x); }
      dom.upgrades.append(row);
    }
  }

  function objectiveList() {
    const avgSat = S.sats.length ? S.sats.reduce((a, b) => a + b, 0) / S.sats.length : 0;
    return [
      { text: `Grow net worth to ${gbp(S.cfg.target)} (now ${gbp(netWorth())})`, ok: netWorth() >= S.cfg.target },
      { text: `Average satisfaction of at least 70% (now ${Math.round(avgSat)}%)`, ok: S.sats.length > 0 && avgSat >= 70 },
      { text: `Own at least 2 upgrades (${S.owned.size})`, ok: S.owned.size >= 2 },
      { text: `Make £80 profit in a single day (best ${gbp(Math.max(0, S.bestDay))})`, ok: S.bestDay >= 8000 },
      { text: `Finish with every loan repaid (owing ${gbp(S.loan)})`, ok: S.loan === 0 && S.day >= DAYS && S.phase !== 'plan' }
    ];
  }

  function renderDash() {
    const last = S.history[S.history.length - 1];
    const k = (label, v, neg) => `<div class="kpi"><span>${label}</span><strong class="${neg ? 'neg' : ''}">${v}</strong></div>`;
    dom.kpis.innerHTML = k('Cash', gbp(S.cash), S.cash < 0) + k('Net worth', gbp(netWorth())) + k('Yesterday’s profit', last ? gbp(last.profit) : '—', last && last.profit < 0) + k('Satisfaction', last ? `${last.sat}%` : '—') + k('Loan / savings', `${gbp(S.loan)} / ${gbp(S.savings)}`) + k('Units sold', S.totals.sold);
    dom.objectives.innerHTML = objectiveList().map((o) => `<li class="${o.ok ? 'is-ok' : ''}">${o.text}</li>`).join('');
    this_shell.setResource(gbp(S.cash), S.cash < 3000);
    this_shell.setProgress((S.day - (S.phase === 'plan' ? 1 : 0)) / DAYS, `Day ${S.day} of ${DAYS}`);
    drawCharts();
  }

  function drawCharts() {
    const H = S.history;
    // Cash and net worth lines
    let f = MG.fitCanvas(dom.cashChart), ctx = f.ctx;
    ctx.clearRect(0, 0, f.w, f.h);
    const pad = { l: 44, r: 8, t: 12, b: 18 };
    const xs = (i) => pad.l + (i / Math.max(1, DAYS)) * (f.w - pad.l - pad.r);
    const seriesCash = [S.startCash, ...H.map((h) => h.cash)], seriesNet = [S.startCash, ...H.map((h) => h.net)];
    const max = Math.max(1000, ...seriesCash, ...seriesNet), min = Math.min(0, ...seriesCash, ...seriesNet);
    const ys = (v) => pad.t + (1 - (v - min) / (max - min || 1)) * (f.h - pad.t - pad.b);
    ctx.fillStyle = '#6c5a4c'; ctx.font = '500 10px "IBM Plex Mono", monospace'; ctx.textAlign = 'right'; ctx.strokeStyle = '#ecdccd';
    for (let i = 0; i <= 3; i++) { const v = min + ((max - min) * i) / 3; ctx.beginPath(); ctx.moveTo(pad.l, ys(v)); ctx.lineTo(f.w - pad.r, ys(v)); ctx.stroke(); ctx.fillText(gbp(v).replace('.00', ''), pad.l - 3, ys(v) + 3); }
    const line = (arr, col, dash) => { ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.setLineDash(dash || []); ctx.beginPath(); arr.forEach((v, i) => (i ? ctx.lineTo(xs(i), ys(v)) : ctx.moveTo(xs(i), ys(v)))); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1; };
    line(seriesCash, '#1f6b45'); line(seriesNet, '#2864d8', [6, 4]);
    ctx.textAlign = 'left'; ctx.fillStyle = '#1f6b45'; ctx.fillText('— cash', pad.l + 4, 10); ctx.fillStyle = '#2864d8'; ctx.fillText('- - net worth', pad.l + 54, 10);
    // Revenue vs costs bars, profit dots
    f = MG.fitCanvas(dom.plChart); ctx = f.ctx;
    ctx.clearRect(0, 0, f.w, f.h);
    const vals = H.flatMap((h) => [h.revenue, h.costs, h.profit]);
    const mx = Math.max(1000, ...vals), mn = Math.min(0, ...vals);
    const y2 = (v) => pad.t + (1 - (v - mn) / (mx - mn || 1)) * (f.h - pad.t - pad.b);
    const bw = (f.w - pad.l - pad.r) / DAYS;
    ctx.strokeStyle = '#999'; ctx.beginPath(); ctx.moveTo(pad.l, y2(0)); ctx.lineTo(f.w - pad.r, y2(0)); ctx.stroke();
    ctx.fillStyle = '#6b7c73'; ctx.textAlign = 'right'; ctx.fillText(gbp(mx).replace('.00', ''), pad.l - 3, y2(mx) + 8); ctx.fillText('£0', pad.l - 3, y2(0) + 3);
    H.forEach((h, i) => {
      const x = pad.l + i * bw;
      ctx.fillStyle = '#7fd1a8'; ctx.fillRect(x + bw * 0.1, y2(h.revenue), bw * 0.38, y2(0) - y2(h.revenue));
      ctx.fillStyle = '#f19a9a'; ctx.fillRect(x + bw * 0.5, y2(h.costs), bw * 0.38, y2(0) - y2(h.costs));
      ctx.fillStyle = h.profit >= 0 ? '#0b6b3c' : '#b71c1c'; ctx.beginPath(); ctx.arc(x + bw / 2, y2(h.profit), 3.5, 0, 7); ctx.fill();
      ctx.fillStyle = '#6b7c73'; ctx.textAlign = 'center'; ctx.fillText(h.day, x + bw / 2, f.h - 4);
    });
    ctx.textAlign = 'left'; ctx.fillStyle = '#2e8b57'; ctx.fillText('■ revenue', pad.l + 4, 10); ctx.fillStyle = '#d9534f'; ctx.fillText('■ costs', pad.l + 70, 10); ctx.fillStyle = '#0b6b3c'; ctx.fillText('● profit', pad.l + 122, 10);
  }

  /* ---------------- Storefront canvas ---------------- */
  function drawShop(dt) {
    const f = MG.fitCanvas(shopCanvas), ctx = f.ctx;
    const W = f.w, Hh = f.h, ground = Hh * 0.8;
    const sky = ctx.createLinearGradient(0, 0, 0, Hh);
    const rain = S.weather.id === 'rain';
    sky.addColorStop(0, rain ? '#8aa1b1' : S.weather.id === 'heat' ? '#ffb27a' : '#8fd3ff'); sky.addColorStop(1, '#e8f6ff');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, Hh);
    if (!rain) { ctx.fillStyle = '#ffe066'; ctx.beginPath(); ctx.arc(W * 0.85, Hh * 0.15, 22, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#9aa5ab'; ctx.fillRect(0, ground, W, Hh - ground);
    ctx.fillStyle = '#c7cdd1'; ctx.fillRect(0, ground, W, 8);
    const ph = phaseOf(S.day);
    const cx = W / 2;
    // The building grows with each phase
    const bw = ph.from === 1 ? Math.min(160, W * 0.4) : ph.from === 5 ? Math.min(230, W * 0.55) : Math.min(320, W * 0.75);
    const bh = ph.from === 1 ? Hh * 0.25 : ph.from === 5 ? Hh * 0.38 : Hh * 0.55;
    ctx.fillStyle = ph.from === 1 ? '#c98b4d' : ph.from === 5 ? '#e6b35c' : '#e8e0d0';
    ctx.fillRect(cx - bw / 2, ground - bh, bw, bh);
    // Striped awning
    for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#fff' : '#1f6b45'; ctx.fillRect(cx - bw / 2 - 8 + (i * (bw + 16)) / 8, ground - bh - 4, (bw + 16) / 8, 22); }
    ctx.fillStyle = '#5d4037'; ctx.fillRect(cx - bw / 2 + 8, ground - bh * 0.45, bw - 16, 10);
    if (ph.from >= 4) { ctx.fillStyle = '#b3e5fc'; ctx.fillRect(cx - bw / 2 + 14, ground - bh + 30, bw * 0.3, bh * 0.35); ctx.fillRect(cx + bw / 2 - 14 - bw * 0.3, ground - bh + 30, bw * 0.3, bh * 0.35); }
    if (ph.from >= 7) { ctx.fillStyle = '#795548'; ctx.fillRect(cx - 14, ground - 50, 28, 50); }
    ctx.fillStyle = '#1a1817'; ctx.font = `italic 900 ${Math.max(13, bw / 11)}px Fraunces, Georgia, serif`; ctx.textAlign = 'center';
    ctx.fillText(ph.name.toUpperCase(), cx, ground - bh - 10);
    if (S.owned.has('sign')) { ctx.shadowColor = '#ff4fd8'; ctx.shadowBlur = 14; ctx.fillStyle = '#ff4fd8'; ctx.fillText('★ OPEN ★', cx, ground - bh + 22); ctx.shadowBlur = 0; }
    if (S.owned.has('fridge')) { ctx.fillStyle = '#e0f2f1'; ctx.fillRect(cx + bw / 2 - 30, ground - 46, 22, 44); ctx.strokeStyle = '#80cbc4'; ctx.strokeRect(cx + bw / 2 - 30, ground - 46, 22, 44); }
    // Product icons on the counter
    ctx.font = '18px serif';
    Object.entries(PRODUCTS).forEach(([k, P], i) => { if (S.day >= P.unlock && S.stock[k] > 0) ctx.fillText(P.icon, cx - 30 + i * 30, ground - bh * 0.45 - 4); });
    // Customers during the simulation
    if (S.sim) {
      const sim = S.sim;
      sim.t += dt;
      const target = Math.round(Math.min(1, sim.t / sim.dur) * sim.r.sold);
      while (sim.walkers.length < Math.min(target, 40) || (sim.shown < target && sim.walkers.length < 40)) {
        sim.walkers.push({ x: Math.random() < 0.5 ? -10 : W + 10, y: ground + 10 + Math.random() * (Hh - ground - 20), c: `hsl(${Math.random() * 360},60%,55%)`, t: 0 });
        sim.shown++;
        if (sim.shown >= target) break;
      }
      for (const w of sim.walkers) {
        w.t += dt;
        const dir = Math.sign(cx - w.x);
        if (Math.abs(cx - w.x) > 6) w.x += dir * 120 * dt;
        ctx.fillStyle = w.c; ctx.beginPath(); ctx.arc(w.x, w.y - 18, 7, 0, 7); ctx.fill(); ctx.fillRect(w.x - 5, w.y - 12, 10, 14);
      }
      if (Math.random() < dt * 8) MG.sound.play('coin');
      if (sim.t >= sim.dur) {
        const r = sim.r;
        S.sim = null;
        settle(r);
        S.phase = 'report';
        renderAll();
        showReport(r);
      }
    }
  }

  /* ---------------- End ---------------- */
  function finalReport() {
    // Close the books: repay loans from savings and cash.
    S.cash += S.savings; S.savings = 0;
    const repay = Math.min(S.loan, Math.max(0, S.cash));
    S.cash -= repay; S.loan -= repay;
    S.phase = 'final';
    const objs = objectiveList();
    const met = objs.filter((o) => o.ok).length;
    this_shell.addScore(met * 150, `${met} objectives`);
    finish(S.cash >= 0, met >= 4 ? 'Business tycoon!' : met >= 2 ? 'Thriving business' : 'Still in business', `You traded for all ${DAYS} days and met ${met} of 5 objectives.`, met);
  }

  function finish(won, title, reason, met = 0) {
    if (S.sim) S.sim = null;
    const avgSat = S.sats.length ? Math.round(S.sats.reduce((a, b) => a + b, 0) / S.sats.length) : 0;
    const net = netWorth();
    const netProfit = net - S.startCash;
    let stars;
    if (won) stars = met === 5 ? 3 : met >= 3 ? 2 : 1;
    else stars = S.day >= 9 ? 2 : S.day >= 5 ? 1 : 0;
    const rating = netProfit >= 50000 ? 'Tycoon' : netProfit >= 25000 ? 'Thriving' : netProfit >= 0 ? 'Steady' : 'Struggling';
    this_shell.end({
      won, title, reason, stars,
      stats: [
        ['Days traded', `${Math.min(S.day, DAYS)} / ${DAYS}`],
        ['Total revenue', gbp(S.totals.revenue)],
        ['Total expenses (incl. stock used)', gbp(S.totals.expenses)],
        ['Net profit (net worth change)', gbp(netProfit)],
        ['Final net worth', gbp(net)],
        ['Interest paid on loans', gbp(S.totals.interest)],
        ['Average satisfaction', `${avgSat}%`],
        ['Objectives met', `${met} / 5`],
        ['Performance rating', rating]
      ],
      math: [
        'Profit = revenue − costs. Your costs included the stock you sold (cost of goods), spoiled stock, rent, wages, marketing and interest.',
        'Discounts: a 20% discount multiplies the price by 0.8 — a £1.50 lemonade sells for £1.20. Bulk discounts work the same way on what you pay.',
        'Mark-up = (selling price − cost) ÷ cost × 100%. Profit margin = profit ÷ revenue × 100%.',
        'Simple interest: I = P × r × t. Borrowing £250 for 6 days at 2% per day costs £250 × 0.02 × 6 = £24.',
        `Your best single day made ${gbp(Math.max(0, S.bestDay))} profit; your average satisfaction was ${avgSat}%.`
      ]
    });
  }

  /* ---------------- Shell ---------------- */
  const this_shell = MG.createShell({
    id: 'finance-tycoon',
    title: 'Finance Tycoon',
    tagline: 'Start with a lemonade stand and £250. Can you turn it into a high-street shop in 10 days?',
    goal: 'Trade for 10 days without going bankrupt, and hit as many goals as you can.',
    steps: [
      ['📦', 'Buy stock. Bigger orders get a bulk discount.'],
      ['🏷️', 'Set prices and deals. Too high and nobody buys!'],
      ['🌙', 'End the day and read your profit or loss.']
    ],
    keys: [
      ['<kbd>Enter</kbd>', 'End the day / next day'],
      ['<kbd>Tab</kbd>', 'Move between controls'],
      ['<kbd>P</kbd>', 'Pause']
    ],
    genre: 'Business & economic strategy',
    topic: 'Percentages, profit & loss, discounts, interest',
    premise: 'With £250 and a folding table you open a lemonade stand. Twelve days later, could it be a high-street shop?',
    objective: 'Buy stock, set prices, run promotions, manage loans and savings and invest in upgrades. Finish 10 business days without going bankrupt and meet as many objectives as you can.',
    livesLabel: 'Cash',
    stageLabel: 'Round',
    timerLabel: 'Day timer',
    art: `<svg viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice"><rect width="400" height="500" fill="#fff1e5"/><g fill="#1a1817" opacity=".05"><circle cx="0" cy="0" r="1"/><circle cx="83" cy="47" r="1"/><circle cx="166" cy="94" r="1"/><circle cx="249" cy="141" r="1"/><circle cx="332" cy="188" r="1"/><circle cx="15" cy="235" r="1"/><circle cx="98" cy="282" r="1"/><circle cx="181" cy="329" r="1"/><circle cx="264" cy="376" r="1"/><circle cx="347" cy="423" r="1"/><circle cx="30" cy="470" r="1"/><circle cx="113" cy="17" r="1"/><circle cx="196" cy="64" r="1"/><circle cx="279" cy="111" r="1"/><circle cx="362" cy="158" r="1"/><circle cx="45" cy="205" r="1"/><circle cx="128" cy="252" r="1"/><circle cx="211" cy="299" r="1"/><circle cx="294" cy="346" r="1"/><circle cx="377" cy="393" r="1"/><circle cx="60" cy="440" r="1"/><circle cx="143" cy="487" r="1"/><circle cx="226" cy="34" r="1"/><circle cx="309" cy="81" r="1"/><circle cx="392" cy="128" r="1"/><circle cx="75" cy="175" r="1"/><circle cx="158" cy="222" r="1"/><circle cx="241" cy="269" r="1"/><circle cx="324" cy="316" r="1"/><circle cx="7" cy="363" r="1"/><circle cx="90" cy="410" r="1"/><circle cx="173" cy="457" r="1"/><circle cx="256" cy="4" r="1"/><circle cx="339" cy="51" r="1"/><circle cx="22" cy="98" r="1"/><circle cx="105" cy="145" r="1"/><circle cx="188" cy="192" r="1"/><circle cx="271" cy="239" r="1"/><circle cx="354" cy="286" r="1"/><circle cx="37" cy="333" r="1"/><circle cx="120" cy="380" r="1"/><circle cx="203" cy="427" r="1"/><circle cx="286" cy="474" r="1"/><circle cx="369" cy="21" r="1"/><circle cx="52" cy="68" r="1"/><circle cx="135" cy="115" r="1"/><circle cx="218" cy="162" r="1"/><circle cx="301" cy="209" r="1"/><circle cx="384" cy="256" r="1"/><circle cx="67" cy="303" r="1"/></g><text x="200" y="64" text-anchor="middle" font-family="Fraunces, Georgia, serif" font-weight="900" font-size="34" font-style="italic" fill="#1a1817">The Daily Ledger</text><path d="M28 80H372M28 86H372" stroke="#1a1817" stroke-width="2"/><text x="200" y="104" text-anchor="middle" font-family="IBM Plex Sans Condensed, sans-serif" font-size="12" fill="#6c5a4c" letter-spacing="2">DAY 12 · MARKETS · £ PROFIT &amp; LOSS</text><text x="200" y="152" text-anchor="middle" font-family="Fraunces, Georgia, serif" font-weight="900" font-size="38" fill="#1a1817">LEMONADE</text><text x="200" y="192" text-anchor="middle" font-family="Fraunces, Georgia, serif" font-weight="900" font-size="38" fill="#1f6b45">STAND SOARS!</text><rect x="40" y="208" width="320" height="120" fill="#fffaf4" stroke="#1a1817" stroke-width="2"/><g stroke="#ecdccd"><path d="M40 230H360"/><path d="M40 260H360"/><path d="M40 290H360"/></g><polyline points="52,312 92,298 132,302 172,274 212,278 252,250 292,254 330,226 346,214" fill="none" stroke="#1f6b45" stroke-width="5" stroke-linejoin="round"/><path d="M336 216l18 -8l-6 18Z" fill="#1f6b45"/><text x="56" y="232" font-family="IBM Plex Mono, monospace" font-weight="700" font-size="14" fill="#1f6b45">▲ +38.2%</text><path d="M40 344H360" stroke="#1a1817" stroke-width="2"/><rect x="40" y="372" width="140" height="5" fill="#1a1817" opacity=".22"/><rect x="40" y="384" width="140" height="5" fill="#1a1817" opacity=".22"/><rect x="40" y="396" width="140" height="5" fill="#1a1817" opacity=".22"/><rect x="40" y="408" width="70" height="5" fill="#1a1817" opacity=".22"/><rect x="40" y="420" width="140" height="5" fill="#1a1817" opacity=".22"/><rect x="40" y="432" width="140" height="5" fill="#1a1817" opacity=".22"/><rect x="40" y="444" width="140" height="5" fill="#1a1817" opacity=".22"/><rect x="40" y="456" width="70" height="5" fill="#1a1817" opacity=".22"/><rect x="40" y="468" width="140" height="5" fill="#1a1817" opacity=".22"/><path d="M200 352V480" stroke="#1a1817"/><path d="M226 380h17v18q-8.5 8 -17 0Z" fill="#1f6b45" stroke="#1a1817" stroke-width="2"/><path d="M243 380h17v18q-8.5 8 -17 0Z" fill="#fff" stroke="#1a1817" stroke-width="2"/><path d="M260 380h17v18q-8.5 8 -17 0Z" fill="#1f6b45" stroke="#1a1817" stroke-width="2"/><path d="M277 380h17v18q-8.5 8 -17 0Z" fill="#fff" stroke="#1a1817" stroke-width="2"/><path d="M294 380h17v18q-8.5 8 -17 0Z" fill="#1f6b45" stroke="#1a1817" stroke-width="2"/><path d="M311 380h17v18q-8.5 8 -17 0Z" fill="#fff" stroke="#1a1817" stroke-width="2"/><path d="M328 380h17v18q-8.5 8 -17 0Z" fill="#1f6b45" stroke="#1a1817" stroke-width="2"/><path d="M345 380h17v18q-8.5 8 -17 0Z" fill="#fff" stroke="#1a1817" stroke-width="2"/><rect x="232" y="398" width="124" height="60" fill="#f6c46a" stroke="#1a1817" stroke-width="2"/><rect x="228" y="440" width="132" height="10" fill="#8a5a33" stroke="#1a1817" stroke-width="2"/><text x="294" y="430" text-anchor="middle" font-family="Fraunces, Georgia, serif" font-weight="900" font-size="16" fill="#1a1817">LEMONADE</text><g transform="translate(300 470) rotate(-8)"><rect x="-46" y="-14" width="92" height="28" fill="#b8322a"/><text y="6" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-weight="700" font-size="15" fill="#fff">£1.50 −20%</text></g></svg>`,
    instructions: {
      objective: `Trade for ${DAYS} days. Grow your net worth, keep customers happy and finish with your loans repaid. Your business grows from a stand (days 1–4) to a kiosk (days 5–8) and a shop (days 9–12).`,
      controls: [
        'Buy stock: choose a quantity with −10/+10 and press <strong>Buy</strong>. Set each price with −10p/+10p and choose a promotion discount and marketing spend.',
        'Bank: borrow or repay in £100 steps, save or withdraw in £50 steps. Buy upgrades with cash.',
        '<strong>End Business Day</strong> (or <kbd>Enter</kbd>) opens the shop; then read the daily report and press Next day. <kbd>P</kbd>/<kbd>Esc</kbd> pause.'
      ],
      maths: [
        'Bulk orders get percentage discounts (50+ units 10% off, 100+ units 20% off). Promotions take a percentage off your selling price.',
        'Customers react to price: well above the typical price fewer buy; below it more buy. Weather, events, marketing and reputation also change demand.',
        'Loans charge simple interest of 2% of the amount owed every day; savings earn 1% per day. Unsold stock can spoil overnight.',
        'The daily report shows revenue, every cost and the net profit or loss, plus the profit margin.'
      ],
      scoring: [
        'Each day: +1 pt per £1 of profit and up to +20 for satisfaction. Each upgrade +40.',
        'Final report: +150 for each objective met.'
      ],
      failure: [
        'If your cash is below £0 at the end of a day, the business goes bankrupt and the run ends.',
        'Buy at least ten items and approve the day?s business quote before opening. The planning deadline ends an unapproved day; it never bypasses a calculation.'
      ],
      timer: [
        'Each day has a planning countdown. The countdown stops while customers are served and while you read the report. Pause freezes everything.'
      ]
    },
    stars: [
      `1 star: survive all ${DAYS} days (a bankrupt run that reached day 5 also earns 1).`,
      '2 stars: survive and meet at least 3 of the 5 objectives (a bankrupt run that reached day 9 earns 2).',
      '3 stars: survive and meet all 5 objectives.'
    ],
    onStart(diff) {
      const cfg = DIFF[diff];
      S = {
        cfg, day: 1, startCash: cfg.cash, cash: cfg.cash, loan: 0, savings: 0, borrowed: 0, reputation: 0.7, owned: new Set(),
        stock: { lemonade: 0, cookie: 0, smoothie: 0 }, avgCost: { lemonade: 0, cookie: 0, smoothie: 0 },
        prices: { lemonade: 150, cookie: 200, smoothie: 350 }, discount: 0, marketing: 0,
        history: [], sats: [], bestDay: -Infinity, totals: { revenue: 0, expenses: 0, interest: 0, sold: 0 }, sim: null
      };
      dom.discount.value = 0; dom.marketing.value = 0;
      startDay();
    },
    onUpdate(dt) { drawShop(dt); },
    onTimeUp() { if (S.phase === 'plan') finish(false,'Planning window closed','The business quote was not approved before the planning window ended. Your completed maths decisions are shown separately.'); },
    onStop() { if (S) S.sim = null; dom.report.hidden = true; }
  });

  /* ---------------- Input (bound once) ---------------- */
  dom.endDay.addEventListener('click', endDay);
  dom.discount.addEventListener('change', () => { if (canPlan()) { S.discount = Number(dom.discount.value); renderStock(); } else if (S) dom.discount.value = S.discount; });
  dom.marketing.addEventListener('input', () => { if (canPlan()) { S.marketing = Number(dom.marketing.value) * 100; dom.mktOut.textContent = gbp(S.marketing); } else if (S) dom.marketing.value = S.marketing / 100; });
  window.addEventListener('keydown', (e) => {
    if (!this_shell.isPlaying() || e.key !== 'Enter' || MG.isTarget(e, 'button, select, input')) return;
    e.preventDefault();
    if (S.phase === 'plan') endDay(); else if (S.phase === 'report') nextDay();
  });
  window.addEventListener('resize', () => { if (S) drawCharts(); });

  MG.game = { get state() { return S; }, buy, changeOrder, setPrice, bank, buyUpgrade, endDay, nextDay, simulate, orderCost };
})();
