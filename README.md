# Tribe Culture

Storefront for **Tribe Culture** — established MMXXVI. Lagos, worldwide.

Twelve heavyweight pieces in Drop 001, a 3D product showcase, live stock and a
server-side checkout. Zero runtime dependencies: a small Node server and a
static front end.

---

## Run locally

```bash
npm install
ADMIN_PASSWORD='choose-a-strong-one' TC_DATA_DIR=./data node server.js
```

Open `http://localhost:3000`.

## Deploy

Built for [Render](https://render.com) — `render.yaml` provisions the service and
a persistent disk. Any Node host works; the only requirement is a writable data
directory.

## Environment

| Variable | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` | Required. Unlocks the private operations console. |
| `TC_DATA_DIR` | Where orders and stock are stored. Use a persistent volume. |
| `SITE_URL` | Public origin, used for links and share previews. |
| `PAYSTACK_PUBLIC_KEY` / `PAYSTACK_SECRET_KEY` | Card payments. |
| `RESEND_API_KEY` | Order and receipt emails. |
| `STORE_EMAIL` / `FROM_EMAIL` | Notification and sender addresses. |
| `ALLOW_PREVIEW_CHECKOUT` | Local development only. It is forcibly disabled when `NODE_ENV=production`. |

Copy `.env.example` to start. Never commit real values.

## Before going live

1. Set a unique `ADMIN_PASSWORD` of at least 16 characters — production startup refuses a missing or weak value.
2. Add Paystack **test** keys and place one real test order end to end.
3. Switch to live keys only after that order and its emails are confirmed.
4. Point the Paystack webhook at `/api/webhook`.
5. Fill in the bank details in `config.json` if you want them printed on invoices.
6. Set `ALLOW_PREVIEW_CHECKOUT=false` in Render; public order tracking also requires the checkout email.

---

© 2026 Tribe Culture · Tribe Society. All rights reserved.
