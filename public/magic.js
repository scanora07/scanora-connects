// Background butterflies: a few of them wander from corner to corner the way real ones do.
// They flap in bursts and glide in between, turn gently with a bit of wobble, bob up and down
// with each wing beat, and steer around the content (they fade out if they ever pass behind it).
(() => {
  "use strict";

  const canvas = document.getElementById("magic");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let w = 0, h = 0, dpr = 1;
  let flies = [];
  let last = 0, raf = 0;

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b)); // shortest turn from b to a

  const palettes = [
    { fore: "#ff7fa8", hind: "#ffb8cf", edge: "#b8286a", dot: "#fff0f5" }, // rose
    { fore: "#ffae55", hind: "#ffd9a0", edge: "#a85a16", dot: "#fff6e6" }, // amber
    { fore: "#b497ff", hind: "#d9ccff", edge: "#5f3fbd", dot: "#f6f1ff" }, // lilac
    { fore: "#ff9686", hind: "#ffcdc1", edge: "#b8453a", dot: "#fff2ee" }, // coral
  ];

  // ---- The content to steer around ----
  // The real footprint of what is on screen (heart, wish, name, button, form card or letter),
  // not the full-width block around it, so butterflies can use every gap beside and between.
  let rects = [];
  const SAFE_PAD = 6;
  const FADE = 30;
  const AVOID = 80;

  function textBox(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect();
  }

  function measureSafe() {
    const view = document.querySelector("#app .view.active");
    const next = [];
    const add = (r) => {
      if (r && r.width > 4 && r.height > 4) {
        next.push({ l: r.left - SAFE_PAD, r: r.right + SAFE_PAD, t: r.top - SAFE_PAD, b: r.bottom + SAFE_PAD });
      }
    };
    if (view && view.id === "view-heart") {
      add(view.querySelector("#heart").getBoundingClientRect());
      add(textBox(view.querySelector("#wish-text")));
      add(textBox(view.querySelector("#wish-name")));
      add(view.querySelector("#open-btn").getBoundingClientRect());
    } else if (view && view.id !== "view-loading") {
      add(view.firstElementChild && view.firstElementChild.getBoundingClientRect());
    }
    // Pieces of content that sit close together (heart, wish, name and button are stacked with
    // small gaps) form one block, so butterflies never get trapped in the narrow gaps between them.
    const GAP = 56;
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < next.length && !merged; i++) {
        for (let j = i + 1; j < next.length; j++) {
          const a = next[i], b = next[j];
          if (a.l - GAP < b.r && b.l - GAP < a.r && a.t - GAP < b.b && b.t - GAP < a.b) {
            next[i] = { l: Math.min(a.l, b.l), r: Math.max(a.r, b.r), t: Math.min(a.t, b.t), b: Math.max(a.b, b.b) };
            next.splice(j, 1);
            merged = true;
            break;
          }
        }
      }
    }
    rects = next;
  }

  // Distance from a point to the nearest piece of content (0 when inside one)
  function distToSafe(x, y) {
    let best = Infinity;
    for (const s of rects) {
      const d = Math.hypot(Math.max(s.l - x, 0, x - s.r), Math.max(s.t - y, 0, y - s.b));
      if (d < best) best = d;
    }
    return best;
  }

  // Push away from every piece of content at once. Returns a vector that grows as the butterfly
  // gets closer and is strongest when it is inside one.
  function repulsion(x, y) {
    let rx = 0, ry = 0;
    for (const s of rects) {
      const cx = clamp(x, s.l, s.r), cy = clamp(y, s.t, s.b); // nearest point on this box
      let dx = x - cx, dy = y - cy;
      let d = Math.hypot(dx, dy);
      let strength;
      if (d === 0) {
        // Inside: leave by the nearest edge
        const left = x - s.l, right = s.r - x, top = y - s.t, bottom = s.b - y;
        const m = Math.min(left, right, top, bottom);
        dx = m === left ? -1 : m === right ? 1 : 0;
        dy = m === top ? -1 : m === bottom ? 1 : 0;
        d = 1;
        strength = 3;
      } else {
        strength = Math.pow(clamp(1 - d / AVOID, 0, 1), 1.5) * 2.2;
        dx /= d; dy /= d;
      }
      rx += dx * strength;
      ry += dy * strength;
    }
    return [rx, ry];
  }

  // Pick the roomiest spot in the free space (the best of many random tries)
  function freePoint() {
    let bx = w / 2, by = h - 30, bd = -1;
    for (let i = 0; i < 160; i++) {
      const x = rand(16, w - 16);
      const y = rand(16, h - 16);
      const d = distToSafe(x, y);
      if (d > bd) { bd = d; bx = x; by = y; }
      if (d > 60) break;
    }
    return [bx, by];
  }

  // ---- Flight ----
  // Targets are the four corners plus the middle of each screen edge, but only the ones that are
  // actually free right now, so butterflies travel between open pockets, not through the text.
  function cornerTarget(avoid) {
    const m = clamp(Math.min(w, h) * 0.08, 24, 60);
    const spots = [
      [m, m], [w - m, m], [m, h - m], [w - m, h - m],
      [w / 2, m], [w / 2, h - m], [m, h / 2], [w - m, h / 2],
    ];
    const free = [];
    spots.forEach((s, i) => { if (i !== avoid && distToSafe(s[0], s[1]) > 12) free.push(i); });
    const i = free.length ? free[(Math.random() * free.length) | 0] : (avoid + 1) % 4;
    return { i, x: spots[i][0] + rand(-m * 0.4, m * 0.4), y: spots[i][1] + rand(-m * 0.4, m * 0.4) };
  }

  // size is the wing length in px (the wingspan is about three times this).
  // Each butterfly starts somewhere in the free space, already flying, so the screen is
  // alive from the very first moment instead of filling up over time.
  function makeButterfly(size) {
    const target = cornerTarget(-1);
    const [x, y] = freePoint();
    const k = clamp((size - 4.5) / 8.5, 0, 1); // 0 = smallest, 1 = largest
    return {
      x,
      y,
      ang: Math.atan2(target.y - y, target.x - x),
      speed: rand(52, 78),
      size,
      rate: 20 - size * 0.9, // small wings beat faster than big ones
      depth: 0.72 + 0.28 * k, // small ones look farther away, so slightly fainter
      born: 0, // fades in over the first moments
      blocked: 0,
      pal: pick(palettes),
      target,
      phase: rand(0, Math.PI * 2),
      flapping: true,
      modeT: rand(0.8, 2.4),
      wob: rand(0, 100),
      open: 1,
    };
  }

  function step(p, dt, t) {
    // Flap for a while, then glide with wings held open
    p.modeT -= dt;
    if (p.modeT <= 0) {
      p.flapping = !p.flapping;
      p.modeT = p.flapping ? rand(1.2, 2.8) : rand(0.35, 0.8);
    }
    if (p.flapping) p.phase += p.rate * dt;
    const openTarget = p.flapping ? 0.1 + 0.9 * Math.abs(Math.cos(p.phase)) : 0.82;
    p.open += (openTarget - p.open) * Math.min(1, dt * 30);

    // Head for the target corner, wandering a little; pick a new corner on arrival
    if (Math.hypot(p.target.x - p.x, p.target.y - p.y) < 60) p.target = cornerTarget(p.target.i);
    let desired = Math.atan2(p.target.y - p.y, p.target.x - p.x);
    desired += Math.sin(t * 0.9 + p.wob) * 0.7 + Math.sin(t * 2.3 + p.wob * 1.7) * 0.35;

    // Blend the wish to go to the target with the push away from content. The push also gets a
    // sideways part, so a butterfly slides along an edge instead of pressing flat against it.
    let urgency = 0;
    if (rects.length) {
      const [rx, ry] = repulsion(p.x, p.y);
      const push = Math.hypot(rx, ry);
      if (push > 0.001) {
        urgency = clamp(push, 0, 1);
        const hx = Math.cos(desired), hy = Math.sin(desired);
        let sx = -ry, sy = rx; // push rotated by 90 degrees
        if (sx * hx + sy * hy < 0) { sx = -sx; sy = -sy; }
        desired = Math.atan2(hy + ry * 1.6 + sy * 1.1, hx + rx * 1.6 + sx * 1.1);
      }
    }

    // Stuck behind content for too long: choose somewhere else to go
    p.blocked = urgency > 0.35 ? p.blocked + dt : Math.max(0, p.blocked - dt);
    if (p.blocked > 1.2) {
      p.target = cornerTarget(p.target.i);
      p.blocked = 0;
    }

    // Turn gradually, never snap; turn a little quicker when content is close
    const turn = (2.4 + 3.2 * urgency) * dt;
    p.ang += clamp(angDiff(desired, p.ang), -turn, turn);

    // Speed surges with each beat and slows while gliding
    const v = p.speed * (p.flapping ? 0.85 + 0.3 * Math.abs(Math.sin(p.phase)) : 0.7);
    p.x += Math.cos(p.ang) * v * dt;
    p.y += Math.sin(p.ang) * v * dt;
    // They may swing a little past the screen edge and come back, like real ones do
    p.x = clamp(p.x, -40, w + 40);
    p.y = clamp(p.y, -40, h + 40);
  }

  // ---- Drawing ----
  function drawButterfly(p, t) {
    const d = distToSafe(p.x, p.y);
    const alpha = 0.92 * p.depth * p.born * (0.12 + 0.88 * clamp(d / FADE, 0, 1));
    if (alpha <= 0.03) return;

    const s = p.size;
    const bob = p.flapping ? Math.sin(p.phase * 2) * s * 0.35 : Math.sin(t * 2 + p.wob) * s * 0.12;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(p.x, p.y + bob);
    ctx.rotate(p.ang + Math.PI / 2);

    for (const side of [-1, 1]) {
      ctx.save();
      ctx.scale(side * p.open, 1);

      // Forewing
      ctx.fillStyle = p.pal.fore;
      ctx.strokeStyle = p.pal.edge;
      ctx.lineWidth = Math.max(0.8, s * 0.1);
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.15);
      ctx.bezierCurveTo(s * 0.9, -s * 1.5, s * 1.9, -s * 0.9, s * 1.35, s * 0.15);
      ctx.bezierCurveTo(s * 0.95, s * 0.3, s * 0.35, s * 0.25, 0, 0);
      ctx.fill();
      ctx.stroke();

      // Hindwing
      ctx.fillStyle = p.pal.hind;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(s * 1, s * 0.05, s * 1.35, s * 1.05, s * 0.8, s * 1.3);
      ctx.bezierCurveTo(s * 0.35, s * 1.45, s * 0.02, s * 0.75, 0, 0);
      ctx.fill();
      ctx.stroke();

      // Wing spots
      ctx.fillStyle = p.pal.dot;
      ctx.beginPath();
      ctx.arc(s * 1.0, -s * 0.5, s * 0.17, 0, Math.PI * 2);
      ctx.arc(s * 0.72, s * 0.78, s * 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Body and antennae
    ctx.strokeStyle = "rgba(70,30,50,.9)";
    ctx.fillStyle = "rgba(70,30,50,.9)";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.ellipse(0, s * 0.25, s * 0.13, s * 0.82, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = Math.max(0.7, s * 0.07);
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.5);
    ctx.quadraticCurveTo(-s * 0.2, -s * 1.1, -s * 0.5, -s * 1.3);
    ctx.moveTo(0, -s * 0.5);
    ctx.quadraticCurveTo(s * 0.2, -s * 1.1, s * 0.5, -s * 1.3);
    ctx.stroke();
    ctx.restore();
  }

  function draw(t) {
    ctx.clearRect(0, 0, w, h);
    for (const p of flies) drawButterfly(p, t);
  }

  function seed() {
    // Spread the sizes evenly from tiny to large so the group clearly differs, then shuffle
    const n = w < 500 ? 8 : 10;
    const sizes = Array.from({ length: n }, (_, i) => 4.5 + (8.5 * i) / (n - 1) + rand(-0.3, 0.3));
    for (let i = sizes.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [sizes[i], sizes[j]] = [sizes[j], sizes[i]];
    }
    flies = sizes.map(makeButterfly);
    if (reduceMotion) { for (const p of flies) p.born = 1; draw(0); }
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    measureSafe();
    seed();
  }

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    for (const p of flies) {
      if (p.born < 1) p.born = Math.min(1, p.born + dt / 0.35);
      step(p, dt, now / 1000);
    }
    draw(now / 1000);
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (reduceMotion || raf) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));

  // The visible content changes between screens, so keep re-measuring it. The first time a real
  // screen (not the loading one) appears, scatter the butterflies into its free space so they are
  // all there from the first moment, with nothing arriving late.
  let placed = false;
  function place() {
    measureSafe();
    if (!placed && rects.length) {
      placed = true;
      seed();
    }
  }
  new MutationObserver(place).observe(document.getElementById("app"), { attributes: true, subtree: true, attributeFilter: ["class"] });
  setInterval(measureSafe, 250);

  resize();
  place();
  start();
})();
