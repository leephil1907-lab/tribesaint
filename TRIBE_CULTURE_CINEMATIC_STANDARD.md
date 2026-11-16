# Tribe Culture — cinematic product presentation standard

This is the implementation contract for the storefront's next visual pass.

## Brand direction

- Keep the existing Tribe Culture identity: ink, bone, blood-red, Anton, Oswald and the house script.
- Make the storefront feel like a cinematic streetwear editorial, not a generic animated shop template.
- Use the existing Three.js stage, Saint film, campaign photography, light sweeps and restrained camera movement as the foundation.
- Motion must remain subordinate to product truth, readable content, checkout usability and mobile performance.
- Respect `prefers-reduced-motion`, pause off-screen animation, and provide a non-WebGL fallback.

## Product integrity — non-negotiable

- The original product files in `assets/products/*.jpg` and their source artwork are authoritative.
- Never crop, stretch, recolour, redraw, regenerate, retouch, distort, or replace garment artwork, logos, typography, prints, patterns, silhouettes or proportions.
- Product images must use `object-fit: contain`, preserve their intrinsic aspect ratio, and have enough frame space to show the entire garment.
- Backgrounds, lighting, 3D staging and transitions may change around a product; they must not alter the product pixels.
- Preserve product names, variants, blurbs, specs, prices, sizes and all uploaded copy from `config.json` exactly. Do not paraphrase catalogue content.
- If a model composite cannot preserve the supplied design exactly, show the original source product photography instead.

## Required model lookbook assets

Every apparel SKU should eventually have two verified model photographs: front and back. Use this path convention:

```
assets/products/models/<sku>-front.webp
assets/products/models/<sku>-back.webp
```

For example:

```
assets/products/models/saint-tee-black-front.webp
assets/products/models/saint-tee-black-back.webp
```

Requirements for each pair:

1. The same product, colourway and garment construction appear in both images.
2. The model wears the exact uploaded product design; artwork placement, spelling, colours, scale and proportions must match the original source.
3. Show the complete garment, including collar, sleeves, side seams and hem. Keep enough of the model visible to communicate fit.
4. Front and back views use a consistent model, styling, lighting, camera distance and crop.
5. Do not invent a back print where the supplied product has none.
6. No extra logos, watermarks, text, accessories covering the print, or visual effects over the artwork.
7. Use a neutral or brand-appropriate studio environment and a web-optimised WebP export. Keep the original source image untouched alongside it.
8. A human review must compare the model image with the original front/back source before it is published.

Non-apparel items such as the Cadet Cap and Crest Art Print should receive suitable on-person / in-context views only where the product type supports them; do not force a garment model treatment onto an art print.

## Current asset coverage

The repository contains twelve catalogue SKUs, original front/back/detail product photographs, cut-out and 3D stage assets, plus a limited set of campaign model photographs. It does not yet contain a verified front-and-back model pair for every SKU. Do not reuse a campaign photograph as if it were a verified view of a different colourway or product.

## Acceptance checks

- Product detail pages show original front and back images together, uncropped.
- The existing gallery and 3D stage continue to work.
- Catalogue copy and commerce behaviour remain unchanged.
- Check at 360 px, 390 px, 768 px, 1024 px and desktop widths.
- Verify no horizontal overflow, cut-off garment edges, distorted aspect ratios or text overlap.
- Verify keyboard access, reduced-motion behaviour, image fallbacks and checkout flow.
- Add model photos to the catalogue only after the front/back pair passes the visual comparison above.


## Mandatory multi-page commerce architecture

Tribe Culture is a multi-page fashion commerce website. The homepage is an entry point, not the whole experience and not a long-form substitute for dedicated pages. Do not flatten, replace or redesign the site as a single landing page.

Preserve and improve the dedicated routes:
- Home: campaign introduction and clear routes into shopping and brand content
- Shop: complete collection browsing, category/family filtering and product discovery
- Product detail: SKU/colour-specific gallery, original product copy, size and variant selection, availability, quantity and add-to-bag
- Bag: persistent contents, editable quantities, remove item, accurate subtotal and checkout progression
- Checkout: buyer and delivery details, server-authoritative price/stock/shipping, Paystack initialization and verified payment outcome
- Order confirmation / invoice / tracking: real order-specific status and documents
- World, About, Help, Contact and account/studio pages: each has its own useful content and working actions

Navigation and interaction acceptance rules:
1. Every visible navigation item resolves to its intended page or a clearly identified in-page panel/action.
2. Every product card opens the correct SKU and selected colour/variant.
3. Bag contents persist across page navigation and refresh; quantity, remove and totals stay consistent.
4. Checkout is reachable only when bag contents are valid; payment success is shown only after server-side Paystack verification.
5. Browser back/forward, direct deep links, refresh and mobile menu open/close must work without trapping the visitor.
6. No placeholder href="#", dead buttons, fake confirmations, disabled actions without an explanation, or navigation that merely scrolls to a section when a dedicated page is intended.
7. Motion and 3D transitions must support the page journey, never obscure navigation, delay access to content, hijack scrolling or replace functional controls.
8. Run route-by-route desktop and mobile checks, plus a complete product → bag → checkout → verified payment/confirmation test before release.

The 3D homepage is one experience within this system. It must not dictate the information architecture or turn the store into a one-page campaign site.


## Checkout and delivery acceptance standard

- Checkout is a distinct multi-step commerce page, not a landing-page section.
- The delivery-details stage must work without payment credentials and must never call the payment-initialisation endpoint until the payment stage is deliberately enabled.
- Before payment is integrated, the customer can validate and save contact/delivery details locally, review the real bag lines, and see a destination-aware delivery estimate. Saving delivery details must clearly state that no order has been placed and no payment has been taken.
- Nigeria delivery and international delivery are separate destinations. The current configured rates remain the source of truth: Nigeria nationwide delivery ₦3,000 (2–5 business days); international delivery ₦25,000 (5–10 business days).
- The ₦150,000 free-delivery threshold applies to Nigeria only. International delivery remains chargeable at its configured rate.
- The selected destination must update the delivery amount and ETA in checkout. The same domestic-only free-delivery wording must be used in the bag and product details.
- Product colourway changes must update the selected product URL and support browser back/forward navigation. Buy now must add the selected in-stock size and quantity before navigating to checkout.
- On mobile, both the order summary and delivery guidance remain visible; do not hide the shipping information card.
- Payment-provider branding, payment methods, and payment CTAs stay out of the delivery-only stage until the payment integration is implemented and tested.
