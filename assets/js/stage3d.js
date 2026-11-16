/* ==========================================================================
   TRIBE CULTURE — 3D product stage (three.js, self-hosted, no CDN)
   Two modes, both driven by data attributes on <div data-stage="…">:
     hero    — the three Drop 001 pieces floating in a lit black studio
     product — one piece on a turntable with front / back / detail faces
   Graceful fallbacks: WebGL missing, reduced motion, tab hidden, offscreen.
   ========================================================================== */
import * as THREE from '../vendor/three.module.min.js';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isMobile = window.matchMedia('(max-width: 760px)').matches;

/* offline fallback media — the live catalogue drives the stage when the API answers */
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
    setTimeout(done, 2500); // never block the stage on a slow API
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

function tex(url) {
  const t = loader().load(url, undefined, undefined, () => {});
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  return t;
}

/** soft radial sprite used for glow pools behind products */
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

/* ================================================================ HERO ==== */
function mountHero(host) {
  const canvas = host.querySelector('canvas');
  const picker = host.querySelector('.stage-picker');
  const caption = host.querySelector('.stage-caption');
  if (!canvas) return null;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.6 : 1.8));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x050505, 0.028);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);
  camera.position.set(0, 0, 9.4);

  const rig = new THREE.Group();
  scene.add(rig);

  /* ---------- lighting backdrop ---------- */
  const glowTex = radialTexture();
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 12),
    new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  backdrop.position.set(0, 0.4, -6.4);
  scene.add(backdrop);

  /* ---------- dust ---------- */
  const count = isMobile ? 260 : 640;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 20;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 12;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 12 - 2;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    color: 0xd4141b, size: 0.035, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
  }));
  scene.add(dust);

  /* ---------- the ring ---------- */
  const list = (window.TC && window.TC.productList) ? window.TC.productList() : [];
  const items = [];
  const ring = new THREE.Group();
  rig.add(ring);

  list.forEach((p, i) => {
    const media = mediaFor(p.sku, true);
    if (!media) return;
    const group = new THREE.Group();
    const texFront = tex(media.tile || media.front);
    const mat = new THREE.MeshBasicMaterial({ map: texFront, transparent: true, opacity: 0, depthWrite: false });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    plane.userData.sku = p.sku;
    group.add(plane);
    group.scale.setScalar(0.001);
    group.userData = { sku: p.sku, index: i, product: p, mat, plane, texFront, media };
    ring.add(group);
    items.push(group);
  });

  const N = Math.max(items.length, 1);
  let radius = 4.6;
  let spin = 0;
  let targetSpin = 0;
  let velocity = 0;
  let dragging = false;
  let lastX = 0;
  let lastT = 0;
  let pointerDown = false;
  let enteredAt = performance.now();
  let active = 0;
  const INTRO = reduceMotion ? 0 : 1250;

  /* ---------- picker chips ---------- */
  function buildPicker() {
    if (!picker) return;
    picker.innerHTML = list.map((p, i) => `
      <button type="button" data-index="${i}" aria-pressed="${i === active}">
        <img src="${p.image}" alt="" loading="lazy" width="34" height="34">
        <span>${p.name.replace(' Tee', '')}</span>
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
    if (pr) pr.textContent = (window.TC ? window.TC.money(p.price) : '₦' + p.price.toLocaleString('en-NG')) + '  ·  drag to spin · click to open';
  }

  function goTo(i, immediate) {
    active = ((i % N) + N) % N;
    targetSpin = -active * (Math.PI * 2 / N);
    if (immediate) spin = targetSpin;
    goTo._manual = true;
    if (picker) {
      Array.from(picker.querySelectorAll('button')).forEach((b) => {
        b.setAttribute('aria-pressed', String(Number(b.dataset.index) === active));
      });
    }
    captionFor(active);
    host.dataset.activeSku = list[active] ? list[active].sku : '';
  }

  function nearestIndex() {
    const step = Math.PI * 2 / N;
    const raw = -spin / step;
    return ((Math.round(raw) % N) + N) % N;
  }

  picker && picker.addEventListener('click', (e) => {
    const b = e.target.closest('[data-index]');
    if (!b) return;
    goTo(Number(b.dataset.index));
    goTo._manual = true;
  });

  /* ---------- pointer ---------- */
  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hovered = null;

  function onDown(e) {
    pointerDown = true;
    dragging = true;
    velocity = 0;
    lastX = e.clientX;
    canvas.style.cursor = 'grabbing';
    host.setPointerCapture && e.pointerId != null && host.setPointerCapture(e.pointerId);
  }
  function onMove(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    if (!dragging) { raycast(); return; }
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    spin += dx * 0.0062;
    velocity = dx * 0.0062;
    goTo._manual = false;
    if (Math.abs(dx) > 2) {
      active = nearestIndex();
      captionFor(active);
      if (picker) Array.from(picker.querySelectorAll('button')).forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.index) === active)));
      host.dataset.activeSku = list[active] ? list[active].sku : '';
    }
  }
  function onUp() {
    if (!dragging) { pointerDown = false; return; }
    dragging = false;
    canvas.style.cursor = '';
    pointerDown = false;
    goTo(nearestIndex());
    if (Math.abs(velocity) < 0.0015) goTo._manual = false;
  }
  function raycast() {
    if (!items.length) return;
    ray.setFromCamera(pointer, camera);
    const hits = ray.intersectObjects(ring.children.map((g) => g.children[0]), false);
    const next = hits.length ? hits[0].object : null;
    if (hovered !== next) {
      hovered = next;
      canvas.style.cursor = next ? 'pointer' : 'grab';
    }
  }
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointerleave', () => { hovered = null; });
  canvas.addEventListener('click', (e) => {
    if (!hovered) return;
    const sku = hovered.userData.sku;
    if (sku) location.href = 'product.html?sku=' + encodeURIComponent(sku);
  });
  canvas.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { goTo(active + 1); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { goTo(active - 1); e.preventDefault(); }
    if (e.key === 'Enter' && list[active]) location.href = 'product.html?sku=' + encodeURIComponent(list[active].sku);
  });
  canvas.tabIndex = 0;

  /* ---------- layout ---------- */
  const BASE_Z = 9.4;
  function resize() {
    const w = canvas.clientWidth || host.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    camera.position.z = BASE_Z;
    const visibleH = 2 * BASE_Z * Math.tan((camera.fov * Math.PI) / 360);
    const visibleW = visibleH * camera.aspect;
    /* card size follows the tighter of the two axes so twelve pieces never collide */
    const cardH = Math.min(visibleH * (isMobile ? 0.46 : 0.46), visibleW * (isMobile ? 0.60 : 0.29));
    /* spacing between neighbours on the ring must exceed the card width */
    radius = Math.max(cardH * 2.45, 3.4);
    items.forEach((g) => { g.userData.cardH = cardH; g.userData.plane.scale.set(cardH, cardH, 1); });
    rig.position.y = isMobile ? 0.05 : 0.16;
  }
  const ro = ('ResizeObserver' in window) ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(host); else window.addEventListener('resize', resize);
  resize();

  function place() {
    items.forEach((g, i) => {
      const a = (i / N) * Math.PI * 2 + spin;
      g.position.set(Math.sin(a) * radius, 0, Math.cos(a) * radius - radius);
      g.rotation.y = Math.sin(a) * 0.22;                  /* slight turn, stays readable */
      const depth = (Math.cos(a) + 1) / 2;                /* 1 = nearest */
      const target = 0.42 + Math.pow(depth, 1.4) * 0.58;
      g.userData.mat.opacity += (target - g.userData.mat.opacity) * 0.14;
      const s = 0.80 + depth * 0.22;
      g.userData.plane.scale.setScalar((g.userData.cardH || 2) * s);
      g.position.y = (depth - 0.5) * 0.22;
    });
  }

  /* ---------- loop ---------- */
  let raf = 0;
  let visible = true;
  const io = new IntersectionObserver((es) => { visible = es[0].isIntersecting; }, { threshold: 0.05 });
  io.observe(host);
  const onVis = () => { if (document.hidden) cancelAnimationFrame(raf); else loop(); };
  document.addEventListener('visibilitychange', onVis);

  function step() {
    const now = performance.now();
    const t = (now - enteredAt) / INTRO;

    /* intro: cards scale in one after another */
    items.forEach((g, i) => {
      const local = Math.min(1, Math.max(0, t - i * (0.6 / N) * 2));
      const ease = local < 1 ? 1 - Math.pow(1 - local, 3) : 1;
      g.scale.setScalar(Math.max(0.001, ease));
    });

    if (!dragging) {
      if (!goTo._manual && !reduceMotion) spin += 0.0016;
      else spin += (targetSpin - spin) * 0.09;
      if (Math.abs(targetSpin - spin) < 0.0004) goTo._manual = false;
    }
    place();

    /* the caption follows whichever piece is nearest, whether drifting or dragged */
    if (!dragging) {
      const near = nearestIndex();
      if (near !== active) {
        active = near;
        captionFor(active);
        host.dataset.activeSku = list[active] ? list[active].sku : '';
        if (picker) Array.from(picker.querySelectorAll('[data-index]')).forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.index) === active)));
      }
    }

    dust.rotation.y += 0.0004;
    dust.position.y = Math.sin(now * 0.0002) * 0.12;
    backdrop.material.opacity = 0.52 + Math.sin(now * 0.0006) * 0.06;

    renderer.render(scene, camera);
    lastT = now;
  }

  function loop() {
    cancelAnimationFrame(raf);
    if (!visible || document.hidden) return;
    const tick = () => {
      if (!visible || document.hidden) { raf = 0; return; }
      step();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
  loop();
  document.addEventListener('visibilitychange', () => loop());

  goTo(0, true);
  goTo._manual = false;

  window.addEventListener('resize', resize);

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

/* ---------- single product turntable (product page) ---------- */
function mountProduct(host) {
  const canvas = host.querySelector('canvas');
  if (!canvas) return null;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.6 : 1.8));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
  camera.position.set(0, 0, 6.2);

  const params = new URLSearchParams(location.search);
  const firstSku = (window.TC && window.TC.productList && window.TC.productList()[0]) ? window.TC.productList()[0].sku : 'saint-tee-black';
  let sku = host.dataset.sku || params.get('sku') || firstSku;
  let media = mediaFor(sku);
  if (!media) return null;

  let face = 'front';

  /* two planes so a face change can cross-fade */
  const group = new THREE.Group();
  scene.add(group);
  const glowTex = radialTexture();
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 7),
    new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  glow.position.z = -2.4;
  scene.add(glow);

  /* the photo is mounted like a framed look-plate: bone mat, ink hairline, print */
  const bone = 0x0;
  const mat = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0xece3cf, transparent: true, opacity: 0.96, depthWrite: false })
  );
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0x050505, transparent: true, opacity: 0.98, depthWrite: false })
  );
  mat.position.z = -0.02;
  line.position.z = -0.01;
  group.add(mat, line);

  const mkPlane = () => new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: tex(media.front), transparent: true, opacity: 0, depthWrite: false })
  );
  const A = mkPlane();
  const B = mkPlane();
  A.material.opacity = 1;
  group.add(A, B);

  /* stage plates: the product photo vignetted so it sits on the black stage */
  function urlFor(f) {
    const m = mediaFor(sku, true);
    if (!m) return media.front;
    return 'assets/products/3d/' + sku + '-' + f + '.webp';
  }

  let active = A;   /* plane currently showing the print */
  let fade = null;  /* { from, to } while a face change cross-fades */

  function setFace(next, instant) {
    const f = ['front', 'back', 'detail'].includes(next) ? next : 'front';
    if (f === face && !instant) return;
    face = f;
    const incoming = active === A ? B : A;
    incoming.material.map = tex(urlFor(f));
    incoming.material.needsUpdate = true;
    if (instant) {
      fade = null;
      active.material.opacity = 0;
      incoming.material.opacity = 1;
      active = incoming;
      return;
    }
    incoming.material.opacity = 0.001;
    fade = { from: active, to: incoming };
    active = incoming;
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
  let spin = 0;
  let spinVel = 0;
  let tiltX = 0;
  let tiltY = 0;
  let enteredAt = performance.now();

  function down(e) {
    dragging = true;
    lastX = e.clientX;
    spinVel = 0;
    canvas.style.cursor = 'grabbing';
  }
  function move(e) {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    spin += dx * 0.008;
    spinVel = dx * 0.008;
  }
  function up() {
    dragging = false;
    canvas.style.cursor = '';
  }
  canvas.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move, { passive: true });
  window.addEventListener('pointerup', up);
  canvas.addEventListener('pointerleave', up);
  canvas.addEventListener('pointermove', (e) => {
    if (dragging) return;
    const r = canvas.getBoundingClientRect();
    tiltY = ((e.clientX - r.left) / r.width - 0.5) * 0.5;
    tiltX = ((e.clientY - r.top) / r.height - 0.5) * 0.35;
  });

  /* ---------- layout ---------- */
  function resize() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const visibleH = 2 * camera.position.z * Math.tan((camera.fov * Math.PI) / 360);
    /* reserve real pixels for the overlay chrome (label above, face picker below)
       so the plate can never sit under either, at any canvas aspect */
    const worldPerPx = visibleH / h;
    const wide = w > 620;
    const topReserve = wide ? 52 : 54;
    const botReserve = wide ? 58 : 98;
    const usableH = Math.max(140, h - topReserve - botReserve);
    const usableW = Math.max(140, w - (wide ? 56 : 34));
    const scaleBoost = parseFloat(host.dataset.plate) ? 1.06 : 1;
    const size = Math.min(usableH * worldPerPx, usableW * worldPerPx) * 0.94 * scaleBoost;
    A.scale.set(size, size, 1);
    B.scale.set(size, size, 1);
    mat.scale.set(size * 1.085, size * 1.085, 1);
    line.scale.set(size * 1.05, size * 1.05, 1);
    /* recentre inside the space that is actually free */
    const topFree = topReserve * worldPerPx;
    const freeH = usableH * worldPerPx;
    group.position.y = (visibleH / 2) - topFree - freeH / 2;
  }
  const ro = ('ResizeObserver' in window) ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(host); else window.addEventListener('resize', resize);
  resize();

  /* ---------- loop ---------- */
  let raf = 0;
  let visible = true;
  const io = new IntersectionObserver((es) => { visible = es[0].isIntersecting; loop(); }, { threshold: 0.05 });
  io.observe(host);

  function step() {
    const now = performance.now();
    const intro = reduceMotion ? 1 : Math.min(1, (now - enteredAt) / 900);
    const ease = 1 - Math.pow(1 - intro, 3);

    if (!dragging) {
      spin += spinVel;
      spinVel *= 0.94;
      if (!reduceMotion) spin += 0.0032;
    }
    group.rotation.y = spin + Math.sin(now * 0.0004) * 0.05;
    group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, tiltX, 0.08);
    group.rotation.z = Math.sin(now * 0.0005) * 0.012;
    group.position.x = THREE.MathUtils.lerp(group.position.x, tiltY * 0.22, 0.06);
    group.scale.setScalar(ease);

    if (fade) {
      fade.to.material.opacity = Math.min(1, fade.to.material.opacity + 0.10);
      fade.from.material.opacity = Math.max(0, fade.from.material.opacity - 0.10);
      if (fade.to.material.opacity >= 0.999) {
        fade.to.material.opacity = 1;
        fade.from.material.opacity = 0;
        fade = null;
      }
    }

    glow.material.opacity = 0.44 + Math.sin(now * 0.0008) * 0.06;
    renderer.render(scene, camera);
  }

  function loop() {
    cancelAnimationFrame(raf);
    if (!visible || document.hidden) return;
    const tick = () => {
      if (!visible || document.hidden) { raf = 0; return; }
      step();
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
