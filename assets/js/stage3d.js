/* ==========================================================================
   TRIBE CULTURE — 3D stages (three.js, self-hosted, no CDN)
   Two modes, both driven by data-stage attributes on <div data-stage="…">:
     hero    — the twelve Drop 001 pieces turning on a lit carousel in a dark
               room: mirrored floor, contact shadow, dust, a light sweep across
               the piece in focus.
     product — one piece floating on the same floor, turning on its own, with
               front / back / detail faces cross-fading.

   Everything is data-driven from the catalogue, and every failure path falls
   back to flat images rather than a black rectangle.
   ========================================================================== */
import * as THREE from '../vendor/three.module.min.js';

const TAU = Math.PI * 2;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isMobile = window.matchMedia('(max-width: 860px)').matches;

/* offline fallback media — the live catalogue drives the stages when it answers */
const PRODUCT_MEDIA = {
  'saint-tee-black': { name: 'Saint Tee', variant: 'Black / Red print', front: 'assets/products/saint-tee-black-front.jpg', back: 'assets/products/saint-tee-black-back.jpg', detail: 'assets/products/saint-tee-black-detail.jpg' },
  'cadet-cap-black': { name: 'Cadet Cap', variant: 'Black / Embroidered', front: 'assets/products/cadet-cap-black-front.jpg', back: 'assets/products/cadet-cap-black-back.jpg', detail: 'assets/products/cadet-cap-black-detail.jpg' }
};

/* ---------------------------------------------------------------- helpers */
function mediaFor(sku, forStage) {
  const p = window.TC && window.TC.product ? window.TC.product(sku) : null;
  if (p && p.images) {
    return {
      name: p.name, variant: p.variant,
      front: p.images.front, back: p.images.back, detail: p.images.detail,
      tile: forStage ? 'assets/products/3d/' + sku + '.webp' : p.images.front
    };
  }
  return PRODUCT_MEDIA[sku] || null;
}

function ready() {
  if (window.TC && window.TC.state.ready) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => resolve();
    document.addEventListener('tc:ready', done, { once: true });
    setTimeout(done, 2500); /* never block the stage on a slow API */
  });
}

function supportsWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

function loader() {
  if (!loader._l) loader._l = new THREE.TextureLoader();
  return loader._l;
}

function tex(url, onLoad) {
  const t = loader().load(url, (loaded) => { if (onLoad) onLoad(loaded); }, undefined, () => {});
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.minFilter = THREE.LinearFilter;
  return t;
}

/** masks and gradients, drawn once and shared between every card */
function canvasTexture(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** the plate a piece is printed on: a crisp card with softly eaten corners */
function plateMask() {
  if (plateMask._t) return plateMask._t;
  plateMask._t = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    try { ctx.filter = 'blur(2.4px)'; } catch { /* newer canvas only */ }
    ctx.fillStyle = '#fff';
    roundRect(ctx, 5, 5, w - 10, h - 10, 16);
    ctx.fill();
  });
  return plateMask._t;
}

/** the hairline around the plate, drawn as a ring so it adds light, never covers */
function plateFrameMask() {
  if (plateFrameMask._t) return plateFrameMask._t;
  plateFrameMask._t = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.2;
    roundRect(ctx, 3.4, 3.4, w - 6.8, h - 6.8, 17);
    ctx.stroke();
  });
  return plateFrameMask._t;
}

/** the floor reflection: the plate, dissolved as it runs away from the piece */
function reflectionMask() {
  if (reflectionMask._t) return reflectionMask._t;
  reflectionMask._t = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    roundRect(ctx, 5, 5, w - 10, h - 10, 16);
    ctx.fill();
    /* keep only what is close to the piece, fading upwards */
    ctx.globalCompositeOperation = 'destination-in';
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.16, 'rgba(255,255,255,.62)');
    g.addColorStop(0.52, 'rgba(255,255,255,.2)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  });
  return reflectionMask._t;
}

/** contact shadow under a piece: soft ellipse, darkest at its centre */
function shadowMask() {
  if (shadowMask._t) return shadowMask._t;
  shadowMask._t = canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,.85)');
    g.addColorStop(0.45, 'rgba(255,255,255,.34)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  return shadowMask._t;
}

/** the light sweep that runs across the piece in focus */
function sweepMask() {
  if (sweepMask._t) return sweepMask._t;
  sweepMask._t = canvasTexture(128, 16, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  return sweepMask._t;
}

/** vertical glow used for the horizon spill behind the stage */
function horizonMask() {
  if (horizonMask._t) return horizonMask._t;
  horizonMask._t = canvasTexture(16, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, h, 0, 0);
    g.addColorStop(0, 'rgba(255,255,255,.9)');
    g.addColorStop(0.35, 'rgba(255,255,255,.28)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  return horizonMask._t;
}

/** soft radial sprite used for the glow pool behind the room */
function radialTexture(inner = 'rgba(212,20,27,0.55)', outer = 'rgba(212,20,27,0)') {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.55, inner.replace(/[\d.]+\)$/, '0.16)'));
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** the room: glow, horizon spill and dust — shared by both stages */
function buildRoom(scene, opts) {
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 18),
    new THREE.MeshBasicMaterial({ map: radialTexture(), transparent: true, opacity: 0.36, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  glow.position.set(0, 0.5, -9.5);
  scene.add(glow);

  const horizon = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 4.4),
    new THREE.MeshBasicMaterial({ map: horizonMask(), color: 0xa3121a, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  scene.add(horizon);

  const count = opts.dust || 380;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 22;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 11;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 14 - 3;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    color: 0xffb3a8, size: 0.032, transparent: true, opacity: 0.5, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true
  }));
  scene.add(dust);

  return { glow, horizon, dust };
}

/** one piece on the stage: the print, a hairline, a soft pool of shadow, a light sweep */
function buildPiece(url, planeGeo) {
  const group = new THREE.Group();

  const photoTex = tex(url);
  const photoMat = new THREE.MeshBasicMaterial({
    map: photoTex, alphaMap: plateMask(), transparent: true, opacity: 0, depthWrite: false
  });
  const photo = new THREE.Mesh(planeGeo, photoMat);
  group.add(photo);

  /* the hairline: a ring of light just outside the print */
  const frameMat = new THREE.MeshBasicMaterial({
    map: plateFrameMask(), color: 0xece3cf, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const frame = new THREE.Mesh(planeGeo, frameMat);
  frame.scale.set(1.014, 1.014, 1);
  frame.position.z = -0.004;
  group.add(frame);

  /* the pool the piece stands in */
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowMask(), color: 0x000000, transparent: true, opacity: 0, depthWrite: false
  });
  const shadow = new THREE.Mesh(planeGeo, shadowMat);
  shadow.position.z = -0.008;
  group.add(shadow);

  const sweepMat = new THREE.MeshBasicMaterial({
    map: sweepMask(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending
  });
  const sweep = new THREE.Mesh(planeGeo, sweepMat);
  sweep.position.z = 0.012;
  group.add(sweep);

  return { group, photo, photoMat, photoTex, frame, frameMat, shadow, shadowMat, sweep, sweepMat };
}

/* ================================================================ HERO ==== */
function mountHero(host) {
  const canvas = host.querySelector('canvas');
  const picker = host.querySelector('.stage-picker');
  const caption = host.querySelector('.stage-caption');
  if (!canvas) return null;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 2 : 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 140);
  const CAM_Z = 8.7;
  camera.position.set(0, 0.34, CAM_Z);

  const room = buildRoom(scene, { dust: isMobile ? 170 : 420 });
  const rig = new THREE.Group();
  scene.add(rig);

  /* ---------- the twelve pieces ---------- */
  const list = (window.TC && window.TC.productList) ? window.TC.productList() : [];
  const planeGeo = new THREE.PlaneGeometry(1, 1);
  const items = [];

  list.forEach((p) => {
    const media = mediaFor(p.sku, true);
    if (!media) return;
    const piece = buildPiece(media.tile || media.front, planeGeo);
    piece.group.userData = { sku: p.sku, product: p };
    rig.add(piece.group);
    items.push(piece);
  });

  const N = Math.max(items.length, 1);
  const STEP = TAU / N;

  let cardSize = 2.4;
  let radius = 4.6;
  let floorY = -1.4;

  let spin = 0;
  let target = 0;
  let dragging = false;
  let moved = 0;
  let downX = 0;
  let lastX = 0;
  let active = 0;
  let opened = false;
  let enteredAt = performance.now();
  let lastInteract = 0;
  let nextAuto = 0;
  let sweeping = -1;
  let sweepT = 0;
  const INTRO = reduceMotion ? 1 : 1500;

  /* ---------- picker chips ---------- */
  function buildPicker() {
    if (!picker) return;
    picker.innerHTML = list.map((p, i) => `
      <button type="button" data-index="${i}" aria-pressed="${i === 0}" aria-label="${p.name} — ${p.variant}">
        <img src="${p.image}" alt="" loading="lazy" width="34" height="34">
        <span>${p.name.replace(' Tee', '').replace(' Tank', '')}</span>
      </button>`).join('');
  }
  buildPicker();

  function captionFor(i) {
    if (!caption) return;
    const p = list[i];
    if (!p) return;
    const k = caption.querySelector('.k');
    const n = caption.querySelector('.n');
    const pr = caption.querySelector('.p');
    if (k) k.textContent = `Drop 001 · ${String(i + 1).padStart(2, '0')} / ${String(list.length).padStart(2, '0')}`;
    if (n) n.textContent = `${p.name} — ${p.variant}`;
    if (pr) pr.textContent = (window.TC ? window.TC.money(p.price) : '₦' + p.price.toLocaleString('en-NG')) + '  ·  drag to spin · tap to open';
  }

  function markActive(i) {
    active = ((i % N) + N) % N;
    captionFor(active);
    host.dataset.activeSku = list[active] ? list[active].sku : '';
    if (picker) {
      const btns = picker.querySelectorAll('button');
      btns.forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.index) === active)));
      const on = btns[active];
      /* keep the selected chip in view on narrow screens without scrolling the page */
      if (on && isMobile) {
        const pr = picker.getBoundingClientRect();
        const br = on.getBoundingClientRect();
        if (br.left < pr.left + 8 || br.right > pr.right - 8) {
          picker.scrollTo({ left: on.offsetLeft - (pr.width - br.width) / 2, behavior: reduceMotion ? 'auto' : 'smooth' });
        }
      }
    }
    /* move the light sweep onto the piece in focus */
    if (sweeping >= 0) attachSweep();
  }

  function attachSweep() {
    const piece = items[active];
    if (!piece) return;
    if (piece.sweep.parent !== piece.group) piece.group.add(piece.sweep);
    items.forEach((it) => { if (it !== piece) it.sweepMat.opacity = 0; });
  }

  function goTo(i, immediate) {
    const idx = ((Math.round(i) % N) + N) % N;
    target = -idx * STEP;
    if (immediate) spin = target;
    markActive(idx);
    lastInteract = performance.now();
  }

  function nearest() {
    const raw = -target / STEP;
    return ((Math.round(raw) % N) + N) % N;
  }

  picker && picker.addEventListener('click', (e) => {
    const b = e.target.closest('[data-index]');
    if (!b) return;
    goTo(Number(b.dataset.index));
    lastInteract = performance.now();
  });

  /* ---------- drag: spin with momentum, snap, tap to open ---------- */
  function openActive() {
    const p = list[active];
    if (p && !opened) {
      opened = true;
      location.href = 'product.html?sku=' + encodeURIComponent(p.sku);
    }
  }

  function onDown(e) {
    dragging = true;
    moved = 0;
    downX = e.clientX;
    lastX = e.clientX;
    lastInteract = performance.now();
    canvas.style.cursor = 'grabbing';
  }
  function onMove(e) {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    moved += Math.abs(dx);
    spin += dx * 0.0052;
    target = spin;
    lastInteract = performance.now();
    const idx = ((Math.round(-spin / STEP) % N) + N) % N;
    if (idx !== active) markActive(idx);
  }
  function onUp() {
    if (!dragging) return;
    dragging = false;
    canvas.style.cursor = '';
    if (moved < 9) { openActive(); return; }
    goTo(Math.round(-spin / STEP));
  }

  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { goTo(active + 1); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { goTo(active - 1); e.preventDefault(); }
    if (e.key === 'Enter' || e.key === ' ') { openActive(); e.preventDefault(); }
  });
  canvas.tabIndex = 0;

  /* pointer parallax — the room breathes with the cursor */
  let px = 0, py = 0, cx = 0, cy = 0;
  window.addEventListener('pointermove', (e) => {
    px = (e.clientX / window.innerWidth - 0.5) * 2;
    py = (e.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });

  /* ---------- layout ---------- */
  function resize() {
    const w = canvas.clientWidth || host.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const visibleH = 2 * CAM_Z * Math.tan((camera.fov * Math.PI) / 360);
    const visibleW = visibleH * camera.aspect;
    /* the piece in focus owns the frame; neighbours peek at the edges */
    const worldPerPx = visibleH / h;
    /* reserve the pixels the chrome occupies, so the piece can never sit under it */
    const topReserve = isMobile ? 44 : 48;
    const botReserve = isMobile ? 112 : 66;
    const usableH = Math.max(120, h - topReserve - botReserve) * worldPerPx;
    const usableW = Math.max(120, w - (isMobile ? 24 : 56)) * worldPerPx;
    /* one piece owns the frame; the next two peek in at the edges */
    cardSize = isMobile
      ? Math.min(usableH * 0.97, usableW * 0.86)
      : Math.min(usableH * 0.94, usableW * 0.46);
    radius = cardSize * (isMobile ? 2.15 : 2.4);
    rig.position.y = (botReserve - topReserve) * worldPerPx * 0.22;
    /* every child of a piece is authored in normalised units; only the group is
       scaled to cardSize, so nothing is ever multiplied twice */
    floorY = -cardSize * 0.56;
    room.horizon.position.y = -cardSize * 0.8;
    room.horizon.scale.y = Math.max(0.4, cardSize * 0.55);
    items.forEach((it) => {
      it.photo.scale.set(1, 1, 1);
      it.shadow.scale.set(1.22, 1.16, 1);
      it.sweep.scale.set(0.5, 1, 1);
    });
  }
  const ro = ('ResizeObserver' in window) ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(host); else window.addEventListener('resize', resize);
  resize();

  /* ---------- place every piece on the arc ---------- */
  function place(now) {
    const introT = Math.min(1, (now - enteredAt) / INTRO);
    items.forEach((it, i) => {
      const a = i * STEP + spin;
      const cos = Math.cos(a);
      const g = it.group;
      g.position.set(Math.sin(a) * radius, 0, cos * radius - radius);
      g.rotation.y = a;
      /* the ring leans a hair towards the camera: a curve, not a flat strip */
      g.rotation.x = -0.045 + (1 - (cos + 1) / 2) * 0.09;
      const depth = (cos + 1) / 2;                     /* 1 = nearest the camera */
      const focus = 0.9 + depth * 0.1;
      const S = cardSize * focus;
      g.scale.setScalar(S);
      g.visible = cos > -0.55;

      /* staggered arrival: each piece rises out of the floor */
      const local = Math.max(0, Math.min(1, introT * 1.55 - (i / N) * 0.55));
      const ease = local < 1 ? 1 - Math.pow(1 - local, 3) : 1;
      g.position.y = -(1 - ease) * cardSize * 0.42;

      /* the pool sits just under the plate, in the group's own units */
      it.shadow.position.y = (floorY - g.position.y) / S;

      const base = 0.12 + Math.pow(depth, 1.9) * 0.88;
      it.photoMat.color.setScalar(0.62 + depth * 0.38);
      const o = base * ease;
      it.photoMat.opacity = o;
      it.frameMat.opacity = Math.min(1, o * 0.36);
      it.shadowMat.opacity = o * 0.62;
    });
  }

  /* ---------- loop ---------- */
  let raf = 0;
  let visible = true;
  const io = new IntersectionObserver((es) => { visible = es[0].isIntersecting; loop(); }, { threshold: 0.02 });
  io.observe(host);

  function step(now) {
    const dt = step._last ? Math.min(64, now - step._last) : 16;
    step._last = now;

    /* auto-advance: one piece every 5.2s, unless the visitor is handling it */
    if (!reduceMotion && !dragging && now - lastInteract > 2600) {
      if (now > nextAuto) {
        target -= STEP;
        nextAuto = now + 5200;
        markActive(nearest());
      }
    } else {
      nextAuto = now + 5200;
    }

    if (!dragging) {
      spin += (target - spin) * Math.min(1, dt * 0.0065);
      if (Math.abs(target - spin) < 0.0004) spin = target;
    }

    /* cursor parallax */
    cx += (px - cx) * Math.min(1, dt * 0.004);
    cy += (py - cy) * Math.min(1, dt * 0.004);
    camera.position.x = cx * 0.42;
    camera.position.y = 0.34 - cy * 0.22;
    camera.lookAt(0, 0.02, 0);

    place(now);

    /* the caption tracks whichever piece is actually centred, so words and
       picture never disagree mid-turn */
    if (!dragging) {
      const centred = ((Math.round(-spin / STEP) % N) + N) % N;
      if (centred !== active) markActive(centred);
    }

    /* light sweep across the piece in focus */
    const piece = items[active];
    if (piece && !reduceMotion) {
      if (sweeping < 0 || now - sweeping > 6400) { sweeping = now; sweepT = 0; attachSweep(); }
      const p = (now - sweeping) / 1400;
      if (p >= 0 && p <= 1) {
        const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        piece.sweep.position.x = -0.72 + 1.44 * e;
        piece.sweepMat.opacity = Math.sin(p * Math.PI) * 0.22;
      } else {
        piece.sweepMat.opacity = 0;
      }
    }

    room.dust.rotation.y += dt * 0.000012;
    room.dust.position.y = Math.sin(now * 0.00018) * 0.14;
    room.glow.material.opacity = 0.46 + Math.sin(now * 0.0007) * 0.05;

    renderer.render(scene, camera);
  }

  function loop() {
    cancelAnimationFrame(raf);
    if (!visible || document.hidden) return;
    const tick = (now) => {
      if (!visible || document.hidden) { raf = 0; step._last = 0; return; }
      step(now || performance.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
  document.addEventListener('visibilitychange', loop);
  loop();

  goTo(0, true);
  captionFor(0);

  return {
    dispose() {
      cancelAnimationFrame(raf);
      io.disconnect();
      if (ro) ro.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      renderer.dispose();
    }
  };
}

/* ---------- single piece on the floor (product page + the round) ---------- */
function mountProduct(host) {
  const canvas = host.querySelector('canvas');
  if (!canvas) return null;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 2 : 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
  const CAM_Z = 7.4;
  camera.position.set(0, 0.22, CAM_Z);

  const room = buildRoom(scene, { dust: isMobile ? 110 : 240 });

  const params = new URLSearchParams(location.search);
  const first = (window.TC && window.TC.productList && window.TC.productList()[0]) ? window.TC.productList()[0].sku : 'saint-tee-black';
  let sku = host.dataset.sku || params.get('sku') || first;
  let media = mediaFor(sku);
  if (!media) return null;
  let face = 'front';

  const planeGeo = new THREE.PlaneGeometry(1, 1);
  const piece = buildPiece(media.tile || media.front, planeGeo);
  const group = piece.group;
  scene.add(group);

  function urlFor(f) {
    const m = mediaFor(sku, true);
    if (!m) return media.front;
    return 'assets/products/3d/' + sku + '-' + f + '.webp';
  }

  /* a second photo plane so a face change can cross-fade */
  const B = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({
    map: tex(urlFor(face)), alphaMap: plateMask(), transparent: true, opacity: 0, depthWrite: false
  }));
  B.position.z = 0.004;
  group.add(B);
  const A = piece.photo;
  piece.photoMat.map = tex(urlFor('front'));
  piece.photoMat.needsUpdate = true;
  piece.photoMat.opacity = 1;

  let activePlane = A;
  let fade = null;

  function setFace(next, instant) {
    const f = ['front', 'back', 'detail'].includes(next) ? next : 'front';
    if (f === face && !instant) return;
    face = f;
    const incoming = activePlane === A ? B : A;
    incoming.material.map = tex(urlFor(f));
    incoming.material.needsUpdate = true;
    if (instant) {
      fade = null;
      activePlane.material.opacity = 0;
      incoming.material.opacity = 1;
      activePlane = incoming;
      return;
    }
    incoming.material.opacity = 0.001;
    fade = { from: activePlane, to: incoming };
    activePlane = incoming;
  }

  document.addEventListener('stage:face', (e) => setFace(e.detail && e.detail.face));
  document.addEventListener('stage:sku', (e) => {
    const next = e.detail && e.detail.sku;
    if (!next || next === sku) return;
    const m = mediaFor(next, true);
    if (!m) return;
    sku = next;
    media = m;
    face = 'nope';
    setFace('front', true);
  });

  /* ---------- interaction ---------- */
  let dragging = false;
  let lastX = 0;
  /* a flat print cannot show a back face, so the turn is a bounded swivel:
     it settles back to square-on and never turns edge-on */
  const SWIVEL = 0.36;
  let swivel = 0;
  let swivelTarget = 0;
  let lastDrag = 0;
  let tiltX = 0;
  let tiltY = 0;
  let enteredAt = performance.now();
  let sweeping = enteredAt;
  let visible = true;

  function down(e) {
    dragging = true;
    lastX = e.clientX;
    lastDrag = performance.now();
    canvas.style.cursor = 'grabbing';
  }
  function move(e) {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    swivelTarget = Math.max(-SWIVEL, Math.min(SWIVEL, swivelTarget + dx * 0.0055));
    lastDrag = performance.now();
  }
  function up() {
    if (!dragging) return;
    dragging = false;
    lastDrag = performance.now();
    canvas.style.cursor = '';
  }
  canvas.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move, { passive: true });
  window.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', up);
  canvas.addEventListener('pointermove', (e) => {
    if (dragging) return;
    const r = canvas.getBoundingClientRect();
    tiltY = ((e.clientX - r.left) / r.width - 0.5) * 0.34;
    tiltX = ((e.clientY - r.top) / r.height - 0.5) * 0.24;
  });

  /* ---------- layout: the piece is always fully inside the free space ---------- */
  let plate = 2.2;
  let floorY = -1.2;
  function resize() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const visibleH = 2 * CAM_Z * Math.tan((camera.fov * Math.PI) / 360);
    const visibleW = visibleH * camera.aspect;
    const worldPerPx = visibleH / h;
    const wide = w > 620;
    /* reserve real pixels for the chrome above and below the stage */
    const topReserve = wide ? 54 : 46;
    const botReserve = wide ? 66 : 104;
    const usableH = Math.max(120, h - topReserve - botReserve);
    const usableW = Math.max(120, w - (wide ? 64 : 40));
    /* 0.86 keeps the soft edge and the reflection shadow inside the frame */
    /* 0.9 leaves a little air under the piece for its shadow */
    plate = Math.min(usableH * 0.9, usableW * 0.99) * worldPerPx;
    plate = Math.max(1.1, plate);
    floorY = -plate * 0.56;
    room.horizon.position.y = -plate * 0.7;
    room.horizon.scale.y = Math.max(0.4, plate * 0.5);
    /* normalised children: the group carries the size, once */
    A.scale.set(1, 1, 1);
    B.scale.set(1, 1, 1);
    piece.shadow.scale.set(1.24, 1.18, 1);
    piece.sweep.scale.set(0.5, 1, 1);
    /* centre the piece in the space between the label and the controls */
    const topFree = topReserve * worldPerPx;
    const freeH = usableH * worldPerPx;
    group.position.y = (visibleH / 2) - topFree - freeH / 2;
  }
  const ro = ('ResizeObserver' in window) ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(host); else window.addEventListener('resize', resize);
  resize();

  /* ---------- loop ---------- */
  let raf = 0;
  const io = new IntersectionObserver((es) => { visible = es[0].isIntersecting; loop(); }, { threshold: 0.02 });
  io.observe(host);

  function step(now) {
    const dt = step._last ? Math.min(64, now - step._last) : 16;
    step._last = now;
    const intro = reduceMotion ? 1 : Math.min(1, (now - enteredAt) / 900);
    const ease = 1 - Math.pow(1 - intro, 3);

    /* let go and the piece settles back to square-on */
    if (!dragging && now - lastDrag > 900) swivelTarget *= 0.965;
    swivel += (swivelTarget - swivel) * Math.min(1, dt * 0.006);

    group.rotation.y = swivel + Math.sin(now * 0.00042) * 0.055;
    group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, tiltX, 0.07);
    const intro2 = 0.88 + ease * 0.12;
    const S = plate * intro2 * (1 + tiltY * 0.04);
    group.scale.setScalar(S);
    group.position.x = THREE.MathUtils.lerp(group.position.x, tiltY * 0.26, 0.06);
    if (!reduceMotion) group.rotation.z = Math.sin(now * 0.00052) * 0.01;

    piece.photoMat.opacity = ease;
    piece.frameMat.opacity = Math.min(1, ease * 0.4);
    piece.shadowMat.opacity = ease * 0.62;
    piece.shadow.position.y = (floorY - group.position.y) / S;

    if (fade) {
      fade.to.material.opacity = Math.min(1, fade.to.material.opacity + dt * 0.006);
      fade.from.material.opacity = Math.max(0, fade.from.material.opacity - dt * 0.006);
      if (fade.to.material.opacity >= 0.999) {
        fade.to.material.opacity = 1;
        fade.from.material.opacity = 0;
        fade = null;
      }
    }

    /* a slow sweep of light passes over the piece every few seconds */
    if (!reduceMotion) {
      const p = (now - sweeping) / 1600;
      if (p > 1) { sweeping = now; }
      const q = Math.max(0, Math.min(1, p));
      const e = q < 0.5 ? 2 * q * q : 1 - Math.pow(-2 * q + 2, 2) / 2;
      piece.sweep.position.x = -0.78 + 1.56 * e;
      piece.sweepMat.opacity = Math.sin(Math.PI * q) * 0.2;
    }

    room.dust.rotation.y += dt * 0.000012;
    room.glow.material.opacity = 0.42 + Math.sin(now * 0.0008) * 0.05;
    renderer.render(scene, camera);
  }

  function loop() {
    cancelAnimationFrame(raf);
    if (!visible || document.hidden) return;
    const tick = (now) => {
      if (!visible || document.hidden) { raf = 0; step._last = 0; return; }
      step(now || performance.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
  document.addEventListener('visibilitychange', loop);
  setFace('front', true);
  loop();

  return {
    dispose() {
      cancelAnimationFrame(raf);
      io.disconnect();
      if (ro) ro.disconnect();
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      renderer.dispose();
    }
  };
}

/* =============================================================== mount ==== */
async function boot() {
  const hosts = Array.from(document.querySelectorAll('[data-stage]'));
  if (!hosts.length) return;

  const mount = () => {
    hosts.forEach((host) => {
      const mode = host.dataset.stage;
      const loading = host.querySelector('.stage-loading');
      try {
        if (!supportsWebGL()) throw new Error('no webgl');
        const inst = mode === 'product' ? mountProduct(host) : mountHero(host);
        if (!inst) throw new Error('mount failed');
        if (loading) loading.hidden = true;
        host.dataset.stageReady = '1';
      } catch (err) {
        console.warn('[stage] fallback:', mode, err && err.message);
        if (loading) loading.hidden = true;
        const fb = host.querySelector('.stage-fallback');
        if (fb) fb.hidden = false;
        host.dataset.stageReady = 'fallback';
      }
    });
  };

  await ready();
  mount();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
