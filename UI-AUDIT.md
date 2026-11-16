# UI modernisation — codebase audit (step 1)

## Stack reality check

| The prompt assumes | What this repo actually is |
|---|---|
| React + Framer Motion | **Zero-dependency vanilla** — `"dependencies": {}`. No React, no bundler, no JSX. |
| `npm run build` | **No build step.** `npm start` serves the static tree directly. Scripts: `start`, `dev`, `smoke`, `deploy-check`, `check` (syntax check only). |
| Component library imports | Hand-written CSS (`assets/css/site.css`, ~1 200 lines) + three ES modules (`store.js`, `pages.js`, `stage3d.js`). |

**Consequence:** Framer Motion cannot be used. Its equivalents here are CSS
transitions on `transform`/`opacity` with the existing `--ease` curve, the
`IntersectionObserver` reveal system already in `store.js`, and the Web Animations
API for anything that needs sequencing. Same buttery result, no 40 kB runtime.

## Where the real products live

**`config.json` → `products`** — 12 SKUs, e.g.

```
saint-tee-black   Saint Tee            Black / Red print      ₦45 000  tees      saint      S M L XL XXL
tracksuit-black   Tribe Track Suit     Black / White piping   ₦95 000  sets      tracksuit  S M L XL XXL
cadet-cap-black   Cadet Cap            Black / Embroidered    ₦20 000  headwear  cadet-cap  ONE SIZE
crest-print       Crest Art Print      Bone / Archive crest   ₦28 000  prints    crest-print ONE SIZE
```

Per SKU: `name, variant, family, colour, category, price, sizes, badge, blurb,
details, image, images{front,back,detail}, featured, active, default_stock`.

- **Categories (live):** `tees`, `tanks`, `sets`, `headwear`, `prints`
- **Families (live):** saint, members, worldwide, sadness, flame-tank, ringer-tank, tracksuit, cadet-cap, crest-print
- **Prices are server-authoritative.** `stock` is *not* in config.json — it lives in the
  JSON store under `TC_DATA_DIR` and is served per request by `/api/catalogue`
  (`server.js:533–560`). Any UI must read stock from that endpoint, never hard-code it.
- **Currency:** NGN, symbol `₦` from `config.json`. Shipping NG ₦3 000 / INTL ₦25 000, free ≥ ₦150 000.

## Where the images live

| Path | Count | Use |
|---|---|---|
| `assets/products/*.jpg` | 52 | original studio shots (front/back/detail) |
| `assets/products/3d/*.webp` | 48 | 760² plates for the 3D stages |
| `assets/products/cut/*.webp` | 46 | transparent cut-outs (the rail) |
| `assets/products/card/*.webp` | 46 | 520 px cut-outs for cards / PDP / checkout |
| `assets/brand/hero-model*.{webp,jpg}` | — | new campaign hero (generated **from** the product shots) |

## Cart, checkout, admin — do not touch

- Bag state + rendering: `store.js` (`tc_bag_v2`, `addToBag`, `setQty`, `renderBag`, drawer focus trap)
- Checkout → `POST /api/init` → Paystack popup → `/api/verify` (server checks status + amount + currency)
- Admin at `private/studio.html` behind `/studio` — never linked from the storefront
- Invoices: `invoice.js` + `/invoice.html?reference=…&token=…`

## Current visual system (what would be replaced)

- Palette: ink `#050505` / bone `#ece3cf` / red `#d4141b` — **the asset, not an accident**
- Type: Anton (condensed display) + the Tribe script + Oswald (utility/mono-ish)
- Themes: dark (default) + bone daylight, both fully tokenised

The reference prompt proposes Alabaster `#F6F4EF` canvas, Obsidian `#111`, Terracotta
`#B85D3B`, Cormorant Garamond + Plus Jakarta Sans + JetBrains Mono. That is a
**different house** unless it is deliberately merged with the existing identity —
which is why the palette and accent need a decision before any CSS is rewritten.


---

## Phase 17 — what was actually built

Mapped onto the real repo, no product data, URLs, routes or backend config touched.

| Brief | Delivered | Where |
| --- | --- | --- |
| Glass sticky header with `Bag (count)` slide-over | `.topbar` glass layer (`color-mix` + `@supports` fallback), `.is-scrolled` shadow added on scroll | `site.css`, `pages.js` (`initHome` boot block) |
| Split-screen hero stage 68/32 | `.rail-grid` = existing `#heroStage` + new `aside.rail-panel`; below 1000px the panel drops underneath | `index.html` `#rail` |
| Panel synced to the stage (title, price, sizes, add) | `initRailPanel()` listens for `rail:piece`, which `stage3d.js` now dispatches from `markActive()`; sizes and stock come from `/api/catalogue` via `TC.stockOf` | `pages.js`, `stage3d.js` |
| Horizontal garment rack, filter pills from real categories | `initHome()` rewritten: `#homeRack` renders all 12 SKUs, `#rackBar` pills generated from live `category` values, `#rackCount` live, arrows step one card, `.is-filtering` fade on change | `pages.js` `initHome` |
| Editorial zine spread | Two-page spread, plate swap (Saint print ↔ house crest), real stats only: 260 gsm · 12 pieces · MMXXVI | `index.html` `.zine` |
| Obsidian band, arched card, scroll-triggered metrics | `.metrics` with `IntersectionObserver` counters; every figure is a real store fact (12 pieces, 5 categories, 260 gsm, ₦150k free-delivery, 14-day returns, 48h dispatch) | `index.html` `.metrics`, `initEditorialMotion()` |
| Motion without a bundler | CSS transitions + `IntersectionObserver` + `requestAnimationFrame`; magnetic buttons disabled for touch and `prefers-reduced-motion` | `site.css`, `pages.js` |
| `npm run build` | n/a — no build step exists. `npm run check` + `npm run deploy-check` used instead | `package.json` |

### Verified
- `qa/e2e.js` 37 checks / 0 problems · `qa/a11y.js` `[]` · `qa/widths.js` 360–1920 `over:0`
- Rack: 12 cards, 6 filter pills, filtering to `headwear` yields 1 piece
- Card add-to-bag → drawer opens → `tc_bag_v2` populated → checkout lists the line at ₦48,000 total
- Rail panel: `#railPanelAdd` disabled until a size is picked, then adds the panel's SKU
- Bag and checkout thumbnails moved to a bone tile so black garments stay visible
