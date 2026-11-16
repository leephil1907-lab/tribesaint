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

  /** product card used by home / shop / related */
  function cardHTML(p) {
    const backs = p.images && p.images.back ? p.images.back : p.image;
    return `
    <article class="card" data-card="${esc(p.sku)}">
      <a class="card-media" href="product.html?sku=${encodeURIComponent(p.sku)}" aria-label="${esc(p.name)} — ${esc(p.variant)}">
        <img class="on" data-shot="front" src="${esc(p.image)}" alt="${esc(p.name)}, ${esc(p.variant)}" loading="lazy" width="900" height="900">
        <img data-shot="back" src="${esc(backs)}" alt="" loading="lazy" width="900" height="900">
        <span class="badge">${esc(p.badge || 'Drop 001')}</span>
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
  function initHome() {
    const host = $('#homeGrid');
    if (!host) return;
    const draw = () => {
      const all = TC.productList();
      const featured = all.filter((p) => p.featured !== false);
      const list = (featured.length >= 8 ? featured : all).slice(0, 8);
      host.innerHTML = list.map(cardHTML).join('');
      wireCards(host);
      const count = $('#homeCount');
      if (count) count.textContent = all.length + ' pieces in Drop 001';
    };
    TC.on(draw);
    draw();
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
      const imgA = $('#pdpImgA'), imgB = $('#pdpImgB');
      imgA.src = p.images.front; imgA.alt = p.name + ' — ' + p.variant;
      imgB.src = p.images.back; imgB.alt = p.name + ' — alternate view';

      const thumbs = $('#pdpThumbs');
      const faces = [
        { key: 'front', label: '1', img: p.images.front, alt: p.name + ' front' },
        { key: 'back', label: '2', img: p.images.back, alt: p.name + ' alternate' },
        { key: 'detail', label: '3', img: p.images.detail, alt: p.name + ' print detail' }
      ];
      thumbs.innerHTML = faces.map((f, i) => `<button type="button" data-face="${f.key}" aria-pressed="${i === 0}"><img src="${esc(f.img)}" alt="${esc(f.alt)}" width="64" height="64" loading="lazy"></button>`).join('');

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
          $$('#pdpSwatches [data-colour-sku]').forEach((b) => b.addEventListener('click', () => {
            sku = b.dataset.colourSku;
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
          <li>Free delivery on orders over ${money(free)}.</li>
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

    function setSize(size) {
      const p = TC.product(sku);
      const sel = $('#pdpSizes');
      if (sel && sel.value !== (size || '')) sel.value = size || '';
      const add = $('#pdpAdd');
      if (!add) return;
      const span = add.querySelector('span');
      if (!size) { add.disabled = true; span.textContent = 'Sold out'; return; }
      const lvl = p.stock[size];
      if (lvl === 0) { add.disabled = true; span.textContent = 'Sold out in ' + size; return; }
      add.disabled = false;
      span.textContent = 'Add to bag · ' + money(p.price);
      add.dataset.size = size;
    }

    $('#pdpSizes')?.addEventListener('change', (e) => {
      setSize(e.target.value || null);
    });

    $('#pdpAdd')?.addEventListener('click', () => {
      const size = $('#pdpAdd').dataset.size;
      if (size) TC.addToBag(sku, size);
    });

    // gallery faces (2D main + 3D stage)
    $('#pdpThumbs')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-face]');
      if (!b) return;
      const face = b.dataset.face;
      $$('#pdpThumbs [data-face]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      const main = $('#pdpMain');
      const a = $('#pdpImgA'), bb = $('#pdpImgB');
      if (face === 'back') { a.classList.remove('on'); bb.classList.add('on'); bb.src = TC.product(sku).images.back; }
      else { bb.classList.remove('on'); a.classList.add('on'); a.src = face === 'detail' ? TC.product(sku).images.detail : TC.product(sku).images.front; }
      document.dispatchEvent(new CustomEvent('stage:face', { detail: { face } }));
    });

    $('#pdpFaces')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-face]');
      if (!b) return;
      $$('#pdpFaces [data-face]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      document.dispatchEvent(new CustomEvent('stage:face', { detail: { face: b.dataset.face } }));
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

    function summary() {
      const items = $('#coItems');
      const zone = $('#coZone').value;
      const rule = shipRules()[zone] || { amount: 0, label: 'Delivery', eta: '' };
      const sub = TC.bagSubtotal();
      const shipping = sub >= freeOver() ? 0 : Number(rule.amount || 0);

      $('#countryField').hidden = zone !== 'INTL';
      $('#coFreeOver').textContent = money(freeOver());

      if (!TC.state.bag.length) {
        items.innerHTML = `<p class="muted small" style="padding:14px 0">Your bag is empty. <a class="link" href="shop.html">Shop the drop</a></p>`;
      } else {
        items.innerHTML = TC.state.bag.map((l) => {
          const p = TC.product(l.sku);
          if (!p) return '';
          return `<div class="order-item" style="border:0;border-bottom:1px solid var(--line);padding:10px 0;grid-template-columns:44px 1fr auto">
            <img src="${esc(p.image)}" alt="" width="44" height="44" loading="lazy">
            <div><div class="n">${esc(p.name)}</div><div class="m">${esc(p.variant)} · ${l.size === 'ONE SIZE' ? 'One size' : 'Size ' + esc(l.size)} · ×${l.qty}</div></div>
            <span class="price" style="font-size:12.5px">${money(p.price * l.qty)}</span>
          </div>`;
        }).join('');
      }
      $('#coSubtotal').textContent = money(sub);
      $('#coShipping').textContent = sub === 0 ? '—' : shipping === 0 ? 'Free' : money(shipping);
      $('#coShipLabel').textContent = rule.eta ? '(' + rule.eta + ')' : '';
      $('#coTotal').textContent = money(sub + (sub ? shipping : 0));
      const payBtn = $('#payBtn');
      const payLabel = payBtn.querySelector('span');
      payBtn.disabled = !TC.state.bag.length;
      if (payLabel) payLabel.textContent = TC.state.bag.length ? 'Pay with Paystack' : 'Add a piece to continue';
      return { sub, shipping, zone, rule };
    }

    const err = (field, msg) => {
      const el = form.querySelector(`[data-err="${field}"]`);
      if (el) el.textContent = msg || '';
      const input = form.querySelector(`[name="${field}"]`);
      if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
      return !msg;
    };

    function validate(data) {
      let ok = true;
      ok = err('name', data.name.trim().length < 2 ? 'Enter your full name' : '') && ok;
      ok = err('email', !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email.trim()) ? 'Enter a valid email' : '') && ok;
      ok = err('phone', data.phone.replace(/\D/g, '').length < 7 ? 'Enter a valid phone number' : '') && ok;
      ok = err('address', data.address.trim().length < 4 ? 'Enter your delivery address' : '') && ok;
      ok = err('city', data.city.trim().length < 2 ? 'Enter your city and state' : '') && ok;
      if (data.zone === 'INTL') ok = err('country', data.country.trim().length < 2 ? 'Enter your country' : '') && ok;
      else err('country', '');
      return ok;
    }

    // restore saved buyer details
    try {
      const saved = JSON.parse(localStorage.getItem(TC.CONFIG.customerKey) || '{}');
      ['name', 'email', 'phone', 'address', 'city', 'country'].forEach((k) => {
        const el = form.querySelector(`[name="${k}"]`);
        if (el && saved[k]) el.value = saved[k];
      });
    } catch {}

    $('#coZone').addEventListener('change', summary);
    TC.on(summary);
    summary();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const alertBox = $('#checkoutAlert');
      alertBox.classList.remove('show');
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
      if (!TC.state.bag.length) { TC.toast('Your bag is empty', 'err'); return; }
      if (!validate(data)) { alertBox.textContent = 'Check the highlighted fields and try again.'; alertBox.classList.add('show'); return; }
      try { localStorage.setItem(TC.CONFIG.customerKey, JSON.stringify(data)); } catch {}

      const btn = $('#payBtn');
      const span = btn.querySelector('span');
      btn.disabled = true;
      span.textContent = 'Opening secure payment…';

      try {
        const res = await fetch('/api/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: TC.state.bag.map((l) => ({ sku: l.sku, size: l.size, qty: l.qty })), customer: data })
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Could not start checkout.');
        try { localStorage.setItem('tc_pending_order', JSON.stringify({ reference: json.reference, total: json.total, mode: json.mode })); } catch {}

        if (json.mode === 'preview') { location.href = json.callback_url; return; }

        if (json.access_code && json.public_key) {
          const loaded = await loadPaystack();
          if (loaded) {
            const pop = new window.PaystackPop();
            pop.newTransaction({
              key: json.public_key,
              email: json.email,
              amount: json.total_kobo,
              currency: json.currency,
              reference: json.reference,
              access_code: json.access_code,
              onSuccess: () => { location.href = 'thanks.html?reference=' + encodeURIComponent(json.reference); },
              onCancel: () => {
                btn.disabled = false; span.textContent = 'Pay with Paystack';
                alertBox.textContent = 'Payment cancelled. Your bag is saved.';
                alertBox.classList.add('show');
              }
            });
            return;
          }
        }
        location.href = json.authorization_url || 'thanks.html?reference=' + encodeURIComponent(json.reference);
      } catch (error) {
        alertBox.textContent = error.message || 'Something went wrong. Please try again.';
        alertBox.classList.add('show');
        btn.disabled = false;
        span.textContent = 'Pay with Paystack';
      }
    });
  }

  function loadPaystack() {
    return new Promise((resolve) => {
      if (window.PaystackPop) return resolve(true);
      const s = document.createElement('script');
      s.src = 'https://js.paystack.co/v2/inline.js';
      s.async = true;
      s.onload = () => resolve(!!window.PaystackPop);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
      setTimeout(() => resolve(!!window.PaystackPop), 6000);
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

      const btn = $('#trackBtn');
      btn.disabled = true;
      out.innerHTML = '<p class="muted small">Looking up your order…</p>';
      try {
        const res = await fetch('/api/track?reference=' + encodeURIComponent(ref) + (email ? '&email=' + encodeURIComponent(email) : ''));
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Order not found.');
        const o = json.order;
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
          <span class="rail-frame"><img src="assets/products/3d/${esc(p.sku)}.jpg" alt="${esc(p.name + ' — ' + p.variant)}" width="360" height="360" loading="lazy"></span>
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
      if (fb) fb.src = 'assets/products/3d/' + sku + '-front.jpg';
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
            <img src="assets/products/3d/${esc(p.sku)}.jpg" alt="" width="64" height="64" loading="lazy">
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

  /* ---------------------------------------------------------------- boot */
  document.addEventListener('DOMContentLoaded', () => {
    initHome();
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
