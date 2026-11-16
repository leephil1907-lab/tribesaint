# Tribe Culture — interactive motion blueprint

This blueprint extends the cinematic product presentation standard with the five additional creative references. These are design lessons, not templates to copy.

## Reference decisions

| Reference | Useful design lesson | Tribe Culture application | Decision |
|---|---|---|---|
| Zoomquilt | Seamless nested artwork and continuous depth | One controlled zoom-through transition from the campaign film into the Drop 001 3D product room; use original Tribe-created textures and scenes, never product artwork as a distorted transition texture | Adopt selectively |
| Neal.fun | Scroll is an input that reveals a story, not just page movement | Build a short editorial product journey: campaign → garment construction → front/back artwork → fit and fabric → shop. Tie progress to scroll with clear chapter labels and no forced scroll hijacking | Adopt |
| Radio Garden | A spatial globe makes worldwide discovery feel tangible | Reserve for a future “Tribe Worldwide” culture/editorial feature, city stories or community destinations. Do not make it the primary shop navigation or imply live radio functionality | Future concept |
| Pointer Pointer | Cursor position can create a direct, playful response | Desktop-only subtle pointer parallax on the 3D stage and restrained magnetic response on selected CTAs. No cursor-tracking gimmick on product artwork; touch devices use tap/drag | Adopt selectively |
| The Useless Web | A tiny, memorable interaction can delight | Keep this lesson for a small campaign easter egg or 404 moment only. Never add random outbound links to the commerce journey | Optional / low priority |

## Motion direction

### 1. Opening film to 3D stage
- Keep the existing fashion film and Three.js product room.
- Use a restrained camera push / depth transition as the film resolves into the 3D stage.
- Make the transition a short, intentional bridge, not an endless animation.
- Keep the wordmark, product silhouettes and CTA readable throughout.
- Respect reduced-motion settings and disable the camera move when motion is off.

### 2. Scroll-led editorial chapters
- Each chapter has a clear editorial purpose and a visible label/progress cue.
- Use normal page scrolling; do not trap the visitor in scroll-jacking.
- Animate only opacity, transform and camera parameters where possible.
- Keep product copy, prices, sizes and add-to-bag controls immediately usable.
- Use the original product front/back assets as static, unaltered image layers. Never feed product artwork into displacement, warp, blur or generative effects.

### 3. Product stage interaction
- Desktop: subtle pointer parallax, drag-to-rotate and clear front/back/detail controls.
- Mobile: touch drag and tap controls; no hover-only information.
- Use the existing self-hosted Three.js build and image fallbacks.
- Pause render loops when the stage is off-screen or the tab is hidden.
- Respect the site motion preference and `prefers-reduced-motion`.

### 4. Model lookbook and product truth
- Model photography is a separate campaign/lookbook layer, not a replacement for original product source photography.
- Every apparel SKU requires a verified on-model front/back pair for its exact colourway.
- Match print placement, spelling, colours, scale, garment construction and silhouette to the source assets.
- If an exact composite cannot be verified, show the original product image unchanged.
- Product pages must always retain the original front/back image spread and uploaded product write-up.

## Performance and accessibility gates

- No autoplay audio.
- Respect reduced-motion settings; provide static poster/fallback frames.
- Do not load heavy visual assets until needed.
- Keep 3D pixel ratio capped and reduce particle count on mobile.
- Pause off-screen and background-tab animation.
- Avoid layout shift: reserve media aspect ratios before image load.
- Maintain keyboard access, visible focus, semantic headings and usable touch targets.
- Verify at 360, 390, 768, 1024 and desktop widths.
- Run product detail, variant selection, stock, bag and checkout smoke tests after motion changes.

## Priority order

1. Preserve and verify every SKU's original front/back/detail image and exact catalogue copy.
2. Finish verified model lookbook pairs, prioritising apparel and matching each colourway.
3. Refine the existing Three.js stage and fashion-film transition.
4. Add short scroll-led editorial chapters.
5. Consider the worldwide globe as a separate campaign feature only if it supports a real brand story.
6. Keep novelty interactions out of the main purchase path.


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
