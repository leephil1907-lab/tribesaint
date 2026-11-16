/* ==========================================================================
   TRIBE CULTURE — invoice & receipt engine (zero dependencies)

   Produces:
     buildInvoice(order, cfg, { type, seq })  → structured document
     invoicePdf(doc)                           → Buffer (branded A4 PDF)
   The same document feeds /invoice.html so print, screen and email agree.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ------------------------------------------------------------------ tokens
   A document link is a capability handed to a customer. It is signed with a
   dedicated secret that lives on the server (env INVOICE_SECRET, or generated
   into the store on first boot) so that rotating the studio password or the
   Paystack keys never invalidates receipts already sitting in an inbox.
   The old derivation is still accepted so nothing sent before is broken.
 * ------------------------------------------------------------------------- */
function legacySecret(cfg) {
  return crypto
    .createHash('sha256')
    .update('tc-invoice|' + (cfg.admin_password || '') + '|' + (cfg.paystack_secret_key || '') + '|' + (cfg.currency || 'NGN'))
    .digest();
}

function invoiceSecret(cfg) {
  if (cfg.invoice_secret) {
    return crypto.createHash('sha256').update('tc-invoice|' + cfg.invoice_secret).digest();
  }
  return legacySecret(cfg);
}

function sign(reference, key) {
  return crypto.createHmac('sha256', key).update(String(reference)).digest('hex').slice(0, 32);
}

function invoiceToken(reference, cfg) {
  return sign(reference, invoiceSecret(cfg));
}

function sameToken(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

function tokenValid(reference, token, cfg) {
  if (!reference || !token) return false;
  const given = String(token);
  if (sameToken(given, invoiceToken(reference, cfg))) return true;
  /* links issued before the dedicated secret existed */
  if (cfg.invoice_secret && sameToken(given, sign(reference, legacySecret(cfg)))) return true;
  return false;
}

/* ---------------------------------------------------------------- document */
const STATUS_LABEL = {
  pending: 'Awaiting payment',
  paid: 'Paid in full',
  packed: 'Paid in full · packed',
  shipped: 'Paid in full · shipped',
  delivered: 'Paid in full · delivered',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  mismatch: 'Payment mismatch'
};

const pad4 = (n) => String(n).padStart(4, '0');

function moneyOf(n, cfg) {
  const v = Number(n || 0);
  return (cfg.currency_symbol || '₦') + v.toLocaleString('en-NG');
}

function buildInvoice(order, cfg, opts = {}) {
  const type = opts.type === 'receipt' ? 'receipt' : 'invoice';
  const seq = Number(opts.seq || 1);
  const inv = cfg.invoice || {};
  const year = new Date(order.created_at || Date.now()).getFullYear();
  const prefix = type === 'receipt' ? inv.receipt_prefix || 'TC/RCT' : inv.prefix || 'TC/INV';
  const paid = ['paid', 'packed', 'shipped', 'delivered'].includes(order.status);
  const number = `${prefix}/${year}/${pad4(seq)}`;

  return {
    type,
    number,
    reference: order.reference,
    status: order.status,
    status_label: STATUS_LABEL[order.status] || order.status,
    paid,
    issued_at: order.created_at,
    paid_at: order.paid_at || null,
    mode: order.mode || 'live',
    currency: order.currency || cfg.currency || 'NGN',
    currency_symbol: cfg.currency_symbol || '₦',
    seller: {
      name: cfg.brand_name || 'Tribe Culture',
      legal: cfg.brand_legal || cfg.brand_name || 'Tribe Culture',
      rc: cfg.brand_rc || '',
      email: cfg.store_email || '',
      phone: cfg.support_phone || '',
      whatsapp: cfg.whatsapp || '',
      site: cfg.site_url || '',
      tagline: cfg.tagline || 'Discover new truth'
    },
    buyer: {
      name: order.customer.name,
      email: order.customer.email,
      phone: order.customer.phone,
      address: order.customer.address,
      city: order.customer.city,
      country: order.customer.country || 'Nigeria',
      note: order.customer.note || ''
    },
    items: (order.items || []).map((i) => ({
      sku: i.sku,
      name: i.name,
      variant: i.variant,
      size: i.size,
      size_label: i.size === 'ONE SIZE' ? 'One size' : 'Size ' + i.size,
      qty: i.qty,
      unit: Number(i.price ?? i.unit ?? 0),
      line_total: Number(i.line_total ?? (i.price || 0) * i.qty),
      image: i.image || null
    })),
    subtotal: Number(order.subtotal || 0),
    shipping: Number(order.shipping || 0),
    shipping_label: order.shipping_label || '',
    shipping_zone: order.shipping_zone || 'NG',
    total: Number(order.total || 0),
    terms: inv.terms || '',
    notes: inv.notes || '',
    bank: inv.bank || null,
    money: (n) => moneyOf(n, cfg)
  };
}

/* -------------------------------------------------------------- pdf engine */
const HELV = {
  ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191, '(': 333, ')': 333, '*': 389, '+': 584,
  ',': 278, '-': 333, '.': 278, '/': 278, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833, N: 722,
  O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333, '{': 334, '|': 260, '}': 334, '~': 584,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833, n: 556,
  o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500
};
const HELV_B = {
  ' ': 278, '!': 333, '"': 474, '#': 556, $: 556, '%': 889, '&': 722, "'": 238, '(': 333, ')': 333, '*': 389, '+': 584,
  ',': 278, '-': 333, '.': 278, '/': 278, ':': 333, ';': 333, '<': 584, '=': 584, '>': 584, '?': 611, '@': 975,
  A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 556, K: 722, L: 611, M: 833, N: 722,
  O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 333, '\\': 278, ']': 333, '^': 584, _: 556, '`': 333, '{': 389, '|': 280, '}': 389, '~': 584,
  a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278, j: 278, k: 556, l: 278, m: 889, n: 611,
  o: 611, p: 611, q: 611, r: 389, s: 556, t: 333, u: 611, v: 556, w: 778, x: 556, y: 556, z: 500
};

/** width of a string in points for Helvetica at `size` */
function textWidth(str, size, bold = false) {
  const table = bold ? HELV_B : HELV;
  let w = 0;
  for (const ch of String(str)) {
    const c = ch.charCodeAt(0);
    if (c >= 48 && c <= 57) w += 556;
    else w += table[ch] || 556;
  }
  return (w / 1000) * size;
}

/** WinAnsi-safe text: the PDF base14 fonts cannot carry ₦, so it becomes NGN */
function pdfSafe(str) {
  return String(str == null ? '' : str)
    .replace(/₦/g, 'NGN ')
    .replace(/[–—]/g, '-')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/·/g, '-')
    .replace(/×/g, 'x')
    .replace(/[^\x20-\x7E\n]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function esc(str) {
  return pdfSafe(str).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

class Pdf {
  constructor(width = 595.28, height = 841.89) {
    this.w = width;
    this.h = height;
    this.pages = [];
    this.ops = [];
    this.images = [];
  }
  page() {
    if (this.ops.length) this.pages.push(this.ops.join('\n'));
    this.ops = [];
    return this;
  }
  _y(y) { return this.h - y; }
  rect(x, y, w, h, color, { stroke = null, lw = 0.6 } = {}) {
    const Y = this._y(y + h);
    if (color) this.ops.push(`${color} rg ${x.toFixed(2)} ${Y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
    if (stroke) this.ops.push(`${stroke} RG ${lw} w ${x.toFixed(2)} ${Y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`);
    return this;
  }
  line(x1, y1, x2, y2, color = '0.8 0.8 0.8', lw = 0.6) {
    this.ops.push(`${color} RG ${lw} w ${x1.toFixed(2)} ${this._y(y1).toFixed(2)} m ${x2.toFixed(2)} ${this._y(y2).toFixed(2)} l S`);
    return this;
  }
  text(x, y, str, { size = 10, bold = false, color = '0.07 0.06 0.06', align = 'left', tracking = 0 } = {}) {
    const s = pdfSafe(str);
    if (!s) return this;
    let px = x;
    const w = textWidth(s, size, bold) + tracking * Math.max(0, s.length - 1);
    if (align === 'right') px = x - w;
    else if (align === 'center') px = x - w / 2;
    const font = bold ? '/F2' : '/F1';
    const tc = tracking ? ` ${tracking.toFixed(2)} Tc` : ' 0 Tc';
    this.ops.push(`BT ${color} rg ${font} ${size} Tf${tc} 1 0 0 1 ${px.toFixed(2)} ${this._y(y + size * 0.82).toFixed(2)} Tm (${esc(s)}) Tj ET`);
    return this;
  }
  wrap(x, y, str, maxWidth, { size = 9, bold = false, color = '0.35 0.33 0.31', leading = 12 } = {}) {
    const words = pdfSafe(str).split(' ').filter(Boolean);
    let line = '';
    let yy = y;
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (textWidth(test, size, bold) > maxWidth && line) {
        this.text(x, yy, line, { size, bold, color });
        yy += leading;
        line = word;
      } else line = test;
    }
    if (line) { this.text(x, yy, line, { size, bold, color }); yy += leading; }
    return yy;
  }
  image(x, y, w, h, buf) {
    const ref = this.images.length + 1;
    this.images.push(buf);
    this.ops.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${this._y(y + h).toFixed(2)} cm /Im${ref} Do Q`);
    return this;
  }
  build() {
    if (this.ops.length) this.pages.push(this.ops.join('\n'));
    this.ops = [];
    const objects = [];
    const add = (body) => { objects.push(body); return objects.length; };

    const fontA = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const fontB = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

    const imgObjs = [];
    for (const buf of this.images) {
      const head = Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width ${buf.width} /Height ${buf.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${buf.data.length} >>\nstream\n`
      );
      imgObjs.push({ head, data: buf.data });
    }

    const pageIds = [];
    const contentIds = [];
    for (const content of this.pages) {
      const z = Buffer.from(content, 'latin1');
      const deflated = require('zlib').deflateSync(z);
      contentIds.push(add({ raw: Buffer.concat([Buffer.from(`<< /Length ${deflated.length} /Filter /FlateDecode >>\nstream\n`), deflated, Buffer.from('\nendstream')]) }));
    }

    // placeholders for pages so ids resolve predictably
    for (let i = 0; i < this.pages.length; i++) pageIds.push(add(null));

    const imgStart = objects.length + 1;
    const xobjRefs = imgObjs.map((_, i) => `${imgStart + i} 0 R`).join(' ');
    for (const o of imgObjs) add({ image: o });

    pageIds.forEach((pid, i) => {
      objects[pid - 1] = `<< /Type /Page /Parent __PAGES__ /MediaBox [0 0 ${this.w.toFixed(2)} ${this.h.toFixed(2)}] /Resources << /Font << /F1 ${fontA} 0 R /F2 ${fontB} 0 R >> ${imgObjs.length ? `/XObject << ${imgObjs.map((_, k) => `/Im${k + 1} ${imgStart + k} 0 R`).join(' ')} >>` : ''} >> /Contents ${contentIds[i]} 0 R >>`;
    });

    const pagesId = add(`<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
    const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    const infoId = add(`<< /Title (Tribe Culture invoice) /Producer (Tribe Culture store) /Creator (Tribe Culture) >>`);

    // patch the parent reference
    objects.forEach((o, i) => {
      if (typeof o === 'string') objects[i] = o.replace('__PAGES__', `${pagesId} 0 R`);
    });

    const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
    const offsets = [0];
    let pos = chunks[0].length;
    objects.forEach((obj, i) => {
      const num = i + 1;
      let buf;
      if (obj && obj.image) {
        buf = Buffer.concat([Buffer.from(`${num} 0 obj\n`), obj.image.head, obj.image.data, Buffer.from('\nendstream\nendobj\n')]);
      } else if (obj && obj.raw) {
        buf = Buffer.concat([Buffer.from(`${num} 0 obj\n`), obj.raw, Buffer.from('\nendobj\n')]);
      } else {
        buf = Buffer.from(`${num} 0 obj\n${obj}\nendobj\n`, 'latin1');
      }
      offsets.push(pos);
      pos += buf.length;
      chunks.push(buf);
    });
    const xrefAt = pos;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i++) xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
    chunks.push(Buffer.from(xref, 'latin1'));
    return Buffer.concat(chunks);
  }
}

/** read a JPEG's intrinsic size without a library */
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return { width: 900, height: 220 };
}

let LOGO_CACHE = null;
function logoBuffer() {
  if (LOGO_CACHE) return LOGO_CACHE;
  const file = path.join(__dirname, 'assets', 'brand', 'crest-ink.jpg');
  const data = fs.readFileSync(file);
  const { width, height } = jpegSize(data);
  LOGO_CACHE = { data, width, height };
  return LOGO_CACHE;
}

/* ------------------------------------------------------------------ layout */
const RED = '0.83 0.08 0.10';
const INK = '0.05 0.05 0.05';
const MUTE = '0.42 0.40 0.38';
const LINE = '0.85 0.83 0.79';
const PAPER = '1 1 1';
const BONE = '0.96 0.94 0.90';

function invoicePdf(doc, cfg) {
  const p = new Pdf(595.28, 841.89);
  const M = 42;
  const CW = p.w - M * 2;
  const perPage = 12;
  const itemPages = [];
  const items = doc.items.slice();
  do {
    itemPages.push(items.splice(0, perPage));
  } while (items.length);

  itemPages.forEach((rows, pageIndex) => {
    const first = pageIndex === 0;
    const y0 = M;

    /* ---------- header band ---------- */
    if (first) {
      p.rect(0, 0, p.w, 112, INK);
      try {
        const logo = logoBuffer();
        p.image(M, 26, 56, 56 * (logo.height / logo.width), logo);
      } catch { /* logo optional */ }
      p.text(M + 72, 30, doc.seller.name.toUpperCase(), { size: 19, bold: true, color: PAPER, tracking: 0.6 });
      p.text(M + 73, 54, 'ESTABLISHED MMXXVI  ·  LAGOS  ·  WORLDWIDE', { size: 7.2, color: '0.62 0.60 0.56', tracking: 0.9 });
      p.text(M + 73, 72, doc.seller.email + (doc.seller.phone ? '  ·  ' + doc.seller.phone : ''), { size: 8, color: '0.75 0.73 0.69' });

      p.text(p.w - M, 30, doc.type === 'receipt' ? 'RECEIPT' : 'INVOICE', { size: 20, bold: true, color: PAPER, align: 'right', tracking: 1.2 });
      p.text(p.w - M, 56, doc.number, { size: 9.5, bold: true, color: RED, align: 'right' });
      p.text(p.w - M, 72, (doc.paid ? 'PAID' : 'AWAITING PAYMENT'), { size: 7.4, color: '0.7 0.68 0.64', align: 'right', tracking: 1 });
      p.rect(p.w - M - 116, 84, 116, 2.2, RED);
    } else {
      p.rect(0, 0, p.w, 42, INK);
      p.text(M, 16, doc.seller.name.toUpperCase() + '  ·  ' + doc.number, { size: 9, bold: true, color: PAPER, tracking: 0.8 });
      p.text(p.w - M, 16, (doc.type === 'receipt' ? 'RECEIPT' : 'INVOICE') + '  ·  page ' + (pageIndex + 1), { size: 8, color: '0.7 0.68 0.64', align: 'right' });
    }

    let y = first ? 140 : 76;

    if (first) {
      /* ---------- parties ---------- */
      const colW = CW / 2 - 14;
      p.text(M, y, 'BILLED TO', { size: 7, bold: true, color: RED, tracking: 1.1 });
      let yl = y + 16;
      p.text(M, yl, doc.buyer.name, { size: 10.5, bold: true, color: INK }); yl += 14;
      for (const line of [doc.buyer.address, doc.buyer.city + (doc.buyer.country ? ', ' + doc.buyer.country : ''), doc.buyer.email, doc.buyer.phone]) {
        if (!line) continue;
        yl = p.wrap(M, yl, line, colW, { size: 8.6, color: '0.28 0.27 0.25', leading: 11 });
      }

      const xr = M + CW / 2 + 14;
      p.text(xr, y, 'DOCUMENT', { size: 7, bold: true, color: RED, tracking: 1.1 });
      const rows = [
        [doc.type === 'receipt' ? 'Receipt no.' : 'Invoice no.', doc.number],
        ['Order ref.', doc.reference],
        ['Issued', fmtDate(doc.issued_at)],
        [doc.paid ? 'Payment received' : 'Payment due', doc.paid_at ? fmtDate(doc.paid_at) : 'On receipt'],
        ['Status', doc.status_label],
        ['Dispatch', doc.shipping_label || '—']
      ];
      let yr = y + 16;
      rows.forEach(([k, v]) => {
        p.text(xr, yr, k.toUpperCase(), { size: 6.6, color: MUTE, tracking: 0.8 });
        p.text(M + CW, yr, v, { size: 8.6, bold: false, color: INK, align: 'right' });
        p.line(xr, yr + 11, M + CW, yr + 11, LINE, 0.4);
        yr += 17;
      });
      y = Math.max(yl, yr) + 16;
    }

    /* ---------- table head ---------- */
    p.rect(M, y, CW, 20, BONE);
    p.text(M + 8, y + 6, 'PIECE', { size: 6.8, bold: true, color: INK, tracking: 0.8 });
    p.text(M + CW * 0.60, y + 6, 'SIZE', { size: 6.8, bold: true, color: INK, tracking: 0.8 });
    p.text(M + CW * 0.70, y + 6, 'QTY', { size: 6.8, bold: true, color: INK, tracking: 0.8, align: 'right' });
    p.text(M + CW * 0.82, y + 6, 'UNIT', { size: 6.8, bold: true, color: INK, tracking: 0.8, align: 'right' });
    p.text(M + CW - 8, y + 6, 'AMOUNT', { size: 6.8, bold: true, color: INK, tracking: 0.8, align: 'right' });
    y += 20;

    /* ---------- rows ---------- */
    rows.forEach((it, idx) => {
      const rowH = 30;
      if (idx % 2 === 1) p.rect(M, y, CW, rowH, '0.985 0.978 0.965');
      p.text(M + 8, y + 8, it.name, { size: 9.4, bold: true, color: INK });
      p.text(M + 8, y + 19, it.variant + '  ·  ' + it.sku, { size: 7.2, color: MUTE });
      p.text(M + CW * 0.60, y + 10, it.size_label, { size: 8.4, color: '0.3 0.29 0.27' });
      p.text(M + CW * 0.70, y + 10, String(it.qty), { size: 8.4, color: '0.3 0.29 0.27', align: 'right' });
      p.text(M + CW * 0.82, y + 10, moneyOf(it.unit, cfg), { size: 8.4, color: '0.3 0.29 0.27', align: 'right' });
      p.text(M + CW - 8, y + 10, moneyOf(it.line_total, cfg), { size: 9.4, bold: true, color: INK, align: 'right' });
      p.line(M, y + rowH, M + CW, y + rowH, LINE, 0.5);
      y += rowH;
    });

    /* ---------- totals (last page only) ---------- */
    if (pageIndex === itemPages.length - 1) {
      y += 10;
      const bx = M + CW * 0.52;
      const bw = CW * 0.48;
      const trow = (label, value, { bold = false, big = false, color = INK } = {}) => {
        p.text(bx, y + 2, label, { size: big ? 9 : 8.4, bold, color: bold ? INK : MUTE, tracking: bold ? 0.6 : 0 });
        p.text(M + CW, y + 2, value, { size: big ? 12 : 8.8, bold, color, align: 'right' });
        y += big ? 22 : 16;
      };
      p.rect(bx, y - 2, bw, 0.8, LINE);
      y += 6;
      trow('Subtotal', moneyOf(doc.subtotal, cfg));
      trow('Delivery — ' + (doc.shipping_label || 'n/a'), doc.shipping ? moneyOf(doc.shipping, cfg) : 'Free');
      p.line(bx, y + 1, M + CW, y + 1, '0.6 0.58 0.55', 0.8);
      y += 8;
      trow(doc.paid ? 'TOTAL PAID' : 'TOTAL DUE', moneyOf(doc.total, cfg), { bold: true, big: true, color: RED });

      /* payment state / bank details */
      const by = y + 6;
      p.rect(M, by, CW, 34, doc.paid ? '0.96 0.98 0.96' : '0.99 0.96 0.96');
      p.text(M + 10, by + 8, doc.paid ? 'SETTLED' : 'HOW TO PAY', { size: 6.8, bold: true, color: doc.paid ? '0.10 0.44 0.20' : RED, tracking: 1 });
      const payLine = doc.paid
        ? `Paid with Paystack${doc.paid_at ? ' on ' + fmtDate(doc.paid_at) : ''}  ·  transaction ${doc.reference}`
        : (doc.bank && doc.bank.bank && doc.bank.account)
          ? `${doc.bank.bank}  ·  ${doc.bank.account}  ·  ${doc.bank.name}  ·  use ${doc.number} as reference`
          : (doc.bank && doc.bank.note)
            ? `${doc.bank.name}  ·  ${doc.bank.note}  ·  reference ${doc.number}`
            : `Pay online with card, transfer or USSD using order ${doc.reference}`;
      p.text(M + 10, by + 19, pdfSafe(payLine), { size: 8, color: '0.2 0.19 0.18' });
      y = by + 48;
    } else {
      y += 16;
      p.text(M, y, 'Continued — items ' + (pageIndex * perPage + 1) + ' to ' + (pageIndex * perPage + rows.length) + ' of ' + doc.items.length, { size: 8, color: MUTE });
      y += 20;
    }

    /* ---------- notes & footer ---------- */
    if (pageIndex === itemPages.length - 1) {
      if (doc.notes) {
        p.text(M, y, 'NOTES', { size: 6.8, bold: true, color: RED, tracking: 1 });
        y = p.wrap(M, y + 12, doc.notes, CW, { size: 7.8, color: '0.32 0.31 0.29', leading: 10 }) + 2;
      }
      if (doc.terms && y < p.h - 120) {
        p.text(M, y, 'TERMS', { size: 6.8, bold: true, color: RED, tracking: 1 });
        y = p.wrap(M, y + 12, doc.terms, CW, { size: 7.4, color: '0.42 0.40 0.38', leading: 9.6 }) + 2;
      }
    }

    /* footer */
    const fy = p.h - 62;
    p.line(M, fy - 10, M + CW, fy - 10, INK, 0.8);
    const sealLine = [doc.seller.name.toUpperCase(), doc.seller.rc ? 'RC ' + doc.seller.rc : null, doc.seller.tagline]
      .filter(Boolean).join('  ·  ');
    p.text(M, fy + 2, sealLine, { size: 8, bold: true, color: INK, tracking: 0.9 });
    const contact = [
      doc.seller.site ? doc.seller.site.replace(/^https?:\/\//, '') : 'tribeculture.store',
      doc.seller.email,
      doc.seller.whatsapp ? 'WhatsApp +' + doc.seller.whatsapp : doc.seller.phone
    ].filter(Boolean).join('  ·  ');
    p.text(M, fy + 16, contact, { size: 7.4, color: MUTE });
    p.text(M + CW, fy + 16, 'Quote ' + doc.number + ' in any correspondence', { size: 7.4, color: MUTE, align: 'right' });
    if (doc.mode === 'preview') {
      p.text(M, fy + 30, 'TEST DOCUMENT — generated in preview mode. No payment has been collected.', { size: 7, color: RED });
    }

    p.page();
  });

  return p.build();
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

module.exports = { invoiceToken, tokenValid, buildInvoice, invoicePdf, moneyOf, fmtDate, pdfSafe };
