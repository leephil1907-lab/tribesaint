'use strict';

/* Boots the server the way Render does — NODE_ENV=production, an injected PORT,
   a data directory standing in for the mounted disk — and asserts the things a
   deploy is judged on. This is the gate that would have caught the boot crash
   from the TDZ bug, so it runs in CI on every push.

   Run locally:  node scripts/deploy-smoke.js
*/

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const PORT = 3901;
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-deploy-'));
const adminPassword = 'deploy-smoke-' + require('node:crypto').randomBytes(8).toString('hex');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHealth(proc, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`server exited before becoming healthy (code ${proc.exitCode})`);
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return res.json();
    } catch {
      /* not listening yet */
    }
    await wait(200);
  }
  throw new Error('server did not answer /api/health in time');
}

(async () => {
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
      TC_DATA_DIR: dataDir,
      SITE_URL: 'https://tribeculture.store',
      ADMIN_PASSWORD: adminPassword,
      /* deliberately no Paystack or Resend keys: the deploy must survive that */
      PAYSTACK_SECRET_KEY: '',
      PAYSTACK_PUBLIC_KEY: '',
      RESEND_API_KEY: '',
      ALLOW_PREVIEW_CHECKOUT: 'true' /* must be ignored in production */
    }
  });

  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });

  try {
    const health = await waitForHealth(proc);
    assert.equal(health.ok, true, 'health is not ok');
    assert.equal(health.paystack, 'unconfigured', 'preview checkout was not disabled in production');
    assert.equal(health.studio, 'configured', 'studio should be configured when ADMIN_PASSWORD is set');
    assert.equal(health.store.writable, true, 'the data directory is not writable');

    /* the storefront, with the security headers a deploy is expected to carry.
       Render terminates TLS at its proxy and forwards the real scheme, so the
       check sends the same header the proxy does. */
    const home = await fetch(`${BASE}/index.html`, { headers: { 'x-forwarded-proto': 'https' } });
    assert.equal(home.status, 200, 'home page did not serve');
    const h = home.headers;
    assert.ok(h.get('content-security-policy'), 'missing Content-Security-Policy');
    assert.equal(h.get('x-content-type-options'), 'nosniff');
    assert.equal(h.get('x-frame-options'), 'DENY');
    assert.ok(h.get('referrer-policy'), 'missing Referrer-Policy');
    assert.ok(h.get('permissions-policy'), 'missing Permissions-Policy');
    assert.ok(h.get('x-content-type-options') === 'nosniff');
    const csp = h.get('content-security-policy');
    assert.match(csp, /script-src 'self' 'nonce-/, 'CSP is not nonce-scoped for scripts');
    assert.match(csp, /frame-ancestors 'none'/);
    /* over the proxied https scheme the response must be HSTS-sticky */
    const secure = await fetch(`${BASE}/index.html`, { headers: { 'x-forwarded-proto': 'https' } });
    assert.ok(secure.headers.get('strict-transport-security'), 'missing HSTS on an https production request');

    /* the console stays shut to anonymous visitors */
    const studio = await fetch(`${BASE}/studio`, { redirect: 'manual' });
    assert.equal(studio.status, 303, 'studio should redirect an anonymous visitor');
    const admin = await fetch(`${BASE}/admin.html`);
    assert.equal(admin.status, 403, '/admin.html must not be served');

    /* crawler files exist and point at the public origin. The public host is
       supplied the way Render's proxy supplies it, so SITE_URL is exercised. */
    const asPublic = { headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'tribeculture.store' } };
    for (const file of ['robots.txt', 'sitemap.xml']) {
      const res = await fetch(`${BASE}/${file}`, asPublic);
      assert.equal(res.status, 200, `${file} missing`);
    }
    const sitemap = await (await fetch(`${BASE}/sitemap.xml`, asPublic)).text();
    assert.ok(sitemap.includes('https://tribeculture.store'), 'sitemap does not use SITE_URL');
    assert.ok(sitemap.includes('/product.html?sku='), 'sitemap is missing the catalogue');
    const robots = await (await fetch(`${BASE}/robots.txt`, asPublic)).text();
    assert.match(robots, /Disallow: \/studio/, 'robots.txt does not lock the console');
    assert.match(robots, /Sitemap: https:\/\/tribeculture\.store\/sitemap\.xml/);

    /* checkout refuses to take an order it cannot charge for */
    const init = await fetch(`${BASE}/api/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ sku: 'saint-tee-black', size: 'M', qty: 1 }],
        customer: { name: 'Deploy Smoke', email: 'smoke@example.com', phone: '08030000000', address: '1 Test Way', city: 'Lagos', country: 'Nigeria' },
        zone: 'NG'
      })
    });
    const initJson = await init.json();
    assert.equal(init.status, 503, 'checkout should refuse without Paystack keys');
    assert.match(initJson.error || '', /not configured/i, 'unclear checkout error');

    /* the failed checkout must not have created an order */
    const after = await (await fetch(`${BASE}/api/health`)).json();
    assert.equal(after.store.orders, 0, 'a refused checkout still wrote an order');

    /* the disk holds a store and a receipt-link secret */
    const store = JSON.parse(fs.readFileSync(path.join(dataDir, 'store.json'), 'utf8'));
    assert.ok(store.settings && store.settings.invoice_secret, 'receipt-link secret was not persisted');
    assert.ok(Array.isArray(store.orders), 'store has no orders array');

    /* shutdown has to finish inside Render's window */
    const started = Date.now();
    proc.kill('SIGTERM');
    await new Promise((resolve) => proc.on('exit', resolve));
    const stopMs = Date.now() - started;
    assert.ok(stopMs < 20000, `shutdown took ${stopMs}ms, over the 20s limit`);

    console.log('Tribe Culture deployment smoke checks passed.');
    console.log(`  health ok · checkout gated · console closed · headers present · shutdown ${stopMs}ms`);
    process.exit(0);
  } catch (err) {
    console.error('Deployment smoke check FAILED:', err.message);
    console.error('--- server output ---');
    console.error(log.trim() || '(no output)');
    if (proc.exitCode === null) proc.kill('SIGKILL');
    process.exit(1);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
})();
