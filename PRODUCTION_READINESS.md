# Tribe Culture — Production Readiness Audit

Repository: leephil1907-lab/tribesaint
Audit branch: production-readiness/final
Scope: storefront, Node server, Paystack checkout, order verification/tracking, studio authentication, JSON persistence, Render blueprint and email flow.

## Executive result

The existing Tribe Culture storefront, editorial styling, ink/bone themes, Three.js product presentation and private /studio dashboard are preserved. Critical configuration and customer-data issues have been hardened. This branch is a staging candidate, not a declaration that live payments or external integrations have been tested.

## Implemented fixes

| Severity | Finding | Change |
|---|---|---|
| Critical | Preview checkout was enabled in production configuration | Disabled in config.json and Render; production code forcibly ignores preview flags |
| Critical | Admin password could be missing or weak | Production startup now requires ADMIN_PASSWORD with at least 16 characters and rejects the previously known weak credential |
| High | Public payment verification exposed delivery PII | Public payload now exposes only the customer display name |
| High | Order tracking allowed reference-only lookup | Checkout email is mandatory in the API and UI; comparison uses constant-time equality |
| High | Order references had only 3 random bytes | New references use 128 bits of cryptographic randomness |
| High | Corrupt JSON store could be silently replaced with an empty database | Original data is preserved and the request fails instead of resetting the store |
| High | Duplicate payment callbacks could race email delivery and deduct stock twice | Paid state and inventory changes are persisted before awaiting email delivery |
| Medium | Duplicate cart lines could exceed the intended per-size cap | Combined quantity capped at 10 per SKU/size |
| Medium | Admin could mark unpaid orders fulfilled | Paid/packed/shipped/delivered status changes require Paystack-confirmed paid_at |
| Medium | No automated source checks | Added GitHub Actions syntax and security smoke checks |

## Remaining risks and release gates

- Inventory is not reserved atomically during checkout. Concurrent checkouts can still compete for the last unit; implement reservations with expiry and a transactional database before scaling limited-run inventory.
- JSON-file persistence is not a transactional multi-process database. Keep a single instance with tested persistent backups or migrate orders, stock, signups, messages and invoice counters to Postgres/Supabase.
- Rate limits are process-local and reset on restart; use a shared store for multi-instance deployments.
- Email success/retry semantics need work. A local mail log is not proof of delivery; configure Resend, verify the sender domain and test actual delivery.
- Render disk mount, Paystack keys/webhook, Resend sender authentication, backup restoration, payment/refund lifecycle and production DNS cannot be verified from repository source alone.
- Run concurrency, failed-payment, duplicate-webhook, amount/currency mismatch, correct/wrong/missing tracking email and restore-drill tests in staging.

## Required Render environment

| Variable | Required value |
|---|---|
| NODE_ENV | production |
| TC_DATA_DIR | /data |
| ADMIN_PASSWORD | Unique value, at least 16 characters |
| SITE_URL | Exact HTTPS production domain |
| PAYSTACK_PUBLIC_KEY / PAYSTACK_SECRET_KEY | Matching keys from the same Paystack environment |
| STORE_EMAIL | Monitored store inbox |
| FROM_EMAIL | Sender verified with Resend |
| RESEND_API_KEY | Valid Resend API key |

Keep ALLOW_PREVIEW_CHECKOUT=false. Production code disables it regardless of the supplied value.

## Deployment acceptance checklist

- [ ] Confirm Render persistent disk is mounted at /data and TC_DATA_DIR=/data.
- [ ] Set ADMIN_PASSWORD in Render; never commit it to Git.
- [ ] Confirm Paystack public and secret keys belong to the same environment.
- [ ] Configure webhook at https://YOUR_DOMAIN/api/webhook.
- [ ] Verify the Resend sender domain and deliver a real test email.
- [ ] Require the GitHub Actions workflow to pass.
- [ ] Deploy to staging with a persistent disk.
- [ ] Test success, failure, cancellation, amount/currency mismatch and duplicate webhook paths.
- [ ] Verify public /api/verify never returns email, phone, address or notes.
- [ ] Verify order tracking requires the correct checkout email.
- [ ] Verify unpaid orders cannot be moved to fulfilment from /studio.
- [ ] Test two simultaneous checkouts for the final unit.
- [ ] Back up the store and perform a restore drill before live orders.

## Conclusion

Critical production configuration, privacy and payment-state fixes are implemented. Atomic inventory reservation, transactional persistence, email retry, shared rate limiting and external integration verification remain before a high-confidence live launch.