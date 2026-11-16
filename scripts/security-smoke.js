'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const server = read('server.js');
const config = read('config.json');
const render = read('render.yaml');
const trackingPage = read('track.html');
const pageControllers = read('assets/js/pages.js');

assert.match(server, /allow_preview_checkout:\s*!production/);
assert.match(server, /Production requires a unique ADMIN_PASSWORD of at least 16 characters/);
assert.match(server, /crypto\.randomBytes\(16\)/);
assert.match(server, /Store database is unreadable/);
assert.match(server, /if \(!validEmail\(email\)\).*checkout/i);
assert.match(server, /Only a Paystack-confirmed paid order can enter fulfilment/);
assert.match(server, /combinedQty > 10/);
assert.match(render, /key: ALLOW_PREVIEW_CHECKOUT\s+value: "false"/);
assert.match(render, /mountPath: \/data/);
assert.match(trackingPage, /id="trEmail"[^>]*required/);
assert.match(pageControllers, /Enter the email address used at checkout/);
assert.doesNotMatch(config, /change-me-tribe-2026/);
assert.match(config, /"allow_preview_checkout": false/);

console.log('Tribe Culture production security smoke checks passed.');
