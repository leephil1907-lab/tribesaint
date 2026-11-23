/* ==========================================================================
   TRIBE CULTURE — THE RACK
   Dedicated cinematic Drop 001 experience.
   Catalogue/cart/stock remain owned by the existing TC storefront runtime.
   Original product photographs are always displayed whole; no image crops.
   ========================================================================== */
import * as THREE from '../../vendor/three.module.min.js';

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');
const MOBILE = window.matchMedia('(max-width: 860px)');
const money = (n) => '₦' + Number(n || 0).toLocaleString('en-NG');
const reducedMotion = () => REDUCED.matches || (window.TC && window.TC.motionOff && window.TC.motionOff());

function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')));
  } catch (_) {
    return false;
  }
}

function listen(target, type, handler, options) {
  if (!target) return () => {};
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
}

function centerActive(host, sku) {
  if (!host || !sku) return;
  const instance = host.__rackInstance;
  if (instance && typeof instance.centerSku === 'function') instance.centerSku(sku);
}

/* ------------------------------------------------------------------ shared UI */
function createPanel(host, products, tc) {
  const panel = host.querySelector('[data-rack-panel]');
  const name = host.querySelector('[data-rack-name]');
  const variant = host.querySelector('[data-rack-variant]');
  const price = host.querySelector('[data-rack-price]');
  const sizes = host.querySelector('[data-rack-sizes]');
  const stock = host.querySelector('[data-rack-stock]');
  const add = host.querySelector('[data-rack-add]');
  const flip = host.querySelector('[data-rack-flip]');
  const close = host.querySelector('[data-rack-close]');
  const pdp = host.querySelector('[data-rack-pdp]');
  const hint = host.querySelector('[data-rack-hint]');
  let activeProduct = null;
  let selectedSize = '';
  let flipHandler = () => {};
  const cleanup = [];

  function liveProduct(product) {
    return tc && tc.product ? (tc.product(product.sku) || null) : null;
  }

  function stockFor(product, size) {
    const live = liveProduct(product);
    if (!live) return null;
    if (tc && tc.stockOf) return tc.stockOf(product.sku, size);
    return live.stock && typeof live.stock[size] === 'number' ? live.stock[size] : null;
  }

  function updateAdd() {
    const live = activeProduct && liveProduct(activeProduct);
    const available = !!(live && selectedSize);
    if (add) {
      add.disabled = !available;
      const label = add.querySelector('span') || add;
      label.textContent = !live ? 'Availability unavailable' : (selectedSize ? 'Add to Stash' : 'Choose a size');
    }
  }

  function chooseSize(size) {
    if (!activeProduct) return;
    const qty = stockFor(activeProduct, size);
    if (qty === 0) return;
    selectedSize = size;
    Array.from(sizes.children).forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.size === size));
    });
    if (stock) {
      stock.textContent = qty === null ? 'Live stock unavailable' :
        (qty <= 3 ? 'Only ' + qty + ' left in ' + size : qty + ' available in ' + size);
    }
    updateAdd();
  }

  function select(product) {
    if (!product) return;
    activeProduct = product;
    selectedSize = '';
    if (name) name.textContent = product.name || 'Drop 001';
    if (variant) variant.textContent = product.variant || product.category || '';
    if (price) price.textContent = money(product.price);
    if (pdp) pdp.href = 'product.html?sku=' + encodeURIComponent(product.sku);
    if (sizes) {
      sizes.replaceChildren();
      (product.sizes || []).forEach((size) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'rack-size';
        button.dataset.size = size;
        button.textContent = size === 'ONE SIZE' ? 'One size' : size;
        button.setAttribute('aria-pressed', 'false');
        const qty = stockFor(product, size);
        button.disabled = qty === 0;
        if (qty === 0) button.title = 'Sold out';
        sizes.appendChild(button);
      });
    }
    if (stock) {
      const live = liveProduct(product);
      stock.textContent = live ? 'Choose your size' : 'Live availability is temporarily unavailable';
    }
    if (panel) panel.classList.add('is-open');
    if (hint) hint.hidden = true;
    if (flip) flip.disabled = false;

    const live = liveProduct(product);
    if (live && live.sizes && live.sizes.length === 1 && stockFor(product, live.sizes[0]) !== 0) {
      chooseSize(live.sizes[0]);
    } else {
      updateAdd();
    }
  }

  function clear() {
    activeProduct = null;
    selectedSize = '';
    if (panel) panel.classList.remove('is-open');
    if (hint) hint.hidden = false;
    if (flip) flip.disabled = true;
    if (add) {
      add.disabled = true;
      const label = add.querySelector('span') || add;
      label.textContent = 'Choose a size';
    }
  }

  function onSizeClick(event) {
    const button = event.target.closest('[data-size]');
    if (button && sizes.contains(button) && !button.disabled) chooseSize(button.dataset.size);
  }
  function onAdd() {
    if (!activeProduct || !selectedSize || !tc || !tc.addToBag) return;
    const ok = tc.addToBag(activeProduct.sku, selectedSize, 1);
    if (ok && tc.toast) tc.toast('Stashed — ' + activeProduct.name);
  }
  function onFlip() { if (activeProduct) flipHandler(activeProduct); }
  function onClose() { clear(); if (host.__rackInstance && host.__rackInstance.clearActive) host.__rackInstance.clearActive(); }

  cleanup.push(listen(sizes, 'click', onSizeClick));
  cleanup.push(listen(add, 'click', onAdd));
  cleanup.push(listen(flip, 'click', onFlip));
  cleanup.push(listen(close, 'click', onClose));

  return {
    select,
    clear,
    setFlipHandler(fn) { flipHandler = typeof fn === 'function' ? fn : () => {}; },
    getActive() { return activeProduct; },
    destroy() { cleanup.forEach((fn) => fn()); }
  };
}

/* ------------------------------------------------------------------ live HUD */
function bindHud(host, tc) {
  const count = host.querySelector('[data-rack-count]');
  const total = host.querySelector('[data-rack-total]');
  if (!tc || !tc.on) return () => {};
  const unsubscribe = tc.on(() => {
    if (count) count.textContent = String(tc.bagCount ? tc.bagCount() : 0);
    if (total) total.textContent = money(tc.bagSubtotal ? tc.bagSubtotal() : 0);
  });
  return typeof unsubscribe === 'function' ? unsubscribe : () => {};
}

/* ------------------------------------------------------------------ fallback */
function mountFallback(host, products, tc, panelUI) {
  const stage = host.querySelector('.rack-stage');
  const canvas = stage && stage.querySelector('canvas');
  const track = host.querySelector('.rack-fallback');
  const prev = host.querySelector('[data-rack-prev]');
  const next = host.querySelector('[data-rack-next]');
  if (!stage || !track) return null;

  if (canvas) canvas.hidden = true;
  track.hidden = false;
  track.replaceChildren();
  host.classList.add('is-fallback');

  products.forEach((product, index) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'rack-card';
    card.dataset.sku = product.sku;
    card.setAttribute('aria-label', 'View ' + product.name + ', ' + (product.variant || 'Drop 001'));

    const image = document.createElement('img');
    image.src = (product.images && product.images.front) || product.image || '';
    image.alt = 'Original front photograph of ' + product.name + ', shown in full';
    image.loading = index < 3 ? 'eager' : 'lazy';
    image.decoding = 'async';
    image.draggable = false;

    const meta = document.createElement('span');
    meta.className = 'rack-card-meta';
    const title = document.createElement('strong');
    title.textContent = product.name || 'Drop 001';
    const detail = document.createElement('span');
    detail.textContent = product.variant || product.category || '';
    const amount = document.createElement('b');
    amount.textContent = money(product.price);
    meta.append(title, detail, amount);
    card.append(image, meta);
    track.appendChild(card);
  });

  let activeSku = '';
  let showingBack = false;
  const cleanup = [];

  function centerSku(sku) {
    const card = track.querySelector('[data-sku="' + CSS.escape(sku) + '"]');
    if (!card) return;
    const trackRect = track.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const delta = cardRect.left - trackRect.left - (trackRect.width - cardRect.width) / 2;
    track.scrollTo({
      left: track.scrollLeft + delta,
      behavior: reducedMotion() ? 'auto' : 'smooth'
    });
  }

  function selectSku(sku) {
    const product = products.find((item) => item.sku === sku);
    if (!product) return;
    activeSku = sku;
    showingBack = false;
    track.querySelectorAll('.rack-card').forEach((card) => {
      const selected = card.dataset.sku === sku;
      card.classList.toggle('is-active', selected);
      card.setAttribute('aria-pressed', String(selected));
      if (selected) {
        const img = card.querySelector('img');
        img.src = (product.images && product.images.front) || product.image || '';
        img.alt = 'Original front photograph of ' + product.name + ', shown in full';
      }
    });
    panelUI.select(product);
    requestAnimationFrame(() => centerSku(sku));
  }

  function flip() {
    if (!activeSku) return;
    const product = products.find((item) => item.sku === activeSku);
    const card = track.querySelector('[data-sku="' + CSS.escape(activeSku) + '"]');
    const image = card && card.querySelector('img');
    if (!product || !image) return;
    showingBack = !showingBack;
    image.src = (showingBack && product.images && product.images.back) ||
      (product.images && product.images.front) || product.image || '';
    image.alt = 'Original ' + (showingBack ? 'back' : 'front') + ' photograph of ' + product.name + ', shown in full';
  }

  function clearActive() {
    activeSku = '';
    showingBack = false;
    track.querySelectorAll('.rack-card').forEach((card) => {
      card.classList.remove('is-active');
      card.setAttribute('aria-pressed', 'false');
    });
    panelUI.clear();
  }

  function onTrackClick(event) {
    const card = event.target.closest('.rack-card');
    if (card && track.contains(card)) selectSku(card.dataset.sku);
  }
  function move(direction) {
    const cards = Array.from(track.querySelectorAll('.rack-card'));
    if (!cards.length) return;
    let index = cards.findIndex((card) => card.dataset.sku === activeSku);
    index = index < 0 ? (direction > 0 ? 0 : cards.length - 1) : Math.max(0, Math.min(cards.length - 1, index + direction));
    selectSku(cards[index].dataset.sku);
  }

  cleanup.push(listen(track, 'click', onTrackClick));
  cleanup.push(listen(prev, 'click', () => move(-1)));
  cleanup.push(listen(next, 'click', () => move(1)));
  panelUI.setFlipHandler(flip);

  return {
    mode: 'fallback',
    centerSku,
    setActive(product) { if (product) selectSku(product.sku); },
    clearActive,
    destroy() {
      cleanup.forEach((fn) => fn());
      panelUI.destroy();
      panelUI.clear();
      track.replaceChildren();
      if (host.__rackCleanup) host.__rackCleanup();
      if (host.__rackInstance === this) delete host.__rackInstance;
    }
  };
}

/* ------------------------------------------------------------------ WebGL */
function mountWebGL(host, products, tc, panelUI) {
  const canvas = host.querySelector('.rack-stage canvas');
  if (!canvas || !supportsWebGL()) return null;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: !MOBILE.matches,
      alpha: true,
      powerPreference: 'high-performance'
    });
  } catch (error) {
    console.warn('[Tribe Culture] WebGL unavailable; using accessible rack fallback.', error);
    return null;
  }

  const fallbackTrack = host.querySelector('.rack-fallback');
  if (fallbackTrack) fallbackTrack.hidden = true;
  host.classList.remove('is-fallback');

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MOBILE.matches ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x080607, 0.035);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
  camera.position.set(0, 0.05, 7.7);

  const roomGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(28, 16),
    new THREE.MeshBasicMaterial({
      color: 0x8f1118,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  roomGlow.position.set(0, 0.15, -7);
  scene.add(roomGlow);

  scene.add(new THREE.AmbientLight(0xffffff, 1.15));
  const keyLight = new THREE.DirectionalLight(0xffe6d6, 1.6);
  keyLight.position.set(-3, 5, 7);
  scene.add(keyLight);
  const rimLight = new THREE.PointLight(0xc51b25, 20, 18);
  rimLight.position.set(0, 2.6, -1.5);
  scene.add(rimLight);

  const rail = new THREE.Group();
  scene.add(rail);

  const spacing = 1.52;
  const planeHeight = 1.48;
  const planeWidth = 1.22;
  const totalWidth = Math.max(8, products.length * spacing + 2);
  const bar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, totalWidth, 16),
    new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.92, roughness: 0.2 })
  );
  bar.rotation.z = Math.PI / 2;
  bar.position.y = 1.42;
  rail.add(bar);

  const pieces = [];
  const loader = new THREE.TextureLoader();
  const textures = [];
  const geometries = [];
  const materials = [];
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let active = null;
  let hovered = null;
  let selectedIndex = 0;
  let targetX = 0;
  let currentX = 0;
  let pointerDown = false;
  let pointerMoved = false;
  let downX = 0;
  let downY = 0;
  let lastX = 0;
  let raf = 0;
  let destroyed = false;
  let fallbackInstance = null;

  function loadFace(url, mesh, product) {
    if (!url) return;
    const texture = loader.load(url, (loaded) => {
      if (destroyed) return;
      loaded.colorSpace = THREE.SRGBColorSpace;
      loaded.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      const image = loaded.image;
      if (image && image.width && image.height) {
        const ratio = image.width / image.height;
        const height = planeHeight;
        const width = Math.max(0.65, Math.min(1.5, height * ratio));
        const old = mesh.geometry;
        mesh.geometry = new THREE.PlaneGeometry(width, height);
        geometries.push(mesh.geometry);
        if (old) old.dispose();
      }
    }, undefined, () => {
      if (!destroyed) console.warn('[Tribe Culture] Product image failed to load:', url);
    });
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    textures.push(texture);
    mesh.material.map = texture;
    mesh.material.needsUpdate = true;
  }

  products.forEach((product, index) => {
    const group = new THREE.Group();
    const frontUrl = (product.images && product.images.front) || product.image || '';
    const backUrl = (product.images && product.images.back) || frontUrl;

    const frontMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const backMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    materials.push(frontMat, backMat);

    const front = new THREE.Mesh(new THREE.PlaneGeometry(planeWidth, planeHeight), frontMat);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(planeWidth, planeHeight), backMat);
    geometries.push(front.geometry, back.geometry);
    front.position.z = 0.025;
    back.position.z = -0.025;
    back.rotation.y = Math.PI;
    back.visible = false;
    group.add(front, back);
    loadFace(frontUrl, front, product);
    loadFace(backUrl, back, product);

    const hook = new THREE.Mesh(
      new THREE.TorusGeometry(0.075, 0.012, 8, 20, Math.PI),
      new THREE.MeshStandardMaterial({ color: 0xb6b6b6, metalness: 0.95, roughness: 0.2 })
    );
    hook.position.set(0, 0.86, 0);
    hook.rotation.z = Math.PI;
    group.add(hook);
    materials.push(hook.material);
    const hanger = new THREE.Mesh(
      new THREE.BoxGeometry(0.54, 0.025, 0.035),
      new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.9, roughness: 0.28 })
    );
    hanger.position.y = 0.75;
    group.add(hanger);
    materials.push(hanger.material);

    group.position.set((index - (products.length - 1) / 2) * spacing, 0.15, 0);
    group.userData = {
      sku: product.sku,
      product,
      baseX: group.position.x,
      front,
      back,
      showingBack: false,
      targetScale: 1,
      targetY: 0.15
    };
    rail.add(group);
    pieces.push(group);
  });

  const maxX = Math.max(0, ((pieces.length - 1) * spacing) / 2 - 1.65);

  function clampRail(value) {
    return Math.max(-maxX, Math.min(maxX, value));
  }

  function centerSku(sku) {
    const piece = pieces.find((item) => item.userData.sku === sku);
    if (!piece) return;
    targetX = clampRail(-piece.userData.baseX);
  }

  function setActive(piece) {
    active = piece || null;
    if (piece) {
      selectedIndex = pieces.indexOf(piece);
      pieces.forEach((item) => {
        item.userData.targetScale = item === piece ? 1.12 : 0.9;
        item.userData.targetY = item === piece ? 0.28 : 0.15;
      });
      panelUI.select(piece.userData.product);
      centerSku(piece.userData.sku);
    } else {
      pieces.forEach((item) => {
        item.userData.targetScale = 1;
        item.userData.targetY = 0.15;
      });
      panelUI.clear();
    }
  }

  function clearActive() { setActive(null); }

  function flipActive() {
    if (!active) return;
    const data = active.userData;
    data.showingBack = !data.showingBack;
    data.front.visible = !data.showingBack;
    data.back.visible = data.showingBack;
  }
  panelUI.setFlipHandler(flipActive);

  function updatePointer(event) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function hitPiece(event) {
    updatePointer(event);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pieces, true);
    if (!hits.length) return null;
    let object = hits[0].object;
    while (object && !object.userData.sku) object = object.parent;
    return object || null;
  }

  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    pointerDown = true;
    pointerMoved = false;
    downX = lastX = event.clientX;
    downY = event.clientY;
    canvas.setPointerCapture && canvas.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (pointerDown) {
      const dxFromStart = event.clientX - downX;
      const dyFromStart = event.clientY - downY;
      if (!pointerMoved && Math.abs(dxFromStart) > 7 && Math.abs(dxFromStart) > Math.abs(dyFromStart)) {
        pointerMoved = true;
      }
      if (pointerMoved) {
        targetX = clampRail(targetX + (event.clientX - lastX) * 0.012);
      }
      lastX = event.clientX;
      return;
    }
    if (event.pointerType === 'touch') return;
    const nextHover = hitPiece(event);
    if (nextHover !== hovered) {
      hovered = nextHover;
      pieces.forEach((piece) => {
        if (piece === active) return;
        piece.userData.targetScale = piece === hovered ? 1.055 : 1;
        piece.userData.targetY = piece === hovered ? 0.22 : 0.15;
      });
    }
  }

  function onPointerUp(event) {
    if (!pointerDown) return;
    pointerDown = false;
    if (!pointerMoved) {
      const piece = hitPiece(event);
      if (piece) setActive(piece === active ? null : piece);
    }
    pointerMoved = false;
  }

  function onPointerCancel() {
    pointerDown = false;
    pointerMoved = false;
  }

  function onKeyDown(event) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      selectedIndex = Math.max(0, Math.min(pieces.length - 1, selectedIndex + (event.key === 'ArrowRight' ? 1 : -1)));
      const piece = pieces[selectedIndex];
      centerSku(piece.userData.sku);
      setActive(piece);
    } else if (event.key === 'Escape') {
      clearActive();
    } else if (event.key === 'Enter' && hovered) {
      setActive(hovered);
    }
  }

  function moveSelection(direction) {
    selectedIndex = Math.max(0, Math.min(pieces.length - 1, selectedIndex + direction));
    const piece = pieces[selectedIndex];
    if (piece) setActive(piece);
  }

  function resize() {
    const width = host.clientWidth;
    const height = host.querySelector('.rack-stage').clientHeight;
    if (!width || !height || destroyed) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function tick() {
    if (destroyed) return;
    raf = requestAnimationFrame(tick);
    const ease = reducedMotion() ? 1 : 0.085;
    currentX += (targetX - currentX) * ease;
    rail.position.x = currentX;
    const now = performance.now() * 0.001;
    pieces.forEach((piece, index) => {
      const data = piece.userData;
      const scale = data.targetScale;
      const y = data.targetY;
      piece.scale.setScalar(piece.scale.x + (scale - piece.scale.x) * (reducedMotion() ? 1 : 0.12));
      piece.position.y += (y - piece.position.y) * (reducedMotion() ? 1 : 0.1);
      if (!reducedMotion() && piece !== active) {
        piece.rotation.z = Math.sin(now * 0.85 + index * 0.58) * 0.018;
      } else if (reducedMotion()) {
        piece.rotation.z = 0;
      }
    });
    renderer.render(scene, camera);
  }

  const cleanup = [];
  cleanup.push(listen(canvas, 'pointerdown', onPointerDown));
  cleanup.push(listen(canvas, 'pointermove', onPointerMove));
  cleanup.push(listen(canvas, 'pointerup', onPointerUp));
  cleanup.push(listen(canvas, 'pointercancel', onPointerCancel));
  cleanup.push(listen(canvas, 'keydown', onKeyDown));
  cleanup.push(listen(window, 'resize', resize));
  cleanup.push(listen(host.querySelector('[data-rack-prev]'), 'click', () => moveSelection(-1)));
  cleanup.push(listen(host.querySelector('[data-rack-next]'), 'click', () => moveSelection(1)));

  function disposeWebGL() {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(raf);
    cleanup.forEach((fn) => fn());
    textures.forEach((texture) => texture.dispose());
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    scene.traverse((object) => {
      if (object.geometry && !geometries.includes(object.geometry)) object.geometry.dispose();
      if (object.material && !materials.includes(object.material)) {
        if (Array.isArray(object.material)) object.material.forEach((m) => m.dispose());
        else object.material.dispose();
      }
    });
    renderer.dispose();
  }

  function onContextLost(event) {
    event.preventDefault();
    if (fallbackInstance) return;
    disposeWebGL();
    fallbackInstance = mountFallback(host, products, tc, panelUI);
    host.__rackInstance = fallbackInstance;
  }
  cleanup.push(listen(canvas, 'webglcontextlost', onContextLost, false));

  resize();
  tick();

  const api = {
    mode: 'webgl',
    centerSku,
    setActive(product) {
      const piece = pieces.find((item) => item.userData.sku === product.sku);
      if (piece) setActive(piece);
    },
    clearActive,
    destroy() {
      if (fallbackInstance) {
        fallbackInstance.destroy();
        return;
      }
      disposeWebGL();
      panelUI.destroy();
      panelUI.clear();
      if (host.__rackInstance === api) delete host.__rackInstance;
    }
  };
  return api;
}

/* ------------------------------------------------------------------ mount */
export function mountRack(host, products, tc) {
  if (!host || host.__rackInstance) return host && host.__rackInstance;
  const catalogue = (products || (tc && tc.productList && tc.productList()) || [])
    .filter((product) => product && product.active !== false && product.sku &&
      ((product.images && product.images.front) || product.image));
  if (!catalogue.length) {
    const message = host.querySelector('[data-rack-status]');
    if (message) message.textContent = 'The collection is temporarily unavailable. Please visit the shop.';
    return null;
  }

  const panelUI = createPanel(host, catalogue, tc);
  const hudCleanup = bindHud(host, tc);
  let api = null;

  if (supportsWebGL()) api = mountWebGL(host, catalogue, tc, panelUI);
  if (!api) api = mountFallback(host, catalogue, tc, panelUI);

  if (!api) {
    panelUI.destroy();
    hudCleanup();
    return null;
  }

  let hudActive = true;
  const cleanupHud = () => {
    if (!hudActive) return;
    hudActive = false;
    hudCleanup();
    if (host.__rackCleanup === cleanupHud) delete host.__rackCleanup;
  };
  host.__rackCleanup = cleanupHud;
  const originalDestroy = api.destroy.bind(api);
  api.destroy = function () {
    originalDestroy();
    cleanupHud();
    if (host.__rackInstance === api) delete host.__rackInstance;
  };
  host.__rackInstance = api;
  host.dataset.rackMounted = 'true';
  return api;
}

/* ------------------------------------------------------------------ boot */
export async function bootRack() {
  const host = document.querySelector('[data-rack]');
  if (!host || host.__rackBooted) return;
  host.__rackBooted = true;

  const tc = window.TC;
  if (!tc) {
    const status = host.querySelector('[data-rack-status]');
    if (status) status.textContent = 'The store is still loading. Refresh to try again.';
    return;
  }

  if (!tc.state || !tc.state.ready) {
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        document.removeEventListener('tc:ready', finish);
        resolve();
      };
      document.addEventListener('tc:ready', finish, { once: true });
      setTimeout(finish, 4500);
    });
  }

  let products = tc.productList ? tc.productList() : [];
  if (!products.length) {
    try {
      const response = await fetch('config.json', { headers: { Accept: 'application/json' } });
      if (response.ok) {
        const config = await response.json();
        products = Object.values(config.products || {}).filter((product) => product.active !== false);
        host.classList.add('is-catalogue-offline');
      }
    } catch (_) { /* status message below */ }
  }

  const api = mountRack(host, products, tc);
  if (!api) {
    const status = host.querySelector('[data-rack-status]');
    if (status) status.textContent = 'The collection could not be loaded. Please try the shop instead.';
  }
}
