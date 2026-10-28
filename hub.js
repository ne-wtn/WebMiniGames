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
/* Maths Arcade hub — builds the 10 game cards (each in its own game's style), topic filter and saved progress. */
(() => {
  'use strict';

  // Card artwork is copied from each game's start screen.
  const GAMES = [
  {
    "n": 1,
    "id": "recipe-rush",
    "dir": "game-01-ratio-recipe",
    "title": "Recipe Rush",
    "genre": "Cooking rush",
    "topic": "Ratio · fractions · percentages · units",
    "tags": [
      "number"
    ],
    "desc": "Scale recipes for every party size, cook, and serve before it burns.",
    "art": "<svg viewBox=\"0 0 400 500\" preserveAspectRatio=\"xMidYMid slice\"><rect width=\"400\" height=\"500\" fill=\"#9ad9c8\"/><path d=\"M200 330L800 330L791 434ZM200 330L764 535L720 630ZM200 330L660 716L586 790ZM200 330L500 850L405 894ZM200 330L304 921L200 930ZM200 330L96 921L-5 894ZM200 330L-100 850L-186 790ZM200 330L-260 716L-320 630ZM200 330L-364 535L-391 434ZM200 330L-400 330L-391 226ZM200 330L-364 125L-320 30ZM200 330L-260 -56L-186 -130ZM200 330L-100 -190L-5 -234ZM200 330L96 -261L200 -270ZM200 330L304 -261L405 -234ZM200 330L500 -190L586 -130ZM200 330L660 -56L720 30ZM200 330L764 125L791 226Z\" fill=\"#c4ecdf\"/><rect y=\"388\" width=\"400\" height=\"112\" fill=\"#fff7e8\"/><g fill=\"#2a1d17\"><rect x=\"0\" y=\"440\" width=\"40\" height=\"40\"/><rect x=\"40\" y=\"400\" width=\"40\" height=\"40\"/><rect x=\"40\" y=\"480\" width=\"40\" height=\"40\"/><rect x=\"80\" y=\"440\" width=\"40\" height=\"40\"/><rect x=\"120\" y=\"400\" width=\"40\" height=\"40\"/><rect x=\"120\" y=\"480\" width=\"40\" height=\"40\"/><rect x=\"160\" y=\"440\" width=\"40\" height=\"40\"/><rect x=\"200\" y=\"400\" width=\"40\" height=\"40\"/><rect x=\"200\" y=\"480\" width=\"40\" height=\"40\"/><rect x=\"240\" y=\"440\" width=\"40\" height=\"40\"/><rect x=\"280\" y=\"400\" width=\"40\" height=\"40\"/><rect x=\"280\" y=\"480\" width=\"40\" height=\"40\"/><rect x=\"320\" y=\"440\" width=\"40\" height=\"40\"/><rect x=\"360\" y=\"400\" width=\"40\" height=\"40\"/><rect x=\"360\" y=\"480\" width=\"40\" height=\"40\"/></g><rect y=\"378\" width=\"400\" height=\"18\" fill=\"#e23d28\" stroke=\"#2a1d17\" stroke-width=\"4\"/><g stroke=\"#2a1d17\" stroke-width=\"5\"><ellipse cx=\"200\" cy=\"356\" rx=\"150\" ry=\"30\" fill=\"#fff\"/><ellipse cx=\"200\" cy=\"336\" rx=\"100\" ry=\"22\" fill=\"#e9a13b\"/><ellipse cx=\"200\" cy=\"314\" rx=\"100\" ry=\"22\" fill=\"#f2b552\"/><ellipse cx=\"200\" cy=\"292\" rx=\"100\" ry=\"22\" fill=\"#e9a13b\"/><ellipse cx=\"200\" cy=\"270\" rx=\"100\" ry=\"22\" fill=\"#f6c46a\"/><rect x=\"176\" y=\"242\" width=\"46\" height=\"26\" rx=\"5\" fill=\"#ffe38a\"/></g><path d=\"M130 272c10 22 22 20 20 44c18-4 16-28 34-30c14 18 30 10 56 4c10 12 12 30 22 34c4-20 8-34 0-52\" fill=\"#9c4a12\" stroke=\"#2a1d17\" stroke-width=\"4\" stroke-linejoin=\"round\"/><g fill=\"none\" stroke=\"#fff\" stroke-width=\"7\" stroke-linecap=\"round\" opacity=\".9\"><path d=\"M170 220c-12-18 12-26 0-46\"/><path d=\"M200 210c-12-18 12-26 0-46\"/><path d=\"M230 220c-12-18 12-26 0-46\"/></g><g transform=\"translate(36 52) rotate(-8)\"><rect width=\"150\" height=\"96\" fill=\"#fffdf6\" stroke=\"#2a1d17\" stroke-width=\"5\"/><text x=\"75\" y=\"44\" text-anchor=\"middle\" font-family=\"Caveat, cursive\" font-weight=\"700\" font-size=\"30\" fill=\"#2a1d17\">Party of 6</text><text x=\"75\" y=\"82\" text-anchor=\"middle\" font-family=\"Shrikhand, serif\" font-size=\"30\" fill=\"#e23d28\">× 3/2</text></g><g transform=\"translate(290 70) rotate(10)\"><path d=\"M0 0h70l-6 110H6Z\" fill=\"#dff3ff\" stroke=\"#2a1d17\" stroke-width=\"5\"/><path d=\"M4 50h62l-3 56H7Z\" fill=\"#fff\" opacity=\".9\"/><g stroke=\"#2a1d17\" stroke-width=\"3\"><path d=\"M44 30h18M48 50h14M44 70h18M48 90h14\"/></g></g></svg>"
  },
  {
    "n": 2,
    "id": "algebra-adventure",
    "dir": "game-02-algebra-platformer",
    "title": "Algebra Adventure",
    "genre": "Platformer",
    "topic": "Equations · substitution · inequalities",
    "tags": [
      "algebra"
    ],
    "desc": "Set x right and the bridges, lifts and doors open the way.",
    "art": "<svg viewBox=\"0 0 100 125\" preserveAspectRatio=\"xMidYMid slice\" shape-rendering=\"crispEdges\"><rect x=\"0\" y=\"0\" width=\"100\" height=\"16\" fill=\"#3c6ee0\"/><rect x=\"0\" y=\"16\" width=\"100\" height=\"16\" fill=\"#4a7ef0\"/><rect x=\"0\" y=\"32\" width=\"100\" height=\"16\" fill=\"#5c94fc\"/><rect x=\"0\" y=\"48\" width=\"100\" height=\"16\" fill=\"#74a6ff\"/><rect x=\"0\" y=\"64\" width=\"100\" height=\"16\" fill=\"#8fbaff\"/><rect x=\"12\" y=\"10\" width=\"12\" height=\"4\" fill=\"#fff\"/><rect x=\"8\" y=\"14\" width=\"24\" height=\"4\" fill=\"#fff\"/><rect x=\"10\" y=\"18\" width=\"26\" height=\"4\" fill=\"#fff\"/><rect x=\"64\" y=\"22\" width=\"12\" height=\"4\" fill=\"#fff\"/><rect x=\"60\" y=\"26\" width=\"24\" height=\"4\" fill=\"#fff\"/><rect x=\"62\" y=\"30\" width=\"26\" height=\"4\" fill=\"#fff\"/><rect x=\"0\" y=\"70\" width=\"100\" height=\"60\" fill=\"#7fd36b\"/><rect x=\"0\" y=\"66\" width=\"4\" height=\"12\" fill=\"#4fae4f\"/><rect x=\"4\" y=\"64\" width=\"4\" height=\"12\" fill=\"#4fae4f\"/><rect x=\"8\" y=\"62\" width=\"4\" height=\"12\" fill=\"#4fae4f\"/><rect x=\"12\" y=\"60\" width=\"4\" height=\"12\" fill=\"#4fae4f\"/><rect x=\"16\" y=\"58\" width=\"4\" height=\"12\" fill=\"#4fae4f\"/><rect x=\"20\" y=\"58\" width=\"4\" height=\"12\" fill=\"#4fae4f\"/><rect x=\"24\" y=\"58\" width=\"4\" height=\"12\" fill=\"#4fae4f\"/><rect x=\"28\" y=\"60\" width=\"4\" height=\"12\" fill=\"#4fae4f\"/><rect x=\"32\" y=\"62\" width=\"4\" height=\"12\" fill=\"#4fae4f\"/><rect x=\"36\" y=\"64\" width=\"4\" height=\"12\" fill=\"#4fae4f\"/><rect x=\"40\" y=\"66\" width=\"4\" height=\"12\" fill=\"#4fae4f\"/><rect x=\"44\" y=\"64\" width=\"4\" height=\"12\" fill=\"#4fae4f\"/><rect x=\"48\" y=\"62\" width=\"4\" height=\"12\" fill=\"#4fae4f\"/><rect x=\"52\" y=\"60\" width=\"4\" height=\"12\" fill=\"#4fae4f\"/><rect x=\"56\" y=\"58\" width=\"4\" height=\"12\" fill=\"#4fae4f\"/><rect x=\"60\" y=\"58\" width=\"4\" height=\"12\" fill=\"#4fae4f\"/><rect x=\"64\" y=\"58\" width=\"4\" height=\"12\" fill=\"#4fae4f\"/><rect x=\"68\" y=\"60\" width=\"4\" height=\"12\" fill=\"#4fae4f\"/><rect x=\"72\" y=\"62\" width=\"4\" height=\"12\" fill=\"#4fae4f\"/><rect x=\"76\" y=\"64\" width=\"4\" height=\"12\" fill=\"#4fae4f\"/><rect x=\"80\" y=\"66\" width=\"4\" height=\"12\" fill=\"#4fae4f\"/><rect x=\"84\" y=\"64\" width=\"4\" height=\"12\" fill=\"#4fae4f\"/><rect x=\"88\" y=\"62\" width=\"4\" height=\"12\" fill=\"#4fae4f\"/><rect x=\"92\" y=\"60\" width=\"4\" height=\"12\" fill=\"#4fae4f\"/><rect x=\"96\" y=\"58\" width=\"4\" height=\"12\" fill=\"#4fae4f\"/><rect x=\"0\" y=\"96\" width=\"34\" height=\"34\" fill=\"#b8642a\"/><rect x=\"0\" y=\"96\" width=\"34\" height=\"4\" fill=\"#5ad25a\"/><rect x=\"0\" y=\"100\" width=\"34\" height=\"2\" fill=\"#2e8f2e\"/><rect x=\"3\" y=\"108\" width=\"3\" height=\"3\" fill=\"#8e4a1c\"/><rect x=\"11\" y=\"116\" width=\"3\" height=\"3\" fill=\"#8e4a1c\"/><rect x=\"19\" y=\"108\" width=\"3\" height=\"3\" fill=\"#8e4a1c\"/><rect x=\"27\" y=\"116\" width=\"3\" height=\"3\" fill=\"#8e4a1c\"/><rect x=\"70\" y=\"96\" width=\"30\" height=\"34\" fill=\"#b8642a\"/><rect x=\"70\" y=\"96\" width=\"30\" height=\"4\" fill=\"#5ad25a\"/><rect x=\"70\" y=\"100\" width=\"30\" height=\"2\" fill=\"#2e8f2e\"/><rect x=\"73\" y=\"108\" width=\"3\" height=\"3\" fill=\"#8e4a1c\"/><rect x=\"81\" y=\"116\" width=\"3\" height=\"3\" fill=\"#8e4a1c\"/><rect x=\"89\" y=\"108\" width=\"3\" height=\"3\" fill=\"#8e4a1c\"/><rect x=\"34\" y=\"96\" width=\"5\" height=\"4\" fill=\"#d08a46\"/><rect x=\"34\" y=\"99\" width=\"5\" height=\"1\" fill=\"#9a5a26\"/><rect x=\"40\" y=\"96\" width=\"5\" height=\"4\" fill=\"#d08a46\"/><rect x=\"40\" y=\"99\" width=\"5\" height=\"1\" fill=\"#9a5a26\"/><rect x=\"46\" y=\"96\" width=\"5\" height=\"4\" fill=\"#d08a46\"/><rect x=\"46\" y=\"99\" width=\"5\" height=\"1\" fill=\"#9a5a26\"/><rect x=\"52\" y=\"96\" width=\"5\" height=\"4\" fill=\"#d08a46\"/><rect x=\"52\" y=\"99\" width=\"5\" height=\"1\" fill=\"#9a5a26\"/><rect x=\"58\" y=\"96\" width=\"5\" height=\"4\" fill=\"#d08a46\"/><rect x=\"58\" y=\"99\" width=\"5\" height=\"1\" fill=\"#9a5a26\"/><rect x=\"64\" y=\"96\" width=\"5\" height=\"4\" fill=\"#d08a46\"/><rect x=\"64\" y=\"99\" width=\"5\" height=\"1\" fill=\"#9a5a26\"/><rect x=\"34\" y=\"96\" width=\"36\" height=\"1\" fill=\"#0d0b1e\"/><rect x=\"36\" y=\"112\" width=\"32\" height=\"2\" fill=\"#fff\"/><rect x=\"36\" y=\"109\" width=\"1\" height=\"8\" fill=\"#fff\"/><rect x=\"67\" y=\"109\" width=\"1\" height=\"8\" fill=\"#fff\"/><rect x=\"43\" y=\"58\" width=\"10\" height=\"22\" fill=\"#0d0b1e\"/><rect x=\"44\" y=\"59\" width=\"8\" height=\"4\" fill=\"#ffd7b0\"/><rect x=\"44\" y=\"58\" width=\"8\" height=\"2\" fill=\"#fcd000\"/><rect x=\"50\" y=\"60\" width=\"1\" height=\"1\" fill=\"#0d0b1e\"/><rect x=\"44\" y=\"64\" width=\"8\" height=\"9\" fill=\"#7b3fe4\"/><rect x=\"44\" y=\"73\" width=\"3\" height=\"6\" fill=\"#3b2a7a\"/><rect x=\"49\" y=\"73\" width=\"3\" height=\"4\" fill=\"#3b2a7a\"/><rect x=\"14\" y=\"76\" width=\"12\" height=\"20\" fill=\"#2d3354\"/><rect x=\"16\" y=\"78\" width=\"8\" height=\"6\" fill=\"#39ff7a\"/><rect x=\"76\" y=\"54\" width=\"4\" height=\"6\" fill=\"#fcd000\"/><rect x=\"84\" y=\"50\" width=\"4\" height=\"6\" fill=\"#fcd000\"/><rect x=\"92\" y=\"54\" width=\"4\" height=\"6\" fill=\"#fcd000\"/><rect x=\"24\" y=\"30\" width=\"52\" height=\"14\" fill=\"#0d0b1e\"/><rect x=\"25\" y=\"31\" width=\"50\" height=\"12\" fill=\"#04140a\"/><text x=\"50\" y=\"40.5\" text-anchor=\"middle\" font-family=\"VT323, monospace\" font-size=\"11\" fill=\"#39ff7a\">L = 2x + 1</text></svg>"
  },
  {
    "n": 3,
    "id": "geometry-city",
    "dir": "game-03-geometry-builder",
    "title": "Geometry City",
    "genre": "City builder",
    "topic": "Area · perimeter · volume · angles",
    "tags": [
      "geometry"
    ],
    "desc": "Design districts to the exact square metre, on budget.",
    "art": "<svg viewBox=\"0 0 400 500\" preserveAspectRatio=\"xMidYMid slice\"><rect width=\"400\" height=\"500\" fill=\"#1655a8\"/><line x1=\"0\" y1=\"0\" x2=\"0\" y2=\"500\" stroke=\"#fff\" stroke-opacity=\"0.2\"/><line x1=\"20\" y1=\"0\" x2=\"20\" y2=\"500\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"40\" y1=\"0\" x2=\"40\" y2=\"500\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"60\" y1=\"0\" x2=\"60\" y2=\"500\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"80\" y1=\"0\" x2=\"80\" y2=\"500\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"100\" y1=\"0\" x2=\"100\" y2=\"500\" stroke=\"#fff\" stroke-opacity=\"0.2\"/><line x1=\"120\" y1=\"0\" x2=\"120\" y2=\"500\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"140\" y1=\"0\" x2=\"140\" y2=\"500\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"160\" y1=\"0\" x2=\"160\" y2=\"500\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"180\" y1=\"0\" x2=\"180\" y2=\"500\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"200\" y1=\"0\" x2=\"200\" y2=\"500\" stroke=\"#fff\" stroke-opacity=\"0.2\"/><line x1=\"220\" y1=\"0\" x2=\"220\" y2=\"500\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"240\" y1=\"0\" x2=\"240\" y2=\"500\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"260\" y1=\"0\" x2=\"260\" y2=\"500\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"280\" y1=\"0\" x2=\"280\" y2=\"500\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"300\" y1=\"0\" x2=\"300\" y2=\"500\" stroke=\"#fff\" stroke-opacity=\"0.2\"/><line x1=\"320\" y1=\"0\" x2=\"320\" y2=\"500\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"340\" y1=\"0\" x2=\"340\" y2=\"500\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"360\" y1=\"0\" x2=\"360\" y2=\"500\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"380\" y1=\"0\" x2=\"380\" y2=\"500\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"400\" y1=\"0\" x2=\"400\" y2=\"500\" stroke=\"#fff\" stroke-opacity=\"0.2\"/><line x1=\"0\" y1=\"0\" x2=\"400\" y2=\"0\" stroke=\"#fff\" stroke-opacity=\"0.2\"/><line x1=\"0\" y1=\"20\" x2=\"400\" y2=\"20\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"0\" y1=\"40\" x2=\"400\" y2=\"40\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"0\" y1=\"60\" x2=\"400\" y2=\"60\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"0\" y1=\"80\" x2=\"400\" y2=\"80\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"0\" y1=\"100\" x2=\"400\" y2=\"100\" stroke=\"#fff\" stroke-opacity=\"0.2\"/><line x1=\"0\" y1=\"120\" x2=\"400\" y2=\"120\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"0\" y1=\"140\" x2=\"400\" y2=\"140\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"0\" y1=\"160\" x2=\"400\" y2=\"160\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"0\" y1=\"180\" x2=\"400\" y2=\"180\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"0\" y1=\"200\" x2=\"400\" y2=\"200\" stroke=\"#fff\" stroke-opacity=\"0.2\"/><line x1=\"0\" y1=\"220\" x2=\"400\" y2=\"220\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"0\" y1=\"240\" x2=\"400\" y2=\"240\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"0\" y1=\"260\" x2=\"400\" y2=\"260\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"0\" y1=\"280\" x2=\"400\" y2=\"280\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"0\" y1=\"300\" x2=\"400\" y2=\"300\" stroke=\"#fff\" stroke-opacity=\"0.2\"/><line x1=\"0\" y1=\"320\" x2=\"400\" y2=\"320\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"0\" y1=\"340\" x2=\"400\" y2=\"340\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"0\" y1=\"360\" x2=\"400\" y2=\"360\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"0\" y1=\"380\" x2=\"400\" y2=\"380\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"0\" y1=\"400\" x2=\"400\" y2=\"400\" stroke=\"#fff\" stroke-opacity=\"0.2\"/><line x1=\"0\" y1=\"420\" x2=\"400\" y2=\"420\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"0\" y1=\"440\" x2=\"400\" y2=\"440\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"0\" y1=\"460\" x2=\"400\" y2=\"460\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"0\" y1=\"480\" x2=\"400\" y2=\"480\" stroke=\"#fff\" stroke-opacity=\"0.08\"/><line x1=\"0\" y1=\"500\" x2=\"400\" y2=\"500\" stroke=\"#fff\" stroke-opacity=\"0.2\"/><g fill=\"none\" stroke=\"#fff\" stroke-width=\"3\" stroke-linejoin=\"round\"><path d=\"M80 380V240L200 160L320 240V380Z\"/><path d=\"M80 240H320\"/><rect x=\"180\" y=\"300\" width=\"40\" height=\"80\"/><rect x=\"105\" y=\"265\" width=\"50\" height=\"40\"/><rect x=\"245\" y=\"265\" width=\"50\" height=\"40\"/><path d=\"M110 265v40M130 265v40M250 265v40M270 265v40\" stroke-width=\"1.5\"/></g><g stroke=\"#ffcc00\" stroke-width=\"2\" fill=\"#ffcc00\"><path d=\"M80 410H320M80 402v16M320 402v16\"/><path d=\"M50 240V380M42 240h16M42 380h16\"/></g><text x=\"200\" y=\"438\" text-anchor=\"middle\" font-family=\"Architects Daughter, cursive\" font-size=\"26\" fill=\"#ffcc00\">6 m</text><text x=\"34\" y=\"318\" text-anchor=\"middle\" font-family=\"Architects Daughter, cursive\" font-size=\"26\" fill=\"#ffcc00\" transform=\"rotate(-90 34 318)\">4 m</text><text x=\"200\" y=\"232\" text-anchor=\"middle\" font-family=\"Architects Daughter, cursive\" font-size=\"22\" fill=\"#fff\">A = 24 m²</text><g transform=\"translate(72 30)\" fill=\"none\" stroke=\"#fff\" stroke-width=\"3\"><path d=\"M0 120V0L90 120Z\"/><path d=\"M0 104h16v16\" stroke-width=\"2\"/></g><g font-family=\"Architects Daughter, cursive\" fill=\"#fff\" font-size=\"20\"><text x=\"54\" y=\"98\">4</text><text x=\"112\" y=\"172\">3</text><text x=\"130\" y=\"94\" fill=\"#ffcc00\">5</text></g><g transform=\"translate(276 100)\" fill=\"none\" stroke=\"#fff\" stroke-width=\"2.5\"><path d=\"M-60 0A60 60 0 0 1 60 0Z\"/><path d=\"M0 0L-36 -48\" stroke=\"#ffcc00\"/></g><text x=\"262\" y=\"88\" text-anchor=\"middle\" font-family=\"Architects Daughter, cursive\" font-size=\"18\" fill=\"#ffcc00\">53°</text><g transform=\"translate(130 452)\"><rect width=\"140\" height=\"40\" fill=\"#0b356f\" stroke=\"#fff\" stroke-width=\"2\"/><text x=\"70\" y=\"27\" text-anchor=\"middle\" font-family=\"Big Shoulders Stencil Display, Impact, sans-serif\" font-weight=\"800\" font-size=\"20\" fill=\"#fff\" letter-spacing=\"2\">SHEET 01</text></g></svg>"
  },
  {
    "n": 4,
    "id": "skyline-stack",
    "dir": "game-04-coordinate-racer",
    "title": "Skyline Stack",
    "genre": "Playful tower builder",
    "topic": "Shapes · fractions · spatial thinking",
    "tags": [
      "geometry",
      "algebra"
    ],
    "desc": "Pick colourful blocks, drive the crane and help Pip build a happy tower!",
    "art": "<svg viewBox=\"0 0 400 500\" xmlns=\"http://www.w3.org/2000/svg\"><defs><linearGradient id=\"ss-sky\" x2=\"0\" y2=\"1\"><stop stop-color=\"#a9e4f1\"/><stop offset=\"1\" stop-color=\"#e8f7e7\"/></linearGradient></defs><rect width=\"400\" height=\"500\" fill=\"url(#ss-sky)\"/><circle cx=\"310\" cy=\"88\" r=\"36\" fill=\"#fce7ab\"/><g stroke=\"#a1c8da\" opacity=\".12\"><path d=\"M0 100H400M0 200H400M0 300H400M0 400H400M100 0V500M200 0V500M300 0V500\"/></g><g fill=\"#b2d5cf\"><path d=\"M0 500V350H65V300H100V500M290 500V310H340V360H400V500\"/></g><g stroke=\"#65919e\" stroke-width=\"5\"><rect x=\"91\" y=\"360\" width=\"218\" height=\"72\" rx=\"5\" fill=\"#57dfce\"/><rect x=\"110\" y=\"288\" width=\"180\" height=\"72\" rx=\"5\" fill=\"#fac76a\"/><rect x=\"126\" y=\"216\" width=\"148\" height=\"72\" rx=\"5\" fill=\"#57dfce\"/><rect x=\"143\" y=\"110\" width=\"114\" height=\"64\" rx=\"5\" fill=\"#a7b5ff\"/></g><g fill=\"#467589\"><path d=\"M110 375h23v35h-23zm42 0h23v35h-23zm42 0h23v35h-23zm42 0h23v35h-23zm42 0h13v35h-13zM128 304h23v34h-23zm43 0h23v34h-23zm43 0h23v34h-23zm43 0h16v34h-16zM145 232h22v34h-22zm44 0h22v34h-22zm44 0h22v34h-22zM160 127h22v30h-22zm40 0h22v30h-22z\"/></g><g stroke=\"#fac76a\" fill=\"none\" stroke-width=\"5\"><path d=\"M336 430V42H48M315 430V42L336 66L315 90L336 114L315 138L336 162L315 186L336 210L315 234L336 258L315 282L336 306L315 330L336 354L315 378L336 402M48 42L120 14L200 42L280 14L336 42\"/><path d=\"M176 42V96M224 42V96\" stroke=\"#fff9e6\" stroke-width=\"2\"/></g><path d=\"M91 450H310\" stroke=\"#fac76a\" stroke-width=\"6\"/><text x=\"200\" y=\"482\" text-anchor=\"middle\" fill=\"#fff9e6\" font-family=\"Inter,sans-serif\" font-size=\"15\" letter-spacing=\"5\">BUILD SOMETHING HIGHER</text></svg>"
  },
  {
    "n": 5,
    "id": "probability-carnival",
    "dir": "game-05-probability-arcade",
    "title": "Probability Carnival",
    "genre": "Fairground tycoon",
    "topic": "Probability · expected value",
    "tags": [
      "data"
    ],
    "desc": "Design the fair’s games, pay the prizes, keep the crowds happy.",
    "art": "<svg viewBox=\"0 0 400 500\" preserveAspectRatio=\"xMidYMid slice\"><rect width=\"400\" height=\"500\" fill=\"#14213d\"/><circle cx=\"0\" cy=\"0\" r=\"2\" fill=\"#fff\" opacity=\".8\"/><circle cx=\"97\" cy=\"53\" r=\"1.2\" fill=\"#fff\" opacity=\".8\"/><circle cx=\"194\" cy=\"106\" r=\"1.2\" fill=\"#fff\" opacity=\".8\"/><circle cx=\"291\" cy=\"159\" r=\"2\" fill=\"#fff\" opacity=\".8\"/><circle cx=\"388\" cy=\"12\" r=\"1.2\" fill=\"#fff\" opacity=\".8\"/><circle cx=\"85\" cy=\"65\" r=\"1.2\" fill=\"#fff\" opacity=\".8\"/><circle cx=\"182\" cy=\"118\" r=\"2\" fill=\"#fff\" opacity=\".8\"/><circle cx=\"279\" cy=\"171\" r=\"1.2\" fill=\"#fff\" opacity=\".8\"/><circle cx=\"376\" cy=\"24\" r=\"1.2\" fill=\"#fff\" opacity=\".8\"/><circle cx=\"73\" cy=\"77\" r=\"2\" fill=\"#fff\" opacity=\".8\"/><circle cx=\"170\" cy=\"130\" r=\"1.2\" fill=\"#fff\" opacity=\".8\"/><circle cx=\"267\" cy=\"183\" r=\"1.2\" fill=\"#fff\" opacity=\".8\"/><circle cx=\"364\" cy=\"36\" r=\"2\" fill=\"#fff\" opacity=\".8\"/><circle cx=\"61\" cy=\"89\" r=\"1.2\" fill=\"#fff\" opacity=\".8\"/><circle cx=\"158\" cy=\"142\" r=\"1.2\" fill=\"#fff\" opacity=\".8\"/><circle cx=\"255\" cy=\"195\" r=\"2\" fill=\"#fff\" opacity=\".8\"/><circle cx=\"352\" cy=\"48\" r=\"1.2\" fill=\"#fff\" opacity=\".8\"/><circle cx=\"49\" cy=\"101\" r=\"1.2\" fill=\"#fff\" opacity=\".8\"/><circle cx=\"146\" cy=\"154\" r=\"2\" fill=\"#fff\" opacity=\".8\"/><circle cx=\"243\" cy=\"7\" r=\"1.2\" fill=\"#fff\" opacity=\".8\"/><circle cx=\"340\" cy=\"60\" r=\"1.2\" fill=\"#fff\" opacity=\".8\"/><circle cx=\"37\" cy=\"113\" r=\"2\" fill=\"#fff\" opacity=\".8\"/><circle cx=\"134\" cy=\"166\" r=\"1.2\" fill=\"#fff\" opacity=\".8\"/><circle cx=\"231\" cy=\"19\" r=\"1.2\" fill=\"#fff\" opacity=\".8\"/><circle cx=\"328\" cy=\"72\" r=\"2\" fill=\"#fff\" opacity=\".8\"/><circle cx=\"25\" cy=\"125\" r=\"1.2\" fill=\"#fff\" opacity=\".8\"/><path d=\"M0 58Q200 100 400 58\" fill=\"none\" stroke=\"#f8ecd1\" stroke-width=\"2\"/><path d=\"M10 76l18 0l-9 20Z\" fill=\"#c8102e\"/><path d=\"M54 72l18 0l-9 20Z\" fill=\"#f2b705\"/><path d=\"M98 68l18 0l-9 20Z\" fill=\"#1b998b\"/><path d=\"M142 64l18 0l-9 20Z\" fill=\"#c8102e\"/><path d=\"M186 60l18 0l-9 20Z\" fill=\"#f2b705\"/><path d=\"M230 64l18 0l-9 20Z\" fill=\"#1b998b\"/><path d=\"M274 68l18 0l-9 20Z\" fill=\"#c8102e\"/><path d=\"M318 72l18 0l-9 20Z\" fill=\"#f2b705\"/><path d=\"M362 76l18 0l-9 20Z\" fill=\"#1b998b\"/><path d=\"M200 120L40 330H56Z\" fill=\"#c8102e\"/><path d=\"M200 120L72 330H88Z\" fill=\"#f8ecd1\"/><path d=\"M200 120L104 330H120Z\" fill=\"#c8102e\"/><path d=\"M200 120L136 330H152Z\" fill=\"#f8ecd1\"/><path d=\"M200 120L168 330H184Z\" fill=\"#c8102e\"/><path d=\"M200 120L200 330H216Z\" fill=\"#f8ecd1\"/><path d=\"M200 120L232 330H248Z\" fill=\"#c8102e\"/><path d=\"M200 120L264 330H280Z\" fill=\"#f8ecd1\"/><path d=\"M200 120L296 330H312Z\" fill=\"#c8102e\"/><path d=\"M200 120L328 330H344Z\" fill=\"#f8ecd1\"/><path d=\"M200 120L40 330H360Z\" fill=\"none\" stroke=\"#14213d\" stroke-width=\"4\"/><path d=\"M40 330q16 22 32 0\" fill=\"#f8ecd1\" stroke=\"#14213d\" stroke-width=\"3\"/><path d=\"M72 330q16 22 32 0\" fill=\"#c8102e\" stroke=\"#14213d\" stroke-width=\"3\"/><path d=\"M104 330q16 22 32 0\" fill=\"#f8ecd1\" stroke=\"#14213d\" stroke-width=\"3\"/><path d=\"M136 330q16 22 32 0\" fill=\"#c8102e\" stroke=\"#14213d\" stroke-width=\"3\"/><path d=\"M168 330q16 22 32 0\" fill=\"#f8ecd1\" stroke=\"#14213d\" stroke-width=\"3\"/><path d=\"M200 330q16 22 32 0\" fill=\"#c8102e\" stroke=\"#14213d\" stroke-width=\"3\"/><path d=\"M232 330q16 22 32 0\" fill=\"#f8ecd1\" stroke=\"#14213d\" stroke-width=\"3\"/><path d=\"M264 330q16 22 32 0\" fill=\"#c8102e\" stroke=\"#14213d\" stroke-width=\"3\"/><path d=\"M296 330q16 22 32 0\" fill=\"#f8ecd1\" stroke=\"#14213d\" stroke-width=\"3\"/><path d=\"M328 330q16 22 32 0\" fill=\"#c8102e\" stroke=\"#14213d\" stroke-width=\"3\"/><path d=\"M200 120V84\" stroke=\"#f8ecd1\" stroke-width=\"4\"/><path d=\"M200 84l30 9l-30 9Z\" fill=\"#f2b705\"/><rect x=\"0\" y=\"352\" width=\"400\" height=\"148\" fill=\"#22345c\"/><g transform=\"translate(200 410)\"><circle r=\"84\" fill=\"#c8102e\" stroke=\"#14213d\" stroke-width=\"4\"/><path d=\"M0 0L70.0 0.0A70 70 0 0 1 60.6 35.0Z\" fill=\"#f2b705\" stroke=\"#14213d\" stroke-width=\"2\"/><path d=\"M0 0L60.6 35.0A70 70 0 0 1 35.0 60.6Z\" fill=\"#c8102e\" stroke=\"#14213d\" stroke-width=\"2\"/><path d=\"M0 0L35.0 60.6A70 70 0 0 1 0.0 70.0Z\" fill=\"#1b998b\" stroke=\"#14213d\" stroke-width=\"2\"/><path d=\"M0 0L0.0 70.0A70 70 0 0 1 -35.0 60.6Z\" fill=\"#cdbf9f\" stroke=\"#14213d\" stroke-width=\"2\"/><path d=\"M0 0L-35.0 60.6A70 70 0 0 1 -60.6 35.0Z\" fill=\"#f2b705\" stroke=\"#14213d\" stroke-width=\"2\"/><path d=\"M0 0L-60.6 35.0A70 70 0 0 1 -70.0 0.0Z\" fill=\"#c8102e\" stroke=\"#14213d\" stroke-width=\"2\"/><path d=\"M0 0L-70.0 0.0A70 70 0 0 1 -60.6 -35.0Z\" fill=\"#1b998b\" stroke=\"#14213d\" stroke-width=\"2\"/><path d=\"M0 0L-60.6 -35.0A70 70 0 0 1 -35.0 -60.6Z\" fill=\"#cdbf9f\" stroke=\"#14213d\" stroke-width=\"2\"/><path d=\"M0 0L-35.0 -60.6A70 70 0 0 1 -0.0 -70.0Z\" fill=\"#f2b705\" stroke=\"#14213d\" stroke-width=\"2\"/><path d=\"M0 0L-0.0 -70.0A70 70 0 0 1 35.0 -60.6Z\" fill=\"#c8102e\" stroke=\"#14213d\" stroke-width=\"2\"/><path d=\"M0 0L35.0 -60.6A70 70 0 0 1 60.6 -35.0Z\" fill=\"#1b998b\" stroke=\"#14213d\" stroke-width=\"2\"/><path d=\"M0 0L60.6 -35.0A70 70 0 0 1 70.0 -0.0Z\" fill=\"#cdbf9f\" stroke=\"#14213d\" stroke-width=\"2\"/><circle cx=\"78.0\" cy=\"0.0\" r=\"4\" fill=\"#f2b705\"/><circle cx=\"72.1\" cy=\"29.8\" r=\"4\" fill=\"#fff6b0\"/><circle cx=\"55.2\" cy=\"55.2\" r=\"4\" fill=\"#f2b705\"/><circle cx=\"29.8\" cy=\"72.1\" r=\"4\" fill=\"#fff6b0\"/><circle cx=\"0.0\" cy=\"78.0\" r=\"4\" fill=\"#f2b705\"/><circle cx=\"-29.8\" cy=\"72.1\" r=\"4\" fill=\"#fff6b0\"/><circle cx=\"-55.2\" cy=\"55.2\" r=\"4\" fill=\"#f2b705\"/><circle cx=\"-72.1\" cy=\"29.8\" r=\"4\" fill=\"#fff6b0\"/><circle cx=\"-78.0\" cy=\"0.0\" r=\"4\" fill=\"#f2b705\"/><circle cx=\"-72.1\" cy=\"-29.8\" r=\"4\" fill=\"#fff6b0\"/><circle cx=\"-55.2\" cy=\"-55.2\" r=\"4\" fill=\"#f2b705\"/><circle cx=\"-29.8\" cy=\"-72.1\" r=\"4\" fill=\"#fff6b0\"/><circle cx=\"-0.0\" cy=\"-78.0\" r=\"4\" fill=\"#f2b705\"/><circle cx=\"29.8\" cy=\"-72.1\" r=\"4\" fill=\"#fff6b0\"/><circle cx=\"55.2\" cy=\"-55.2\" r=\"4\" fill=\"#f2b705\"/><circle cx=\"72.1\" cy=\"-29.8\" r=\"4\" fill=\"#fff6b0\"/><circle r=\"10\" fill=\"#f2b705\" stroke=\"#14213d\" stroke-width=\"3\"/></g><path d=\"M186 318h28l-14 26Z\" fill=\"#f2b705\" stroke=\"#14213d\" stroke-width=\"3\"/><g transform=\"translate(200 186) rotate(-4)\"><rect x=\"-120\" y=\"-24\" width=\"240\" height=\"44\" fill=\"#f2b705\" stroke=\"#14213d\" stroke-width=\"4\"/><text x=\"0\" y=\"8\" text-anchor=\"middle\" font-family=\"Rye, serif\" font-size=\"26\" fill=\"#14213d\">STEP RIGHT UP</text></g></svg>"
  },
  {
    "n": 6,
    "id": "function-factory",
    "dir": "game-06-function-factory",
    "title": "Function Factory",
    "genre": "Factory puzzle",
    "topic": "Functions · composition · sequences",
    "tags": [
      "algebra"
    ],
    "desc": "Build machine lines that turn every crate into the right number.",
    "art": "<svg viewBox=\"0 0 400 500\" preserveAspectRatio=\"xMidYMid slice\"><rect width=\"400\" height=\"500\" fill=\"#2a2e2d\"/><path d=\"M4 14l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M4 54l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M4 94l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M4 134l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M4 174l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M4 214l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M4 254l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M4 294l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M4 334l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M4 374l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M4 414l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M4 454l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M4 494l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M4 534l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M24 34l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M24 74l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M24 114l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M24 154l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M24 194l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M24 234l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M24 274l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M24 314l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M24 354l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M24 394l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M24 434l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M24 474l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M24 514l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M24 554l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M44 14l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M44 54l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M44 94l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M44 134l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M44 174l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M44 214l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M44 254l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M44 294l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M44 334l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M44 374l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M44 414l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M44 454l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M44 494l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M44 534l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M64 34l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M64 74l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M64 114l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M64 154l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M64 194l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M64 234l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M64 274l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M64 314l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M64 354l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M64 394l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M64 434l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M64 474l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M64 514l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M64 554l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M84 14l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M84 54l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M84 94l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M84 134l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M84 174l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M84 214l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M84 254l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M84 294l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M84 334l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M84 374l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M84 414l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M84 454l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M84 494l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M84 534l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M104 34l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M104 74l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M104 114l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M104 154l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M104 194l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M104 234l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M104 274l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M104 314l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M104 354l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M104 394l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M104 434l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M104 474l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M104 514l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M104 554l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M124 14l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M124 54l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M124 94l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M124 134l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M124 174l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M124 214l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M124 254l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M124 294l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M124 334l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M124 374l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M124 414l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M124 454l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M124 494l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M124 534l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M144 34l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M144 74l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M144 114l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M144 154l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M144 194l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M144 234l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M144 274l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M144 314l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M144 354l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M144 394l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M144 434l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M144 474l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M144 514l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M144 554l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M164 14l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M164 54l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M164 94l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M164 134l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M164 174l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M164 214l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M164 254l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M164 294l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M164 334l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M164 374l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M164 414l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M164 454l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M164 494l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M164 534l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M184 34l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M184 74l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M184 114l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M184 154l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M184 194l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M184 234l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M184 274l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M184 314l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M184 354l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M184 394l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M184 434l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M184 474l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M184 514l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M184 554l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M204 14l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M204 54l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M204 94l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M204 134l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M204 174l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M204 214l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M204 254l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M204 294l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M204 334l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M204 374l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M204 414l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M204 454l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M204 494l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M204 534l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M224 34l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M224 74l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M224 114l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M224 154l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M224 194l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M224 234l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M224 274l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M224 314l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M224 354l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M224 394l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M224 434l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M224 474l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M224 514l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M224 554l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M244 14l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M244 54l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M244 94l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M244 134l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M244 174l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M244 214l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M244 254l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M244 294l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M244 334l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M244 374l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M244 414l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M244 454l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M244 494l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M244 534l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M264 34l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M264 74l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M264 114l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M264 154l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M264 194l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M264 234l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M264 274l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M264 314l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M264 354l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M264 394l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M264 434l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M264 474l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M264 514l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M264 554l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M284 14l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M284 54l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M284 94l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M284 134l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M284 174l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M284 214l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M284 254l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M284 294l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M284 334l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M284 374l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M284 414l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M284 454l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M284 494l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M284 534l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M304 34l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M304 74l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M304 114l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M304 154l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M304 194l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M304 234l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M304 274l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M304 314l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M304 354l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M304 394l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M304 434l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M304 474l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M304 514l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M304 554l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M324 14l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M324 54l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M324 94l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M324 134l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M324 174l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M324 214l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M324 254l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M324 294l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M324 334l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M324 374l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M324 414l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M324 454l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M324 494l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M324 534l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M344 34l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M344 74l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M344 114l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M344 154l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M344 194l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M344 234l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M344 274l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M344 314l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M344 354l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M344 394l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M344 434l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M344 474l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M344 514l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M344 554l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M364 14l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M364 54l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M364 94l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M364 134l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M364 174l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M364 214l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M364 254l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M364 294l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M364 334l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M364 374l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M364 414l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M364 454l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M364 494l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M364 534l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M384 34l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M384 74l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M384 114l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M384 154l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M384 194l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M384 234l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M384 274l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M384 314l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M384 354l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M384 394l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M384 434l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M384 474l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M384 514l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M384 554l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M404 14l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M404 54l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M404 94l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M404 134l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M404 174l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M404 214l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M404 254l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M404 294l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M404 334l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M404 374l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M404 414l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M404 454l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M404 494l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M404 534l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M424 34l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M424 74l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M424 114l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M424 154l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M424 194l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M424 234l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M424 274l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M424 314l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M424 354l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M424 394l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M424 434l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M424 474l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M424 514l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M424 554l10 -8\" stroke=\"#3d4442\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M354.3 80.0L351.6 96.8L343.7 94.2L337.2 107.0L343.9 111.9L331.9 123.9L327.0 117.2L314.2 123.7L316.8 131.6L300.0 134.3L300.0 126.0L285.8 123.7L283.2 131.6L268.1 123.9L273.0 117.2L262.8 107.0L256.1 111.9L248.4 96.8L256.3 94.2L254.0 80.0L245.7 80.0L248.4 63.2L256.3 65.8L262.8 53.0L256.1 48.1L268.1 36.1L273.0 42.8L285.8 36.3L283.2 28.4L300.0 25.7L300.0 34.0L314.2 36.3L316.8 28.4L331.9 36.1L327.0 42.8L337.2 53.0L343.9 48.1L351.6 63.2L343.7 65.8L346.0 80.0Z\" fill=\"#c9a03d\" stroke=\"#1c1f1e\" stroke-width=\"3\"/><circle cx=\"300\" cy=\"80\" r=\"16.1\" fill=\"#1c1f1e\"/><path d=\"M267.4 128.0L264.7 141.5L259.7 139.5L253.2 149.2L257.0 153.0L245.5 160.7L243.5 155.7L232.0 158.0L232.0 163.4L218.5 160.7L220.5 155.7L210.8 149.2L207.0 153.0L199.3 141.5L204.3 139.5L202.0 128.0L196.6 128.0L199.3 114.5L204.3 116.5L210.8 106.8L207.0 103.0L218.5 95.3L220.5 100.3L232.0 98.0L232.0 92.6L245.5 95.3L243.5 100.3L253.2 106.8L257.0 103.0L264.7 114.5L259.7 116.5L262.0 128.0Z\" fill=\"#9aa3a8\" stroke=\"#1c1f1e\" stroke-width=\"3\"/><circle cx=\"232\" cy=\"128\" r=\"10.5\" fill=\"#1c1f1e\"/><rect x=\"70\" y=\"150\" width=\"260\" height=\"190\" rx=\"8\" fill=\"#4f7d68\" stroke=\"#1c1f1e\" stroke-width=\"5\"/><rect x=\"88\" y=\"168\" width=\"224\" height=\"40\" rx=\"4\" fill=\"#efe6cf\" stroke=\"#1c1f1e\" stroke-width=\"3\"/><text x=\"200\" y=\"198\" text-anchor=\"middle\" font-family=\"Saira Stencil One, Impact, sans-serif\" font-size=\"26\" fill=\"#2c4a3d\">f(x) = 3x + 2</text><circle cx=\"140\" cy=\"270\" r=\"44\" fill=\"#efe6cf\" stroke=\"#1c1f1e\" stroke-width=\"5\"/><path d=\"M110 280A32 32 0 0 1 170 280\" fill=\"none\" stroke=\"#c62828\" stroke-width=\"6\"/><path d=\"M140 270L166 246\" stroke=\"#1c1f1e\" stroke-width=\"5\" stroke-linecap=\"round\"/><circle cx=\"140\" cy=\"270\" r=\"6\" fill=\"#1c1f1e\"/><g fill=\"#c4ccd0\"><circle cx=\"82\" cy=\"162\" r=\"4\"/><circle cx=\"318\" cy=\"162\" r=\"4\"/><circle cx=\"82\" cy=\"328\" r=\"4\"/><circle cx=\"318\" cy=\"328\" r=\"4\"/></g><rect x=\"210\" y=\"236\" width=\"96\" height=\"40\" rx=\"3\" fill=\"#0f1312\" stroke=\"#5d6a66\" stroke-width=\"3\"/><text x=\"258\" y=\"265\" text-anchor=\"middle\" font-family=\"Share Tech Mono, monospace\" font-size=\"26\" fill=\"#8dffb4\">× 3</text><rect x=\"210\" y=\"284\" width=\"96\" height=\"40\" rx=\"3\" fill=\"#0f1312\" stroke=\"#5d6a66\" stroke-width=\"3\"/><text x=\"258\" y=\"313\" text-anchor=\"middle\" font-family=\"Share Tech Mono, monospace\" font-size=\"26\" fill=\"#8dffb4\">+ 2</text><rect x=\"0\" y=\"412\" width=\"400\" height=\"26\" fill=\"#111413\" stroke=\"#1c1f1e\" stroke-width=\"3\"/><path d=\"M0 414l8 22\" stroke=\"#3c434b\" stroke-width=\"3\"/><path d=\"M20 414l8 22\" stroke=\"#3c434b\" stroke-width=\"3\"/><path d=\"M40 414l8 22\" stroke=\"#3c434b\" stroke-width=\"3\"/><path d=\"M60 414l8 22\" stroke=\"#3c434b\" stroke-width=\"3\"/><path d=\"M80 414l8 22\" stroke=\"#3c434b\" stroke-width=\"3\"/><path d=\"M100 414l8 22\" stroke=\"#3c434b\" stroke-width=\"3\"/><path d=\"M120 414l8 22\" stroke=\"#3c434b\" stroke-width=\"3\"/><path d=\"M140 414l8 22\" stroke=\"#3c434b\" stroke-width=\"3\"/><path d=\"M160 414l8 22\" stroke=\"#3c434b\" stroke-width=\"3\"/><path d=\"M180 414l8 22\" stroke=\"#3c434b\" stroke-width=\"3\"/><path d=\"M200 414l8 22\" stroke=\"#3c434b\" stroke-width=\"3\"/><path d=\"M220 414l8 22\" stroke=\"#3c434b\" stroke-width=\"3\"/><path d=\"M240 414l8 22\" stroke=\"#3c434b\" stroke-width=\"3\"/><path d=\"M260 414l8 22\" stroke=\"#3c434b\" stroke-width=\"3\"/><path d=\"M280 414l8 22\" stroke=\"#3c434b\" stroke-width=\"3\"/><path d=\"M300 414l8 22\" stroke=\"#3c434b\" stroke-width=\"3\"/><path d=\"M320 414l8 22\" stroke=\"#3c434b\" stroke-width=\"3\"/><path d=\"M340 414l8 22\" stroke=\"#3c434b\" stroke-width=\"3\"/><path d=\"M360 414l8 22\" stroke=\"#3c434b\" stroke-width=\"3\"/><path d=\"M380 414l8 22\" stroke=\"#3c434b\" stroke-width=\"3\"/><path d=\"M400 414l8 22\" stroke=\"#3c434b\" stroke-width=\"3\"/><g transform=\"translate(94 388)\"><rect x=\"-24\" y=\"-24\" width=\"48\" height=\"48\" fill=\"#c58b4e\" stroke=\"#1c1f1e\" stroke-width=\"3\"/><path d=\"M-24 -24L24 24M24 -24L-24 24\" stroke=\"#7a5025\" stroke-width=\"2\" opacity=\".5\"/><text y=\"8\" text-anchor=\"middle\" font-family=\"Share Tech Mono, monospace\" font-size=\"26\" fill=\"#1c1f1e\">4</text></g><g transform=\"translate(306 388)\"><rect x=\"-24\" y=\"-24\" width=\"48\" height=\"48\" fill=\"#c58b4e\" stroke=\"#1c1f1e\" stroke-width=\"3\"/><path d=\"M-24 -24L24 24M24 -24L-24 24\" stroke=\"#7a5025\" stroke-width=\"2\" opacity=\".5\"/><text y=\"8\" text-anchor=\"middle\" font-family=\"Share Tech Mono, monospace\" font-size=\"22\" fill=\"#1c1f1e\">14</text></g><path d=\"M132 388h26M242 388h26\" stroke=\"#ff7a1a\" stroke-width=\"6\" stroke-linecap=\"round\"/><path d=\"M150 376l14 12l-14 12M262 376l14 12l-14 12\" fill=\"none\" stroke=\"#ff7a1a\" stroke-width=\"6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><rect y=\"480\" width=\"400\" height=\"20\" fill=\"#1c1f1e\"/><path d=\"M-40 500l20 -20h10l-20 20Z\" fill=\"#ffc21a\"/><path d=\"M-20 500l20 -20h10l-20 20Z\" fill=\"#ffc21a\"/><path d=\"M0 500l20 -20h10l-20 20Z\" fill=\"#ffc21a\"/><path d=\"M20 500l20 -20h10l-20 20Z\" fill=\"#ffc21a\"/><path d=\"M40 500l20 -20h10l-20 20Z\" fill=\"#ffc21a\"/><path d=\"M60 500l20 -20h10l-20 20Z\" fill=\"#ffc21a\"/><path d=\"M80 500l20 -20h10l-20 20Z\" fill=\"#ffc21a\"/><path d=\"M100 500l20 -20h10l-20 20Z\" fill=\"#ffc21a\"/><path d=\"M120 500l20 -20h10l-20 20Z\" fill=\"#ffc21a\"/><path d=\"M140 500l20 -20h10l-20 20Z\" fill=\"#ffc21a\"/><path d=\"M160 500l20 -20h10l-20 20Z\" fill=\"#ffc21a\"/><path d=\"M180 500l20 -20h10l-20 20Z\" fill=\"#ffc21a\"/><path d=\"M200 500l20 -20h10l-20 20Z\" fill=\"#ffc21a\"/><path d=\"M220 500l20 -20h10l-20 20Z\" fill=\"#ffc21a\"/><path d=\"M240 500l20 -20h10l-20 20Z\" fill=\"#ffc21a\"/><path d=\"M260 500l20 -20h10l-20 20Z\" fill=\"#ffc21a\"/><path d=\"M280 500l20 -20h10l-20 20Z\" fill=\"#ffc21a\"/><path d=\"M300 500l20 -20h10l-20 20Z\" fill=\"#ffc21a\"/><path d=\"M320 500l20 -20h10l-20 20Z\" fill=\"#ffc21a\"/><path d=\"M340 500l20 -20h10l-20 20Z\" fill=\"#ffc21a\"/><path d=\"M360 500l20 -20h10l-20 20Z\" fill=\"#ffc21a\"/><path d=\"M380 500l20 -20h10l-20 20Z\" fill=\"#ffc21a\"/><path d=\"M400 500l20 -20h10l-20 20Z\" fill=\"#ffc21a\"/><path d=\"M420 500l20 -20h10l-20 20Z\" fill=\"#ffc21a\"/><path d=\"M440 500l20 -20h10l-20 20Z\" fill=\"#ffc21a\"/><path d=\"M460 500l20 -20h10l-20 20Z\" fill=\"#ffc21a\"/></svg>"
  },
  {
    "n": 7,
    "id": "data-detective",
    "dir": "game-07-statistics-detective",
    "title": "Data Detective",
    "genre": "Mystery",
    "topic": "Mean · median · mode · range",
    "tags": [
      "data"
    ],
    "desc": "Crack the case of the missing diamond using the data.",
    "art": "<svg viewBox=\"0 0 400 500\" preserveAspectRatio=\"xMidYMid slice\"><defs><radialGradient id=\"hub-dd-lamp\" cx=\"50%\" cy=\"0%\" r=\"90%\"><stop offset=\"0\" stop-color=\"#ffd98a\" stop-opacity=\".55\"/><stop offset=\"1\" stop-color=\"#ffd98a\" stop-opacity=\"0\"/></radialGradient></defs><rect width=\"400\" height=\"500\" fill=\"#140e0a\"/><g stroke=\"#000\" stroke-opacity=\".35\"><path d=\"M0 0V500\"/><path d=\"M26 0V500\"/><path d=\"M52 0V500\"/><path d=\"M78 0V500\"/><path d=\"M104 0V500\"/><path d=\"M130 0V500\"/><path d=\"M156 0V500\"/><path d=\"M182 0V500\"/><path d=\"M208 0V500\"/><path d=\"M234 0V500\"/><path d=\"M260 0V500\"/><path d=\"M286 0V500\"/><path d=\"M312 0V500\"/><path d=\"M338 0V500\"/><path d=\"M364 0V500\"/><path d=\"M390 0V500\"/></g><path d=\"M150 0h100l130 500H20Z\" fill=\"url(#hub-dd-lamp)\"/><path d=\"M162 0h76l-10 40h-56Z\" fill=\"#2f3a2f\"/><rect x=\"60\" y=\"210\" width=\"290\" height=\"230\" rx=\"4\" fill=\"#c9a560\" transform=\"rotate(-4 205 325)\"/><g transform=\"rotate(-2 210 320)\"><rect x=\"80\" y=\"200\" width=\"270\" height=\"226\" fill=\"#f3e8cf\"/><g stroke=\"#000\" stroke-opacity=\".06\"><path d=\"M80 226H350\"/><path d=\"M80 248H350\"/><path d=\"M80 270H350\"/><path d=\"M80 292H350\"/><path d=\"M80 314H350\"/><path d=\"M80 336H350\"/><path d=\"M80 358H350\"/><path d=\"M80 380H350\"/><path d=\"M80 402H350\"/></g><text x=\"96\" y=\"230\" font-family=\"Special Elite, Courier New, monospace\" font-size=\"18\" fill=\"#b3261e\" letter-spacing=\"3\">CASE No. 7</text><rect x=\"118\" y=\"324\" width=\"16\" height=\"28\" fill=\"#8a6a3c\"/><rect x=\"142\" y=\"305.8\" width=\"16\" height=\"46\" fill=\"#8a6a3c\"/><rect x=\"166\" y=\"331\" width=\"16\" height=\"21\" fill=\"#8a6a3c\"/><rect x=\"190\" y=\"293.2\" width=\"16\" height=\"59\" fill=\"#8a6a3c\"/><rect x=\"214\" y=\"314.2\" width=\"16\" height=\"38\" fill=\"#8a6a3c\"/><rect x=\"238\" y=\"326.8\" width=\"16\" height=\"25\" fill=\"#8a6a3c\"/><rect x=\"262\" y=\"254\" width=\"16\" height=\"98\" fill=\"#b3261e\"/><path d=\"M110 302H300\" stroke=\"#1565c0\" stroke-width=\"3\" stroke-dasharray=\"8 6\"/><path d=\"M110 318H300\" stroke=\"#2e7d32\" stroke-width=\"3\"/><text x=\"300\" y=\"296\" font-family=\"Special Elite, Courier New, monospace\" font-size=\"13\" fill=\"#1565c0\" text-anchor=\"end\">mean</text><text x=\"300\" y=\"334\" font-family=\"Special Elite, Courier New, monospace\" font-size=\"13\" fill=\"#2e7d32\" text-anchor=\"end\">median</text><text x=\"96\" y=\"404\" font-family=\"Special Elite, Courier New, monospace\" font-size=\"16\" fill=\"#17120e\">Outlier: 142 cm ?!</text></g><g transform=\"translate(300 150) rotate(-30)\"><circle r=\"52\" fill=\"rgba(200,230,255,.18)\" stroke=\"#2a1d15\" stroke-width=\"12\"/><circle r=\"52\" fill=\"none\" stroke=\"#c9a560\" stroke-width=\"5\"/><rect x=\"-9\" y=\"56\" width=\"18\" height=\"78\" rx=\"6\" fill=\"#2a1d15\"/></g><g transform=\"translate(92 120)\"><path d=\"M0 0l22 -20h40l22 20l-42 46Z\" fill=\"#7fe3ff\" stroke=\"#e8fbff\" stroke-width=\"3\"/><path d=\"M0 0h84M22 -20l20 66l20 -66M22 -20L42 0L62 -20\" fill=\"none\" stroke=\"#e8fbff\" stroke-width=\"2\" opacity=\".8\"/></g><text x=\"200\" y=\"480\" text-anchor=\"middle\" font-family=\"DM Serif Display, Georgia, serif\" font-style=\"italic\" font-size=\"30\" fill=\"#ffd98a\">Who took the diamond?</text></svg>"
  },
  {
    "n": 8,
    "id": "trig-rescue",
    "dir": "game-08-trigonometry-rescue",
    "title": "Trigonometry Rescue",
    "genre": "Rescue flight",
    "topic": "Trigonometry · elevation · bearings",
    "tags": [
      "geometry"
    ],
    "desc": "Fly the rescue drone with angles and distances.",
    "art": "<svg viewBox=\"0 0 400 500\" preserveAspectRatio=\"xMidYMid slice\"><defs><linearGradient id=\"hub-tr-sky\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#7fbbe6\"/><stop offset=\"1\" stop-color=\"#eef6fb\"/></linearGradient></defs><rect width=\"400\" height=\"500\" fill=\"url(#hub-tr-sky)\"/><circle cx=\"320\" cy=\"70\" r=\"30\" fill=\"#fff6d6\"/><path d=\"M-10 300L70 210L120 250L210 120L290 230L340 180L410 260V500H-10Z\" fill=\"#9fb4c6\"/><path d=\"M190 148L210 120L232 152L218 146L206 160Z M58 224L70 210L84 222Z M330 190L340 180L352 192Z\" fill=\"#fff\"/><path d=\"M-10 420L60 340L130 380L170 330L200 360L260 300L300 330L410 290V500H-10Z\" fill=\"#56697b\"/><path d=\"M250 310l10 -10l14 12l-8 -2Z\" fill=\"#fff\"/><path d=\"M200 360h70v8h-70Z\" fill=\"#eef6fb\"/><g transform=\"translate(236 344)\"><path d=\"M0 0v-14M0 -11l8 -8M0 0l-4 6M0 0l4 6\" stroke=\"#c62828\" stroke-width=\"3\" stroke-linecap=\"round\"/><circle cx=\"0\" cy=\"-18\" r=\"4\" fill=\"#ffd7b0\"/></g><path d=\"M60 460L236 236\" stroke=\"#ff5a1f\" stroke-width=\"4\" stroke-dasharray=\"12 9\"/><path d=\"M60 460H236V236\" fill=\"none\" stroke=\"#1d2b38\" stroke-width=\"2.5\" stroke-dasharray=\"5 5\"/><path d=\"M100 460A40 40 0 0 0 85 428\" fill=\"none\" stroke=\"#1d2b38\" stroke-width=\"3\"/><text x=\"106\" y=\"448\" font-family=\"B612 Mono, monospace\" font-weight=\"700\" font-size=\"18\" fill=\"#1d2b38\">θ</text><text x=\"148\" y=\"486\" font-family=\"B612 Mono, monospace\" font-weight=\"700\" font-size=\"15\" fill=\"#1d2b38\" text-anchor=\"middle\">d cos θ</text><text x=\"226\" y=\"300\" font-family=\"B612 Mono, monospace\" font-weight=\"700\" font-size=\"15\" fill=\"#fff\" transform=\"rotate(-90 226 300)\" text-anchor=\"middle\">d sin θ</text><g transform=\"translate(236 236)\"><path d=\"M0 0v96\" stroke=\"#1d2b38\" stroke-width=\"2\"/><rect x=\"-24\" y=\"-8\" width=\"48\" height=\"14\" rx=\"4\" fill=\"#1d2b38\"/><rect x=\"-12\" y=\"-16\" width=\"24\" height=\"10\" rx=\"3\" fill=\"#ff5a1f\"/><rect x=\"-40\" y=\"-20\" width=\"26\" height=\"4\" rx=\"2\" fill=\"#1d2b38\"/><rect x=\"14\" y=\"-20\" width=\"26\" height=\"4\" rx=\"2\" fill=\"#1d2b38\"/></g><rect x=\"40\" y=\"460\" width=\"44\" height=\"8\" fill=\"#ff5a1f\"/><g transform=\"translate(40 30)\"><rect width=\"120\" height=\"40\" rx=\"8\" fill=\"#fff\" stroke=\"#1d2b38\" stroke-width=\"3\"/><text x=\"60\" y=\"27\" text-anchor=\"middle\" font-family=\"B612 Mono, monospace\" font-weight=\"700\" font-size=\"18\" fill=\"#ff5a1f\">✚ RESCUE</text></g></svg>"
  },
  {
    "n": 9,
    "id": "integer-maze",
    "dir": "game-09-integer-maze",
    "title": "Integer Maze",
    "genre": "Maze escape",
    "topic": "Integers · number line · BIDMAS",
    "tags": [
      "number"
    ],
    "desc": "Escape the vault with exactly the right energy E.",
    "art": "<svg viewBox=\"0 0 400 500\" preserveAspectRatio=\"xMidYMid slice\"><defs><linearGradient id=\"hub-im-sky\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#0b0420\"/><stop offset=\".6\" stop-color=\"#4a0e6e\"/><stop offset=\".6\" stop-color=\"#0b0420\"/></linearGradient><linearGradient id=\"hub-im-sun\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffd36b\"/><stop offset=\".55\" stop-color=\"#ff8a3d\"/><stop offset=\"1\" stop-color=\"#ff2fd6\"/></linearGradient><filter id=\"hub-im-glow\"><feGaussianBlur stdDeviation=\"2.5\"/></filter></defs><rect width=\"400\" height=\"500\" fill=\"url(#hub-im-sky)\"/><circle cx=\"0\" cy=\"0\" r=\"1.8\" fill=\"#fff\" opacity=\".7\"/><circle cx=\"89\" cy=\"37\" r=\"1\" fill=\"#fff\" opacity=\".7\"/><circle cx=\"178\" cy=\"74\" r=\"1\" fill=\"#fff\" opacity=\".7\"/><circle cx=\"267\" cy=\"111\" r=\"1\" fill=\"#fff\" opacity=\".7\"/><circle cx=\"356\" cy=\"148\" r=\"1.8\" fill=\"#fff\" opacity=\".7\"/><circle cx=\"45\" cy=\"5\" r=\"1\" fill=\"#fff\" opacity=\".7\"/><circle cx=\"134\" cy=\"42\" r=\"1\" fill=\"#fff\" opacity=\".7\"/><circle cx=\"223\" cy=\"79\" r=\"1\" fill=\"#fff\" opacity=\".7\"/><circle cx=\"312\" cy=\"116\" r=\"1.8\" fill=\"#fff\" opacity=\".7\"/><circle cx=\"1\" cy=\"153\" r=\"1\" fill=\"#fff\" opacity=\".7\"/><circle cx=\"90\" cy=\"10\" r=\"1\" fill=\"#fff\" opacity=\".7\"/><circle cx=\"179\" cy=\"47\" r=\"1\" fill=\"#fff\" opacity=\".7\"/><circle cx=\"268\" cy=\"84\" r=\"1.8\" fill=\"#fff\" opacity=\".7\"/><circle cx=\"357\" cy=\"121\" r=\"1\" fill=\"#fff\" opacity=\".7\"/><circle cx=\"46\" cy=\"158\" r=\"1\" fill=\"#fff\" opacity=\".7\"/><circle cx=\"135\" cy=\"15\" r=\"1\" fill=\"#fff\" opacity=\".7\"/><circle cx=\"224\" cy=\"52\" r=\"1.8\" fill=\"#fff\" opacity=\".7\"/><circle cx=\"313\" cy=\"89\" r=\"1\" fill=\"#fff\" opacity=\".7\"/><circle cx=\"2\" cy=\"126\" r=\"1\" fill=\"#fff\" opacity=\".7\"/><circle cx=\"91\" cy=\"163\" r=\"1\" fill=\"#fff\" opacity=\".7\"/><circle cx=\"180\" cy=\"20\" r=\"1.8\" fill=\"#fff\" opacity=\".7\"/><circle cx=\"269\" cy=\"57\" r=\"1\" fill=\"#fff\" opacity=\".7\"/><circle cx=\"358\" cy=\"94\" r=\"1\" fill=\"#fff\" opacity=\".7\"/><circle cx=\"47\" cy=\"131\" r=\"1\" fill=\"#fff\" opacity=\".7\"/><circle cx=\"136\" cy=\"168\" r=\"1.8\" fill=\"#fff\" opacity=\".7\"/><circle cx=\"225\" cy=\"25\" r=\"1\" fill=\"#fff\" opacity=\".7\"/><circle cx=\"314\" cy=\"62\" r=\"1\" fill=\"#fff\" opacity=\".7\"/><circle cx=\"3\" cy=\"99\" r=\"1\" fill=\"#fff\" opacity=\".7\"/><circle cx=\"92\" cy=\"136\" r=\"1.8\" fill=\"#fff\" opacity=\".7\"/><circle cx=\"181\" cy=\"173\" r=\"1\" fill=\"#fff\" opacity=\".7\"/><circle cx=\"200\" cy=\"230\" r=\"108\" fill=\"url(#hub-im-sun)\"/><rect x=\"80\" y=\"226\" width=\"240\" height=\"2\" fill=\"#0b0420\"/><rect x=\"80\" y=\"240\" width=\"240\" height=\"3.6\" fill=\"#0b0420\"/><rect x=\"80\" y=\"254\" width=\"240\" height=\"5.2\" fill=\"#0b0420\"/><rect x=\"80\" y=\"268\" width=\"240\" height=\"6.800000000000001\" fill=\"#0b0420\"/><rect x=\"80\" y=\"282\" width=\"240\" height=\"8.4\" fill=\"#0b0420\"/><rect x=\"80\" y=\"296\" width=\"240\" height=\"10\" fill=\"#0b0420\"/><rect y=\"298\" width=\"400\" height=\"202\" fill=\"#0b0420\"/><path d=\"M0 302.6H400\" stroke=\"#ff2fd6\" stroke-opacity=\"0.32\" stroke-width=\"2\"/><path d=\"M0 310.4H400\" stroke=\"#ff2fd6\" stroke-opacity=\"0.39\" stroke-width=\"2\"/><path d=\"M0 323.4H400\" stroke=\"#ff2fd6\" stroke-opacity=\"0.46\" stroke-width=\"2\"/><path d=\"M0 341.6H400\" stroke=\"#ff2fd6\" stroke-opacity=\"0.53\" stroke-width=\"2\"/><path d=\"M0 365.0H400\" stroke=\"#ff2fd6\" stroke-opacity=\"0.60\" stroke-width=\"2\"/><path d=\"M0 393.6H400\" stroke=\"#ff2fd6\" stroke-opacity=\"0.67\" stroke-width=\"2\"/><path d=\"M0 427.4H400\" stroke=\"#ff2fd6\" stroke-opacity=\"0.74\" stroke-width=\"2\"/><path d=\"M0 466.4H400\" stroke=\"#ff2fd6\" stroke-opacity=\"0.81\" stroke-width=\"2\"/><path d=\"M0 510.6H400\" stroke=\"#ff2fd6\" stroke-opacity=\"0.88\" stroke-width=\"2\"/><path d=\"M200 300L-500 520\" stroke=\"#00f0ff\" stroke-opacity=\".5\" stroke-width=\"1.5\"/><path d=\"M200 300L-430 520\" stroke=\"#00f0ff\" stroke-opacity=\".5\" stroke-width=\"1.5\"/><path d=\"M200 300L-360 520\" stroke=\"#00f0ff\" stroke-opacity=\".5\" stroke-width=\"1.5\"/><path d=\"M200 300L-290 520\" stroke=\"#00f0ff\" stroke-opacity=\".5\" stroke-width=\"1.5\"/><path d=\"M200 300L-220 520\" stroke=\"#00f0ff\" stroke-opacity=\".5\" stroke-width=\"1.5\"/><path d=\"M200 300L-150 520\" stroke=\"#00f0ff\" stroke-opacity=\".5\" stroke-width=\"1.5\"/><path d=\"M200 300L-80 520\" stroke=\"#00f0ff\" stroke-opacity=\".5\" stroke-width=\"1.5\"/><path d=\"M200 300L-10 520\" stroke=\"#00f0ff\" stroke-opacity=\".5\" stroke-width=\"1.5\"/><path d=\"M200 300L60 520\" stroke=\"#00f0ff\" stroke-opacity=\".5\" stroke-width=\"1.5\"/><path d=\"M200 300L130 520\" stroke=\"#00f0ff\" stroke-opacity=\".5\" stroke-width=\"1.5\"/><path d=\"M200 300L200 520\" stroke=\"#00f0ff\" stroke-opacity=\".5\" stroke-width=\"1.5\"/><path d=\"M200 300L270 520\" stroke=\"#00f0ff\" stroke-opacity=\".5\" stroke-width=\"1.5\"/><path d=\"M200 300L340 520\" stroke=\"#00f0ff\" stroke-opacity=\".5\" stroke-width=\"1.5\"/><path d=\"M200 300L410 520\" stroke=\"#00f0ff\" stroke-opacity=\".5\" stroke-width=\"1.5\"/><path d=\"M200 300L480 520\" stroke=\"#00f0ff\" stroke-opacity=\".5\" stroke-width=\"1.5\"/><path d=\"M200 300L550 520\" stroke=\"#00f0ff\" stroke-opacity=\".5\" stroke-width=\"1.5\"/><path d=\"M200 300L620 520\" stroke=\"#00f0ff\" stroke-opacity=\".5\" stroke-width=\"1.5\"/><path d=\"M200 300L690 520\" stroke=\"#00f0ff\" stroke-opacity=\".5\" stroke-width=\"1.5\"/><path d=\"M200 300L760 520\" stroke=\"#00f0ff\" stroke-opacity=\".5\" stroke-width=\"1.5\"/><path d=\"M200 300L830 520\" stroke=\"#00f0ff\" stroke-opacity=\".5\" stroke-width=\"1.5\"/><path d=\"M200 300L900 520\" stroke=\"#00f0ff\" stroke-opacity=\".5\" stroke-width=\"1.5\"/><path d=\"M40 418H360\" stroke=\"#00f0ff\" stroke-width=\"4\" filter=\"url(#hub-im-glow)\"/><path d=\"M40 418H360\" stroke=\"#fff\" stroke-width=\"2\"/><path d=\"M50 406v24\" stroke=\"#fff\" stroke-width=\"2\"/><text x=\"50\" y=\"450\" text-anchor=\"middle\" font-family=\"Oxanium, monospace\" font-weight=\"700\" font-size=\"16\" fill=\"#fff\">−5</text><path d=\"M80 412v12\" stroke=\"#fff\" stroke-width=\"2\"/><path d=\"M110 412v12\" stroke=\"#fff\" stroke-width=\"2\"/><path d=\"M140 412v12\" stroke=\"#fff\" stroke-width=\"2\"/><path d=\"M170 412v12\" stroke=\"#fff\" stroke-width=\"2\"/><path d=\"M200 406v24\" stroke=\"#fff\" stroke-width=\"2\"/><text x=\"200\" y=\"450\" text-anchor=\"middle\" font-family=\"Oxanium, monospace\" font-weight=\"700\" font-size=\"16\" fill=\"#fff\">0</text><path d=\"M230 412v12\" stroke=\"#fff\" stroke-width=\"2\"/><path d=\"M260 412v12\" stroke=\"#fff\" stroke-width=\"2\"/><path d=\"M290 412v12\" stroke=\"#fff\" stroke-width=\"2\"/><path d=\"M320 412v12\" stroke=\"#fff\" stroke-width=\"2\"/><path d=\"M350 406v24\" stroke=\"#fff\" stroke-width=\"2\"/><text x=\"350\" y=\"450\" text-anchor=\"middle\" font-family=\"Oxanium, monospace\" font-weight=\"700\" font-size=\"16\" fill=\"#fff\">5</text><circle cx=\"110\" cy=\"418\" r=\"13\" fill=\"#ff2fd6\" filter=\"url(#hub-im-glow)\"/><circle cx=\"110\" cy=\"418\" r=\"9\" fill=\"#fff\"/><g transform=\"translate(84 96)\"><circle r=\"30\" fill=\"#ff2fd6\" fill-opacity=\".18\" stroke=\"#ff2fd6\" stroke-width=\"3\" filter=\"url(#hub-im-glow)\"/><text y=\"7\" text-anchor=\"middle\" font-family=\"Oxanium, monospace\" font-weight=\"700\" font-size=\"19\" fill=\"#fff\">+(−5)</text></g><g transform=\"translate(316 120)\"><circle r=\"30\" fill=\"#00f0ff\" fill-opacity=\".18\" stroke=\"#00f0ff\" stroke-width=\"3\" filter=\"url(#hub-im-glow)\"/><text y=\"7\" text-anchor=\"middle\" font-family=\"Oxanium, monospace\" font-weight=\"700\" font-size=\"19\" fill=\"#fff\">−(−3)</text></g><g transform=\"translate(200 476)\"><rect x=\"-58\" y=\"-18\" width=\"116\" height=\"30\" rx=\"6\" fill=\"#0b0420\" stroke=\"#ff2fd6\" stroke-width=\"2\"/><text y=\"4\" text-anchor=\"middle\" font-family=\"Audiowide, sans-serif\" font-size=\"17\" fill=\"#fff\">E = −3</text></g></svg>"
  },
  {
    "n": 10,
    "id": "finance-tycoon",
    "dir": "game-10-finance-tycoon",
    "title": "Finance Tycoon",
    "genre": "Business sim",
    "topic": "Percentages · profit · interest",
    "tags": [
      "number"
    ],
    "desc": "Grow a lemonade stand into a high-street shop.",
    "art": "<svg viewBox=\"0 0 400 500\" preserveAspectRatio=\"xMidYMid slice\"><rect width=\"400\" height=\"500\" fill=\"#fff1e5\"/><g fill=\"#1a1817\" opacity=\".05\"><circle cx=\"0\" cy=\"0\" r=\"1\"/><circle cx=\"83\" cy=\"47\" r=\"1\"/><circle cx=\"166\" cy=\"94\" r=\"1\"/><circle cx=\"249\" cy=\"141\" r=\"1\"/><circle cx=\"332\" cy=\"188\" r=\"1\"/><circle cx=\"15\" cy=\"235\" r=\"1\"/><circle cx=\"98\" cy=\"282\" r=\"1\"/><circle cx=\"181\" cy=\"329\" r=\"1\"/><circle cx=\"264\" cy=\"376\" r=\"1\"/><circle cx=\"347\" cy=\"423\" r=\"1\"/><circle cx=\"30\" cy=\"470\" r=\"1\"/><circle cx=\"113\" cy=\"17\" r=\"1\"/><circle cx=\"196\" cy=\"64\" r=\"1\"/><circle cx=\"279\" cy=\"111\" r=\"1\"/><circle cx=\"362\" cy=\"158\" r=\"1\"/><circle cx=\"45\" cy=\"205\" r=\"1\"/><circle cx=\"128\" cy=\"252\" r=\"1\"/><circle cx=\"211\" cy=\"299\" r=\"1\"/><circle cx=\"294\" cy=\"346\" r=\"1\"/><circle cx=\"377\" cy=\"393\" r=\"1\"/><circle cx=\"60\" cy=\"440\" r=\"1\"/><circle cx=\"143\" cy=\"487\" r=\"1\"/><circle cx=\"226\" cy=\"34\" r=\"1\"/><circle cx=\"309\" cy=\"81\" r=\"1\"/><circle cx=\"392\" cy=\"128\" r=\"1\"/><circle cx=\"75\" cy=\"175\" r=\"1\"/><circle cx=\"158\" cy=\"222\" r=\"1\"/><circle cx=\"241\" cy=\"269\" r=\"1\"/><circle cx=\"324\" cy=\"316\" r=\"1\"/><circle cx=\"7\" cy=\"363\" r=\"1\"/><circle cx=\"90\" cy=\"410\" r=\"1\"/><circle cx=\"173\" cy=\"457\" r=\"1\"/><circle cx=\"256\" cy=\"4\" r=\"1\"/><circle cx=\"339\" cy=\"51\" r=\"1\"/><circle cx=\"22\" cy=\"98\" r=\"1\"/><circle cx=\"105\" cy=\"145\" r=\"1\"/><circle cx=\"188\" cy=\"192\" r=\"1\"/><circle cx=\"271\" cy=\"239\" r=\"1\"/><circle cx=\"354\" cy=\"286\" r=\"1\"/><circle cx=\"37\" cy=\"333\" r=\"1\"/><circle cx=\"120\" cy=\"380\" r=\"1\"/><circle cx=\"203\" cy=\"427\" r=\"1\"/><circle cx=\"286\" cy=\"474\" r=\"1\"/><circle cx=\"369\" cy=\"21\" r=\"1\"/><circle cx=\"52\" cy=\"68\" r=\"1\"/><circle cx=\"135\" cy=\"115\" r=\"1\"/><circle cx=\"218\" cy=\"162\" r=\"1\"/><circle cx=\"301\" cy=\"209\" r=\"1\"/><circle cx=\"384\" cy=\"256\" r=\"1\"/><circle cx=\"67\" cy=\"303\" r=\"1\"/></g><text x=\"200\" y=\"64\" text-anchor=\"middle\" font-family=\"Fraunces, Georgia, serif\" font-weight=\"900\" font-size=\"34\" font-style=\"italic\" fill=\"#1a1817\">The Daily Ledger</text><path d=\"M28 80H372M28 86H372\" stroke=\"#1a1817\" stroke-width=\"2\"/><text x=\"200\" y=\"104\" text-anchor=\"middle\" font-family=\"IBM Plex Sans Condensed, sans-serif\" font-size=\"12\" fill=\"#6c5a4c\" letter-spacing=\"2\">DAY 12 · MARKETS · £ PROFIT &amp; LOSS</text><text x=\"200\" y=\"152\" text-anchor=\"middle\" font-family=\"Fraunces, Georgia, serif\" font-weight=\"900\" font-size=\"38\" fill=\"#1a1817\">LEMONADE</text><text x=\"200\" y=\"192\" text-anchor=\"middle\" font-family=\"Fraunces, Georgia, serif\" font-weight=\"900\" font-size=\"38\" fill=\"#1f6b45\">STAND SOARS!</text><rect x=\"40\" y=\"208\" width=\"320\" height=\"120\" fill=\"#fffaf4\" stroke=\"#1a1817\" stroke-width=\"2\"/><g stroke=\"#ecdccd\"><path d=\"M40 230H360\"/><path d=\"M40 260H360\"/><path d=\"M40 290H360\"/></g><polyline points=\"52,312 92,298 132,302 172,274 212,278 252,250 292,254 330,226 346,214\" fill=\"none\" stroke=\"#1f6b45\" stroke-width=\"5\" stroke-linejoin=\"round\"/><path d=\"M336 216l18 -8l-6 18Z\" fill=\"#1f6b45\"/><text x=\"56\" y=\"232\" font-family=\"IBM Plex Mono, monospace\" font-weight=\"700\" font-size=\"14\" fill=\"#1f6b45\">▲ +38.2%</text><path d=\"M40 344H360\" stroke=\"#1a1817\" stroke-width=\"2\"/><rect x=\"40\" y=\"372\" width=\"140\" height=\"5\" fill=\"#1a1817\" opacity=\".22\"/><rect x=\"40\" y=\"384\" width=\"140\" height=\"5\" fill=\"#1a1817\" opacity=\".22\"/><rect x=\"40\" y=\"396\" width=\"140\" height=\"5\" fill=\"#1a1817\" opacity=\".22\"/><rect x=\"40\" y=\"408\" width=\"70\" height=\"5\" fill=\"#1a1817\" opacity=\".22\"/><rect x=\"40\" y=\"420\" width=\"140\" height=\"5\" fill=\"#1a1817\" opacity=\".22\"/><rect x=\"40\" y=\"432\" width=\"140\" height=\"5\" fill=\"#1a1817\" opacity=\".22\"/><rect x=\"40\" y=\"444\" width=\"140\" height=\"5\" fill=\"#1a1817\" opacity=\".22\"/><rect x=\"40\" y=\"456\" width=\"70\" height=\"5\" fill=\"#1a1817\" opacity=\".22\"/><rect x=\"40\" y=\"468\" width=\"140\" height=\"5\" fill=\"#1a1817\" opacity=\".22\"/><path d=\"M200 352V480\" stroke=\"#1a1817\"/><path d=\"M226 380h17v18q-8.5 8 -17 0Z\" fill=\"#1f6b45\" stroke=\"#1a1817\" stroke-width=\"2\"/><path d=\"M243 380h17v18q-8.5 8 -17 0Z\" fill=\"#fff\" stroke=\"#1a1817\" stroke-width=\"2\"/><path d=\"M260 380h17v18q-8.5 8 -17 0Z\" fill=\"#1f6b45\" stroke=\"#1a1817\" stroke-width=\"2\"/><path d=\"M277 380h17v18q-8.5 8 -17 0Z\" fill=\"#fff\" stroke=\"#1a1817\" stroke-width=\"2\"/><path d=\"M294 380h17v18q-8.5 8 -17 0Z\" fill=\"#1f6b45\" stroke=\"#1a1817\" stroke-width=\"2\"/><path d=\"M311 380h17v18q-8.5 8 -17 0Z\" fill=\"#fff\" stroke=\"#1a1817\" stroke-width=\"2\"/><path d=\"M328 380h17v18q-8.5 8 -17 0Z\" fill=\"#1f6b45\" stroke=\"#1a1817\" stroke-width=\"2\"/><path d=\"M345 380h17v18q-8.5 8 -17 0Z\" fill=\"#fff\" stroke=\"#1a1817\" stroke-width=\"2\"/><rect x=\"232\" y=\"398\" width=\"124\" height=\"60\" fill=\"#f6c46a\" stroke=\"#1a1817\" stroke-width=\"2\"/><rect x=\"228\" y=\"440\" width=\"132\" height=\"10\" fill=\"#8a5a33\" stroke=\"#1a1817\" stroke-width=\"2\"/><text x=\"294\" y=\"430\" text-anchor=\"middle\" font-family=\"Fraunces, Georgia, serif\" font-weight=\"900\" font-size=\"16\" fill=\"#1a1817\">LEMONADE</text><g transform=\"translate(300 470) rotate(-8)\"><rect x=\"-46\" y=\"-14\" width=\"92\" height=\"28\" fill=\"#b8322a\"/><text y=\"6\" text-anchor=\"middle\" font-family=\"IBM Plex Mono, monospace\" font-weight=\"700\" font-size=\"15\" fill=\"#fff\">£1.50 −20%</text></g></svg>"
  }
];

  /** Safe read of saved progress (storage may be unavailable). */
  const load = (key, fallback) => {
    try { const v = localStorage.getItem('mathgames:' + key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
  };

  const grid = document.getElementById('grid');
  let totalStars = 0, played = 0;
  for (const g of GAMES) {
    const best = load(g.id + ':best', 0);
    const stars = load(g.id + ':stars', 0);
    totalStars += stars;
    if (best) played++;
    const li = document.createElement('li');
    li.className = 'card t' + String(g.n).padStart(2, '0');
    li.dataset.tags = g.tags.join(' ');

    li.innerHTML = `
      <a class="card__link" href="${g.dir}/index.html" aria-label="Play ${g.title}">
        <div class="card__art" aria-hidden="true">${g.art.replace('<svg ', '<svg class="card__svg" ')}<span class="card__num">${String(g.n).padStart(2, '0')}</span></div>
        <div class="card__body">
          <p class="card__genre">${g.genre}</p>
          <h2 class="card__title">${g.title}</h2>
          <p class="card__desc">${g.desc}</p>
          <p class="card__topic">${g.topic}</p>
          <div class="card__foot">
            <span class="card__best">${best ? `Best ${best} · <span class="card__stars" aria-label="${stars} of 3 stars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>` : 'Not played yet'}</span>
            <span class="play">▶ Play</span>
          </div>
        </div>
      </a>`;
    grid.appendChild(li);
  }
  document.getElementById('summary').innerHTML =
    `<span class="pill">🎮 10 games</span><span class="pill">⭐ ${totalStars} / 30 stars</span><span class="pill">✅ ${played} played</span>`;

  // Observe cards once as they enter view; the grid still works without motion.
  ArcadeMotion.ready(() => {
    ArcadeMotion.observe(grid.querySelectorAll('.card'));
    ArcadeMotion.reveal(document.querySelectorAll('.hero__kicker, .hero h1, .hero__lead, .hero__stats, .filters'), 55);
  });

  // Topic filter
  const chips = document.querySelectorAll('.chip');
  chips.forEach((c) => c.addEventListener('click', () => {
    chips.forEach((x) => { x.classList.toggle('is-on', x === c); x.setAttribute('aria-pressed', String(x === c)); });
    const f = c.dataset.filter;
    ArcadeMotion.layout(grid, () => {
      grid.querySelectorAll('.card').forEach((card) => { card.hidden = f !== 'all' && !card.dataset.tags.split(' ').includes(f); });
    });
  }));
})();
