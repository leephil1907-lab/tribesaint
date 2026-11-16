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
| `ALLOW_PREVIEW_CHECKOUT` | `true` completes orders without payment keys, for testing. |

Copy `.env.example` to start. Never commit real values.

## Before going live

1. Set `ADMIN_PASSWORD` — the console stays locked without it.
2. Add Paystack **test** keys and place one real test order end to end.
3. Switch to live keys only after that order and its emails are confirmed.
4. Point the Paystack webhook at `/api/webhook`.
5. Fill in the bank details in `config.json` if you want them printed on invoices.

---

© 2026 Tribe Culture · Tribe Society. All rights reserved.
