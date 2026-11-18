// Live wireframe "blueprint" scenes for the Rehearse site (Three.js, rendered in the browser).
//  #hero3d  : a live market — candles tick in, the strategy trades them, equity line + trade markers
//  #stack3d : plain words → rules → prices, layers spread apart as you scroll
//  #gate3d  : strategies walk up to the gate; most fail and drop, a few pass
// Each scene only renders while it is on screen.
import * as THREE from "https://unpkg.com/three@0.160.0/build/three.module.js";

const WHITE = 0xffffff, LIME = 0xc8ff2e, RED = 0xff4d5e;
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const lineMat = (color = WHITE, opacity = 0.9) => new THREE.LineBasicMaterial({ color, transparent: true, opacity });
const blackMat = new THREE.MeshBasicMaterial({ color: 0x000000, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
const UNIT = new THREE.BoxGeometry(1, 1, 1), UNIT_EDGES = new THREE.EdgesGeometry(UNIT);

// a wire box: black solid (hides lines behind it) + edges
function wbox(mat = lineMat()) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(UNIT, blackMat)); const e = new THREE.LineSegments(UNIT_EDGES, mat); g.add(e); g.userData.edges = e;
  return g;
}
function grid(size, divs, opacity = 0.22) {
  const g = new THREE.GridHelper(size, divs, WHITE, WHITE); g.material.transparent = true; g.material.opacity = opacity; return g;
}
function ring(r, color = WHITE, opacity = 0.8, seg = 128) {
  const pts = []; for (let i = 0; i <= seg; i++) { const a = (i / seg) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat(color, opacity));
}
function textTexture(w, h, draw) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d");
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return { canvas: c, ctx: x, tex: t, redraw: (...a) => { x.clearRect(0, 0, w, h); draw(x, ...a); t.needsUpdate = true; } };
}

// renderer bound to a container; runs `tick(t, dt)` only while visible
function stage(el, setup) {
  if (!el) return;
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  r.setPixelRatio(Math.min(devicePixelRatio, 2)); r.setClearColor(0x000000, 0);
  el.appendChild(r.domElement);
  const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x000000, 14, 40);
  const ctx = { el, renderer: r, scene, mouse: { x: 0, y: 0 } };
  const api = setup(ctx);
  const size = () => { const w = el.clientWidth, h = el.clientHeight; r.setSize(w, h, false); api.resize(w, h); };
  new ResizeObserver(size).observe(el); size();
  // no mouse interaction: the scenes animate on their own (ctx.mouse stays 0)
  let on = false, last = performance.now(), t = 0;
  new IntersectionObserver(([e]) => { on = e.isIntersecting; if (on) { last = performance.now(); requestAnimationFrame(loop); } }, { threshold: 0.01 }).observe(el);
  function loop(now) {
    if (!on) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += reduce ? 0 : dt;
    api.tick(t, dt); r.render(scene, api.camera);
    if (!reduce) requestAnimationFrame(loop);
  }
}

/* ───────────────────────── HERO: a live market ───────────────────────── */
stage(document.getElementById("hero3d"), ({ scene, mouse, el }) => {
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  const world = new THREE.Group(); scene.add(world);

  const N = 30, GAP = 0.34, STEP = 0.6; // candles, spacing, seconds per new candle
  const chart = new THREE.Group(); chart.position.set(0, 0.3, 0); world.add(chart);
  const up = lineMat(WHITE, 1), down = lineMat(WHITE, 0.5), held = lineMat(LIME, 1), wickMat = lineMat(WHITE, 0.45);
  const candles = [];
  for (let i = 0; i < N; i++) {
    const body = wbox(up); body.scale.set(0.24, 1, 0.24); chart.add(body);
    const wg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -0.5, 0), new THREE.Vector3(0, 0.5, 0)]);
    const wick = new THREE.Line(wg, wickMat); chart.add(wick);
    candles.push({ body, wick });
  }
  // price series (random walk with drift + occasional dips, so the strategy has something to trade)
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
  const series = []; let price = 100, id = 0;
  const next = () => { const o = price; const shock = rnd() < 0.08 ? -0.035 : 0; price *= Math.exp(0.0025 + 0.016 * gauss() + shock); const c = price; series.push({ id: id++, o, c, h: Math.max(o, c) * (1 + rnd() * 0.01), l: Math.min(o, c) * (1 - rnd() * 0.01) }); };
  for (let i = 0; i < N + 1; i++) next();
  const WARM = 160;

  // the strategy: buy after a 4% drop over 3 candles, exit at +6%, -4% or after 8 candles
  const trades = []; let pos = null, equity = 1, eqSeries = [];
  const runStrategy = (k) => {
    const s = series, i = s.length - 1, c = s[i].c;
    if (pos) {
      const r = c / pos.px - 1;
      if (r >= 0.06 || r <= -0.04 || s[i].id - pos.id >= 8) { equity *= 1 + r * 0.5; trades.push({ in: pos.id, out: s[i].id, inPx: pos.px, outPx: c, win: r > 0, born: k }); pos = null; }
    } else if (i >= 3 && c <= s[i - 3].c * 0.96) pos = { id: s[i].id, px: c, born: k };
    eqSeries.push({ id: s[i].id, v: equity * (pos ? c / pos.px * 0.5 + 0.5 : 1) });
    if (eqSeries.length > N + 2) eqSeries.shift();
  };
  for (let i = 0; i < N; i++) runStrategy(-9);
  for (let i = 0; i < WARM; i++) { next(); series.shift(); runStrategy(-9); } // history already has trades on screen

  // equity line (lime) behind the candles
  const eqGeo = new THREE.BufferGeometry(); eqGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array((N + 2) * 3), 3));
  const eqLine = new THREE.Line(eqGeo, new THREE.LineBasicMaterial({ color: LIME, transparent: true, opacity: 0.95 }));
  eqLine.position.z = -1.4; // equity is shown in the HUD instead
  const eqGlow = new THREE.Line(eqGeo, new THREE.LineBasicMaterial({ color: LIME, transparent: true, opacity: 0.25 })); eqGlow.position.z = -1.42;

  // trade markers: rings at entry (lime) / exit (white), dotted link
  const markerPool = [];
  const marker = () => {
    const g = new THREE.Group();
    const r1 = ring(0.22, LIME, 1, 40); r1.rotation.x = Math.PI / 2; g.add(r1);
    const r2 = ring(0.22, WHITE, 0.9, 40); r2.rotation.x = Math.PI / 2; g.add(r2);
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]);
    const link = new THREE.Line(lg, new THREE.LineDashedMaterial({ color: WHITE, dashSize: 0.08, gapSize: 0.07, transparent: true, opacity: 0.8 }));
    g.add(link); g.userData = { r1, r2, link }; chart.add(g); return g;
  };
  for (let i = 0; i < 8; i++) markerPool.push(marker());
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), new THREE.MeshBasicMaterial({ color: LIME })); chart.add(dot);

  // HUD
  const hud = document.createElement("div"); hud.className = "hud"; el.appendChild(hud);

  let clock = 0, lo = 80, hi = 140, eLo = 0.9, eHi = 1.2, dist = 13;
  const X = (k, frac) => (k - (N - 1) / 2 - frac) * GAP;
  return {
    camera,
    resize(w, h) {
      camera.aspect = w / h; camera.updateProjectionMatrix();
      // keep the whole chart (≈11 units wide) in frame at any width
      const hf = 2 * Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect);
      dist = Math.max(9.5, 6.0 / Math.tan(hf / 2));
    },
    tick(t, dt) {
      clock += dt;
      while (clock >= STEP) { clock -= STEP; next(); series.shift(); runStrategy(t); }
      const frac = clock / STEP, live = series.at(-1);
      live.c = live.c * (1 + 0.0009 * Math.sin(t * 9) * (1 - frac)); // the live candle breathes
      // smooth vertical scale
      const vis = series.slice(-N); const mn = Math.min(...vis.map((s) => s.l)), mx = Math.max(...vis.map((s) => s.h));
      lo += (mn - lo) * 0.05; hi += (mx - hi) * 0.05;
      const Y = (p) => ((p - lo) / (hi - lo)) * 6.2;
      vis.forEach((s, k) => {
        const c = candles[k], y0 = Y(s.o), y1 = Y(s.c), x = X(k, frac);
        const grow = k === N - 1 ? Math.min(1, 0.25 + frac * 1.5) : 1;
        c.body.position.set(x, (y0 + y1) / 2, 0); c.body.scale.y = Math.max(0.05, Math.abs(y1 - y0) * grow);
        const inTrade = (pos && s.id >= pos.id) || trades.some((tr) => s.id >= tr.in && s.id <= tr.out);
        c.body.userData.edges.material = inTrade ? held : s.c >= s.o ? up : down;
        c.wick.position.set(x, (Y(s.h) + Y(s.l)) / 2, 0); c.wick.scale.y = Math.max(0.05, Y(s.h) - Y(s.l));
        const fade = Math.min(1, (k + 1 - frac) / 6); c.body.visible = c.wick.visible = fade > 0.05;
      });
      // equity
      const ev = eqSeries.slice(-N); const em = Math.min(...ev.map((e) => e.v)), eM = Math.max(...ev.map((e) => e.v));
      eLo += (em - eLo) * 0.05; eHi += (Math.max(eM, em + 0.02) - eHi) * 0.05;
      const pa = eqGeo.attributes.position.array; const off = N - ev.length;
      for (let k = 0; k < N; k++) { const e = ev[Math.max(0, k - off)]; pa[k * 3] = X(k, frac); pa[k * 3 + 1] = 4.9 + ((e.v - eLo) / (eHi - eLo)) * 1.3; pa[k * 3 + 2] = 0; }
      eqGeo.setDrawRange(0, N); eqGeo.attributes.position.needsUpdate = true;
      dot.position.set(X(N - 1, frac), Y(live.c), 0.2); dot.scale.setScalar(1 + 0.35 * Math.sin(t * 5));
      // markers for trades still on screen
      const first = vis[0].id, slot = (sid) => sid - first;
      const shown = trades.filter((tr) => slot(tr.out) >= 0).slice(-markerPool.length);
      markerPool.forEach((m, i) => {
        const tr = shown[i]; m.visible = !!tr; if (!tr) return;
        const a = slot(tr.in), b = slot(tr.out);
        const ya = Y(tr.inPx), yb = Y(tr.outPx), xa = X(Math.max(a, -1), frac), xb = X(b, frac);
        const { r1, r2, link } = m.userData;
        r1.visible = a >= 0; r1.position.set(xa, ya, 0); r2.position.set(xb, yb, 0);
        const age = t - tr.born, pulse = age < 1.2 ? 1 + 0.8 * (1 - age / 1.2) : 1;
        r2.scale.setScalar(pulse); r2.material.color.setHex(tr.win ? LIME : RED);
        link.geometry.setFromPoints([new THREE.Vector3(xa, ya, 0), new THREE.Vector3(xb, yb, 0)]); link.computeLineDistances();
      });
      // camera: slow orbit + mouse parallax
      const a = Math.sin(t * 0.12) * 0.28 + mouse.x * 0.45;
      camera.position.set(Math.sin(a) * dist, dist * 0.3 - mouse.y * 2.0, Math.cos(a) * dist); camera.lookAt(0, 3.0, 0);
      const wins = trades.filter((x) => x.win).length;
      hud.innerHTML = `<span>SIM · LIVE · 1 CANDLE = 1 DAY</span><span>STRATEGY: BUY THE 4% DIP · +6% / −4%</span><span>TRADES <b>${trades.length}</b> · WIN <b>${trades.length ? Math.round((wins / trades.length) * 100) : 0}%</b> · EQUITY <b class="l">${((equity - 1) * 100 >= 0 ? "+" : "")}${((equity - 1) * 100).toFixed(1)}%</b></span>`;
    },
  };
});

/* ──────────────────── STACK: plain words → rules → prices ──────────────────── */
stage(document.getElementById("stack3d"), ({ scene, el }) => {
  scene.fog = null;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -50, 50);
  const root = new THREE.Group(); scene.add(root);
  // layer 3: price blocks
  const blocks = [], limeEdge = lineMat(LIME, 1), whiteEdge = lineMat(WHITE, 0.85);
  for (let i = 0; i < 9; i++) for (let j = 0; j < 6; j++) { const b = wbox(whiteEdge); b.position.set(-3.6 + i * 0.9, 0, -2.25 + j * 0.9); b.scale.set(0.7, 0.3, 0.7); root.add(b); blocks.push({ b, i, j }); }
  // layer 2: rules slab with rows
  const slab = new THREE.Group(); root.add(slab);
  const sb = wbox(lineMat(WHITE, 0.95)); sb.scale.set(8.4, 0.2, 5.6); slab.add(sb);
  const rows = [];
  [6.2, 4.4, 5.2, 3.4, 4.0].forEach((w, k) => { const r = wbox(lineMat(WHITE, 0.6)); r.scale.set(w, 0.06, 0.34); r.position.set(-3.8 + w / 2 + 0.2, 0.14, -2.0 + k * 1.0); slab.add(r); rows.push(r); });
  const rowFill = rows.map((r) => { const m = new THREE.Mesh(UNIT, new THREE.MeshBasicMaterial({ color: LIME, transparent: true, opacity: 0 })); m.scale.copy(r.scale).multiplyScalar(0.999); m.position.copy(r.position); m.position.y += 0.035; slab.add(m); return m; });
  // layer 1: the plain-words card, with typed text
  const card = new THREE.Group(); root.add(card);
  const cb = wbox(lineMat(WHITE, 0.95)); cb.scale.set(5.4, 0.12, 2.8); card.add(cb);
  const TEXT = "BUY NVDA WHEN IT DROPS 5% IN A WEEK. SELL AT +8% OR A 4% STOP.";
  const tt = textTexture(1024, 512, (x, n) => {
    x.fillStyle = "#fff"; x.font = "500 44px 'JetBrains Mono', monospace";
    const words = TEXT.slice(0, n).split(" "); let line = "", y = 120;
    for (const w of words) { if ((line + w).length > 30) { x.fillText(line, 50, y); y += 70; line = ""; } line += w + " "; }
    x.fillText(line + (n < TEXT.length ? "▍" : ""), 50, y);
  });
  const tp = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.6), new THREE.MeshBasicMaterial({ map: tt.tex, transparent: true })); tp.rotation.x = -Math.PI / 2; tp.position.y = 0.07; card.add(tp);
  // dotted guides
  const guides = [];
  for (const [x, z] of [[-4.2, -2.8], [4.2, -2.8], [-4.2, 2.8], [4.2, 2.8]]) {
    const gl = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 1, z)]), new THREE.LineDashedMaterial({ color: WHITE, dashSize: 0.12, gapSize: 0.1, transparent: true, opacity: 0.45 }));
    root.add(gl); guides.push(gl);
  }
  const labels = [...el.parentElement.querySelectorAll(".lbl")];
  const v = new THREE.Vector3();
  let spread = 0;
  return {
    camera,
    resize(w, h) { const s = 6.0, a = w / h; camera.left = -s * a; camera.right = s * a; camera.top = s; camera.bottom = -s; camera.updateProjectionMatrix(); },
    tick(t) {
      // spread follows how far the section has scrolled into view
      const b = el.getBoundingClientRect(), p = Math.min(1, Math.max(0, (innerHeight - b.top) / (innerHeight + b.height * 0.2)));
      spread += (p - spread) * 0.08;
      const gap = 2.0 + spread * 1.6;
      slab.position.y = 0.6 + gap + 0.06 * Math.sin(t * 1.3);
      card.position.set(0.2, slab.position.y + gap * 0.9 + 0.1 * Math.sin(t * 1.1 + 1), 0.2);
      guides.forEach((gl, i) => { const y0 = 0.4, y1 = slab.position.y - 0.1; gl.geometry.setFromPoints([new THREE.Vector3(gl.geometry.attributes.position.getX(0), y0, gl.geometry.attributes.position.getZ(0)), new THREE.Vector3(gl.geometry.attributes.position.getX(0), y1, gl.geometry.attributes.position.getZ(0))]); gl.computeLineDistances(); });
      // blocks breathe like a price history; a lit cell walks through it (trades)
      const lit = Math.floor(t * 2.2) % blocks.length;
      blocks.forEach(({ b, i, j }, k) => {
        const hgt = 0.18 + 0.55 * (0.5 + 0.5 * Math.sin(i * 0.8 + j * 0.5 + t * 1.6));
        b.scale.y = hgt; b.position.y = hgt / 2;
        const on = k === lit || (k * 7) % blocks.length === lit;
        b.userData.edges.material = on ? limeEdge : whiteEdge;
      });
      // rules light up one by one as the sentence is typed
      const n = Math.floor((t * 14) % (TEXT.length + 40)); tt.redraw(Math.min(n, TEXT.length));
      const rp = Math.max(0, n - TEXT.length) / 40;
      rowFill.forEach((m, k) => { m.material.opacity = rp * rows.length > k ? 0.9 : 0.0; });
      // camera: isometric, slow sway
      const a = Math.PI / 4 + Math.sin(t * 0.25) * 0.18;
      camera.position.set(Math.sin(a) * 20, 15, Math.cos(a) * 20); camera.lookAt(0, 3.0, 0);
      // labels follow their layer on screen
      const put = (lbl, obj, dx, dy) => { if (!lbl) return; v.set(dx, dy, 0).applyMatrix4(obj.matrixWorld).project(camera); lbl.style.left = `${(v.x * 0.5 + 0.5) * el.clientWidth}px`; lbl.style.top = `${(-v.y * 0.5 + 0.5) * el.clientHeight}px`; };
      root.updateMatrixWorld();
      put(labels[0], card, 2.6, 0); put(labels[1], slab, -4.4, 0); put(labels[2], blocks[blocks.length - 1].b, 0.4, 0);
    },
  };
});

/* ─────────────────────────── GATE: most strategies fail ─────────────────────────── */
stage(document.getElementById("gate3d"), ({ scene, mouse, el }) => {
  scene.fog = new THREE.Fog(0x000000, 12, 30);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  const root = new THREE.Group(); scene.add(root);
  const gate = new THREE.Group(); root.add(gate);
  for (const s of [-1, 1]) { const p = wbox(lineMat(WHITE, 0.95)); p.scale.set(0.45, 3.6, 0.45); p.position.set(0, 1.8, s * 1.6); gate.add(p); const f = wbox(lineMat(WHITE, 0.8)); f.scale.set(0.8, 0.25, 0.8); f.position.set(0, 0.125, s * 1.6); gate.add(f); }
  const beam = wbox(lineMat(WHITE, 0.95)); beam.scale.set(0.5, 0.4, 4.1); beam.position.y = 3.8; gate.add(beam);
  const signT = textTexture(512, 128, (x, txt, col) => { x.fillStyle = col; x.font = "700 64px 'JetBrains Mono', monospace"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(txt, 256, 66); });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), new THREE.MeshBasicMaterial({ map: signT.tex, transparent: true })); sign.position.set(-0.32, 4.45, 0); sign.rotation.y = -Math.PI / 2; gate.add(sign);
  const signBox = wbox(lineMat(WHITE, 0.9)); signBox.scale.set(0.12, 0.7, 2.6); signBox.position.set(-0.24, 4.45, 0); gate.add(signBox);
  signT.redraw("THE GATE", "#c8ff2e");
  // scanning beam between the posts
  const scan = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 3.4), new THREE.MeshBasicMaterial({ color: LIME, transparent: true, opacity: 0.6 }));
  scan.rotation.y = Math.PI / 2; gate.add(scan);
  // path through the gate
  const path = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-14, 0.01, 0), new THREE.Vector3(14, 0.01, 0)]), new THREE.LineDashedMaterial({ color: WHITE, dashSize: 0.25, gapSize: 0.2, transparent: true, opacity: 0.6 }));
  path.computeLineDistances(); root.add(path);
  const passed = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(14, 0.02, 0)]), new THREE.LineBasicMaterial({ color: LIME, transparent: true, opacity: 0.8 })); root.add(passed);
  // candidate strategies, as coins rolling up to the gate (illustrative; pass/fail follows the real example runs)
  const ASSETS = [
    { sym: "N", tk: "NVDA", name: "NVDA DIP", pass: false }, { sym: "₿", tk: "BTC", name: "BTC RSI", pass: true },
    { sym: "A", tk: "AAPL", name: "BIG 4 RSI", pass: false }, { sym: "Ξ", tk: "ETH", name: "ETH RSI", pass: true },
    { sym: "T", tk: "TSLA", name: "TSLA BREAKOUT", pass: false }, { sym: "Q", tk: "QQQ", name: "QQQ PULLBACK", pass: false },
    { sym: "◎", tk: "SOL", name: "SOL MOMENTUM", pass: false }, { sym: "X", tk: "XLV", name: "SECTOR RSI", pass: true },
    { sym: "Ð", tk: "DOGE", name: "DOGE PUMP", pass: false }, { sym: "S", tk: "SPY", name: "GOLDEN CROSS", pass: false },
  ];
  const R = 0.62, TH = 0.18;
  const coinGeo = new THREE.CylinderGeometry(R, R, TH, 64); coinGeo.rotateX(Math.PI / 2);
  const coinEdges = new THREE.EdgesGeometry(coinGeo, 30), faceGeo = new THREE.CircleGeometry(R * 0.98, 64);
  const drawFace = (x, a, col) => {
    x.strokeStyle = col; x.lineWidth = 7; x.beginPath(); x.arc(128, 128, 112, 0, Math.PI * 2); x.stroke();
    x.lineWidth = 3; x.beginPath(); x.arc(128, 128, 92, 0, Math.PI * 2); x.stroke();
    x.fillStyle = col; x.textAlign = "center"; x.textBaseline = "middle";
    x.font = `700 ${a.sym.length > 1 ? 70 : 104}px 'Space Grotesk', 'Segoe UI Symbol', sans-serif`; x.fillText(a.sym, 128, 118);
    x.font = "600 26px 'JetBrains Mono', monospace"; x.fillText(a.tk, 128, 186);
  };
  const pool = Array.from({ length: 7 }, () => {
    const g = new THREE.Group(); root.add(g); g.visible = false;
    g.add(new THREE.Mesh(coinGeo, blackMat));
    const m = lineMat(WHITE, 0.95); g.add(new THREE.LineSegments(coinEdges, m));
    const ft = textTexture(256, 256, drawFace);
    const fm = new THREE.MeshBasicMaterial({ map: ft.tex, transparent: true });
    const f1 = new THREE.Mesh(faceGeo, fm); f1.position.z = TH / 2 + 0.002; g.add(f1);
    const f2 = new THREE.Mesh(faceGeo, fm); f2.position.z = -TH / 2 - 0.002; f2.rotation.y = Math.PI; g.add(f2);
    const lt = textTexture(320, 64, (x, txt, col) => { x.fillStyle = col; x.font = "500 26px 'JetBrains Mono', monospace"; x.textAlign = "center"; x.fillText(txt, 160, 40); });
    const lab = new THREE.Sprite(new THREE.SpriteMaterial({ map: lt.tex, transparent: true, depthTest: false })); lab.scale.set(2.6, 0.52, 1); root.add(lab); lab.visible = false;
    return { g, m, fm, ft, lab, lt, alive: false };
  });
  let spawnT = 0, k = 0, tested = 0, ok = 0, last = "";
  const hud = document.createElement("div"); hud.className = "hud gate"; el.appendChild(hud);
  const spawn = () => {
    const p = pool.find((q) => !q.alive); if (!p) return;
    const a = ASSETS[k++ % ASSETS.length];
    Object.assign(p, { alive: true, x: -8.5, a, pass: a.pass, decided: false, vy: 0, y: R, fade: 1, tip: 0 });
    p.m.color.setHex(WHITE); p.ft.redraw(a, "#ffffff"); p.lt.redraw(a.name, "#ffffff");
    p.g.visible = p.lab.visible = true; p.g.rotation.set(0, 0, 0);
  };
  return {
    camera,
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    tick(t, dt) {
      spawnT += dt; if (spawnT > 1.3) { spawnT = 0; spawn(); }
      scan.position.y = 1.8 + Math.sin(t * 3) * 1.6;
      for (const p of pool) {
        if (!p.alive) continue;
        if (!p.decided && p.x > -0.9) { p.decided = true; tested++; if (p.pass) ok++; last = p.a.name;
          const col = p.pass ? "#c8ff2e" : "#ff4d5e";
          p.m.color.setHex(p.pass ? LIME : RED); p.ft.redraw(p.a, col); p.lt.redraw(`${p.a.name} · ${p.pass ? "PASS" : "FAIL"}`, col);
          signT.redraw(p.pass ? "PASS" : "FAIL", col); setTimeout(() => signT.redraw("THE GATE", "#c8ff2e"), 700); }
        if (p.decided && !p.pass) { // bounces off the gate, tips over and fades
          p.tip = Math.min(Math.PI / 2, p.tip + 3 * dt); p.x -= 0.5 * dt; p.y = Math.max(TH / 2, R * Math.cos(p.tip) + (TH / 2) * Math.sin(p.tip)); p.fade -= 0.7 * dt;
          p.g.rotation.x = p.tip;
        } else { p.x += 2.6 * dt; p.g.rotation.z = -p.x / R; } // rolls
        p.g.position.set(p.x, p.y, 0); p.lab.position.set(p.x, R * 2 + 0.45, 0);
        const o = Math.max(0, p.fade); p.m.opacity = o * 0.95; p.fm.opacity = o; p.lab.material.opacity = o;
        if (p.x > 11 || p.fade <= 0) { p.alive = false; p.g.visible = p.lab.visible = false; }
      }
      const a = -0.55 + Math.sin(t * 0.15) * 0.18 + mouse.x * 0.4;
      camera.position.set(Math.sin(a) * 12.5, 4.6 - mouse.y * 1.6, Math.cos(a) * 12.5); camera.lookAt(0, 2.0, 0);
      hud.innerHTML = `<span>STRATEGIES TESTED <b>${tested}</b></span><span>PASSED <b class="l">${ok}</b></span><span>LAST <b>${last || "–"}</b></span>`;
    },
  };
});
