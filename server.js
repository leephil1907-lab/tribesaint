#!/usr/bin/env node
/**
 * Tribe Culture — production storefront server
 * -------------------------------------------------------------------------
 * Node 18+, zero runtime dependencies.
 *
 *  · Static site with gzip, long-cache assets, 404 page and byte-range video
 *  · Server-authoritative catalogue, prices, stock and delivery rates
 *  · Paystack: initialize → verify → webhook (HMAC-SHA512 + amount/currency match)
 *  · Orders, stock, signups, messages and settings persisted to a JSON store
 *  · Admin API behind a signed session token + rate limiting
 *
 * Environment (all optional; config.json supplies the defaults):
 *  PORT, HOST, SITE_URL, PAYSTACK_SECRET_KEY, PAYSTACK_PUBLIC_KEY,
 *  STORE_EMAIL, FROM_EMAIL, ADMIN_PASSWORD, RESEND_API_KEY,
 *  ALLOW_PREVIEW_CHECKOUT, TC_DATA_DIR, DATA_DIR
 */

'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { URL } = require('url');
const { invoiceToken, tokenValid, buildInvoice, invoicePdf } = require('./invoice.js');

const ROOT = __dirname;

/* recognised weak values, compared as hashes so no plaintext ships in the repo */
const WEAK_PASSWORDS = new Set([
  '7c939657c4e1c6acca9db34dcb087e3662b265314546b4b3fec1de66073ed80b'
]);
function isWeakPassword(pw) {
  if (!pw) return false;
  const h = crypto.createHash('sha256').update(String(pw)).digest('hex');
  return WEAK_PASSWORDS.has(h);
}

/* ------------------------------------------------------------------ config */
function loadConfig() {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  const production = process.env.NODE_ENV === 'production';
  const adminPassword = String(process.env.ADMIN_PASSWORD || raw.admin_password || '').trim();
  if (production && (adminPassword.length < 16 || isWeakPassword(adminPassword))) {
    throw new Error('Production requires a unique ADMIN_PASSWORD of at least 16 characters.');
  }
  return {
    ...raw,
    currency: (process.env.STORE_CURRENCY || raw.currency || 'NGN').toUpperCase(),
    store_email: process.env.STORE_EMAIL || raw.store_email,
    from_email: process.env.FROM_EMAIL || raw.from_email,
    site_url: (process.env.SITE_URL || raw.site_url || '').replace(/\/+$/, ''),
    paystack_secret_key: (process.env.PAYSTACK_SECRET_KEY || raw.paystack_secret_key || '').trim(),
    paystack_public_key: (process.env.PAYSTACK_PUBLIC_KEY || raw.paystack_public_key || '').trim(),
    /* no shipped default: production refuses a missing or weak studio password */
    admin_password: adminPassword,
    resend_api_key: (process.env.RESEND_API_KEY || '').trim(),
    low_stock_at: Number(process.env.LOW_STOCK_AT || raw.low_stock_at || 3) || 3,
    /* signs receipt links; see ensureInvoiceSecret() */
    invoice_secret: (process.env.INVOICE_SECRET || '').trim(),
    allow_preview_checkout: !production && (
      process.env.ALLOW_PREVIEW_CHECKOUT !== undefined
        ? process.env.ALLOW_PREVIEW_CHECKOUT === 'true'
        : Boolean(raw.allow_preview_checkout)
    )
  };
}

let CONFIG;
try {
  CONFIG = loadConfig();
} catch (err) {
  /* a misconfigured production deploy must fail loudly and readably, not with a
     stack trace buried in the build log */
  console.error('\u2716  ' + ((err && err.message) || err));
  console.error('   Set ADMIN_PASSWORD to a unique value of 16+ characters in the service environment, then redeploy.');
  if (require.main === module) process.exit(1);
  throw err;
}

function paystackMode(cfg) {
  if (cfg.paystack_secret_key.startsWith('sk_live_')) return 'live';
  if (cfg.paystack_secret_key.startsWith('sk_test_')) return 'test';
  return cfg.allow_preview_checkout ? 'preview' : 'unconfigured';
}

/* ------------------------------------------------------------------- store */
const DATA_DIR =
  process.env.TC_DATA_DIR ||
  process.env.DATA_DIR ||
  (process.env.VERCEL ? '/tmp/tc-data' : path.join(ROOT, 'api', 'data'));

const DB_FILE = path.join(DATA_DIR, 'store.json');
const MAIL_LOG = path.join(DATA_DIR, 'emails.log');

function ensureDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
}

function freshDb() {
  const stock = {};
  const products = {};
  for (const [sku, p] of Object.entries(CONFIG.products)) {
    stock[sku] = { ...p.default_stock };
    products[sku] = { price: p.price, active: p.active !== false };
  }
  return {
    stock,
    products,
    orders: [],
    signups: [],
    messages: [],
    settings: {
      free_delivery_over: CONFIG.free_delivery_over,
      store_email: CONFIG.store_email,
      shipping: CONFIG.shipping
    }
  };
}

/* ---------------------------------------------------------------- storage
 * The store is a single JSON file. Two rules keep it safe in production:
 *  1. never invent an empty database over a file we failed to read
 *  2. never let two requests interleave a read-modify-write
 * Reads are served from an in-memory copy guarded by the file's mtime, so a
 * request costs a stat() rather than a full parse.
 * ------------------------------------------------------------------------- */
const BACKUP_FILE = DB_FILE + '.bak';
let dbCache = null;      /* { db, mtimeMs, size } */
let dbHealthy = true;        /* false while the store is unreadable */
let dbRecoveredAt = null;    /* when we last had to rebuild from a backup */
let writeChain = Promise.resolve();

function logEvent(level, msg, extra) {
  const line = `[${new Date().toISOString()}] ${level} ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}`;
  if (level === 'error') console.error(line); else console.log(line);
}

/* normalise whatever we parsed into the shape the rest of the server expects */
function migrate(db) {
  db.stock ||= {};
  db.products ||= {};
  db.orders ||= [];
  db.signups ||= [];
  db.messages ||= [];
  db.settings ||= {};
  db.invoices ||= {};
  if (typeof db.invoice_seq !== 'number') db.invoice_seq = 0;
  for (const [sku, p] of Object.entries(CONFIG.products)) {
    if (!db.stock[sku]) db.stock[sku] = { ...p.default_stock };
    for (const size of p.sizes) {
      if (typeof db.stock[sku][size] !== 'number') db.stock[sku][size] = p.default_stock[size] ?? 0;
    }
    if (!db.products[sku]) db.products[sku] = { price: p.price, active: p.active !== false };
  }
  db.settings.shipping ||= CONFIG.shipping;
  if (db.settings.free_delivery_over == null) db.settings.free_delivery_over = CONFIG.free_delivery_over;
  if (!db.settings.store_email) db.settings.store_email = CONFIG.store_email;
  return db;
}

function readJsonFile(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

/* called only when the primary file is unreadable: keep the evidence, restore
   the last good copy if there is one, and shout about it. */
function recover(reason) {
  dbHealthy = false;
  dbRecoveredAt = new Date().toISOString();
  ensureDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const quarantined = path.join(DATA_DIR, `store.corrupt-${stamp}.json`);
  try { fs.renameSync(DB_FILE, quarantined); } catch {}
  logEvent('error', 'store.json could not be read — quarantined', { reason, quarantined });

  try {
    const backup = migrate(readJsonFile(BACKUP_FILE));
    logEvent('error', 'restored from store.json.bak', { orders: backup.orders.length });
    writeDb(backup);
    dbHealthy = true;      /* serving again; dbRecoveredAt keeps the warning visible */
    return backup;
  } catch {
    logEvent('error', 'no usable backup — starting a fresh store; check the quarantined file');
    const db = freshDb();
    writeDb(db);
    dbHealthy = true;
    return db;
  }
}

function readDb() {
  ensureDir();
  let stat;
  try { stat = fs.statSync(DB_FILE); } catch { stat = null; }

  if (!stat) {
    if (dbCache && !fs.existsSync(DB_FILE)) {
      /* someone removed the file under us — honour it with a fresh store */
      const db = freshDb();
      writeDb(db);
      return db;
    }
    const db = freshDb();
    writeDb(db);
    return db;
  }

  if (dbCache && dbCache.mtimeMs === stat.mtimeMs && dbCache.size === stat.size) {
    return dbCache.db;
  }

  try {
    const db = migrate(readJsonFile(DB_FILE));
    dbCache = { db, mtimeMs: stat.mtimeMs, size: stat.size };
    dbHealthy = true;
    return db;
  } catch (err) {
    return recover(err && err.message);
  }
}

function writeDb(db) {
  ensureDir();
  const payload = JSON.stringify(db, null, 2);
  const tmp = DB_FILE + '.tmp';
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, payload);
    fs.fsyncSync(fd);          /* durability: survive a container kill */
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, DB_FILE);
  /* the backup mirrors the newest good state, so a corrupt primary costs us
     nothing rather than one write */
  try { fs.copyFileSync(DB_FILE, BACKUP_FILE); } catch {}
  const stat = fs.statSync(DB_FILE);
  dbCache = { db, mtimeMs: stat.mtimeMs, size: stat.size };
}

/* Every mutation goes through here: reads a fresh copy, runs the work, writes,
   and serialises the whole thing so concurrent requests cannot clobber each
   other. `fn` may be async; it must not await network calls while it holds the
   store (do those outside and come back). */
function withDb(fn) {
  const run = async () => {
    const db = readDb();
    const result = await fn(db);
    writeDb(db);
    return result;
  };
  const next = writeChain.then(run, run);
  writeChain = next.catch(() => {});
  return next;
}

/* read-only view, safe to use for GETs */
function peekDb() {
  return readDb();
}

/* --------------------------------------------------------------- utilities */
const text = (v, max = 300) => String(v == null ? '' : v)
  .replace(/[\r\n\t]+/g, ' ')
  /* eslint-disable-next-line no-control-regex */
  .replace(/[\u0000-\u001f\u007f]+/g, '')
  .replace(/\s{2,}/g, ' ')
  .trim()
  .slice(0, max);
const validEmail = (v) => typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

const money = (n, cfg = CONFIG) => (cfg.currency_symbol || '₦') + Number(n || 0).toLocaleString('en-NG');
const reference = () => 'TC-' + new Date().getFullYear() + '-' + crypto.randomBytes(16).toString('hex').toUpperCase();

function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '');
  const hops = xff.split(',').map((h) => h.trim()).filter(Boolean);
  /* the right-most entry is the one the trusted proxy appended; the left ones
     are whatever the caller claimed */
  if (hops.length) return hops[hops.length - 1];
  return req.socket.remoteAddress || 'unknown';
}

const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) { buckets.set(key, hits); return false; }
  hits.push(now);
  buckets.set(key, hits);
  return true;
}

/* check without spending budget — used where only failures should count */
function ratePeek(key, max, windowMs) {
  const now = Date.now();
  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  buckets.set(key, hits);
  return hits.length < max;
}
/* buckets are pruned hourly so a long-lived process cannot accumulate keys */
setInterval(() => {
  const now = Date.now();
  for (const [key, hits] of buckets) {
    const live = hits.filter((t) => now - t < 60 * 60 * 1000);
    if (live.length) buckets.set(key, live); else buckets.delete(key);
  }
}, 60 * 60 * 1000).unref();

function rateHit(key, windowMs) {
  const now = Date.now();
  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  hits.push(now);
  buckets.set(key, hits);
}

function sendJson(res, code, data, headers) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(headers || {})
  });
  res.end(body);
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function httpsJson(options, payload) {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : null;
    const req = https.request(
      {
        ...options,
        headers: {
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
          ...(options.headers || {})
        }
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          try { resolve({ status: res.statusCode, json: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode, json: null, raw }); }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('upstream timeout')));
    if (body) req.write(body);
    req.end();
  });
}

/* ------------------------------------------------------------------ emails */
function sendMail(cfg, to, subject, body, opts = {}) {
  const entry = `\n=== ${new Date().toISOString()} → ${to} | ${subject} ===\n${body}\n`;
  try { fs.appendFileSync(MAIL_LOG, entry, { mode: 0o600 }); } catch {}

  if (!cfg.resend_api_key) {
    /* no provider configured — the log above is the only record */
    return Promise.resolve({ ok: false, error: 'email is not configured (RESEND_API_KEY is missing)' });
  }

  const payload = { from: cfg.from_email, to: [to], subject, text: body };
  if (opts.html) payload.html = opts.html;
  if (opts.attachments && opts.attachments.length) {
    payload.attachments = opts.attachments.map((a) => ({ filename: a.filename, content: a.content.toString('base64') }));
  }

  return httpsJson(
    { hostname: 'api.resend.com', path: '/emails', method: 'POST', headers: { Authorization: `Bearer ${cfg.resend_api_key}` } },
    payload
  ).then(
    (r) => (r && r.status >= 200 && r.status < 300
      ? { ok: true, id: (r.json && r.json.id) || null }
      : { ok: false, error: `resend rejected it (${(r && r.status) || '?'}) ${((r && r.json && (r.json.message || r.json.error)) || '').toString().slice(0, 120)}`.trim() }),
    (err) => ({ ok: false, error: `resend unreachable: ${(err && err.message) || err}` })
  );
}

/* ---------------------------------------------------------------- invoices */
function invoiceNumbers(db, order, cfg) {
  db.invoices ||= {};
  if (!db.invoices[order.reference]) {
    db.invoice_seq = (db.invoice_seq || 0) + 1;
    db.invoices[order.reference] = { seq: db.invoice_seq, created_at: new Date().toISOString(), sent_at: null };
  }
  return db.invoices[order.reference];
}

function invoiceFor(db, order, cfg, type) {
  const meta = invoiceNumbers(db, order, cfg);
  const doc = buildInvoice(order, cfg, { type, seq: meta.seq });
  doc.token = invoiceToken(order.reference, cfg);
  doc.link_path = `/invoice.html?reference=${encodeURIComponent(order.reference)}&type=${type}&token=${doc.token}`;
  return { doc, meta };
}

async function sendOrderEmails(order, cfg, base, db) {
  if (order.email_sent) return;
  const sym = cfg.currency_symbol || '₦';
  const site = base || cfg.site_url || '';
  /* the receipt number was allocated inside the settlement lock; just read it */
  const store = db || readDb();
  const { doc } = invoiceFor(store, order, cfg, 'receipt');

  const lines = order.items
    .map((i) => `  - ${i.name} (${i.variant} / ${i.size === 'ONE SIZE' ? 'One size' : 'Size ' + i.size}) × ${i.qty} — ${money(i.line_total, cfg)}`)
    .join('\n');

  let attachment = null;
  try {
    attachment = { filename: `${doc.number.replace(/[\/]/g, '-')}.pdf`, content: invoicePdf(doc, cfg) };
  } catch { attachment = null; }

  const body = [
    'TRIBE CULTURE — ESTABLISHED MMXXVI',
    '',
    `Thank you, ${order.customer.name}. Your payment is confirmed.`,
    '',
    `Order: ${order.reference}`,
    `Receipt: ${doc.number}`,
    `Status: PAID`,
    '',
    'Items:',
    lines,
    '',
    `Subtotal: ${money(order.subtotal, cfg)}`,
    `Delivery (${order.shipping_label}): ${money(order.shipping, cfg)}`,
    `Total paid: ${money(order.total, cfg)} (${order.currency})`,
    '',
    'Deliver to:',
    order.customer.name,
    order.customer.address,
    `${order.customer.city}${order.customer.country ? ', ' + order.customer.country : ''}`,
    `Phone: ${order.customer.phone}`,
    order.customer.note ? `Note: ${order.customer.note}` : '',
    '',
    `View or download your receipt: ${site}${doc.link_path}`,
    `Track your order: ${site}/track.html?ref=${order.reference}`,
    `Questions: reply to this email, message WhatsApp${cfg.whatsapp ? ' +' + cfg.whatsapp : ''}, or write to ${cfg.store_email}.`,
    '',
    cfg.brand_rc ? `${cfg.brand_legal || 'Tribe Culture'} · RC ${cfg.brand_rc}` : '',
    'Discover new truth. — Tribe Society'
  ].filter(Boolean).join('\n');

  const row = (i) => `<tr>
      <td style="padding:10px 0;border-bottom:1px solid #e8e3d8;font:400 14px/1.4 Helvetica,Arial,sans-serif;color:#111">${esc(i.name)}
        <div style="font:400 11px/1.5 Helvetica,Arial,sans-serif;color:#888;letter-spacing:.04em">${esc(i.variant)} · ${i.size === 'ONE SIZE' ? 'One size' : 'Size ' + i.size} · ×${i.qty}</div></td>
      <td align="right" style="padding:10px 0;border-bottom:1px solid #e8e3d8;font:700 14px/1.4 Helvetica,Arial,sans-serif;color:#111">${money(i.line_total, cfg)}</td></tr>`;

  const html = `<!doctype html><html><body style="margin:0;background:#f4f1ea;padding:24px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff">
    <tr><td style="background:#0a0909;padding:22px 24px">
      <table role="presentation" width="100%"><tr>
        <td><div style="font:700 20px/1 Helvetica,Arial,sans-serif;color:#ece3cf;letter-spacing:.14em">TRIBE CULTURE</div>
            <div style="font:400 9px/1 Helvetica,Arial,sans-serif;color:#8a8378;letter-spacing:.3em;margin-top:7px">ESTABLISHED MMXXVI</div></td>
        <td align="right"><div style="font:700 11px/1 Helvetica,Arial,sans-serif;color:#d4141b;letter-spacing:.22em">PAID</div>
            <div style="font:400 10px/1 Helvetica,Arial,sans-serif;color:#b9b1a4;margin-top:7px">${doc.number}</div></td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:26px 24px 8px">
      <div style="font:400 11px/1 Helvetica,Arial,sans-serif;color:#d4141b;letter-spacing:.26em;text-transform:uppercase">Thank you</div>
      <h1 style="font:700 24px/1.2 Helvetica,Arial,sans-serif;color:#0a0909;margin:10px 0 6px">Your payment is confirmed</h1>
      <p style="font:400 14px/1.6 Helvetica,Arial,sans-serif;color:#4a4640;margin:0 0 18px">${esc(order.customer.name)}, we have your order <strong>${esc(order.reference)}</strong> and the pieces are being packed. Your receipt is attached to this email and always available online.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${order.items.map(row).join('')}
        <tr><td style="padding:12px 0 2px;font:400 12px/1.5 Helvetica,Arial,sans-serif;color:#7b756a">Subtotal</td><td align="right" style="padding:12px 0 2px;font:400 12px/1.5 Helvetica,Arial,sans-serif;color:#7b756a">${money(order.subtotal, cfg)}</td></tr>
        <tr><td style="padding:2px 0;font:400 12px/1.5 Helvetica,Arial,sans-serif;color:#7b756a">Delivery — ${esc(order.shipping_label)}</td><td align="right" style="padding:2px 0;font:400 12px/1.5 Helvetica,Arial,sans-serif;color:#7b756a">${order.shipping ? money(order.shipping, cfg) : 'Free'}</td></tr>
        <tr><td style="padding:12px 0 0;border-top:1px solid #0a0909;font:700 14px/1.4 Helvetica,Arial,sans-serif;color:#0a0909">TOTAL PAID</td><td align="right" style="padding:12px 0 0;border-top:1px solid #0a0909;font:700 16px/1.4 Helvetica,Arial,sans-serif;color:#d4141b">${money(order.total, cfg)}</td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:8px 24px 0">
      <a href="${site}${doc.link_path}" style="display:inline-block;background:#d4141b;color:#fff;text-decoration:none;font:700 11px/1 Helvetica,Arial,sans-serif;letter-spacing:.18em;text-transform:uppercase;padding:14px 22px">View receipt</a>
      <a href="${site}/track.html?ref=${order.reference}" style="display:inline-block;margin-left:8px;border:1px solid #0a0909;color:#0a0909;text-decoration:none;font:700 11px/1 Helvetica,Arial,sans-serif;letter-spacing:.18em;text-transform:uppercase;padding:13px 22px">Track order</a>
    </td></tr>
    <tr><td style="padding:22px 24px 6px">
      <div style="font:400 9px/1 Helvetica,Arial,sans-serif;color:#d4141b;letter-spacing:.26em;text-transform:uppercase;margin-bottom:8px">Delivering to</div>
      <div style="font:400 13px/1.65 Helvetica,Arial,sans-serif;color:#4a4640">${esc(order.customer.name)}<br>${esc(order.customer.address)}<br>${esc(order.customer.city)}${order.customer.country ? ', ' + esc(order.customer.country) : ''}<br>${esc(order.customer.phone)}</div>
    </td></tr>
    <tr><td style="padding:18px 24px 26px">
      <p style="font:400 12px/1.65 Helvetica,Arial,sans-serif;color:#7b756a;margin:0">Questions? Message us on WhatsApp${cfg.whatsapp ? ' (+' + cfg.whatsapp + ')' : ''} or reply to this email. Unworn pieces can be returned within 14 days, tags attached.</p>
    </td></tr>
    <tr><td style="background:#0a0909;padding:18px 24px;font:400 10px/1.7 Helvetica,Arial,sans-serif;color:#8a8378">
      ${esc(cfg.brand_legal || 'Tribe Culture')}${cfg.brand_rc ? ' · RC ' + esc(cfg.brand_rc) : ''} · Discover new truth · ${esc(site.replace(/^https?:\/\//, ''))}<br>${esc(doc.number)} · ${esc(order.reference)}
    </td></tr>
  </table></body></html>`;

  const customer = await sendMail(cfg, order.customer.email, `Tribe Culture — receipt ${doc.number} (${order.reference})`, body, {
    html,
    attachments: attachment ? [attachment] : []
  });
  const store_mail = cfg.store_email
    ? await sendMail(cfg, cfg.store_email, `[NEW ORDER] ${order.reference} — ${money(order.total, cfg)}`, body, {
        attachments: attachment ? [attachment] : []
      })
    : { ok: true };

  if (store.invoices[order.reference]) store.invoices[order.reference].sent_at = customer.ok ? new Date().toISOString() : null;
  order.receipt_no = doc.number;
  order.invoice_no = doc.number.replace(/RCT/, 'INV');
  order.email_sent = !!customer.ok;
  order.email_error = customer.ok ? (store_mail.ok ? null : `store copy: ${store_mail.error}`) : customer.error;
}

/* --------------------------------------------------------------- catalogue */
function cataloguePayload(cfg) {
  const db = readDb();
  const products = {};
  for (const [sku, base] of Object.entries(cfg.products)) {
    const over = db.products[sku] || {};
    const stock = db.stock[sku] || {};
    products[sku] = {
      sku,
      name: base.name,
      variant: base.variant,
      family: base.family || sku,
      colour: base.colour,
      category: base.category || 'apparel',
      badge: base.badge || '',
      featured: base.featured !== false,
      blurb: base.blurb || '',
      details: base.details || {},
      price: Number(over.price ?? base.price),
      active: over.active !== false,
      image: base.image,
      images: base.images || { front: base.image, back: base.image, detail: base.image },
      sizes: base.sizes,
      stock,
      stock_total: base.sizes.reduce((a, z) => a + Number(stock[z] || 0), 0)
    };
  }
  return {
    ok: true,
    brand: cfg.brand_name,
    currency: cfg.currency,
    currency_symbol: cfg.currency_symbol || '₦',
    store_email: db.settings.store_email || cfg.store_email,
    support_phone: cfg.support_phone || '',
    whatsapp: cfg.whatsapp || '',
    whatsapp_message: cfg.whatsapp_message || '',
    free_delivery_over: Number(db.settings.free_delivery_over ?? cfg.free_delivery_over),
    shipping: db.settings.shipping || cfg.shipping,
    products,
    paystack_mode: paystackMode(cfg),
    paystack_public_key: cfg.paystack_public_key || null
  };
}

/* ------------------------------------------------------------------ orders */
/* a per-order proof that the caller is the buyer: handed to the browser that
   created the order, so a reference on its own never unlocks a customer's
   name, phone or address. */
function orderAccessToken(reference, cfg) {
  const secret = `tc-access|${cfg.admin_password}|${cfg.paystack_secret_key}|${cfg.currency}`;
  return crypto.createHmac('sha256', secret).update('order|' + String(reference)).digest('hex').slice(0, 40);
}

function orderAccessible(req, url, order, cfg) {
  const token = text(url.searchParams.get('t') || url.searchParams.get('access_token'), 80);
  const email = text(url.searchParams.get('email'), 254).toLowerCase();
  const preview = text(url.searchParams.get('preview_token'), 64);
  if (token && safeEqual(token, orderAccessToken(order.reference, cfg))) return 'token';
  if (preview && order.preview_token && safeEqual(preview, order.preview_token)) return 'preview';
  if (email && safeEqual(email, String(order.customer.email || '').toLowerCase())) return 'email';
  return null;
}

/* the safe minimum when the caller has only a reference */
function redactedOrder(order, cfg) {
  if (!order) return null;
  return {
    reference: order.reference,
    status: order.status,
    paid: !!order.paid_at,
    currency: order.currency,
    currency_symbol: cfg.currency_symbol || '₦',
    total: order.total,
    item_count: (order.items || []).reduce((n, i) => n + (i.qty || 0), 0),
    created_at: order.created_at,
    locked: true
  };
}

function publicOrder(order, cfg) {
  if (!order) return null;
  return {
    reference: order.reference,
    status: order.status,
    mode: order.mode,
    currency: order.currency,
    currency_symbol: cfg.currency_symbol || '₦',
    subtotal: order.subtotal,
    shipping: order.shipping,
    shipping_label: order.shipping_label,
    shipping_zone: order.shipping_zone,
    total: order.total,
    items: order.items,
    customer: {
      name: order.customer.name,
      email: order.customer.email,
      phone: order.customer.phone,
      address: order.customer.address,
      city: order.customer.city,
      country: order.customer.country,
      note: order.customer.note || ''
    },
    created_at: order.created_at,
    paid_at: order.paid_at || null,
    updated_at: order.updated_at || null,
    timeline: order.timeline || [],
    email_sent: !!order.email_sent
  };
}

function callbackOf(order, cfg, req) {
  const base = `${baseUrl(req, cfg)}/thanks.html?reference=${encodeURIComponent(order.reference)}`;
  return order.mode === 'preview' && order.preview_token
    ? `${base}&preview_token=${order.preview_token}&t=${orderAccessToken(order.reference, cfg)}`
    : `${base}&t=${orderAccessToken(order.reference, cfg)}`;
}

async function confirmPaid(ref, tx, cfg, base) {
  const status = String(tx.status || '').toLowerCase();
  const amount = Number(tx.amount);
  const currency = String(tx.currency || '').toUpperCase();

  /* Phase 1 — validate and settle under the store lock. No network here. */
  const settled = await withDb((db) => {
    const order = db.orders.find((o) => o.reference === ref);
    if (!order) return { ok: false, code: 404, error: 'Order not found' };

    if (status !== 'success') return { ok: false, error: 'Payment not completed yet' };

    if (amount !== order.total_kobo || currency !== order.currency) {
      order.status = 'mismatch';
      order.mismatch = { expected: order.total_kobo, received: amount, expected_currency: order.currency, received_currency: currency };
      order.updated_at = new Date().toISOString();
      return { ok: false, error: 'Payment amount or currency mismatch' };
    }

    /* already settled — a duplicate verify or webhook retry is a no-op */
    if (order.paid_at) return { ok: true, order, alreadyPaid: true };

    order.status = 'paid';
    order.paid_at = new Date().toISOString();
    order.updated_at = order.paid_at;
    order.paystack_id = tx.id || null;
    order.channel = tx.channel || 'card';
    order.timeline = order.timeline || [];
    order.timeline.push({ status: 'paid', at: order.paid_at });

    if (!order.stock_deducted) {
      const short = [];
      for (const item of order.items) {
        const cur = db.stock[item.sku]?.[item.size];
        if (typeof cur !== 'number') continue;
        if (cur < item.qty) short.push({ sku: item.sku, size: item.size, wanted: item.qty, had: cur });
        db.stock[item.sku][item.size] = Math.max(0, cur - item.qty);
        item.stock_after = db.stock[item.sku][item.size];
      }
      order.stock_deducted = true;
      /* the money is already taken, so never fail the confirmation — flag it for
         the studio instead of quietly shipping something we do not have */
      if (short.length) {
        order.oversold = short;
        logEvent('error', 'order sold past available stock', { reference: order.reference, short });
      }
    }
    invoiceFor(db, order, cfg, 'receipt');
    return { ok: true, order };
  });

  if (!settled.ok || settled.alreadyPaid) return settled;

  /* Phase 2 — email outside the lock, then record the outcome. */
  const result = await deliverReceipt(settled.order, cfg, base);
  return { ok: true, order: result.order || settled.order };
}

/* Sends the receipt + store notification and records exactly what happened, so
   the dashboard can show "not sent" and offer a retry instead of lying. */
async function deliverReceipt(order, cfg, base) {
  let failure = null;
  try {
    await sendOrderEmails(order, cfg, base);
    if (order.email_error) failure = order.email_error;
  } catch (err) {
    failure = (err && err.message) || 'send failed';
  }
  const saved = await withDb((db) => {
    const live = db.orders.find((o) => o.reference === order.reference);
    if (!live) return order;
    live.email_sent = !failure;
    live.email_error = failure || null;
    live.email_sent_at = failure ? null : new Date().toISOString();
    if (order.receipt_no) live.receipt_no = order.receipt_no;
    if (order.invoice_no) live.invoice_no = order.invoice_no;
    return live;
  });
  if (failure) logEvent('error', 'receipt email failed', { reference: order.reference, failure });
  return { order: saved, failure };
}

/* --------------------------------------------------------------- admin auth */
function adminToken(cfg) {
  const exp = Date.now() + 12 * 3600 * 1000;
  const sig = crypto.createHmac('sha256', 'tc-admin:' + cfg.admin_password).update(String(exp)).digest('hex');
  return `${exp}.${sig}`;
}
function adminValid(token, cfg) {
  if (!token || !token.includes('.')) return false;
  const [exp, sig] = token.split('.');
  if (!Number.isFinite(Number(exp)) || Date.now() > Number(exp)) return false;
  const want = crypto.createHmac('sha256', 'tc-admin:' + cfg.admin_password).update(String(exp)).digest('hex');
  const a = Buffer.from(String(sig));
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function safeEqual(a, b) {
  /* hash both sides: equal length input to timingSafeEqual, and comparison time
     no longer leaks how long the secret is */
  const x = crypto.createHash('sha256').update(String(a == null ? '' : a)).digest();
  const y = crypto.createHash('sha256').update(String(b == null ? '' : b)).digest();
  return crypto.timingSafeEqual(x, y);
}

/* --------------------------------------------------------- response headers
 * One policy for the whole site. Scripts are nonce-scoped (the theme bootstrap
 * and the JSON-LD blocks are annotated on the way out) so an injected script
 * cannot run even if a template ever forgets to escape something.
 * ------------------------------------------------------------------------- */
const PAYSTACK_HOSTS = 'https://js.paystack.co https://checkout.paystack.com https://api.paystack.co';

function contentSecurityPolicy(nonce) {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' https://js.paystack.co`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://paystack.com https://*.paystack.com https://*.paystack.co",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    `connect-src 'self' ${PAYSTACK_HOSTS}`,
    `frame-src ${PAYSTACK_HOSTS}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "upgrade-insecure-requests"
  ].join('; ');
}

function securityHeaders(req, nonce, opts = {}) {
  const secure = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || !!req.socket.encrypted;
  const h = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=(self "https://js.paystack.co"), usb=(), interest-cohort=()',
    'Cross-Origin-Opener-Policy': 'same-origin'
  };
  if (opts.html !== false) h['Content-Security-Policy'] = contentSecurityPolicy(nonce);
  if (secure && process.env.NODE_ENV === 'production') h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return h;
}

/* every inline <script> the pages ship needs the nonce; scripts with a src and
   no body are left alone */
function annotateNonce(html, nonce) {
  return String(html).replace(/<script(?![^>]*\bsrc=)([^>]*)>/gi, (full, attrs) => {
    if (/\bnonce=/.test(attrs)) return full;
    return `<script nonce="${nonce}"${attrs}>`;
  });
}

function htmlBytes(html, nonce, req) {
  const body = annotateNonce(html, nonce);
  const buf = Buffer.from(body, 'utf8');
  const acceptsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
  if (acceptsGzip && buf.length > 1024) {
    return { out: zlib.gzipSync(buf, { level: 6 }), headers: { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } };
  }
  return { out: buf, headers: {} };
}

/* ------------------------------------------------------------ studio session */
const STUDIO_COOKIE = 'tc_studio';

function readCookie(req, name) {
  const raw = String(req.headers.cookie || '');
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

function sessionCookie(req, value, maxAge) {
  const secure = String(req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https' || !!req.socket.encrypted;
  return `${STUDIO_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function studioAuthorised(req, cfg) {
  return adminValid(readCookie(req, STUDIO_COOKIE), cfg);
}

function sendFile(res, file, req, extra = {}) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
  const nonce = crypto.randomBytes(18).toString('base64');
  const { out, headers } = htmlBytes(raw, nonce, req);
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    ...securityHeaders(req, nonce),
    ...headers,
    'Content-Length': out.length,
    ...extra
  });
  if (req.method === 'HEAD') return res.end();
  res.end(out);
}

/* /studio is not part of the public site: no link points here, /admin.html is 404,
   the file lives outside the web root and every request is cookie-gated. */
function handleStudio(req, res, pathname, cfg) {
  const leaf = pathname.replace(/\/+$/, '');
  const signin = path.join(ROOT, 'private', 'signin.html');
  const dash = path.join(ROOT, 'private', 'studio.html');

  if (leaf === '/studio/logout') {
    res.writeHead(303, { 'Set-Cookie': sessionCookie(req, '', 0), Location: '/studio/signin', 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (leaf === '/studio/signin') {
    if (studioAuthorised(req, cfg)) {
      res.writeHead(303, { Location: '/studio', 'Cache-Control': 'no-store' });
      return res.end();
    }
    return sendFile(res, signin, req);
  }
  if (leaf === '/studio') {
    if (!studioAuthorised(req, cfg)) {
      res.writeHead(303, { Location: '/studio/signin', 'Cache-Control': 'no-store' });
      return res.end();
    }
    return sendFile(res, dash, req);
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end('Not found');
}

/* local / sandbox hosts must never be rewritten to the public domain, or the
   preview-mode checkout would bounce off to production before it exists */
function isLocalHost(host) {
  const h = String(host || '').split(':')[0].toLowerCase();
  if (!h) return true;
  return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1' ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /\.e2b\.app$/.test(h) || /\.internal$/.test(h);
}

function requestOrigin(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  return `${proto}://${String(host).split(',')[0].trim()}`;
}

/* The Host header is attacker-controlled. Anything that ends up in an email, a
   Paystack callback or a receipt link must therefore come from SITE_URL unless
   the request is genuinely local. */
function baseUrl(req, cfg) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (cfg.site_url) {
    if (!isLocalHost(host)) return cfg.site_url;
    return requestOrigin(req);
  }
  if (isLocalHost(host)) return requestOrigin(req);
  logEvent('warn', 'SITE_URL is not set; ignoring a non-local Host header', { host });
  return `http://localhost:${process.env.PORT || 3000}`;
}

/* ------------------------------------------------------------------- API */
async function handleApi(req, res, pathname, url) {
  const route = pathname.replace(/\.php$/i, '').replace(/\/+$/, '');
  const ip = clientIp(req);
  const cfg = CONFIG;

  if (route === '/api/health') {
    const db = peekDb();
    let disk = { writable: false };
    try {
      fs.accessSync(DATA_DIR, fs.constants.W_OK);
      const st = fs.statSync(DB_FILE);
      disk = { writable: true, bytes: st.size, updated_at: st.mtime.toISOString() };
    } catch {}
    const healthy = disk.writable && dbHealthy;
    return sendJson(res, healthy ? 200 : 503, {
      ok: healthy,
      uptime: Math.round(process.uptime()),
      paystack: paystackMode(cfg),
      email: cfg.resend_api_key ? 'configured' : 'not configured',
      studio: cfg.admin_password ? 'configured' : 'locked',
      store: { healthy: dbHealthy, recovered_at: dbRecoveredAt, ...disk, orders: (db.orders || []).length },
      warnings: [
        !dbHealthy ? 'the store is unreadable right now — check the data directory' : null,
        dbRecoveredAt && Date.now() - Date.parse(dbRecoveredAt) < 24 * 3600 * 1000
          ? `the store was rebuilt at ${dbRecoveredAt} from a backup — check data/store.corrupt-*.json`
          : null,
        !cfg.admin_password ? 'ADMIN_PASSWORD is not set; the studio is locked' : null,
        isWeakPassword(cfg.admin_password) ? 'ADMIN_PASSWORD is a well-known default' : null,
        !cfg.paystack_secret_key
          ? (cfg.allow_preview_checkout
              ? 'PAYSTACK_SECRET_KEY is not set; checkout is in preview mode and takes no money'
              : 'PAYSTACK_SECRET_KEY is not set; checkout is switched off until you add it')
          : null,
        !cfg.resend_api_key ? 'RESEND_API_KEY is not set; receipts are logged but not emailed' : null
      ].filter(Boolean)
    });
  }

  /* catalogue */
  if ((route === '/api/catalogue' || route === '/api/stock') && (req.method === 'GET' || req.method === 'HEAD')) {
    return sendJson(res, 200, cataloguePayload(cfg));
  }

  /* checkout start */
  if (route === '/api/init' && req.method === 'POST') {
    if (!rateLimit('init:' + ip, 12, 10 * 60 * 1000)) return sendJson(res, 429, { ok: false, error: 'Too many checkout attempts. Please wait a few minutes.' });
    let body;
    try { body = JSON.parse((await readBody(req)).toString('utf8')); }
    catch { return sendJson(res, 400, { ok: false, error: 'Invalid request.' }); }

    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length || items.length > 25) return sendJson(res, 400, { ok: false, error: 'Your bag is empty.' });

    const c = body.customer || {};
    const name = text(c.name, 100);
    const email = text(c.email, 254).toLowerCase();
    const phone = text(c.phone, 40);
    const address = text(c.address, 220);
    const city = text(c.city, 100);
    const zone = c.zone === 'INTL' ? 'INTL' : 'NG';
    const country = zone === 'NG' ? 'Nigeria' : text(c.country, 80);
    const note = text(c.note, 240);

    if (name.length < 2) return sendJson(res, 400, { ok: false, error: 'Please enter your full name.' });
    if (!validEmail(email)) return sendJson(res, 400, { ok: false, error: 'Please enter a valid email address.' });
    if (phone.replace(/\D/g, '').length < 6) return sendJson(res, 400, { ok: false, error: 'Please enter a valid phone number.' });
    if (address.length < 4) return sendJson(res, 400, { ok: false, error: 'Please enter your delivery address.' });
    if (city.length < 2) return sendJson(res, 400, { ok: false, error: 'Please enter your city and state.' });
    if (zone === 'INTL' && country.length < 2) return sendJson(res, 400, { ok: false, error: 'Please enter your country.' });

    const db = readDb();
    const merged = new Map();
    for (const raw of items) {
      const sku = String(raw.sku || '');
      const size = String(raw.size || '').toUpperCase();
      const qty = Math.floor(Number(raw.qty || 0));
      const base = cfg.products[sku];
      if (!base) return sendJson(res, 400, { ok: false, error: 'Unknown item in bag.' });
      const over = db.products[sku] || {};
      if (over.active === false) return sendJson(res, 409, { ok: false, error: `${base.name} is no longer available.` });
      if (!base.sizes.includes(size)) return sendJson(res, 400, { ok: false, error: `Choose a valid size for ${base.name}.` });
      if (!Number.isFinite(qty) || qty < 1 || qty > 10) return sendJson(res, 400, { ok: false, error: `Invalid quantity for ${base.name}.` });
      const key = sku + '::' + size;
      const combinedQty = (merged.get(key)?.qty || 0) + qty;
      if (combinedQty > 10) return sendJson(res, 400, { ok: false, error: `Maximum quantity is 10 for each product and size.` });
      merged.set(key, { sku, size, qty: combinedQty });
    }

    const orderItems = [];
    let subtotal = 0;
    for (const { sku, size, qty } of merged.values()) {
      const base = cfg.products[sku];
      const over = db.products[sku] || {};
      const price = Number(over.price ?? base.price);
      const available = db.stock[sku]?.[size] ?? 0;
      if (qty > available) {
        return sendJson(res, 409, {
          ok: false,
          error: available < 1
            ? `${base.name} (${base.variant}, ${size}) just sold out.`
            : `Only ${available} left of ${base.name} (${base.variant}, ${size}).`
        });
      }
      const lineTotal = price * qty;
      subtotal += lineTotal;
      orderItems.push({ sku, name: base.name, variant: base.variant, size, qty, unit_price: price, line_total: lineTotal, image: base.image });
    }

    const shippingRules = db.settings.shipping || cfg.shipping;
    const rule = shippingRules[zone] || shippingRules.NG;
    const freeOver = Number(db.settings.free_delivery_over ?? cfg.free_delivery_over);
    const shipping = subtotal >= freeOver ? 0 : Number(rule.amount);
    const total = subtotal + shipping;
    const mode = paystackMode(cfg);

    if (mode === 'unconfigured') {
      return sendJson(res, 503, { ok: false, error: 'Payments are not configured yet. Add your Paystack keys.' });
    }

    const ref = reference();
    const order = {
      reference: ref,
      status: 'pending',
      mode,
      currency: cfg.currency,
      subtotal,
      shipping,
      shipping_zone: zone,
      shipping_label: rule.label,
      total,
      total_kobo: Math.round(total * 100),
      items: orderItems,
      customer: { name, email, phone, address, city, country, note },
      created_at: new Date().toISOString(),
      paid_at: null,
      stock_deducted: false,
      email_sent: false,
      timeline: [{ status: 'pending', at: new Date().toISOString() }]
    };

    const callback = `${baseUrl(req, cfg)}/thanks.html?reference=${encodeURIComponent(ref)}`;

    /* idempotency: the same bag from the same address inside two minutes is the
       same checkout, double-tapped — reuse the pending order instead of opening
       a second Paystack transaction */
    const signature = crypto.createHash('sha256')
      .update(JSON.stringify({ email, zone, items: orderItems.map((i) => [i.sku, i.size, i.qty]).sort(), total }))
      .digest('hex').slice(0, 24);
    const duplicate = await withDb((live) => {
      const cutoff = Date.now() - 120 * 1000;
      const found = live.orders.find((o) => o.status === 'pending' && !o.paid_at
        && o.checkout_signature === signature && Date.parse(o.created_at) > cutoff);
      if (found) return found;
      order.checkout_signature = signature;
      return null;
    });

    if (duplicate) {
      if (duplicate.mode === 'preview') {
        return sendJson(res, 200, {
          ok: true, mode: 'preview', reference: duplicate.reference, reused: true,
          currency: cfg.currency, currency_symbol: cfg.currency_symbol,
          subtotal: duplicate.subtotal, shipping: duplicate.shipping, total: duplicate.total,
          total_kobo: duplicate.total_kobo, email,
          preview_token: duplicate.preview_token,
          access_token: orderAccessToken(duplicate.reference, cfg),
          callback_url: `${callbackOf(duplicate, cfg, req)}`
        });
      }
      if (duplicate.access_code && duplicate.authorization_url) {
        return sendJson(res, 200, {
          ok: true, mode: paystackMode(cfg), reference: duplicate.reference, reused: true,
          access_code: duplicate.access_code, authorization_url: duplicate.authorization_url,
          public_key: cfg.paystack_public_key || null,
          access_token: orderAccessToken(duplicate.reference, cfg),
          email, currency: cfg.currency, currency_symbol: cfg.currency_symbol,
          subtotal: duplicate.subtotal, shipping: duplicate.shipping, total: duplicate.total,
          total_kobo: duplicate.total_kobo, callback_url: callbackOf(duplicate, cfg, req)
        });
      }
      /* a pending duplicate without a usable transaction: let it through */
    }

    if (mode === 'preview') {
      order.preview_token = crypto.randomBytes(16).toString('hex');
      await withDb((live) => { live.orders.unshift(order); });
      return sendJson(res, 200, {
        ok: true, mode: 'preview', reference: ref, currency: cfg.currency, currency_symbol: cfg.currency_symbol,
        subtotal, shipping, total, total_kobo: order.total_kobo, email,
        preview_token: order.preview_token,
        access_token: orderAccessToken(ref, cfg),
        callback_url: `${callback}&preview_token=${order.preview_token}&t=${orderAccessToken(ref, cfg)}`
      });
    }

    let ps;
    try {
      ps = await httpsJson(
        { hostname: 'api.paystack.co', path: '/transaction/initialize', method: 'POST', headers: { Authorization: `Bearer ${cfg.paystack_secret_key}` } },
        {
          email, amount: order.total_kobo, currency: cfg.currency, reference: ref, callback_url: callback,
          metadata: {
            order_reference: ref,
            customer_name: name,
            customer_phone: phone,
            shipping_zone: zone,
            custom_fields: [
              { display_name: 'Customer', variable_name: 'customer_name', value: name },
              { display_name: 'Phone', variable_name: 'customer_phone', value: phone },
              { display_name: 'Items', variable_name: 'items', value: orderItems.map((i) => `${i.name} ${i.variant} (${i.size}) ×${i.qty}`).join(', ') }
            ]
          }
        }
      );
    } catch {
      return sendJson(res, 502, { ok: false, error: 'Could not reach Paystack. Please try again.' });
    }

    if (!ps.json || !ps.json.status || !ps.json.data) {
      return sendJson(res, 502, { ok: false, error: ps.json?.message || 'Paystack rejected the request. Check the API key and currency.' });
    }

    order.access_code = ps.json.data.access_code;
    order.authorization_url = ps.json.data.authorization_url;
    await withDb((live) => { live.orders.unshift(order); });

    return sendJson(res, 200, {
      ok: true, mode, reference: ref,
      access_code: ps.json.data.access_code,
      authorization_url: ps.json.data.authorization_url,
      public_key: cfg.paystack_public_key || null,
      access_token: orderAccessToken(ref, cfg),
      email, currency: cfg.currency, currency_symbol: cfg.currency_symbol,
      subtotal, shipping, total, total_kobo: order.total_kobo, callback_url: callback
    });
  }

  /* verify */
  if (route === '/api/verify' && req.method === 'GET') {
    if (!rateLimit('verify:' + ip, 40, 5 * 60 * 1000)) return sendJson(res, 429, { ok: false, error: 'Slow down a moment.' });
    const ref = text(url.searchParams.get('reference'), 64);
    const token = text(url.searchParams.get('preview_token'), 64);
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(ref)) return sendJson(res, 400, { ok: false, error: 'Invalid order reference.' });

    const db = readDb();
    const order = db.orders.find((o) => o.reference === ref);
    if (!order) return sendJson(res, 404, { ok: false, error: 'Order not found.' });
    const access = orderAccessible(req, url, order, cfg);
    if (!access) {
      /* reference only — confirm the state, reveal nothing personal */
      return sendJson(res, 200, {
        ok: true,
        verified: !!order.paid_at,
        access_required: true,
        order: redactedOrder(order, cfg),
        hint: 'Open the confirmation link from your email, or track with the email you ordered with.'
      });
    }
    if (order.paid_at) return sendJson(res, 200, { ok: true, verified: true, receipt_token: invoiceToken(order.reference, cfg), order: publicOrder(order, cfg) });

    if (order.mode === 'preview' && cfg.allow_preview_checkout && token && safeEqual(token, order.preview_token)) {
      const out = await confirmPaid(ref, { status: 'success', amount: order.total_kobo, currency: order.currency, id: 'PREVIEW-' + ref, channel: 'preview' }, cfg, baseUrl(req, cfg));
      return sendJson(res, 200, { ok: out.ok, verified: out.ok, error: out.error || null, receipt_token: invoiceToken(order.reference, cfg), order: publicOrder(readDb().orders.find((o) => o.reference === ref), cfg) });
    }

    if (!cfg.paystack_secret_key) return sendJson(res, 200, { ok: true, verified: false, order: publicOrder(order, cfg) });

    let ps;
    try {
      ps = await httpsJson({ hostname: 'api.paystack.co', path: `/transaction/verify/${encodeURIComponent(ref)}`, method: 'GET', headers: { Authorization: `Bearer ${cfg.paystack_secret_key}` } });
    } catch {
      return sendJson(res, 502, { ok: false, error: 'Could not reach Paystack to verify payment.' });
    }
    if (!ps.json || !ps.json.status || !ps.json.data) {
      return sendJson(res, 200, { ok: false, verified: false, error: ps.json?.message || 'Payment not confirmed yet.', order: publicOrder(order, cfg) });
    }
    const out = await confirmPaid(ref, ps.json.data, cfg, baseUrl(req, cfg));
    return sendJson(res, 200, { ok: out.ok, verified: out.ok, error: out.error || null, receipt_token: invoiceToken(order.reference, cfg), order: publicOrder(readDb().orders.find((o) => o.reference === ref), cfg) });
  }

  /* webhook */
  if (route === '/api/webhook' && req.method === 'POST') {
    if (!cfg.paystack_secret_key) return sendJson(res, 400, { ok: false, error: 'Webhook not configured' });
    const raw = await readBody(req, 512 * 1024);
    const sig = String(req.headers['x-paystack-signature'] || '');
    const want = crypto.createHmac('sha512', cfg.paystack_secret_key).update(raw).digest('hex');
    if (!safeEqual(sig, want)) return sendJson(res, 401, { ok: false, error: 'Invalid signature' });

    let event;
    try { event = JSON.parse(raw.toString('utf8')); } catch { return sendJson(res, 400, { ok: false, error: 'Invalid JSON' }); }

    if (event?.event === 'charge.success' && event.data?.reference) {
      const ref = String(event.data.reference);
      try {
        const ps = await httpsJson({ hostname: 'api.paystack.co', path: `/transaction/verify/${encodeURIComponent(ref)}`, method: 'GET', headers: { Authorization: `Bearer ${cfg.paystack_secret_key}` } });
        if (ps.json?.status && ps.json?.data) await confirmPaid(ref, ps.json.data, cfg);
        else await confirmPaid(ref, event.data, cfg);
      } catch { await confirmPaid(ref, event.data, cfg); }
    }
    return sendJson(res, 200, { ok: true });
  }

  /* newsletter */
  if (route === '/api/signup' && req.method === 'POST') {
    if (!rateLimit('signup:' + ip, 8, 10 * 60 * 1000)) return sendJson(res, 429, { ok: false, error: 'Too many attempts. Try again shortly.' });
    let body;
    try { body = JSON.parse((await readBody(req, 16 * 1024)).toString('utf8')); }
    catch { return sendJson(res, 400, { ok: false, error: 'Invalid request.' }); }
    const email = text(body.email, 254).toLowerCase();
    if (!validEmail(email)) return sendJson(res, 400, { ok: false, error: 'Enter a valid email address.' });
    const source = text(body.source, 40) || 'site';
    const exists = await withDb((db) => {
      if (db.signups.some((x) => x.email === email)) return true;
      db.signups.unshift({ email, created_at: new Date().toISOString(), source });
      return false;
    });
    return sendJson(res, 200, { ok: true, already: exists, message: exists ? 'You are already on the Tribe list.' : 'Welcome to the Tribe. First access unlocked.' });
  }

  /* contact */
  if (route === '/api/contact' && req.method === 'POST') {
    if (!rateLimit('contact:' + ip, 5, 10 * 60 * 1000)) return sendJson(res, 429, { ok: false, error: 'Too many messages. Please try again later.' });
    let body;
    try { body = JSON.parse((await readBody(req, 32 * 1024)).toString('utf8')); }
    catch { return sendJson(res, 400, { ok: false, error: 'Invalid request.' }); }
    const name = text(body.name, 100);
    const email = text(body.email, 254).toLowerCase();
    const subject = text(body.subject, 140) || 'General enquiry';
    const message = text(body.message, 2000);
    if (name.length < 2) return sendJson(res, 400, { ok: false, error: 'Please tell us your name.' });
    if (!validEmail(email)) return sendJson(res, 400, { ok: false, error: 'Please enter a valid email address.' });
    if (message.length < 10) return sendJson(res, 400, { ok: false, error: 'Please add a little more detail to your message.' });
    await withDb((db) => {
      db.messages.unshift({ id: crypto.randomBytes(6).toString('hex'), name, email, subject, message, created_at: new Date().toISOString(), read: false });
    });
    await sendMail(cfg, cfg.store_email, `[CONTACT] ${subject} — ${name}`, `${name} <${email}>\n\n${message}`);
    return sendJson(res, 200, { ok: true, message: 'Message received. We reply within one business day.' });
  }

  /* order tracking */
  if (route === '/api/track' && req.method === 'GET') {
    if (!rateLimit('track:' + ip, 30, 5 * 60 * 1000)) return sendJson(res, 429, { ok: false, error: 'Too many lookups. Please wait a minute.' });
    const ref = text(url.searchParams.get('reference'), 64).toUpperCase();
    const email = text(url.searchParams.get('email'), 254).toLowerCase();
    if (!ref) return sendJson(res, 400, { ok: false, error: 'Enter your order reference.' });
    if (!validEmail(email)) return sendJson(res, 400, { ok: false, error: 'Enter the email address used at checkout.' });
    const db = readDb();
    const order = db.orders.find((o) => o.reference.toUpperCase() === ref);
    if (!order) return sendJson(res, 404, { ok: false, error: 'No order found with that reference.' });
    if (!safeEqual(email, String(order.customer.email || '').toLowerCase())) {
      return sendJson(res, 403, { ok: false, error: 'That email does not match this order.' });
    }
    if (!orderAccessible(req, url, order, cfg)) {
      return sendJson(res, 200, {
        ok: true,
        access_required: true,
        order: redactedOrder(order, cfg),
        message: 'Add the email you ordered with to see the full order.'
      });
    }
    const view = publicOrder(order, cfg);
    return sendJson(res, 200, {
      ok: true,
      order: {
        reference: view.reference,
        status: view.status,
        placed: view.created_at,
        paid_at: view.paid_at,
        total: view.total,
        currency_symbol: view.currency_symbol,
        items: view.items.map((i) => ({ name: i.name, variant: i.variant, size: i.size, qty: i.qty, image: i.image })),
        timeline: view.timeline,
        shipping_label: view.shipping_label,
        city: view.customer.city,
        country: view.customer.country
      }
    });
  }

  /* ------------------------------------------------------------------ admin */
  if (route === '/api/invoice' && req.method === 'GET') {
    if (!rateLimit('invoice:' + ip, 60, 5 * 60 * 1000)) return sendJson(res, 429, { ok: false, error: 'Too many requests.' });
    const ref = text(url.searchParams.get('reference'), 64).toUpperCase();
    const type = url.searchParams.get('type') === 'invoice' ? 'invoice' : 'receipt';
    const format = url.searchParams.get('format') || 'json';
    const token = text(url.searchParams.get('token'), 80);
    const auth = String(req.headers.authorization || '');
    const isAdmin = (auth.startsWith('Bearer ') && adminValid(auth.slice(7).trim(), cfg)) || studioAuthorised(req, cfg);
    if (!isAdmin && !tokenValid(ref, token, cfg)) return sendJson(res, 403, { ok: false, error: 'This document link is not valid. Sign in to the admin to open it.' });

    const db = readDb();
    const order = db.orders.find((o) => o.reference.toUpperCase() === ref);
    if (!order) return sendJson(res, 404, { ok: false, error: 'Order not found.' });

    const { doc } = invoiceFor(db, order, cfg, type);
    if (format === 'pdf') {
      let pdf;
      try { pdf = invoicePdf(doc, cfg); }
      catch (err) { return sendJson(res, 500, { ok: false, error: 'Could not render the PDF.' }); }
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${url.searchParams.get('download') ? 'attachment' : 'inline'}; filename="${doc.number.replace(/[\/]/g, '-')}.pdf"`,
        'Content-Length': pdf.length,
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex'
      });
      return res.end(pdf);
    }
    return sendJson(res, 200, { ok: true, invoice: { ...doc, money: undefined }, type, pdf_path: `/api/invoice?reference=${encodeURIComponent(doc.reference)}&type=${type}&format=pdf&token=${doc.token}` });
  }

  if (route === '/api/admin') {
    const action = url.searchParams.get('action') || '';

    if (req.method === 'POST' && action === 'login') {
      if (!cfg.admin_password) {
        return sendJson(res, 503, {
          ok: false,
          error: 'The studio is not configured yet. Set the ADMIN_PASSWORD environment variable, then sign in with it.'
        });
      }
      const loginKey = 'admin-login:' + ip;
      const WINDOW = 15 * 60 * 1000;
      /* two gates: 8 tries per address, and 25 per instance so a spread-out
         attempt cannot keep guessing the same single password */
      if (!ratePeek(loginKey, 8, WINDOW) || !ratePeek('admin-login:global', 25, WINDOW)) {
        return sendJson(res, 429, { ok: false, error: 'Too many failed sign-in attempts. Wait 15 minutes.' });
      }
      let body;
      try { body = JSON.parse((await readBody(req, 8 * 1024)).toString('utf8')); }
      catch { return sendJson(res, 400, { ok: false, error: 'Invalid request.' }); }
      if (!safeEqual(body.password, cfg.admin_password)) {
        rateHit(loginKey, WINDOW);
        rateHit('admin-login:global', WINDOW);
        await new Promise((r) => setTimeout(r, 350 + Math.floor(Math.random() * 250)));
        logEvent('warn', 'studio sign-in failed', { ip });
        return sendJson(res, 401, { ok: false, error: 'Incorrect password.' });
      }
      buckets.delete(loginKey);
      buckets.delete('admin-login:global');
      const token = adminToken(cfg);
      return sendJson(res, 200, { ok: true, token, default_password: isWeakPassword(cfg.admin_password) }, {
        'Set-Cookie': sessionCookie(req, token, 12 * 3600)
      });
    }

    const auth = String(req.headers.authorization || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!adminValid(token, cfg) && !studioAuthorised(req, cfg)) {
      return sendJson(res, 401, { ok: false, error: 'Session expired. Sign in again.' });
    }
    if (action === 'logout') {
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
    }

    if (req.method === 'GET' && (action === 'overview' || action === '')) {
      const db = readDb();
      const cat = cataloguePayload(cfg);
      const paidish = db.orders.filter((o) => ['paid', 'packed', 'shipped', 'delivered'].includes(o.status));
      return sendJson(res, 200, {
        ok: true,
        mode: paystackMode(cfg),
        default_password: isWeakPassword(cfg.admin_password),
        currency: cfg.currency,
        currency_symbol: cfg.currency_symbol,
        store_email: db.settings.store_email,
        free_delivery_over: db.settings.free_delivery_over,
        shipping: db.settings.shipping,
        webhook_url: `${baseUrl(req, cfg)}/api/webhook`,
        products: cat.products,
        stock: db.stock,
        settings: db.settings,
        kpis: {
          orders: db.orders.length,
          paid: paidish.length,
          pending: db.orders.filter((o) => o.status === 'pending').length,
          revenue: paidish.reduce((a, o) => a + Number(o.total || 0), 0),
          items_sold: paidish.reduce((a, o) => a + o.items.reduce((x, i) => x + i.qty, 0), 0),
          signups: db.signups.length,
          messages: db.messages.length,
          unread_messages: db.messages.filter((m) => !m.read).length,
          awaiting_email: db.orders.filter((o) => o.paid_at && !o.email_sent).length,
          oversold: db.orders.filter((o) => o.oversold).length,
          low_stock: Object.entries(db.stock).flatMap(([sku, sizes]) =>
            Object.entries(sizes).filter(([, n]) => n <= (cfg.low_stock_at || 3)).map(([size, n]) => ({ sku, size, left: n }))
          ).length
        },
        orders: db.orders.map((o) => {
          const { preview_token, access_code, authorization_url, ...safe } = o;
          /* operational flags the dashboard surfaces as badges */
          safe.needs_attention = !!o.oversold || (!!o.paid_at && !o.email_sent);
          const meta = db.invoices[o.reference];
          if (meta) {
            const inv = buildInvoice(o, cfg, { type: 'invoice', seq: meta.seq });
            const rct = buildInvoice(o, cfg, { type: 'receipt', seq: meta.seq });
            safe.invoice_no = inv.number;
            safe.receipt_no = rct.number;
            safe.invoice_token = invoiceToken(o.reference, cfg);
            safe.invoice_sent_at = meta.sent_at || null;
          }
          return safe;
        }),
        signups: db.signups,
        messages: db.messages,
        whatsapp: cfg.whatsapp || '',
        support_phone: cfg.support_phone || '',
        brand_legal: cfg.brand_legal || cfg.brand_name,
        invoice_next: `${(cfg.invoice && cfg.invoice.prefix) || 'TC/INV'}/${new Date().getFullYear()}/${String((db.invoice_seq || 0) + 1).padStart(4, '0')}`
      });
    }

    if (req.method === 'POST' && action === 'order-status') {
      let body;
      try { body = JSON.parse((await readBody(req, 16 * 1024)).toString('utf8')); }
      catch { return sendJson(res, 400, { ok: false, error: 'Invalid request.' }); }
      const allowed = ['pending', 'paid', 'packed', 'shipped', 'delivered', 'cancelled', 'refunded'];
      if (!allowed.includes(body.status)) return sendJson(res, 400, { ok: false, error: 'Invalid status.' });
      const reference = text(body.reference, 64);
      const restockable = ['cancelled', 'refunded'];
      const out = await withDb((db) => {
        const order = db.orders.find((o) => o.reference === reference);
        if (!order) return null;
        if (['paid', 'packed', 'shipped', 'delivered'].includes(body.status) && !order.paid_at) {
          return { error: 'Only a Paystack-confirmed paid order can enter fulfilment.' };
        }
        /* moving a paid order to cancelled/refunded puts the stock back, once */
        if (restockable.includes(body.status) && order.stock_deducted) {
          for (const item of order.items) {
            const cur = db.stock[item.sku]?.[item.size];
            if (typeof cur === 'number') db.stock[item.sku][item.size] = cur + item.qty;
          }
          order.stock_deducted = false;
        }
        order.status = body.status;
        order.updated_at = new Date().toISOString();
        order.timeline = order.timeline || [];
        order.timeline.push({ status: body.status, at: order.updated_at });
        return order;
      });
      if (!out) return sendJson(res, 404, { ok: false, error: 'Order not found.' });
      if (out.error) return sendJson(res, 409, { ok: false, error: out.error });
      return sendJson(res, 200, { ok: true, order: out });
    }

    if (req.method === 'POST' && action === 'stock') {
      let body;
      try { body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8')); }
      catch { return sendJson(res, 400, { ok: false, error: 'Invalid request.' }); }
      const stock = await withDb((db) => {
        for (const [sku, sizes] of Object.entries(body.stock || {})) {
          if (!cfg.products[sku] || typeof sizes !== 'object' || sizes === null) continue;
          db.stock[sku] = db.stock[sku] || {};
          for (const size of cfg.products[sku].sizes) {
            if (sizes[size] !== undefined) db.stock[sku][size] = Math.max(0, Math.min(9999, Math.floor(Number(sizes[size]) || 0)));
          }
        }
        return db.stock;
      });
      return sendJson(res, 200, { ok: true, stock });
    }

    if (req.method === 'POST' && action === 'product') {
      let body;
      try { body = JSON.parse((await readBody(req, 16 * 1024)).toString('utf8')); }
      catch { return sendJson(res, 400, { ok: false, error: 'Invalid request.' }); }
      const sku = String(body.sku || '');
      if (!cfg.products[sku]) return sendJson(res, 404, { ok: false, error: 'Unknown product.' });
      const products = await withDb((db) => {
        db.products[sku] = db.products[sku] || { price: cfg.products[sku].price, active: true };
        if (body.price !== undefined) db.products[sku].price = Math.max(0, Math.round(Number(body.price) || 0));
        if (body.active !== undefined) db.products[sku].active = Boolean(body.active);
        return db.products;
      });
      return sendJson(res, 200, { ok: true, products });
    }

    if (req.method === 'POST' && action === 'settings') {
      let body;
      try { body = JSON.parse((await readBody(req, 16 * 1024)).toString('utf8')); }
      catch { return sendJson(res, 400, { ok: false, error: 'Invalid request.' }); }
      const settings = await withDb((db) => {
        if (body.store_email && validEmail(body.store_email)) db.settings.store_email = text(body.store_email, 254).toLowerCase();
        if (body.free_delivery_over !== undefined) db.settings.free_delivery_over = Math.max(0, Math.round(Number(body.free_delivery_over) || 0));
        if (body.shipping && typeof body.shipping === 'object') {
          for (const zone of ['NG', 'INTL']) {
            if (body.shipping[zone]) {
              db.settings.shipping[zone] = {
                ...db.settings.shipping[zone],
                amount: Math.max(0, Math.round(Number(body.shipping[zone].amount) || 0)),
                eta: body.shipping[zone].eta ? text(body.shipping[zone].eta, 60) : db.settings.shipping[zone].eta,
                label: db.settings.shipping[zone].label
              };
            }
          }
        }
        return db.settings;
      });
      return sendJson(res, 200, { ok: true, settings });
    }

    if (req.method === 'POST' && action === 'invoice-send') {
      let body;
      try { body = JSON.parse((await readBody(req, 16 * 1024)).toString('utf8')); }
      catch { return sendJson(res, 400, { ok: false, error: 'Invalid request.' }); }
      const type = body.type === 'receipt' ? 'receipt' : 'invoice';
      const reference = text(body.reference, 64);
      const found = await withDb((db) => {
        const order = db.orders.find((o) => o.reference === reference);
        if (!order) return null;
        const built = invoiceFor(db, order, cfg, type);   /* allocates the number under the lock */
        return { order, doc: built.doc };
      });
      if (!found) return sendJson(res, 404, { ok: false, error: 'Order not found.' });
      const { order, doc } = found;
      const base = baseUrl(req, cfg);
      let attachment = null;
      try { attachment = { filename: `${doc.number.replace(/[\/]/g, '-')}.pdf`, content: invoicePdf(doc, cfg) }; } catch { attachment = null; }
      const label = type === 'receipt' ? 'receipt' : 'invoice';
      const bodyText = [
        `TRIBE CULTURE — ${label.toUpperCase()} ${doc.number}`,
        '',
        `Hello ${order.customer.name},`,
        '',
        type === 'receipt'
          ? `This is your ${label} for order ${order.reference}. Total ${money(doc.total, cfg)}.`
          : `Please find your ${label} ${doc.number} for order ${order.reference}. Total due ${money(doc.total, cfg)}.`,
        '',
        `Items: ${doc.items.map((i) => `${i.name} (${i.size_label}) × ${i.qty}`).join(', ')}`,
        '',
        `View it online: ${base}${doc.link_path}`,
        `Questions? WhatsApp${cfg.whatsapp ? ' +' + cfg.whatsapp : ''} or reply to this email.`,
        '',
        'Discover new truth. — Tribe Society'
      ].join('\n');
      const sent = await sendMail(cfg, order.customer.email, `Tribe Culture — ${label} ${doc.number}`, bodyText, {
        attachments: attachment ? [attachment] : []
      });
      await withDb((db) => {
        const live = db.orders.find((o) => o.reference === reference);
        if (!live) return;
        const meta = db.invoices && db.invoices[reference];
        if (meta) meta.sent_at = sent.ok ? new Date().toISOString() : null;
        live[type === 'receipt' ? 'receipt_no' : 'invoice_no'] = doc.number;
      });
      if (!sent.ok) {
        return sendJson(res, 502, { ok: false, error: `Email could not be sent — ${sent.error}`, number: doc.number, link: base + doc.link_path });
      }
      return sendJson(res, 200, { ok: true, sent_to: order.customer.email, number: doc.number, link: base + doc.link_path });
    }

    if (req.method === 'POST' && action === 'message-read') {
      let body;
      try { body = JSON.parse((await readBody(req, 8 * 1024)).toString('utf8')); }
      catch { return sendJson(res, 400, { ok: false, error: 'Invalid request.' }); }
      await withDb((db) => {
        const msg = db.messages.find((m) => m.id === text(body.id, 40));
        if (msg) msg.read = body.read !== false;
      });
      return sendJson(res, 200, { ok: true });
    }
  }

  return sendJson(res, 404, { ok: false, error: 'Endpoint not found.' });
}

/* ------------------------------------------------------------ static files */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json'
};

const TEXTUAL = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.webmanifest', '.txt']);
const BLOCKED = [/^\/api\//i, /^\/config\.json$/i, /^\/server\.js$/i, /^\/package(-lock)?\.json$/i, /^\/render\.yaml$/i, /^\/README/i, /^\/private\//i, /^\/admin\.html$/i, /^\/\./];
const gzipCache = new Map();

function gzipped(file, buf, mtimeMs = 0) {
  const key = file + ':' + buf.length + ':' + mtimeMs;
  if (gzipCache.has(key)) return gzipCache.get(key);
  const out = zlib.gzipSync(buf, { level: 6 });
  if (gzipCache.size > 40) gzipCache.clear();
  gzipCache.set(key, out);
  return out;
}


/* minimal HTML attribute escaper for the head we rewrite */
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* per-product Open Graph: the link preview shows the piece being shared */
const productHtmlCache = new Map();
function productHtml(rel, sku, req) {
  const cat = cataloguePayload(CONFIG);
  const products = (cat && cat.products) || {};
  const p = products[sku];
  if (!p || p.active === false) return null;
  const key = p.sku + '|' + p.price;
  if (productHtmlCache.has(key)) return productHtmlCache.get(key);

  const file = path.join(ROOT, rel);
  let html;
  try { html = fs.readFileSync(file, 'utf8'); } catch { return null; }

  /* share cards must be absolute and stable: prefer SITE_URL, then the request host */
  const base = CONFIG.site_url || baseUrl(req, CONFIG) || 'https://tribeculture.store/';
  const origin = base.replace(/\/$/, '');
  const title = `${p.name} — ${p.variant} · Tribe Culture`;
  const desc = `${p.name} in ${p.variant}. ${p.blurb || ''} ₦${Number(p.price).toLocaleString('en-NG')}. Small-run Drop 001, worldwide delivery.`.replace(/\s+/g, ' ').trim();
  const img = p.images && p.images.card ? p.images.card : (p.images ? p.images.front : '');
  const image = origin + '/' + String(img).replace(/^\//, '');
  const pageUrl = `${origin}/product.html?sku=${encodeURIComponent(p.sku)}`;

  const set = (re, replacement) => { html = html.replace(re, replacement); };
  set(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
  set(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${pageUrl}">`);
  set(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">`);
  set(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${pageUrl}">`);
  set(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(title)}">`);
  set(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(desc)}">`);
  set(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${image}">`);
  set(/<meta property="og:image:secure_url" content="[^"]*">/, `<meta property="og:image:secure_url" content="${image}">`);
  set(/<meta property="og:image:alt" content="[^"]*">/, `<meta property="og:image:alt" content="${esc(p.name + ' — ' + p.variant + ' by Tribe Culture')}">`);
  set(/<meta name="twitter:title" content="[^"]*">/, `<meta name="twitter:title" content="${esc(title)}">`);
  set(/<meta name="twitter:description" content="[^"]*">/, `<meta name="twitter:description" content="${esc(desc)}">`);
  set(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${image}">`);

  if (productHtmlCache.size > 60) productHtmlCache.clear();
  productHtmlCache.set(key, html);
  return html;
}

function serveStatic(req, res, pathname, search) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { decoded = pathname; }
  if (BLOCKED.some((re) => re.test(decoded))) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }

  let rel = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  let full = path.resolve(ROOT, rel);
  if (!full.startsWith(ROOT + path.sep) && full !== ROOT) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  let stat = null;
  try { stat = fs.statSync(full); } catch {}
  if (stat && stat.isDirectory()) {
    full = path.join(full, 'index.html');
    try { stat = fs.statSync(full); } catch { stat = null; }
  }

  if (!stat || !stat.isFile()) {
    const notFound = path.join(ROOT, '404.html');
    if (fs.existsSync(notFound)) {
      const nonce = crypto.randomBytes(18).toString('base64');
      const { out, headers } = htmlBytes(fs.readFileSync(notFound, 'utf8'), nonce, req);
      res.writeHead(404, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        ...securityHeaders(req, nonce),
        ...headers,
        'Content-Length': out.length
      });
      return res.end(req.method === 'HEAD' ? undefined : out);
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }

  const ext = path.extname(full).toLowerCase();

  /* product pages get their own share card, built from the live catalogue */
  if (ext === '.html' && rel === 'product.html' && search) {
    const sku = String(search.get('sku') || '');
    const html = productHtml(rel, sku, req);
    if (html) {
      const nonce = crypto.randomBytes(18).toString('base64');
      const { out, headers } = htmlBytes(html, nonce, req);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
        ...securityHeaders(req, nonce),
        ...headers,
        'Content-Length': out.length
      });
      if (req.method === 'HEAD') return res.end();
      return res.end(out);
    }
  }

  const type = MIME[ext] || 'application/octet-stream';
  /* nothing here is content-hashed, so "immutable" is reserved for the two
     things that genuinely never change: the vendored library and the fonts.
     Styles and scripts stay short so a design change reaches people quickly. */
  const cache = ext === '.html' ? 'no-cache'
    : /\.woff2?$/.test(full) || decoded.startsWith('/assets/vendor/') ? 'public, max-age=31536000, immutable'
    : /\.(css|js|mjs)$/.test(full) ? 'public, max-age=300, must-revalidate'
    : 'public, max-age=86400';

  /* cheap conditional requests: a 304 instead of the bytes */
  const etag = `W/"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`;
  if (String(req.headers['if-none-match'] || '') === etag && ext !== '.html') {
    res.writeHead(304, { ETag: etag, 'Cache-Control': cache });
    return res.end();
  }

  /* range requests for the drop film */
  const range = req.headers.range;
  if (range && ext === '.mp4') {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? Math.min(parseInt(m[2], 10), stat.size - 1) : stat.size - 1;
      if (start <= end && start < stat.size) {
        res.writeHead(206, {
          'Content-Type': type,
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          'Cache-Control': cache
        });
        if (req.method === 'HEAD') return res.end();
        return fs.createReadStream(full, { start, end }).pipe(res);
      }
    }
  }

  if (ext === '.html') {
    const nonce = crypto.randomBytes(18).toString('base64');
    const { out, headers: enc } = htmlBytes(fs.readFileSync(full, 'utf8'), nonce, req);
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': cache,
      ...securityHeaders(req, nonce),
      ...(NOINDEX_PAGES.has(rel) ? { 'X-Robots-Tag': 'noindex, nofollow' } : {}),
      ...enc,
      'Content-Length': out.length
    });
    return res.end(req.method === 'HEAD' ? undefined : out);
  }

  const headers = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': cache,
    ETag: etag,
    ...securityHeaders(req, '', { html: false })
  };

  const acceptsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
  if (TEXTUAL.has(ext) && acceptsGzip && stat.size > 1024) {
    const buf = fs.readFileSync(full);
    const out = gzipped(full, buf, stat.mtimeMs);
    headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = out.length;
    headers.Vary = 'Accept-Encoding';
    res.writeHead(200, headers);
    return res.end(req.method === 'HEAD' ? undefined : out);
  }

  headers['Content-Length'] = stat.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(full).pipe(res);
}

/* --------------------------------------------------------- robots + sitemap
 * Generated from the live catalogue so a new drop is indexed without editing
 * markup. Transactional pages are kept out of search results.
 * ------------------------------------------------------------------------- */
const NOINDEX_PAGES = new Set(['checkout.html', 'thanks.html', 'track.html', 'invoice.html', '404.html']);
let sitemapCache = { at: 0, xml: '' };

function sitemapXml(base, cfg) {
  if (Date.now() - sitemapCache.at < 3600 * 1000 && sitemapCache.xml) return sitemapCache.xml;
  const pages = ['index.html', 'shop.html', 'about.html', 'help.html', 'contact.html', 'world.html'];
  const url = (loc, priority) => `  <url><loc>${esc(base.replace(/\/+$/, '') + loc)}</loc><changefreq>weekly</changefreq><priority>${priority}</priority></url>`;
  const rows = pages.map((p, i) => url('/' + (p === 'index.html' ? '' : p), i === 0 ? '1.0' : '0.7'));
  for (const sku of Object.keys(cfg.products)) {
    rows.push(url(`/product.html?sku=${encodeURIComponent(sku)}`, '0.6'));
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${rows.join('\n')}
</urlset>
`;
  sitemapCache = { at: Date.now(), xml };
  return xml;
}

function robotsTxt(base) {
  return `# Tribe Culture
User-agent: *
Allow: /
Disallow: /studio
Disallow: /studio/*
Disallow: /private/
Disallow: /api/
Disallow: /checkout.html
Disallow: /thanks.html
Disallow: /track.html
Disallow: /invoice.html

Sitemap: ${base.replace(/\/+$/, '')}/sitemap.xml
`;
}

/* ------------------------------------------------------------------ server */
let invoiceSecretReady = false;
function ensureInvoiceSecret() {
  if (invoiceSecretReady) return;
  invoiceSecretReady = true;
  if (CONFIG.invoice_secret) return;
  try {
    const db = readDb();
    if (!db.settings.invoice_secret) {
      db.settings.invoice_secret = crypto.randomBytes(24).toString('hex');
      writeDb(db);
      logEvent('info', 'created a store secret for receipt links (kept in the data directory)');
    }
    CONFIG.invoice_secret = db.settings.invoice_secret;
  } catch (err) {
    logEvent('warn', 'could not persist the receipt-link secret; falling back to the password-derived token', {
      error: String((err && err.message) || err)
    });
  }
}

async function handler(req, res) {
  try {
    ensureInvoiceSecret();
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/studio' || url.pathname.startsWith('/studio/')) return handleStudio(req, res, url.pathname, CONFIG);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url.pathname, url);

    if (url.pathname === '/robots.txt' || url.pathname === '/sitemap.xml') {
      const base = baseUrl(req, CONFIG);
      const isMap = url.pathname === '/sitemap.xml';
      const body = isMap ? sitemapXml(base, CONFIG) : robotsTxt(base);
      const buf = Buffer.from(body, 'utf8');
      res.writeHead(200, {
        'Content-Type': isMap ? 'application/xml; charset=utf-8' : 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        'Content-Length': buf.length,
        'X-Content-Type-Options': 'nosniff'
      });
      return res.end(req.method === 'HEAD' ? undefined : buf);
    }
    return serveStatic(req, res, url.pathname, url.searchParams);
  } catch (err) {
    console.error('request failed', err);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'Internal server error' });
  }
}

module.exports = { handler, loadConfig };

if (require.main === module) {
  const PORT = Number(process.env.PORT || 3000);
  const HOST = process.env.HOST || '0.0.0.0';
  ensureInvoiceSecret();
  const server = http.createServer(handler);
  server.listen(PORT, HOST, () => {
    console.log(`Tribe Culture · http://${HOST}:${PORT} · paystack:${paystackMode(CONFIG)} · data:${DATA_DIR} · studio:/studio`);
    const warn = (m) => console.warn('⚠  ' + m);
    if (!CONFIG.admin_password) {
      warn('ADMIN_PASSWORD is not set — the /studio console is locked until it is.');
    } else if (isWeakPassword(CONFIG.admin_password)) {
      warn('ADMIN_PASSWORD is a well-known default — change it before going live.');
    }
    if (!CONFIG.site_url && process.env.NODE_ENV === 'production') {
      warn('SITE_URL is not set — receipt links and the Paystack callback will not resolve. Set it to the public origin.');
    }
    if (paystackMode(CONFIG) === 'preview' && process.env.NODE_ENV === 'production') {
      warn('checkout is in PREVIEW mode (no PAYSTACK_SECRET_KEY): orders are marked paid without payment. Set the keys before launch.');
    }
    if (CONFIG.allow_preview_checkout && paystackMode(CONFIG) === 'live') {
      warn('ALLOW_PREVIEW_CHECKOUT is on but live keys are in use — preview checkout is ignored.');
    }
    if (!CONFIG.resend_api_key) {
      warn('RESEND_API_KEY is not set — receipts and order emails are written to the data directory only.');
    }
    if (!CONFIG.store_email) {
      warn('STORE_EMAIL is not set — order notifications have no destination.');
    }
  });
  let closing = false;
  const shutdown = (signal) => {
    if (closing) return;
    closing = true;
    logEvent('info', `shutting down (${signal})`);
    server.close(() => {
      /* let any queued store write land before the process leaves */
      writeChain.then(() => process.exit(0), () => process.exit(0));
      setTimeout(() => process.exit(0), 3000).unref();
    });
    setTimeout(() => process.exit(0), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => logEvent('error', 'unhandled rejection', { error: String((err && err.message) || err) }));
  process.on('uncaughtException', (err) => logEvent('error', 'uncaught exception', { error: String((err && err.message) || err) }));
}
