# VERIFICATION-REPORT.md

Independent check of the 19 Nov 2026 valuation assessment against the current
`main` branch and a running instance. Each claim is marked with the evidence used.

**Build tested:** local `main` (Phase 17 + lookbook) and the live Render deployment.
**Method:** code inspection, HTTP probes against a running server, and headless
Chromium runs at 390 px and 1440 px.

---

## A. Claims that were already resolved (the assessment was reading an older build)

| Assessment claim | Status | Evidence |
| --- | --- | --- |
| "Several editorial counters initially show zero" | **By design, and correct in the browser** | `data-count` values start at `0` in markup deliberately; `initEditorialMotion()` animates them to the target on `IntersectionObserver` entry over 1100 ms, and paints the final value immediately when `prefers-reduced-motion` or the motion switch is on. Verified on the live site — counters land on 12 / 5 / 260 / ₦150k / 14 / 48. |
| "Some image paths use older JPG conventions" | **Not a defect** | The `.jpg` paths are the *original* studio photographs (`assets/products/<sku>-front|back|detail.jpg`), which are the highest-fidelity assets in the repo and the ones shown in galleries. The `card/` and `cut/` WebP files are derived crops used only for grids and thumbnails. Every referenced path resolves: `12 products, 0 broken paths`. |
| "Product presentation on mobile — test every front/back/detail" | **Passes** | All 12 SKUs at 390 px: `problems 0` — image contained in frame, natural size loaded, no horizontal overflow. |
| "Newsletter submission not verified" | **Works** | `POST /api/signup` persists to storage and rate-limits at 8 per 10 min per IP. Form → toast "Joined the Tribe list" → confirmed already-registered on re-submit. |
| "Worldwide shipping messaging differs between sections" | **Partially valid, minor** | Wording varies ("2–5 days" vs "2–5 business days") but every figure derives from `config.json` shipping rules (NG ₦3 000/2–5 business days, INTL ₦25 000/5–10 business days). Cosmetic standardisation only. |
| "Drop information references June 2026" | **Was valid — fixed** | Stale poster side-label. Replaced with "Drop / 001" in `3627292`. |

## B. Claims that are correct and remain open

| Item | Severity | Notes |
| --- | --- | --- |
| **JSON file storage, no atomic inventory reservation** | **High** | Real. Stock decrements only after a verified payment, but two simultaneous checkouts could oversell the last unit. PostgreSQL/Supabase migration is the correct fix. Note: `supabase` is available as a connected app in this workspace. |
| **Paystack live payment not proven** | **High (release gate)** | Server-side amount recomputation, currency check and webhook signature verification are all implemented and behave correctly in tests (see C). Live keys, a real test order and inbox delivery are still outstanding. |
| **Email delivery unverified** | **Medium** | `RESEND_API_KEY` is unset, so receipts and order emails are written to the data directory only. |
| **Operational verification on Render** | **Medium** | Persistent disk mount, data surviving redeploy, webhook registration, backup and restore: all unverified from here. |

## C. Security probes — all correctly rejected

Run against a live instance; no endpoint accepted malformed input.

| Probe | Result |
| --- | --- |
| `POST /api/init` with empty body | `400 Your bag is empty.` |
| Unknown SKU in bag | `400 Unknown item in bag.` |
| Negative quantity | `400 Invalid quantity for Saint Tee.` |
| Absurd quantity (9999) | `400 Invalid quantity for Saint Tee.` |
| Invalid size | `400 Choose a valid size for Saint Tee.` |
| Invalid email | `400 Enter a valid email address.` |
| Repeated checkout attempts | `429 Too many checkout attempts. Please wait a few minutes.` |
| `GET /api/admin` without auth | `401` |
| `GET /api/verify?reference=FAKE` | `404 Order not found.` |
| `GET /api/invoice?ref=FAKE` | `403` |
| `POST /api/webhook` unsigned | `400` |
| `GET /assets/../server.js` | `403` |
| `GET /.env` | `403` |

## D. Theme contrast — measured

A contrast auditor (WCAG relative-luminance, resolved against real computed
backgrounds) was run on `index`, `shop`, `product`, `about`, `help` and `checkout`
in both themes.

- Dark theme: **0** low-contrast nodes.
- Light theme: **0** low-contrast nodes.

Earlier in the light theme, dark-surface sections (hero caption, rail panel, red CTA
band) flipped to dark ink and became unreadable. Fixed by re-pinning dark-surface
tokens on those surfaces.

## E. Product image integrity

The brand's original photographs are treated as source-of-truth and are never
cropped, stretched, recoloured or redrawn:

- Homepage plate and product galleries use `<sku>-front.jpg` / `-back.jpg`, whole, with
  `object-fit: contain` inside a matte that samples each photo's own studio ground.
- `card/` crops appear only in grids and thumbnails, at their native aspect.
- The 3D hanger was removed because its `cut/` silhouettes trimmed garments (the
  tracksuit lost its trousers, the crest print lost its oval edge).

**Open coordination point:** a parallel line of work on the remote (`723bf64`)
re-points the product gallery at `cut/*.webp`, which would reintroduce trimming.
That needs one decision so the two lines stop overwriting each other.

## F. What actually remains before real money

1. PostgreSQL/Supabase migration with atomic reservations (no data loss).
2. Paystack live keys + full payment matrix, including duplicate webhook and
   amount/currency mismatch.
3. Resend domain authentication and a real inbox delivery test.
4. Render disk, backup and restore verification.
5. Cosmetic: standardise shipping wording across sections.
