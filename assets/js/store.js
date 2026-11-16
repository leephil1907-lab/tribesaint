/* ==========================================================================
   TRIBE CULTURE — storefront runtime
   Catalogue, bag, drawer, navigation, forms. No framework, no dependencies.
   ========================================================================== */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const CONFIG = {
    apiBase: '',
    currency: 'NGN',
    symbol: '₦',
    freeDeliveryOver: 150000,
    bagKey: 'tc_bag_v2',
    customerKey: 'tc_customer_v1',
    signupKey: 'tc_signups_v1',
    lowStock: 3
  };

  const state = {
    catalogue: null,
    bag: [],
    ready: false,
    listeners: new Set()
  };

  /* ------------------------------------------------------------------ utils */
  const money = (n, sym) => (sym || CONFIG.symbol) + Number(n || 0).toLocaleString('en-NG');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const product = (sku) => (state.catalogue && state.catalogue.products ? state.catalogue.products[sku] : null);
  const stockOf = (sku, size) => {
    const p = product(sku);
    if (!p || !p.stock) return null;
    const v = p.stock[size];
    return typeof v === 'number' ? v : null;
  };
  const bagCount = () => state.bag.reduce((a, l) => a + l.qty, 0);
  const bagSubtotal = () => state.bag.reduce((a, l) => a + (product(l.sku) ? product(l.sku).price : 0) * l.qty, 0);

  function emit() { state.listeners.forEach((fn) => { try { fn(); } catch (e) { /* keep other listeners alive */ } }); }
  function on(fn) { state.listeners.add(fn); if (state.ready) fn(); return () => state.listeners.delete(fn); }

  /* ------------------------------------------------------------------ toast */
  let toastTimer;
  function toast(msg, kind) {
    let el = $('#toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.toggle('err', kind === 'err');
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  /* ------------------------------------------------------------------ bag */
  function loadBag() {
    try {
      const raw = JSON.parse(localStorage.getItem(CONFIG.bagKey) || '[]');
      state.bag = Array.isArray(raw) ? raw.filter((l) => l && l.sku && l.size && l.qty > 0) : [];
    } catch { state.bag = []; }
  }
  function saveBag() {
    try { localStorage.setItem(CONFIG.bagKey, JSON.stringify(state.bag)); } catch {}
    emit();
  }

  function addToBag(sku, size, qty) {
    const p = product(sku);
    if (!p) { toast('That piece is unavailable', 'err'); return false; }
    if (!size) { toast('Choose a size first', 'err'); return false; }
    const lvl = stockOf(sku, size);
    if (lvl === 0) { toast('Sold out in ' + size, 'err'); return false; }
    const want = Math.max(1, Math.floor(Number(qty) || 1));
    const line = state.bag.find((l) => l.sku === sku && l.size === size);
    const next = (line ? line.qty : 0) + want;
    if (lvl !== null && next > lvl) { toast('Only ' + lvl + ' left in ' + size, 'err'); return false; }
    if (line) line.qty = next; else state.bag.push({ sku, size, qty: want });
    saveBag();
    openBag();
    toast('Added — ' + p.name + ', ' + size);
    return true;
  }
  function setQty(i, qty) {
    const line = state.bag[i];
    if (!line) return;
    const lvl = stockOf(line.sku, line.size);
    if (qty <= 0) { state.bag.splice(i, 1); saveBag(); renderBag(); return; }
    if (lvl !== null && qty > lvl) { toast('Only ' + lvl + ' left', 'err'); return; }
    line.qty = qty; saveBag(); renderBag();
  }

  /* ------------------------------------------------------------------ navigation */
  function initNav() {
    const sheet = $('#navSheet');
    const openBtn = $('#navOpen');
    const closeBtn = $('#navClose');
    if (sheet && openBtn) {
      const open = () => { sheet.classList.add('open'); sheet.setAttribute('aria-hidden', 'false'); document.body.classList.add('lock'); openBtn.setAttribute('aria-expanded', 'true'); const f = sheet.querySelector('a,button'); if (f) f.focus(); };
      const close = () => { sheet.classList.remove('open'); sheet.setAttribute('aria-hidden', 'true'); document.body.classList.remove('lock'); openBtn.setAttribute('aria-expanded', 'false'); openBtn.focus(); };
      openBtn.addEventListener('click', open);
      if (closeBtn) closeBtn.addEventListener('click', close);
      sheet.addEventListener('click', (e) => { if (e.target.closest('a')) close(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheet.classList.contains('open')) close(); });
    }
    // mark the current page in both navs
    const here = location.pathname.split('/').pop() || 'index.html';
    $$('.nav-main a, .nav-sheet-links a').forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (href === here || (here === 'index.html' && href === './')) a.setAttribute('aria-current', 'page');
    });
  }

  /* ------------------------------------------------------------------ bag drawer */
  let lastFocus = null;
  function openBag() {
    const drawer = $('#bagDrawer');
    const scrim = $('#scrim');
    if (!drawer) { location.href = 'bag.html'; return; }
    lastFocus = document.activeElement;
    renderBag();
    if (scrim) { scrim.hidden = false; requestAnimationFrame(() => scrim.classList.add('show')); }
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('lock');
    setTimeout(() => { const c = $('#bagClose'); if (c) c.focus(); }, 60);
  }
  function closeBag() {
    const drawer = $('#bagDrawer');
    const scrim = $('#scrim');
    if (!drawer) return;
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    if (scrim) scrim.classList.remove('show');
    document.body.classList.remove('lock');
    setTimeout(() => { if (scrim && !$('.modal.show')) scrim.hidden = true; }, 380);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function renderBag() {
    const count = bagCount();
    $$('[data-bag-count]').forEach((el) => { el.textContent = String(count); });
    const list = $('#bagList');
    if (!list) return;

    $('#bagSub') && ($('#bagSub').textContent = count === 1 ? '1 piece' : count + ' pieces');

    if (!state.bag.length) {
      list.innerHTML = `
        <div class="bag-empty">
          <span class="script" style="font-size:30px;color:var(--parch)">Nothing here yet</span>
          <p class="small">The Saint tee and the Cadet Cap are waiting.</p>
          <a class="btn ghost sm" href="shop.html"><span>Shop Drop 001</span></a>
        </div>`;
    } else {
      list.innerHTML = state.bag.map((line, i) => {
        const p = product(line.sku);
        if (!p) return '';
        const lvl = stockOf(line.sku, line.size);
        return `
        <div class="bag-line">
          <img src="${p.image}" alt="" width="64" height="64" loading="lazy">
          <div>
            <div class="nm">${esc(p.name)}</div>
            <div class="mt">${esc(p.variant)} · ${line.size === 'ONE SIZE' ? 'One size' : 'Size ' + esc(line.size)}</div>
            <div class="qty">
              <button type="button" data-qty="-1" data-i="${i}" aria-label="Decrease quantity">−</button>
              <span>${line.qty}</span>
              <button type="button" data-qty="1" data-i="${i}" aria-label="Increase quantity" ${lvl !== null && line.qty >= lvl ? 'disabled' : ''}>+</button>
            </div>
            ${lvl !== null && lvl > 0 && lvl <= CONFIG.lowStock ? `<div class="mt" style="color:var(--red)">Only ${lvl} left</div>` : ''}
          </div>
          <div class="rt">
            <span class="lp">${money(p.price * line.qty)}</span>
            <button class="rm" type="button" data-remove="${i}">Remove</button>
          </div>
        </div>`;
      }).join('');
    }

    const sub = bagSubtotal();
    $('#bagSubtotal') && ($('#bagSubtotal').textContent = money(sub));
    $('#bagTotal') && ($('#bagTotal').textContent = money(sub));
    const checkoutBtn = $('#bagCheckout');
    if (checkoutBtn) checkoutBtn.disabled = !state.bag.length;

    const meter = $('#shipMeter');
    if (meter) {
      const pct = Math.min(100, Math.round((sub / CONFIG.freeDeliveryOver) * 100));
      meter.innerHTML = sub >= CONFIG.freeDeliveryOver
        ? `Free delivery unlocked<span class="bar"><i style="width:100%"></i></span>`
        : `Add <b>${money(CONFIG.freeDeliveryOver - sub)}</b> for free delivery<span class="bar"><i style="width:${pct}%"></i></span>`;
    }
  }

  function initBag() {
    $$('[data-open-bag]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); openBag(); }));
    const close = $('#bagClose');
    if (close) close.addEventListener('click', closeBag);
    const scrim = $('#scrim');
    if (scrim) scrim.addEventListener('click', () => { closeBag(); $$('.modal.show').forEach(closeModal); });
    const list = $('#bagList');
    if (list) {
      list.addEventListener('click', (e) => {
        const rm = e.target.closest('[data-remove]');
        if (rm) { state.bag.splice(Number(rm.dataset.remove), 1); saveBag(); renderBag(); return; }
        const q = e.target.closest('[data-qty]');
        if (q) { const i = Number(q.dataset.i); setQty(i, state.bag[i].qty + Number(q.dataset.qty)); }
      });
    }
    const go = $('#bagCheckout');
    if (go) go.addEventListener('click', () => { location.href = 'checkout.html'; });
    window.addEventListener('storage', (e) => { if (e.key === CONFIG.bagKey) { loadBag(); renderBag(); } });
  }

  /* ------------------------------------------------------------------ modals */
  function openModal(id) {
    const m = typeof id === 'string' ? document.getElementById(id) : id;
    if (!m) return;
    const scrim = $('#scrim');
    if (scrim) { scrim.hidden = false; requestAnimationFrame(() => scrim.classList.add('show')); }
    m.classList.add('show'); m.setAttribute('aria-hidden', 'false');
    document.body.classList.add('lock');
    const f = m.querySelector('input,select,textarea,button,a');
    if (f) setTimeout(() => f.focus(), 80);
  }
  function closeModal(m) {
    const el = typeof m === 'string' ? document.getElementById(m) : m;
    if (!el) return;
    el.classList.remove('show'); el.setAttribute('aria-hidden', 'true');
    if (!$('#bagDrawer.open') && !$('#navSheet.open')) {
      document.body.classList.remove('lock');
      const scrim = $('#scrim');
      if (scrim) setTimeout(() => { if (!$('#bagDrawer.open')) { scrim.classList.remove('show'); scrim.hidden = true; } }, 300);
    }
  }
  function initModals() {
    document.addEventListener('click', (e) => {
      const opener = e.target.closest('[data-modal]');
      if (opener) { e.preventDefault(); openModal(opener.dataset.modal); return; }
      const closer = e.target.closest('[data-close-modal]');
      if (closer) { e.preventDefault(); closeModal(closer.closest('.modal')); return; }
      if (e.target.classList && e.target.classList.contains('modal')) closeModal(e.target);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const open = $$('.modal.show');
      if (open.length) { closeModal(open[open.length - 1]); return; }
      if ($('#bagDrawer.open')) closeBag();
    });
    // light focus trap
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const scope = $('#navSheet.open') || $('#bagDrawer.open') || $('.modal.show');
      if (!scope) return;
      const items = $$('a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])', scope).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  /* ------------------------------------------------------------------ size table */
  const SIZE_TABLE = [
    { s: 'S', chest: [21, 53.5], len: [26.5, 67.5], sleeve: [8.5, 21.5] },
    { s: 'M', chest: [22.5, 57], len: [27.5, 70], sleeve: [9, 23] },
    { s: 'L', chest: [24, 61], len: [28.5, 72.5], sleeve: [9.5, 24] },
    { s: 'XL', chest: [25.5, 65], len: [29.5, 75], sleeve: [10, 25.5] },
    { s: 'XXL', chest: [27, 69], len: [30.5, 77.5], sleeve: [10.5, 26.5] }
  ];
  function renderSizeTable(host, unit) {
    if (!host) return;
    const idx = unit === 'cm' ? 1 : 0;
    const u = unit === 'cm' ? 'cm' : 'in';
    host.innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr><th>Size</th><th>Chest (${u})</th><th>Body length (${u})</th><th>Sleeve (${u})</th></tr></thead>
      <tbody>${SIZE_TABLE.map((r) => `<tr><td><strong style="color:var(--bone)">${r.s}</strong></td><td>${r.chest[idx]}</td><td>${r.len[idx]}</td><td>${r.sleeve[idx]}</td></tr>`).join('')}</tbody>
    </table></div>`;
  }
  function initSizeGuide() {
    $$('[data-size-table]').forEach((host) => renderSizeTable(host, 'in'));
    document.addEventListener('click', (e) => {
      const u = e.target.closest('[data-unit]');
      if (!u) return;
      const scope = u.closest('.modal, section, .card') || document;
      $$('[data-unit]', scope).forEach((b) => b.classList.toggle('on', b === u));
      $$('[data-size-table]', scope).forEach((h) => renderSizeTable(h, u.dataset.unit));
    });
  }

  /* ------------------------------------------------------------------ catalogue */
  async function loadCatalogue(force) {
    if (state.catalogue && !force) return state.catalogue;
    try {
      const res = await fetch(CONFIG.apiBase + '/api/catalogue', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('catalogue ' + res.status);
      const data = await res.json();
      if (!data || !data.ok) throw new Error('catalogue payload');
      state.catalogue = data;
    } catch (err) {
      state.catalogue = state.catalogue || { ok: false, offline: true, currency: CONFIG.currency, currency_symbol: CONFIG.symbol, shipping: { NG: { label: 'Nigeria', amount: 3000, eta: '2–5 business days' }, INTL: { label: 'International', amount: 25000, eta: '5–10 business days' } }, products: {} };
    }
    if (state.catalogue.currency_symbol) CONFIG.symbol = state.catalogue.currency_symbol;
    if (state.catalogue.free_delivery_over) CONFIG.freeDeliveryOver = state.catalogue.free_delivery_over;
    state.ready = true;
    emit();
    return state.catalogue;
  }
  const productList = () => Object.values(state.catalogue && state.catalogue.products ? state.catalogue.products : {}).filter((p) => p.active !== false);

  /* ------------------------------------------------------------------ newsletter */
  async function submitSignup(email) {
    try {
      const list = JSON.parse(localStorage.getItem(CONFIG.signupKey) || '[]');
      if (!list.includes(email)) list.push(email);
      localStorage.setItem(CONFIG.signupKey, JSON.stringify(list));
    } catch {}
    try {
      const res = await fetch(CONFIG.apiBase + '/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      const json = await res.json();
      return json.message || 'Welcome to the Tribe.';
    } catch { return 'Welcome to the Tribe.'; }
  }
  function initNewsletter() {
    $$('form[data-newsletter]').forEach((form) => {
      const input = form.querySelector('input[type="email"]');
      const note = form.parentElement.querySelector('.form-note') || form.querySelector('.form-note');
      const btn = form.querySelector('button[type="submit"]');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = (input.value || '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
          input.setAttribute('aria-invalid', 'true');
          if (note) { note.className = 'form-note err'; note.textContent = 'Enter a valid email address.'; }
          input.focus(); return;
        }
        input.setAttribute('aria-invalid', 'false');
        if (btn) { btn.disabled = true; btn.textContent = 'Joining…'; }
        const msg = await submitSignup(email);
        if (note) { note.className = 'form-note ok'; note.textContent = msg; }
        input.value = '';
        if (btn) { btn.disabled = false; btn.textContent = 'Join'; }
        toast('Joined the Tribe list');
      });
      if (input) input.addEventListener('input', () => input.setAttribute('aria-invalid', 'false'));
    });
  }

  /* ------------------------------------------------------------------ entrance */
  function entrance() {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { document.body.classList.add('no-motion', 'ready'); return; }
    requestAnimationFrame(() => document.body.classList.add('ready'));
  }

  /* ------------------------------------------------------------------ boot */

  /* ------------------------------------------------------------ whatsapp */
  function initWhatsApp() {
    const cat = state.catalogue || {};
    const number = (cat.whatsapp || state.whatsapp || '').replace(/\D/g, '');
    if (!number) return;
    const msg = cat.whatsapp_message || 'Hi Tribe Culture — I have a question about Drop 001.';
    const href = 'https://wa.me/' + number + '?text=' + encodeURIComponent(msg);

    /* every static WhatsApp link on the page follows the catalogue number */
    $$('[data-wa-link]').forEach((el) => {
      const text = el.dataset.waText || msg;
      el.href = 'https://wa.me/' + number + '?text=' + encodeURIComponent(text);
      el.target = '_blank';
      el.rel = 'noopener';
    });

    if (document.getElementById('waFab')) return;
    const a = document.createElement('a');
    a.id = 'waFab';
    a.className = 'wa-fab';
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.setAttribute('aria-label', 'Chat with Tribe Culture on WhatsApp');
    a.innerHTML = `
      <img class="wa-ico" src="assets/brand/partners/whatsapp.svg" alt="" aria-hidden="true" width="26" height="26">
      <span class="wa-tip">Chat on WhatsApp</span>`;
    document.body.appendChild(a);

    // reveal once the page has settled
    setTimeout(() => a.classList.add('on'), 900);
    a.addEventListener('mouseenter', () => a.classList.add('open'));
    a.addEventListener('mouseleave', () => a.classList.remove('open'));
  }


  /* ---------------------------------------------------------------- theme */
  const THEME_KEY = 'tc-theme';
  const THEME_META = { dark: '#050505', light: '#f4ecdd' };

  function currentTheme() {
    return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  }

  function paintThemeMeta(theme) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_META[theme] || THEME_META.dark);
    $$('[data-theme-toggle]').forEach((b) => {
      b.setAttribute('aria-pressed', String(theme === 'light'));
      b.setAttribute('aria-label', theme === 'light' ? 'Switch to ink theme' : 'Switch to daylight theme');
      const label = b.querySelector('.sheet-theme-label');
      if (label) label.textContent = theme === 'light' ? 'Ink mode' : 'Daylight mode';
    });
  }

  function setTheme(theme, opts) {
    const next = theme === 'light' ? 'light' : 'dark';
    document.documentElement.classList.add('theme-anim');
    if (next === 'light') document.documentElement.dataset.theme = 'light';
    else delete document.documentElement.dataset.theme;
    try { localStorage.setItem(THEME_KEY, next); } catch {}
    paintThemeMeta(next);
    clearTimeout(setTheme._t);
    setTheme._t = setTimeout(() => document.documentElement.classList.remove('theme-anim'), 480);
    if (opts && opts.pulse) {
      const btn = opts.pulse;
      btn.classList.remove('pulse');
      void btn.offsetWidth;
      btn.classList.add('pulse');
      setTimeout(() => btn.classList.remove('pulse'), 720);
    }
    return next;
  }

  function initTheme() {
    paintThemeMeta(currentTheme());
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-theme-toggle]');
      if (!btn) return;
      e.preventDefault();
      setTheme(currentTheme() === 'light' ? 'dark' : 'light', { pulse: btn.classList.contains('icon-btn') ? btn : null });
      if (btn.classList.contains('sheet-theme')) {
        const sheet = $('#navSheet');
        if (sheet && sheet.classList.contains('open')) {
          sheet.classList.remove('open');
          sheet.setAttribute('aria-hidden', 'true');
          document.body.classList.remove('lock');
          const openBtn = $('#navOpen');
          if (openBtn) openBtn.setAttribute('aria-expanded', 'false');
        }
      }
    });
    /* ink is the house default; the visitor's choice is the only thing that moves it */
    if (currentTheme() === 'light') document.documentElement.dataset.theme = 'light';
    paintThemeMeta(currentTheme());
  }


  /* ---------------------------------------------------------------- motion */
  function initMotion() {
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* 1. scroll reveal — everything marked .reveal, plus section heads and cards */
    const targets = $$('.reveal, .sec-head, .page-head, .card, .info-card, .live-card, .panel, .split-media, .foot-brand')
      .filter((el) => !el.closest('.stage, .no-reveal'));

    if (reduce || !('IntersectionObserver' in window)) {
      targets.forEach((el) => el.classList.add('in'));
    } else {
      targets.forEach((el) => { if (!el.classList.contains('reveal')) el.classList.add('reveal'); });
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
      targets.forEach((el) => io.observe(el));

      /* elements injected later (grids, admin rows, related pieces) */
      const mo = new MutationObserver((records) => {
        records.forEach((r) => r.addedNodes && r.addedNodes.forEach((n) => {
          if (!(n instanceof HTMLElement)) return;
          $$('.card, .reveal', n).forEach((el) => {
            if (el.classList.contains('in')) return;
            if (!el.classList.contains('reveal')) el.classList.add('reveal');
            io.observe(el);
          });
        }));
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }

    /* 2. soft image settle */
    $$('main img, .grid-products img').forEach((img) => {
      if (img.complete && img.naturalWidth) return;
      img.addEventListener('load', () => img.classList.add('settle'), { once: true });
    });

    /* 3. cross-document view transitions where supported, else the curtain */
    if (document.startViewTransition === undefined) {
      document.addEventListener('click', (e) => {
        const a = e.target.closest('a[href]');
        if (!a) return;
        const href = a.getAttribute('href');
        if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
        if (a.target === '_blank' || a.hasAttribute('download')) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        const url = new URL(a.href, location.href);
        if (url.origin !== location.origin) return;
        if (url.pathname === location.pathname && url.search === location.search) return;
        if (reduce) return;
        e.preventDefault();
        const veil = document.createElement('div');
        veil.className = 'curtain';
        veil.style.animationDirection = 'normal';
        document.body.appendChild(veil);
        setTimeout(() => { location.href = a.href; }, 240);
      });
    }

    /* 4. parallax on the hero lockup (transform only, no layout thrash) */
    const hero = $('.hero .hero-copy') || $('.hero .wrap');
    if (hero && !reduce) {
      let raf = 0;
      const onScroll = () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          const y = Math.min(window.scrollY, 600);
          hero.style.transform = y < 4 ? '' : 'translate3d(0,' + (-y * 0.045).toFixed(2) + 'px,0)';
          raf = 0;
        });
      };
      window.addEventListener('scroll', onScroll, { passive: true });
    }
  }

  async function boot() {
    initTheme();
    initMotion();
    loadBag();
    initNav();
    initBag();
    initModals();
    initSizeGuide();
    initNewsletter();
    renderBag();
    entrance();
    await loadCatalogue();
    initWhatsApp();
    document.dispatchEvent(new CustomEvent('tc:ready', { detail: state.catalogue }));
  }

  window.TC = {
    CONFIG, state, money, esc, product, productList, stockOf,
    bagCount, bagSubtotal, addToBag, openBag, closeBag, renderBag,
    openModal, closeModal, toast, on, loadCatalogue, submitSignup, setQty,
    SIZE_TABLE, renderSizeTable, initWhatsApp, setTheme, currentTheme, initMotion
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
