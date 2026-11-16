/* ==========================================================================
   TRIBE CULTURE — page controllers
   Each controller no-ops unless its markup exists on the page.
   ========================================================================== */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const TC = window.TC;
  if (!TC) return;

  const money = (n) => TC.money(n);
  const esc = TC.esc;

  /* ------------------------------------------------------------- helpers */
  function totalStock(p) {
    if (typeof p.stock_total === 'number') return p.stock_total;
    return (p.sizes || []).reduce((a, s) => a + (typeof p.stock[s] === 'number' ? p.stock[s] : 0), 0);
  }

  function stockNote(p) {
    const total = totalStock(p);
    if (!total) return 'Sold out — restocking';
    const low = (p.sizes || []).filter((s) => typeof p.stock[s] === 'number' && p.stock[s] > 0 && p.stock[s] <= TC.CONFIG.lowStock);
    if (p.sizes.length === 1) return total + ' in stock · adjustable';
    if (low.length) return 'Low stock: ' + low.join(', ') + ' · ' + total + ' pieces left';
    return total + ' pieces in stock';
  }

  /** the grid copy of a shot: same photograph, sized for a card */
  function thumb(src) {
    return String(src || '').replace('/assets/products/', '/assets/products/cards/')
      .replace('/products/', '/products/cards/');
  }

  /** product card used by home / shop / related */
  function cardHTML(p) {
    return `
    <article class="card${totalStock(p) === 0 ? ' is-sold' : ''}" data-card="${esc(p.sku)}">
      <a class="card-media" href="product.html?sku=${encodeURIComponent(p.sku)}" aria-label="${esc(p.name)} — ${esc(p.variant)}${totalStock(p) === 0 ? ', sold out' : ''}">
        <img class="on shot" data-shot="front" src="assets/products/card/${esc(p.sku)}.webp" alt="${esc(p.name)}, ${esc(p.variant)}" loading="lazy" decoding="async" width="520" height="520">
        <img class="shot" data-shot="back" src="assets/products/card/${esc(p.sku)}-back.webp" alt="" loading="lazy" decoding="async" width="520" height="520">
        <span class="badge">${esc(p.badge || 'Drop 001')}</span>
        ${totalStock(p) === 0 ? '<span class="sold-badge">Sold out</span>' : ''}
        <span class="views" role="group" aria-label="Product view">
          <button type="button" class="on" data-view="front" aria-pressed="true">1</button>
          <button type="button" data-view="back" aria-pressed="false">2</button>
        </span>
      </a>
      <div class="card-body">
        <div>
          <h3 class="disp"><a href="product.html?sku=${encodeURIComponent(p.sku)}">${esc(p.name)}</a></h3>
          <div class="variant">${esc(p.variant)}</div>
        </div>
        <span class="price">${money(p.price)}</span>
      </div>
      <div class="card-sizes" data-sizes="${esc(p.sku)}" role="group" aria-label="Size for ${esc(p.name)}">
        ${p.sizes.map((s) => {
          const lvl = p.stock[s];
          const sold = lvl === 0;
          return `<button class="pill${sold ? ' sold' : ''}" type="button" data-size="${esc(s)}" aria-pressed="false" ${sold ? 'disabled title="Sold out"' : ''}>${s === 'ONE SIZE' ? 'One size' : esc(s)}</button>`;
        }).join('')}
      </div>
      <div class="card-foot">
        ${totalStock(p) === 0
          ? `<button class="btn ghost" type="button" disabled><span>Sold out · restocking</span></button>`
          : `<button class="btn${p.sizes.length === 1 ? '' : ' ghost'}" type="button" data-add="${esc(p.sku)}" ${p.sizes.length === 1 ? '' : 'data-needs-size="1"'}>
          <span>${p.sizes.length === 1 ? 'Add to bag · ' + money(p.price) : 'Select a size'}</span>
        </button>`}
        <p class="hint">${esc(stockNote(p))}</p>
      </div>
    </article>`;
  }

  /** wire view toggles, size picks and add-to-bag for a grid host */
  function wireCards(host) {
    if (!host || host.dataset.wired) return;
    host.dataset.wired = '1';
    const picked = {};

    host.addEventListener('click', (e) => {
      const viewBtn = e.target.closest('[data-view]');
      if (viewBtn) {
        e.preventDefault();
        const media = viewBtn.closest('.card-media');
        if (!media) return;
        const which = viewBtn.dataset.view;
        $$('[data-shot]', media).forEach((img) => img.classList.toggle('on', img.dataset.shot === which));
        $$('[data-view]', media).forEach((b) => {
          const on = b === viewBtn;
          b.classList.toggle('on', on);
          b.setAttribute('aria-pressed', String(on));
        });
        return;
      }

      const sizeBtn = e.target.closest('[data-size]');
      if (sizeBtn && !sizeBtn.disabled) {
        const group = sizeBtn.closest('[data-sizes]');
        const sku = group.dataset.sizes;
        picked[sku] = sizeBtn.dataset.size;
        $$('[data-size]', group).forEach((b) => b.setAttribute('aria-pressed', String(b === sizeBtn)));
        const addBtn = sizeBtn.closest('.card').querySelector(`[data-add="${sku}"]`);
        const add = addBtn ? addBtn.querySelector('span') : null;
        const p = TC.product(sku);
        if (add && p) add.textContent = 'Add to bag · ' + money(p.price);
        if (addBtn) addBtn.classList.remove('ghost');
        return;
      }

      const addBtn = e.target.closest('[data-add]');
      if (addBtn) {
        const sku = addBtn.dataset.add;
        const p = TC.product(sku);
        if (!p) return;
        const size = p.sizes.length === 1 ? p.sizes[0] : picked[sku];
        if (!size) {
          TC.toast('Choose your size first', 'err');
          const group = host.querySelector(`[data-sizes="${sku}"]`);
          if (group) group.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
        TC.addToBag(sku, size);
      }
    });

    // hover swap on pointer devices
    if (matchMedia('(hover:hover)').matches) {
      $$('.card-media', host).forEach((media) => {
        const imgs = $$('[data-shot]', media);
        if (imgs.length < 2) return;
        media.addEventListener('mouseenter', () => imgs.forEach((i, idx) => i.classList.toggle('on', idx === 1)));
        media.addEventListener('mouseleave', () => imgs.forEach((i, idx) => i.classList.toggle('on', idx === 0)));
      });
    }
  }

  /* --------------------------------------------------------------- home */
  /* --------------------------------------------------------------- home rack
     The collection is a horizontal rack: the whole catalogue, filter pills built
     from the real categories in config.json, and cards wired to the same
     add-to-bag path as everywhere else. Nothing new is invented — only laid out. */
  const CAT_LABEL = { tees: 'Tees', tanks: 'Tanks', sets: 'Sets', headwear: 'Headwear', prints: 'Prints' };

  function initHome() {
    const host = $('#homeRack');
    if (!host) return;
    const bar = $('#rackBar');
    const countEl = $('#rackCount');
    let active = 'all';

    const draw = () => {
      const all = TC.productList();
      if (!all.length) return;

      const cats = [];
      all.forEach((p) => { if (p.category && cats.indexOf(p.category) === -1) cats.push(p.category); });

      if (bar && !bar.dataset.built) {
        bar.dataset.built = '1';
        bar.innerHTML = '<span class="count" id="rackCount">' + all.length + ' pieces</span>' +
          ['all'].concat(cats).map((c) => `<button type="button" data-cat="${c}" aria-pressed="${c === 'all'}">${c === 'all' ? 'All' : (CAT_LABEL[c] || c)}</button>`).join('');
        bar.addEventListener('click', (e) => {
          const b = e.target.closest('[data-cat]');
          if (!b) return;
          active = b.dataset.cat;
          $$('[data-cat]', bar).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
          host.classList.add('is-filtering');
          setTimeout(() => { paint(); host.classList.remove('is-filtering'); }, 180);
        });
      }

      paint();
    };

    const paint = () => {
      const all = TC.productList();
      const list = active === 'all' ? all : all.filter((p) => p.category === active);
      host.innerHTML = list.map(cardHTML).join('');
      wireCards(host);
      const countEl = $('#rackCount');
      if (countEl) countEl.textContent = list.length + (list.length === 1 ? ' piece' : ' pieces');
      const prev = $('#rackPrev'), next = $('#rackNext');
      if (prev) prev.disabled = host.scrollLeft < 8;
      if (next) next.disabled = host.scrollLeft + host.clientWidth >= host.scrollWidth - 8;
    };

    const step = (dir) => {
      const card = host.querySelector('.card');
      const w = card ? card.getBoundingClientRect().width + 16 : host.clientWidth * 0.8;
      host.scrollBy({ left: dir * w, behavior: 'smooth' });
    };
    $('#rackPrev')?.addEventListener('click', () => step(-1));
    $('#rackNext')?.addEventListener('click', () => step(1));
    host.addEventListener('scroll', () => {
      const prev = $('#rackPrev'), next = $('#rackNext');
      if (prev) prev.disabled = host.scrollLeft < 8;
      if (next) next.disabled = host.scrollLeft + host.clientWidth >= host.scrollWidth - 8;
    }, { passive: true });

    TC.on(draw);
    draw();
  }

  /* --------------------------------------------------------- zine plate swap */
  function initZine() {
    const img = $('#zineImg');
    if (!img) return;
    const cap = $('#zineCaption');
    const plates = {
      print: {
        src: 'assets/brand/hero-backprint.jpg',
        webp: 'assets/brand/hero-backprint.webp',
        alt: 'The Saint print: arched red SAINT lettering, three doves, the doctrine line and the globes.',
        cap: 'Screen printed plastisol, cured by hand. Red on black, bone on black — nothing else.'
      },
      crest: {
        src: 'assets/brand/crest-ink.jpg',
        webp: null,
        alt: 'The Tribe Culture crest: baroque script wordmark, established MMXXVI.',
        cap: 'The house crest, drawn in Lagos. Baroque script, the mark on every parcel and every receipt.'
      }
    };
    document.querySelectorAll('[data-zine]').forEach((b) => b.addEventListener('click', () => {
      const p = plates[b.dataset.zine];
      if (!p) return;
      document.querySelectorAll('[data-zine]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      const src = b.dataset.zine === 'crest' ? p.src : ((window.matchMedia && matchMedia('(min-width:0px)').matches && img.currentSrc.endsWith('.webp')) ? p.webp : p.src);
      img.src = src || p.src;
      img.alt = p.alt;
      if (cap) cap.textContent = p.cap;
    }));
  }

  /* ------------------------------------------------------------- lookbook
     Six frames, six different people and garments, cross-fading on a slow
     beat. The caption and the flat-print inset follow whichever frame is up,
     and the whole thing stops for reduced-motion or the motion switch. */
  function initLookbook() {
    const host = $('#heroFrames');
    if (!host) return;
    const frames = Array.from(host.querySelectorAll('.hero-frame'));
    if (frames.length < 2) return;

    const dots = $('#heroDots');
    const worn = $('#heroWorn');
    const wornMeta = $('#heroWornMeta');
    const wornLink = $('#heroWornLink');
    const inset = $('#heroInset');
    const insetImg = $('#heroInsetImg');
    const insetK = $('#heroInsetK');
    const reduce = () => document.documentElement.dataset.motion === 'off' ||
      (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

    if (dots) {
      dots.innerHTML = frames.map((f, n) =>
        `<button type="button" data-hero="${n}" aria-pressed="${n === 0}" aria-label="Look ${n + 1}: ${TC.esc(f.dataset.k)}"></button>`).join('');
    }

    let i = 0, timer = 0;

    const show = (n) => {
      i = ((n % frames.length) + frames.length) % frames.length;
      frames.forEach((f, k) => f.classList.toggle('is-on', k === i));
      const f = frames[i];
      const href = 'product.html?sku=' + encodeURIComponent(f.dataset.sku);
      if (worn) worn.textContent = f.dataset.k;
      if (wornMeta) wornMeta.textContent = f.dataset.p;
      if (wornLink) wornLink.href = href;
      if (inset) { inset.href = href; inset.setAttribute('aria-label', f.dataset.k + ' — ' + f.dataset.insetK); }
      if (insetImg && f.dataset.inset) {
        insetImg.src = f.dataset.inset;
        insetImg.alt = f.dataset.k + ' — ' + f.dataset.insetK;
      }
      if (insetK) insetK.textContent = f.dataset.insetK;
      if (dots) Array.from(dots.children).forEach((b, k) => b.setAttribute('aria-pressed', String(k === i)));
    };

    const start = () => {
      stop();
      if (reduce()) return;
      timer = setInterval(() => show(i + 1), 5600);
    };
    const stop = () => { if (timer) { clearInterval(timer); timer = 0; } };

    if (dots) {
      dots.addEventListener('click', (e) => {
        const b = e.target.closest('[data-hero]');
        if (!b) return;
        show(Number(b.dataset.hero));
        start();
      });
    }

    /* pause while the pointer is over the picture or the tab is hidden */
    const shot = $('#heroShot');
    if (shot) {
      shot.addEventListener('pointerenter', stop);
      shot.addEventListener('pointerleave', start);
      shot.addEventListener('focusin', stop);
    }
    document.addEventListener('visibilitychange', () => { document.hidden ? stop() : start(); });
    document.addEventListener('tc:motion', start);

    show(0);
    start();
  }

  /* ------------------------------------------------- metric counters + magnet */
  function initEditorialMotion() {
    const nums = $$('.metric b[data-count]');
    const reduce = document.body.classList.contains('no-motion') ||
      (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const paint = (el, v) => {
      const pre = el.dataset.prefix || '';
      const suf = el.dataset.suffix || '';
      const num = Math.round(v).toLocaleString('en-NG');
      if (!pre && !suf) { el.textContent = num; return; }
      el.innerHTML = (pre ? `<span class="u">${pre}</span>` : '') + num + (suf ? `<span class="u">${suf}</span>` : '');
    };
    if (!nums.length) return;
    if (reduce || !('IntersectionObserver' in window)) { nums.forEach((el) => paint(el, +el.dataset.count)); }
    else {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          const el = en.target;
          io.unobserve(el);
          const target = +el.dataset.count;
          const t0 = performance.now();
          const tick = (now) => {
            const p = Math.min(1, (now - t0) / 1100);
            paint(el, target * (1 - Math.pow(1 - p, 3)));
            if (p < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });
      }, { threshold: 0.4 });
      nums.forEach((el) => io.observe(el));
    }

    /* magnetic buttons: the label leans toward the cursor, then settles */
    if (reduce) return;
    $$('.magnetic').forEach((btn) => {
      let raf = 0;
      const move = (e) => {
        const r = btn.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / r.width;
        const dy = (e.clientY - (r.top + r.height / 2)) / r.height;
        btn.style.transform = `translate(${(dx * 7).toFixed(2)}px,${(dy * 5).toFixed(2)}px)`;
      };
      btn.addEventListener('pointermove', move);
      btn.addEventListener('pointerleave', () => { btn.style.transform = ''; });
    });
  }

  /* --------------------------------------------------------------- shop */
  function initShop() {
    const host = $('#shopGrid');
    if (!host) return;

    const catSel = $('#shopCategory');
    const famSel = $('#shopFamily');
    const sortSel = $('#shopSort');
    const countEl = $('#shopCount');

    const params = new URLSearchParams(location.search);
    let category = params.get('category') || 'all';
    let family = params.get('family') || 'all';
    let sort = params.get('sort') || 'featured';

    const syncUrl = () => {
      const q = new URLSearchParams();
      if (category !== 'all') q.set('category', category);
      if (family !== 'all') q.set('family', family);
      if (sort !== 'featured') q.set('sort', sort);
      const qs = q.toString();
      history.replaceState(null, '', 'shop.html' + (qs ? '?' + qs : ''));
    };

    const draw = () => {
      let list = TC.productList();
      if (category !== 'all') list = list.filter((p) => p.category === category);
      if (family !== 'all') list = list.filter((p) => (p.family || p.sku).indexOf(family) === 0);
      if (sort === 'low') list.sort((a, b) => a.price - b.price);
      if (sort === 'high') list.sort((a, b) => b.price - a.price);
      if (sort === 'stock') list.sort((a, b) => totalStock(b) - totalStock(a));
      if (sort === 'az') list.sort((a, b) => a.name.localeCompare(b.name));
      host.innerHTML = list.map(cardHTML).join('');
      const empty = $('#shopEmpty');
      if (empty) empty.hidden = list.length > 0;
      if (countEl) countEl.textContent = list.length + (list.length === 1 ? ' piece' : ' pieces');
      /* keep the category counts honest against live stock */
      if (catSel) {
        const all = TC.productList();
        Array.from(catSel.options).forEach((o) => {
          if (o.value === 'all') { o.textContent = 'All pieces — ' + all.length; return; }
          const n = all.filter((p) => p.category === o.value).length;
          const label = o.dataset.label || o.textContent.replace(/\s*—\s*\d+$/, '');
          o.dataset.label = label;
          o.textContent = label + ' — ' + n;
        });
      }
      wireCards(host);
    };

    if (catSel) {
      if (!Array.from(catSel.options).some((o) => o.value === category)) category = 'all';
      catSel.value = category;
      catSel.addEventListener('change', () => { category = catSel.value; syncUrl(); draw(); });
    }
    if (famSel) {
      if (!Array.from(famSel.options).some((o) => o.value === family)) family = 'all';
      famSel.value = family;
      famSel.addEventListener('change', () => { family = famSel.value; syncUrl(); draw(); });
    }
    if (sortSel) {
      if (!Array.from(sortSel.options).some((o) => o.value === sort)) sort = 'featured';
      sortSel.value = sort;
      sortSel.addEventListener('change', () => { sort = sortSel.value; syncUrl(); draw(); });
    }

    TC.on(draw);
    draw();
  }

  /* ------------------------------------------------------------ product */
  function initProduct() {
    const nameEl = $('#pdpName');
    if (!nameEl) return;

    const params = new URLSearchParams(location.search);
    let sku = params.get('sku') || '';

    const faceFor = { front: 0, back: 1, detail: 2 };

    function render() {
      const list = TC.productList();
      if (!list.length) return;
      let p = TC.product(sku);
      if (!p || p.active === false) { p = list[0]; sku = p.sku; }
      if (location.search.indexOf('sku=' + sku) === -1) history.replaceState(null, '', 'product.html?sku=' + encodeURIComponent(sku));

      document.title = p.name + ' · ' + p.variant.replace(' / ', ' — ') + ' — Tribe Culture';
      const crumb = $('#pdpCrumb'); if (crumb) crumb.textContent = p.name;
      nameEl.textContent = p.name;
      $('#pdpVariant').textContent = 'Drop 001 · ' + p.variant;
      $('#pdpPrice').textContent = money(p.price);
      $('#pdpCurrency').textContent = (TC.state.catalogue && TC.state.catalogue.currency) || 'NGN';
      $('#pdpBlurb').textContent = p.blurb || '';
      /* the gallery shows the original studio photograph, whole — never a cut
         silhouette. The card crops stay for the grids and thumbnails. */
      const cut = (face) => p.images[face] || p.images.front;
      const imgA = $('#pdpImgA'), imgB = $('#pdpImgB');
      imgA.src = cut('front'); imgA.alt = p.name + ' — ' + p.variant;
      imgB.src = cut('back'); imgB.alt = p.name + ' — alternate view';
      const pbg = $('#pdpBg');
      if (pbg) pbg.src = imgA.src;

      // Always show both original garment faces together. These are the source
      // photographs, not generated or cropped campaign assets.
      const frontView = $('#pdpFrontView');
      const backView = $('#pdpBackView');
      if (frontView) {
        frontView.src = cut('front');
        frontView.alt = p.name + ' — ' + p.variant + ' — original front view';
      }
      if (backView) {
        backView.src = cut('back');
        backView.alt = p.name + ' — ' + p.variant + ' — original back view';
      }

      const thumbs = $('#pdpThumbs');
      const faces = [
        { key: 'front', label: '1', img: 'assets/products/card/' + p.sku + '.webp', alt: p.name + ' front' },
        { key: 'back', label: '2', img: 'assets/products/card/' + p.sku + '-back.webp', alt: p.name + ' alternate' },
        { key: 'detail', label: '3', img: cut('detail'), alt: p.name + ' print detail' }
      ];
      thumbs.innerHTML = faces.map((f, i) => `<button type="button" data-face="${f.key}" aria-pressed="${i === 0}" aria-label="Show ${esc(f.alt)}"><img src="${esc(f.img)}" alt="" width="64" height="64" loading="lazy" decoding="async"></button>`).join('');

      // colourways: every piece sharing this family (Saint black/white, Members black/white, ...)
      const family = list.filter((x) => (x.family || x.sku) === (p.family || p.sku));
      const wrap = $('#pdpColourWrap');
      const swatches = $('#pdpSwatches');
      if (wrap && swatches) {
        wrap.hidden = family.length < 2;
        if (family.length > 1) {
          swatches.innerHTML = family.map((f) => `
            <button type="button" data-colour-sku="${esc(f.sku)}" aria-pressed="${f.sku === sku}"
              aria-label="${esc(f.variant)}" title="${esc(f.variant)}"
              style="background:${f.colour === 'white' ? '#f2ede2' : f.colour === 'bone' ? '#d9cdb2' : '#0a0a0a'}"></button>`).join('');
          $('#pdpSwatches [data-colour-sku]').forEach((b) => b.addEventListener('click', () => {
            sku = b.dataset.colourSku;
            history.pushState({ sku }, '', 'product.html?sku=' + encodeURIComponent(sku));
            render();
          }));
        }
        const nameEl = $('#pdpColourName');
        if (nameEl) nameEl.textContent = p.variant;
      }

      // spec table straight from the catalogue
      const spec = $('#pdpSpec');
      if (spec) {
        const d = p.details || {};
        spec.innerHTML = [
          ['Fabric', d.fabric], ['Fit', d.fit], ['Print', d.print], ['Made', d.made]
        ].filter(([, v]) => v).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
      }

      // whatsapp enquiry, pre-filled with this piece
      const waBtn = $('#pdpWhatsapp');
      const waNum = (TC.state.catalogue && TC.state.catalogue.whatsapp) || '';
      if (waBtn && waNum) {
        waBtn.href = 'https://wa.me/' + String(waNum).replace(/\D/g, '') +
          '?text=' + encodeURIComponent(`Hi Tribe Culture — I'd like to ask about the ${p.name} (${p.variant}).`);
      } else if (waBtn) {
        waBtn.hidden = true;
      }

      // sizes — a drop-down, with sold-out sizes disabled but still visible
      const sizeHost = $('#pdpSizes');
      sizeHost.innerHTML = '<option value="">Choose a size</option>' + p.sizes.map((s) => {
        const lvl = p.stock[s];
        const sold = lvl === 0;
        const label = s === 'ONE SIZE' ? 'One size' : s;
        return `<option value="${esc(s)}" ${sold ? 'disabled' : ''}>${esc(label)}${sold ? ' — sold out' : lvl <= 3 ? ' — ' + lvl + ' left' : ''}</option>`;
      }).join('');
      const firstInStock = p.sizes.find((s) => (p.stock[s] || 0) > 0) || null;
      setSize(firstInStock);
      $('#pdpStock').textContent = stockNote(p);

      // delivery note from live settings
      const ship = (TC.state.catalogue && TC.state.catalogue.shipping) || {};
      const free = (TC.state.catalogue && TC.state.catalogue.free_delivery_over) || TC.CONFIG.freeDeliveryOver;
      $('#pdpDelivery').innerHTML = `
        <ul>
          ${Object.values(ship).map((z) => `<li>${esc(z.label)} — ${money(z.amount)} · ${esc(z.eta || '')}</li>`).join('')}
          <li>Free delivery in Nigeria on orders over ${money(free)}; international delivery is charged at the listed rate.</li>
          <li>Ships in 1–2 business days. Unworn returns within 14 days, tags attached.</li>
        </ul>`;

      const stage = $('#pdpStage');
      if (stage) stage.dataset.sku = sku;

      // related
      const rel = $('#pdpRelated');
      if (rel) {
        const others = list.filter((x) => x.sku !== sku).concat(list.filter((x) => x.sku === sku)).slice(0, 3);
        rel.innerHTML = others.map(cardHTML).join('');
        wireCards(rel);
      }
      document.dispatchEvent(new CustomEvent('stage:face', { detail: { face: 'front' } }));
      document.dispatchEvent(new CustomEvent('stage:sku', { detail: { sku } }));
    }

    /* the quantity stepper is only meaningful once a size is chosen and in stock */
    let pdpQty = 1;

    function paintQty() {
      const p = TC.product(sku);
      const size = $('#pdpAdd') ? $('#pdpAdd').dataset.size : null;
      const box = $('#pdpQty');
      const n = $('#pdpQtyN');
      if (!box || !n) return;
      const stock = size && p ? p.stock[size] : 0;
      box.hidden = !size || !p || !stock;
      const cap = Math.max(1, Math.min(stock || 1, 10));
      pdpQty = Math.max(1, Math.min(pdpQty, cap));
      n.textContent = String(pdpQty);
      const minus = box.querySelector('[data-pdp-qty="-1"]');
      const plus = box.querySelector('[data-pdp-qty="1"]');
      if (minus) minus.disabled = pdpQty <= 1;
      if (plus) plus.disabled = pdpQty >= cap;
      const add = $('#pdpAdd');
      const span = add && add.querySelector('span');
      if (span && add && !add.disabled) span.textContent = 'Add to bag · ' + money((p ? p.price : 0) * pdpQty);
    }

    function setSize(size) {
      const p = TC.product(sku);
      const sel = $('#pdpSizes');
      if (sel && sel.value !== (size || '')) sel.value = size || '';
      const add = $('#pdpAdd');
      if (!add) return;
      const span = add.querySelector('span');
      if (!size) { add.disabled = true; span.textContent = 'Sold out'; delete add.dataset.size; paintQty(); return; }
      const lvl = p.stock[size];
      if (lvl === 0) { add.disabled = true; span.textContent = 'Sold out in ' + size; delete add.dataset.size; paintQty(); return; }
      add.disabled = false;
      add.dataset.size = size;
      pdpQty = 1;
      paintQty();
    }

    $('#pdpQty')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pdp-qty]');
      if (!b) return;
      pdpQty = Math.max(1, pdpQty + Number(b.dataset.pdpQty));
      paintQty();
    });

    /* the size-guide trigger opens the panel already on the page instead of
       sending the shopper to the help centre mid-decision */
    $('#pdpGuide')?.addEventListener('click', () => {
      const panel = $('#pdpGuidePanel');
      if (!panel) return;
      panel.open = true;
      panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      panel.querySelector('summary')?.focus({ preventScroll: true });
    });

    $('#pdpSizes')?.addEventListener('change', (e) => {
      setSize(e.target.value || null);
    });

    $('#pdpAdd')?.addEventListener('click', () => {
      const size = $('#pdpAdd').dataset.size;
      if (!size) return;
      TC.addToBag(sku, size, pdpQty);
      pdpQty = 1;
      paintQty();
    });

    $('#pdpBuyNow')?.addEventListener('click', () => {
      const size = $('#pdpAdd')?.dataset.size;
      if (!size) {
        TC.toast('Choose an available size first', 'err');
        $('#pdpSizes')?.focus();
        return;
      }
      const added = TC.addToBag(sku, size, pdpQty);
      if (added) location.href = 'checkout.html';
    });

    // gallery faces (2D main + 3D stage)
    $('#pdpThumbs')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-face]');
      if (!b) return;
      const face = b.dataset.face;
      $$('#pdpThumbs [data-face]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      const main = $('#pdpMain');
      const a = $('#pdpImgA'), bb = $('#pdpImgB');
      const p2 = TC.product(sku);
      const cutFace = (f) => p2.images[f] || p2.images.front;
      const pbg2 = $('#pdpBg');
      if (face === 'back') {
        a.classList.remove('on'); bb.classList.add('on'); bb.src = cutFace('back');
        if (pbg2) pbg2.src = cutFace('back');
      } else {
        bb.classList.remove('on'); a.classList.add('on'); a.src = cutFace(face);
        if (pbg2) pbg2.src = cutFace(face);
      }
      document.dispatchEvent(new CustomEvent('stage:face', { detail: { face } }));
    });

    $('#pdpFaces')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-face]');
      if (!b) return;
      $$('#pdpFaces [data-face]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      document.dispatchEvent(new CustomEvent('stage:face', { detail: { face: b.dataset.face } }));
    });

    window.addEventListener('popstate', () => {
      const nextSku = new URLSearchParams(location.search).get('sku');
      if (nextSku) { sku = nextSku; render(); }
    });

    TC.on(render);
    render();
  }

  /* ----------------------------------------------------------- checkout */
  function initCheckout() {
    const form = $('#checkoutForm');
    if (!form) return;
    const shipRules = () => (TC.state.catalogue && TC.state.catalogue.shipping) || {};
    const freeOver = () => (TC.state.catalogue && TC.state.catalogue.free_delivery_over) || TC.CONFIG.freeDeliveryOver;
    const saveBtn = $('#saveDeliveryBtn');
    const saveNote = $('#checkoutSaveNote');

    function summary() {
      const items = $('#coItems');
      const zone = $('#coZone').value;
      const rule = shipRules()[zone] || { amount: 0, label: 'Delivery', eta: '' };
      const subtotal = TC.bagSubtotal();
      const free = zone === 'NG' && subtotal >= freeOver();
      const shipping = free ? 0 : Number(rule.amount || 0);
      $('#countryField').hidden = zone !== 'INTL';
      $('#coCountry').required = zone === 'INTL';
      $('#coFreeOver').textContent = money(freeOver());

      if (!TC.state.bag.length) {
        items.innerHTML = '<p class="muted small" style="padding:14px 0">Your bag is empty. <a class="link" href="shop.html">Shop the drop</a></p>';
      } else {
        items.innerHTML = TC.state.bag.map((line) => {
          const product = TC.product(line.sku);
          if (!product) return '';
          const size = line.size === 'ONE SIZE' ? 'One size' : 'Size ' + esc(line.size);
          return '<div class="order-item" style="border:0;border-bottom:1px solid var(--line);padding:10px 0;grid-template-columns:44px 1fr auto">' +
            '<img src="assets/products/card/' + esc(product.sku) + '.webp" alt="' + esc(product.name) + ', ' + esc(product.variant) + '" width="44" height="44" loading="lazy" decoding="async">' +
            '<div><div class="n">' + esc(product.name) + '</div><div class="m">' + esc(product.variant) + ' · ' + size + ' · ×' + line.qty + '</div></div>' +
            '<span class="price" style="font-size:12.5px">' + money(product.price * line.qty) + '</span></div>';
        }).join('');
      }
      $('#coSubtotal').textContent = money(subtotal);
      $('#coShipping').textContent = subtotal === 0 ? '—' : free ? 'Free' : money(shipping);
      $('#coShipLabel').textContent = rule.eta ? '· ' + rule.eta : '';
      $('#coTotal').textContent = money(subtotal + (subtotal ? shipping : 0));
      saveBtn.disabled = !TC.state.bag.length;
      const label = saveBtn.querySelector('span');
      if (label) label.textContent = TC.state.bag.length ? 'Save delivery details' : 'Add a piece to continue';
      return { subtotal, shipping, zone, rule };
    }

    const err = (field, message) => {
      const error = form.querySelector('[data-err="' + field + '"]');
      if (error) error.textContent = message || '';
      const input = form.querySelector('[name="' + field + '"]');
      if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
      return !message;
    };

    function validate(data) {
      let valid = true;
      valid = err('name', data.name.length < 2 ? 'Enter your full name' : '') && valid;
      valid = err('email', !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email) ? 'Enter a valid email' : '') && valid;
      valid = err('phone', data.phone.replace(/\D/g, '').length < 7 ? 'Enter a valid phone number' : '') && valid;
      valid = err('address', data.address.length < 4 ? 'Enter your delivery address' : '') && valid;
      valid = err('city', data.city.length < 2 ? 'Enter your city and state / region' : '') && valid;
      if (data.zone === 'INTL') valid = err('country', data.country.length < 2 ? 'Enter your destination country' : '') && valid;
      else err('country', '');
      return valid;
    }

    try {
      const saved = JSON.parse(localStorage.getItem(TC.CONFIG.customerKey) || '{}');
      ['name', 'email', 'phone', 'address', 'city', 'country', 'note'].forEach((key) => {
        const input = form.querySelector('[name="' + key + '"]');
        if (input && saved[key]) input.value = saved[key];
      });
      if (saved.zone === 'NG' || saved.zone === 'INTL') $('#coZone').value = saved.zone;
    } catch {}

    $('#coZone').addEventListener('change', () => {
      if (saveNote) {
        saveNote.classList.remove('show');
        saveNote.dataset.saved = 'false';
      }
      summary();
    });
    form.addEventListener('input', () => {
      if (saveNote && saveNote.dataset.saved === 'true') {
        saveNote.dataset.saved = 'false';
        saveNote.classList.remove('show');
      }
    });
    TC.on(summary);
    summary();

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (saveNote) saveNote.classList.remove('show');
      if (!TC.state.bag.length) {
        TC.toast('Your bag is empty', 'err');
        return;
      }

      const data = {
        name: $('#coName').value.trim(),
        email: $('#coEmail').value.trim(),
        phone: $('#coPhone').value.trim(),
        address: $('#coAddress').value.trim(),
        city: $('#coCity').value.trim(),
        country: $('#coCountry').value.trim(),
        zone: $('#coZone').value,
        note: $('#coNote').value.trim()
      };
      if (!validate(data)) {
        if (saveNote) {
          saveNote.textContent = 'Please correct the highlighted delivery details.';
          saveNote.classList.add('show');
        }
        const firstInvalid = form.querySelector('[aria-invalid="true"]');
        if (firstInvalid) firstInvalid.focus();
        return;
      }

      const review = {
        customer: data,
        items: TC.state.bag.map((line) => ({ sku: line.sku, size: line.size, qty: line.qty })),
        subtotal: TC.bagSubtotal(),
        destination: data.zone,
        shipping: summary().shipping,
        saved_at: new Date().toISOString()
      };
      try {
        localStorage.setItem(TC.CONFIG.customerKey, JSON.stringify(data));
        localStorage.setItem('tc_checkout_review_v1', JSON.stringify(review));
      } catch {
        if (saveNote) {
          saveNote.textContent = 'Your browser could not save these details. Check device storage and try again.';
          saveNote.classList.add('show');
        }
        return;
      }

      if (saveNote) {
        saveNote.textContent = 'Delivery details saved. Your bag and delivery estimate are ready for the payment step. No order has been placed and no payment has been taken.';
        saveNote.dataset.saved = 'true';
        saveNote.classList.add('show');
      }
      const label = saveBtn.querySelector('span');
      if (label) label.textContent = 'Update delivery details';
      TC.toast('Delivery details saved');
    });
  }

  /* -------------------------------------------------------------- track */
  function initTrack() {
    const form = $('#trackForm');
    if (!form) return;
    const statusLabel = { pending: 'Payment pending', paid: 'Paid — packing', packed: 'Packed', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled', refunded: 'Refunded', mismatch: 'Payment mismatch' };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const ref = $('#trRef').value.trim();
      const email = $('#trEmail').value.trim();
      const alertBox = $('#trackAlert');
      const out = $('#trackResult');
      alertBox.classList.remove('show');
      if (!ref) { alertBox.textContent = 'Enter your order reference.'; alertBox.classList.add('show'); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { alertBox.textContent = 'Enter the email address used at checkout.'; alertBox.classList.add('show'); return; }

      const btn = $('#trackBtn');
      btn.disabled = true;
      out.innerHTML = '<p class="muted small">Looking up your order…</p>';
      try {
        let token = '';
        try { token = sessionStorage.getItem('tc_access_' + ref) || ''; } catch {}
        const res = await fetch('/api/track?reference=' + encodeURIComponent(ref) + (email ? '&email=' + encodeURIComponent(email) : '') + (token ? '&t=' + encodeURIComponent(token) : ''));
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Order not found.');
        const o = json.order;
        if (json.access_required) {
          out.innerHTML = `
            <div class="info-card">
              <p class="eyebrow red">${esc(o.reference)}</p>
              <h2 class="disp" style="font-size:clamp(20px,3vw,26px);margin-top:6px">${esc(statusLabel[o.status] || o.status)}</h2>
              <p class="muted small" style="margin-top:8px">${esc(o.item_count)} item${o.item_count === 1 ? '' : 's'} · ${esc(o.currency_symbol)}${Number(o.total).toLocaleString('en-NG')}</p>
              <p class="tiny" style="margin-top:10px">Add the email address you ordered with to see the full order and delivery details.</p>
            </div>`;
          return;
        }
        out.innerHTML = `
          <div class="info-card">
            <div class="row-between">
              <div>
                <p class="eyebrow red">${esc(o.reference)}</p>
                <h2 class="disp" style="font-size:clamp(22px,3.4vw,30px);margin-top:6px">${esc(statusLabel[o.status] || o.status)}</h2>
              </div>
              <span class="badge">${esc(o.status)}</span>
            </div>
            <div class="stack-sm" style="margin-top:10px">
              ${(o.items || []).map((i) => `<div class="tot-row"><span>${esc(i.name)} · ${esc(i.variant)} · ${i.size === 'ONE SIZE' ? 'One size' : 'Size ' + esc(i.size)}</span><span>×${i.qty}</span></div>`).join('')}
            </div>
            <div class="tot-row big" style="margin-top:10px"><span>Total</span><span>${esc(o.currency_symbol)}${Number(o.total).toLocaleString('en-NG')}</span></div>
            <p class="tiny" style="margin-top:8px">Placed ${new Date(o.placed).toLocaleString('en-NG')} · ${esc(o.shipping_label)} · ${esc(o.city)}${o.country ? ', ' + esc(o.country) : ''}</p>
            ${(o.timeline || []).length ? `<div class="timeline" style="margin-top:14px">${o.timeline.map((t) => `<div><span>${esc(statusLabel[t.status] || t.status)}</span><span class="muted">${new Date(t.at).toLocaleString('en-NG')}</span></div>`).join('')}</div>` : ''}
            <a class="btn ghost sm" href="contact.html" style="justify-self:start;margin-top:12px"><span>Question about this order</span></a>
          </div>`;
      } catch (error) {
        out.innerHTML = '';
        alertBox.textContent = error.message || 'We could not find that order.';
        alertBox.classList.add('show');
      } finally {
        btn.disabled = false;
      }
    });

    const ref = new URLSearchParams(location.search).get('ref');
    if (ref) { $('#trRef').value = ref; }
  }

  /* ------------------------------------------------------------ contact */
  function initContact() {
    const form = $('#contactForm');
    if (!form) return;
    TC.on(() => {
      const email = (TC.state.catalogue && TC.state.catalogue.store_email) || 'orders@tribeculture.store';
      const host = $('#contactEmail');
      if (host) host.innerHTML = `<a class="link" href="mailto:${esc(email)}" style="border:0">${esc(email)}</a>`;
      const wa = $('#contactWhatsapp');
      const num = (TC.state.catalogue && TC.state.catalogue.whatsapp) || '';
      if (wa && num) {
        wa.href = 'https://wa.me/' + String(num).replace(/\D/g, '') + '?text=' +
          encodeURIComponent("Hi Tribe Culture — I'd like to ask a question.");
      }
    });

    const err = (field, msg) => {
      const el = form.querySelector(`[data-err="${field}"]`);
      if (el) el.textContent = msg || '';
      const input = form.querySelector(`[name="${field}"]`);
      if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
      return !msg;
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const alertBox = $('#contactAlert');
      alertBox.classList.remove('show', 'ok');
      const data = {
        name: $('#cName').value.trim(),
        email: $('#cEmail').value.trim(),
        subject: $('#cSubject').value,
        message: $('#cMessage').value.trim()
      };
      let ok = true;
      ok = err('name', data.name.length < 2 ? 'Tell us your name' : '') && ok;
      ok = err('email', !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email) ? 'Enter a valid email' : '') && ok;
      ok = err('message', data.message.length < 10 ? 'Add a little more detail' : '') && ok;
      if (!ok) return;

      const btn = $('#contactBtn');
      btn.disabled = true;
      try {
        const res = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Message could not be sent.');
        alertBox.className = 'alert ok show';
        alertBox.textContent = json.message || 'Message received.';
        form.reset();
      } catch (error) {
        alertBox.className = 'alert show';
        alertBox.textContent = error.message || 'Message could not be sent. Please email us directly.';
      } finally {
        btn.disabled = false;
      }
    });
  }



  /* ---------------------------------------------------------- drop poster */
  function initPoster() {
    const host = $('#railPieces');
    if (!host) return;
    const PICKS = ['saint-tee-black', 'members-tee-black', 'tracksuit-black', 'crest-print'];

    const draw = () => {
      const list = TC.productList();
      if (!list.length) return;
      const chosen = PICKS.map((sku) => list.find((p) => p.sku === sku)).filter(Boolean);
      const filled = chosen.length >= 4 ? chosen.slice(0, 4) : list.slice(0, 4);
      host.innerHTML = filled.map((p) => `
        <a class="rail-piece" href="product.html?sku=${encodeURIComponent(p.sku)}" aria-label="${esc(p.name + ' — ' + p.variant)}">
          <span class="rail-hook" aria-hidden="true"></span>
          <span class="rail-frame"><img src="assets/products/3d/${esc(p.sku)}.webp" alt="${esc(p.name + ' — ' + p.variant)}" width="360" height="360" loading="lazy" decoding="async"></span>
          <span class="rail-tag">${esc(p.name)}<br>${esc(p.variant)}</span>
          <span class="rail-price">${money(p.price)}</span>
        </a>`).join('');
    };
    TC.on(draw);
    draw();
  }

  /* ------------------------------------------------------- live 3D showcase */
  function initLive() {
    const stage = $('#liveStage');
    if (!stage) return;

    const pick = $('#liveSku');
    const strip = $('#liveStrip');
    const nameEl = $('#liveName');
    const variantEl = $('#liveVariant');
    const priceEl = $('#livePrice');
    const specEl = $('#liveSpec');
    const metaEl = $('#liveMeta');
    const openEl = $('#liveOpen');
    const buyEl = $('#liveBuy');
    const faces = $('#liveFaces');
    let sku = stage.dataset.sku || 'saint-tee-black';
    let auto = true;
    let timer = 0;

    const faceOf = (n) => (n === 'back' ? 'back' : n === 'detail' ? 'detail' : 'front');

    const paint = () => {
      const p = TC.product(sku);
      if (!p) return;
      const list = TC.productList();
      const i = list.findIndex((x) => x.sku === sku);
      stage.dataset.sku = sku;
      if (nameEl) nameEl.textContent = p.name;
      if (variantEl) variantEl.textContent = p.variant;
      if (priceEl) priceEl.textContent = money(p.price);
      if (metaEl) metaEl.textContent = String(i + 1).padStart(2, '0') + ' / ' + String(list.length).padStart(2, '0') + ' · ' + (p.category || 'piece');
      if (openEl) openEl.href = 'product.html?sku=' + encodeURIComponent(sku);
      if (buyEl) buyEl.href = 'product.html?sku=' + encodeURIComponent(sku);
      if (specEl) {
        const d = p.details || {};
        specEl.innerHTML = [['Fabric', d.fabric], ['Fit', d.fit], ['Print', d.print]]
          .filter(([, v]) => v)
          .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
      }
      if (pick && pick.value !== sku) pick.value = sku;
      $$('#liveStrip [data-live-sku]').forEach((b) => {
        const on = b.dataset.liveSku === sku;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      });
      const fb = stage.querySelector('.stage-fallback img');
      if (fb) fb.src = 'assets/products/3d/' + sku + '-front.webp';
      document.dispatchEvent(new CustomEvent('stage:sku', { detail: { sku } }));
    };

    const choose = (next, opts) => {
      if (!next || next === sku) return;
      sku = next;
      paint();
      if (!(opts && opts.keepAuto === false)) restartAuto();
    };

    const restartAuto = () => {
      auto = true;
      clearInterval(timer);
      timer = setInterval(() => {
        if (!auto) return;
        const list = TC.productList();
        if (list.length < 2) return;
        const i = list.findIndex((x) => x.sku === sku);
        choose(list[(i + 1) % list.length].sku, { keepAuto: false });
      }, 7000);
    };

    /* the visitor takes over the moment they touch the stage */
    stage.addEventListener('pointerdown', () => { auto = false; clearInterval(timer); stage.classList.add('touched'); });
    stage.addEventListener('focusin', () => { auto = false; clearInterval(timer); });

    if (pick) {
      pick.addEventListener('change', () => choose(pick.value));
    }
    if (strip) {
      strip.addEventListener('click', (e) => {
        const b = e.target.closest('[data-live-sku]');
        if (b) choose(b.dataset.liveSku);
      });
    }
    if (faces) {
      faces.addEventListener('click', (e) => {
        const b = e.target.closest('[data-face]');
        if (!b) return;
        auto = false; clearInterval(timer);
        $$('#liveFaces [data-face]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        document.dispatchEvent(new CustomEvent('stage:face', { detail: { face: faceOf(b.dataset.face) } }));
      });
    }
    const randomBtn = $('#liveRandom');
    if (randomBtn) {
      randomBtn.addEventListener('click', () => {
        const list = TC.productList().filter((x) => x.sku !== sku);
        if (!list.length) return;
        choose(list[Math.floor(Math.random() * list.length)].sku);
      });
    }

    const draw = () => {
      const list = TC.productList();
      if (!list.length) return;
      if (pick) {
        pick.innerHTML = list.map((p) => `<option value="${esc(p.sku)}">${esc(p.name)} — ${esc(p.variant)}</option>`).join('');
      }
      if (strip) {
        strip.innerHTML = list.map((p) => `
          <button type="button" data-live-sku="${esc(p.sku)}" class="live-chip" aria-pressed="false" title="${esc(p.name + ' — ' + p.variant)}">
            <img src="assets/products/3d/${esc(p.sku)}.webp" alt="" width="64" height="64" loading="lazy" decoding="async">
            <span>${esc(p.name)}</span>
          </button>`).join('');
      }
      if (!TC.product(sku)) sku = list[0].sku;
      paint();
    };

    TC.on(draw);
    draw();
    restartAuto();
  }

  /* --------------------------------------------------------------- help */
  function initHelp() {
    const table = $('#shippingTable');
    if (!table) return;
    TC.on(() => {
      const ship = (TC.state.catalogue && TC.state.catalogue.shipping) || {};
      const free = (TC.state.catalogue && TC.state.catalogue.free_delivery_over) || TC.CONFIG.freeDeliveryOver;
      const body = table.querySelector('tbody');
      body.innerHTML = Object.values(ship).map((z) => `<tr><td>${esc(z.label)}</td><td>${money(z.amount)}</td><td>${esc(z.eta || '—')}</td></tr>`).join('')
        + `<tr><td><strong style="color:var(--bone)">Orders over ${money(free)}</strong></td><td>Free</td><td>Same transit</td></tr>`;
    });
  }

  /* ----------------------------------------------------------------- plate
     The twelve pieces exactly as photographed — the whole garment in frame,
     never a trimmed silhouette. Front/back, swipe, arrows and a picker, and
     the panel beside it stays in step. */
  function initPlate() {
    const host = $('#plateStack');
    if (!host) return;
    const frame = $('#plateFrame');
    const idxEl = $('#plateIdx');
    let built = false;

    function build() {
      if (built) return true;
      const list = TC.productList();
      if (!list.length) return false;
      built = true;

      let i = 0;
      let face = 'front';

      host.innerHTML = list.map((p, n) => `
        <figure class="plate-slide${n === 0 ? ' is-on' : ''}" data-slide="${n}" data-sku="${esc(p.sku)}">
          <img class="p-front" alt="${esc(p.name)} — ${esc(p.variant)}, front." loading="lazy" decoding="async">
          <img class="p-back" alt="${esc(p.name)} — ${esc(p.variant)}, back." loading="lazy" decoding="async">
        </figure>`).join('');

      const slides = Array.from(host.children);
      const bg = document.getElementById('plateBg');
      const backBtn = document.querySelector('[data-face="back"]');
      const frontBtn = document.querySelector('[data-face="front"]');

      const hydrate = (n) => {
        const el = slides[n];
        if (!el || el.dataset.noBack === '1') return;
        const p = list[n];
        const f = el.querySelector('.p-front');
        const b = el.querySelector('.p-back');
        if (!f.getAttribute('src')) f.src = 'assets/products/' + p.sku + '-front.jpg';
        if (!b.getAttribute('src')) {
          b.addEventListener('error', () => { el.dataset.noBack = '1'; if (backBtn && slides[i] === el && face === 'back') face = 'front'; paint(); }, { once: true });
          b.src = 'assets/products/' + p.sku + '-back.jpg';
        }
      };

      /* the matte takes the colour of each photo's own studio ground, so the
         frame looks like a mounted print instead of a pasted rectangle */
      const matteCache = {};
      const matte = (img) => {
        const key = img.currentSrc || img.src;
        if (!key) return;
        if (matteCache[key]) { frame.style.background = matteCache[key]; return; }
        const apply = () => {
          try {
            const c = document.createElement('canvas');
            c.width = c.height = 12;
            const g = c.getContext('2d');
            g.drawImage(img, 0, 0, 12, 12);
            const d = g.getImageData(0, 0, 12, 12).data;
            let r = 0, gr = 0, bl = 0, n = 0;
            for (let y = 0; y < 12; y++) {
              for (let x = 0; x < 12; x++) {
                if (x > 3 && x < 8 && y > 3 && y < 8) continue; /* skip the garment */
                const o = (y * 12 + x) * 4;
                r += d[o]; gr += d[o + 1]; bl += d[o + 2]; n++;
              }
            }
            /* lift it a little toward bone so the mount reads as paper, not concrete */
            const lift = (v) => Math.round(v * 0.82 + 246 * 0.18);
            const col = 'rgb(' + lift(r / n) + ',' + lift(gr / n) + ',' + lift(bl / n) + ')';
            /* tell the furniture which way to go: dark ink over a pale photo */
            const L = (0.2126 * r + 0.7152 * gr + 0.0722 * bl) / n;
            host.parentElement.parentElement.dataset.tone = L > 135 ? 'light' : 'dark';
            matteCache[key] = col;
            frame.style.background = col;
          } catch (e) { /* keep the default matte */ }
        };
        if (img.complete && img.naturalWidth) apply();
        else img.addEventListener('load', apply, { once: true });
      };

      const paint = () => {
        hydrate(i);
        hydrate((i + 1) % list.length);
        hydrate((i - 1 + list.length) % list.length);
        slides.forEach((el, n) => el.classList.toggle('is-on', n === i));
        const back = face === 'back' && slides[i].dataset.noBack !== '1';
        slides[i].classList.toggle('show-back', back);
        if (backBtn) {
          backBtn.disabled = slides[i].dataset.noBack === '1';
          backBtn.setAttribute('aria-pressed', String(back));
        }
        if (frontBtn) frontBtn.setAttribute('aria-pressed', String(!back));
        if (idxEl) idxEl.textContent = String(i + 1).padStart(2, '0') + ' / ' + String(list.length).padStart(2, '0');
        if (frame) {
          const shown = slides[i].querySelector(back ? '.p-back' : '.p-front');
          if (shown) matte(shown);
          if (bg) {
            const src = shown && (shown.currentSrc || shown.src);
            if (src && bg.getAttribute('src') !== src) bg.src = src;
          }
        }
        $$('.stage-picker button').forEach((b, n) => b.setAttribute('aria-pressed', String(n === i)));
        document.dispatchEvent(new CustomEvent('rail:piece', { detail: { sku: list[i].sku, index: i } }));
      };

      const go = (n) => { i = ((n % list.length) + list.length) % list.length; face = 'front'; paint(); };

      const picker = document.querySelector('.stage-picker');
      if (picker) {
        picker.innerHTML = list.map((p, n) =>
          `<button type="button" data-index="${n}" aria-pressed="${n === 0}" aria-label="${esc(p.name)} — ${esc(p.variant)}"></button>`).join('');
        picker.addEventListener('click', (e) => {
          const b = e.target.closest('[data-index]');
          if (b) go(Number(b.dataset.index));
        });
      }

      const prev = document.querySelector('[data-rail-prev]');
      const next = document.querySelector('[data-rail-next]');
      if (prev) prev.addEventListener('click', (e) => { e.preventDefault(); go(i - 1); });
      if (next) next.addEventListener('click', (e) => { e.preventDefault(); go(i + 1); });

      document.querySelectorAll('[data-face]').forEach((b) => b.addEventListener('click', () => {
        if (b.disabled) return;
        face = b.dataset.face;
        paint();
      }));

      if (frame) {
        let x0 = null, y0 = null, moved = 0;
        frame.addEventListener('pointerdown', (e) => { x0 = e.clientX; y0 = e.clientY; moved = 0; });
        frame.addEventListener('pointermove', (e) => {
          if (x0 === null) return;
          moved = Math.max(moved, Math.abs(e.clientX - x0) + Math.abs(e.clientY - y0));
        });
        frame.addEventListener('pointerup', (e) => {
          if (x0 === null) return;
          const dx = e.clientX - x0;
          x0 = null;
          if (Math.abs(dx) > 42) { go(i + (dx < 0 ? 1 : -1)); return; }
          if (moved < 12) location.href = 'product.html?sku=' + encodeURIComponent(list[i].sku);
        });
        frame.addEventListener('pointercancel', () => { x0 = null; });
        frame.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowRight') { e.preventDefault(); go(i + 1); }
          else if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); }
          else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); location.href = 'product.html?sku=' + encodeURIComponent(list[i].sku); }
        });
      }

      paint();
      return true;
    }

    if (build()) return;
    /* the catalogue may still be in flight — build the moment it lands */
    let stop = () => {};
    stop = TC.on(() => { if (build()) stop(); });
  }

  /* ---------------------------------------------------------- rail panel
     The right-hand panel mirrors whatever the 3D rail has centred: real name,
     real variant, real price, live sizes from /api/catalogue, and the same
     add-to-bag call the cards use. stage3d dispatches 'rail:piece'. */
  function initRailPanel() {
    const panel = $('#railPanel');
    if (!panel) return;
    let sku = 'saint-tee-black';
    let size = null;

    const paint = () => {
      const p = TC.product(sku);
      if (!p) return;
      $('#railPanelName').textContent = p.name;
      $('#railPanelVariant').textContent = p.variant;
      $('#railPanelPrice').textContent = TC.money(p.price);
      const link = $('#railPanelOpen');
      if (link) link.href = 'product.html?sku=' + encodeURIComponent(p.sku);

      const box = $('#railPanelSizes');
      const add = $('#railPanelAdd');
      if (box) {
        const sizes = p.sizes || [];
        if (!sizes.includes(size)) size = null;
        box.innerHTML = sizes.map((sz) => {
          const lvl = TC.stockOf(p.sku, sz);
          const out = lvl === 0;
          return `<button type="button" data-size="${TC.esc(sz)}" aria-pressed="${sz === size}" ${out ? 'disabled title="Sold out"' : ''}>${sz === 'ONE SIZE' ? 'OS' : TC.esc(sz)}</button>`;
        }).join('');
        const hint = $('#railPanelStock');
        if (hint) {
          const total = sizes.reduce((a, z) => a + (TC.stockOf(p.sku, z) || 0), 0);
          hint.textContent = total > 0 ? total + ' in stock · 1–2 day dispatch' : 'Sold out — restocking';
        }
      }
      if (add) {
        const span = add.querySelector('span');
        if (!size) { add.disabled = true; span.textContent = 'Choose a size'; }
        else {
          const lvl = TC.stockOf(p.sku, size);
          add.disabled = lvl === 0;
          span.textContent = lvl === 0 ? 'Sold out in ' + size : 'Add to bag · ' + TC.money(p.price);
        }
      }
    };

    panel.addEventListener('click', (e) => {
      const b = e.target.closest('[data-size]');
      if (b && !b.disabled) {
        size = b.dataset.size;
        $$('[data-size]', panel).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        paint();
        return;
      }
      if (e.target.closest('#railPanelAdd') && size) TC.addToBag(sku, size, 1);
    });

    const sync = () => paint();
    document.addEventListener('rail:piece', (e) => {
      if (!e.detail || !e.detail.sku) return;
      sku = e.detail.sku;
      size = null;
      paint();
    });
    TC.on(sync);
    paint();
  }

  /* ---------------------------------------------------------------- boot */
  document.addEventListener('DOMContentLoaded', () => {
    initHome();
    initZine();
    initPlate();
    initLookbook();
    /* glass header: gains weight only once it leaves the hero */
    const bar = document.querySelector('.topbar');
    if (bar) {
      let last = -1;
      const onScroll = () => {
        const y = window.scrollY || 0;
        const on = y > 24;
        if (on !== last) { last = on; bar.classList.toggle('is-scrolled', on); }
      };
      addEventListener('scroll', onScroll, { passive: true });
      onScroll();
    }
    initEditorialMotion();
    initRailPanel();
    initPoster();
    initLive();
    initShop();
    initProduct();
    initCheckout();
    initTrack();
    initContact();
    initHelp();
  });
})();
