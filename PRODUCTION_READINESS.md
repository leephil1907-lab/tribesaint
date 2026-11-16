# Tribe Culture — Production Readiness Audit

Repository: leephil1907-lab/tribesaint
Audit branch: production-readiness/hardening
Scope: Static storefront, Node HTTP server, Paystack checkout, order verification/tracking, studio authentication, JSON persistence, Render blueprint and customer email flow.

## Executive result

The storefront and checkout have a useful server-authoritative foundation, but the repository should not be described as fully production-ready until the remaining operational and data-integrity items below are completed and tested against the actual Render, Paystack and Resend accounts.

This branch preserves the existing HTML/CSS/vanilla-JS storefront, ink/bone themes, editorial layout, Three.js presentation and private /studio dashboard.

## Findings fixed in this branch

| Severity | Finding | Change |
|---|---|---|
| Critical | Preview checkout enabled by default and in Render production blueprint | Disabled in config.json and render.yaml; production configuration ignores preview flags |
| Critical | Weak/default admin credential available as a configuration fallback | Removed shipped password; production refuses startup unless a strong ADMIN_PASSWORD environment variable (16+ characters) is supplied |
| High | Public payment verification returned delivery address, phone, email and notes | Public order payload now returns only the customer's display name |
| High | Order tracking allowed reference-only lookup | Checkout email is now mandatory in API and UI; email comparison uses constant-time comparison |
| High | Order references included timestamp fragments and only 3 random bytes | New references use 128 bits of cryptographic randomness |
| High | Corrupt JSON database was silently replaced with an empty store | Server preserves the original file and fails the request rather than silently destroying order/stock data |
| High | Duplicate payment callbacks could race the email await and deduct stock more than once | Paid state and inventory changes are persisted before email delivery is awaited |
| Medium | Duplicate cart lines could bypass the per-size quantity limit | Combined quantity is capped at 10 per SKU/size |
| Medium | Admin could mark an unpaid order as paid/packed/shipped/delivered | Fulfilment statuses are rejected unless Paystack has set paid_at |
| Medium | No automated repository checks | Added Node syntax checks and production configuration/security smoke checks in GitHub Actions |

## Additional code-level observations

- Paystack webhook signatures are verified using HMAC-SHA512 over the raw request body.
- Payment confirmation checks transaction status, amount and currency before marking an order paid.
- The studio is outside the public static root, is served behind an HttpOnly SameSite cookie, and is not indexed.
- Runtime data is written to a JSON file on the configured persistent disk.
- Rate limits are in-memory and therefore reset on restart and are not shared between multiple instances.
- Checkout does not reserve inventory while a customer is completing Paystack checkout. Two concurrent checkouts can still compete for the same last unit.
- The JSON-file database is not a transactional multi-process database. It is unsuitable for horizontal scaling and high-concurrency inventory without a durable transactional datastore.
- Email configuration and delivery depend on a verified Resend sender and a valid API key. A local mail log is not proof of customer email delivery.
- The live Paystack account, webhook delivery, real charge/refund lifecycle, sender-domain authentication, persistent disk and backup restoration cannot be verified from repository source alone.

## Required Render environment

Set these values in the Render service before deploying this branch:

| Variable | Requirement |
|---|---|
| NODE_ENV | production |
| TC_DATA_DIR | /data |
| ADMIN_PASSWORD | Unique password, 16+ characters; do not reuse a password |
| SITE_URL | Exact HTTPS production domain |
| PAYSTACK_PUBLIC_KEY | Correct public key for the selected Paystack environment |
| PAYSTACK_SECRET_KEY | Matching secret key; use test keys for controlled test transactions, live keys only after sign-off |
| STORE_EMAIL | Monitored order/support inbox |
| FROM_EMAIL | Sender identity verified with Resend |
| RESEND_API_KEY | Valid Resend API key |

Keep ALLOW_PREVIEW_CHECKOUT=false. Production code ignores preview mode even if this variable is accidentally changed.

## Deployment acceptance checklist

- [ ] Confirm the Render disk is mounted at /data and TC_DATA_DIR=/data.
- [ ] Confirm ADMIN_PASSWORD is set in Render and is not present in Git.
- [ ] Confirm Paystack public and secret keys belong to the same environment.
- [ ] Configure the Paystack webhook to https://YOUR_DOMAIN/api/webhook.
- [ ] Configure and verify the Resend sender domain; send a real test email.
- [ ] Run the GitHub Actions workflow and require it to pass.
- [ ] Deploy the branch to a staging service with a persistent disk.
- [ ] Test successful payment, failed payment, cancelled payment, wrong amount/currency, duplicate webhook and email failure.
- [ ] Test tracking with the correct email, wrong email and missing email.
- [ ] Confirm public /api/verify responses do not contain customer email, phone, address or notes.
- [ ] Confirm an unpaid order cannot be moved into a fulfilment status from the studio.
- [ ] Test stock behaviour with two concurrent checkout attempts for the final unit.
- [ ] Take a backup and perform a restore drill before accepting live orders.

## Release blockers still open

1. Inventory reservation and concurrency: implement atomic stock reservations with expiry and a transactional database before relying on limited-run inventory at scale.
2. Durable data store: migrate orders, stock, signups, messages and invoice counters from the JSON file to Postgres/Supabase, or explicitly constrain the deployment to one instance and maintain tested backups.
3. Operational email retry: distinguish queued, sent and failed email delivery and provide a safe retry path in the studio.
4. External integration verification: run end-to-end staging tests with actual Render, Paystack and Resend credentials; source inspection cannot prove those external settings are correct.
5. Operational monitoring: add persistent/shared rate limiting, error monitoring, backup alerts and an incident/recovery procedure.

## Conclusion

The critical configuration, customer privacy and payment-state integrity fixes are implemented in this branch. The branch is a hardened candidate for staging validation, not a declaration that live payments have been tested or that the current JSON persistence layer is ready for high concurrency.