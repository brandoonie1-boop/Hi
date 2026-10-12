# Brown Line IL LLC website

Booking, payments and dispatch site for a portable toilet rental company in Chicago. Plain HTML pages rendered by one small Node.js server (no framework, no runtime npm dependencies). Supabase provides accounts and the Postgres database (called over its REST APIs, no SDK); Stripe provides card payments, refunds and a webhook (also no SDK).

## Commands

- `npm start` runs the site on http://localhost:3000. It needs a `.env` file (copy `.env.example`).
- `npm test` runs the unit tests in `tests/` with Node's built-in test runner.
- `npm run css` rebuilds `public/styles.css` from `styles/input.css` after Tailwind classes change. Run `npm install` once first (Tailwind is a dev-only dependency).

## Where things are

- `server.js`: routes for every page and form address.
- `src/pages/`: one file per area (book, checkout, admin, auth, rentals, home, webhooks, errors).
- `src/views/`: layout, icons, shared UI pieces.
- `src/html.js`: the `html` tagged template. It escapes every value; `raw()` is only for markup we wrote ourselves.
- `src/session.js`, `src/supabase.js`, `src/stripe.js`, `src/payments.js`, `src/rate-limit.js`: sessions, API clients, payment checks, per-visitor limits.
- `shared/`: pricing, dates, booking rules and the legal text, used by both the server and the browser scripts in `public/`.
- `supabase/schema.sql`: the whole database (tables, row-level security, functions, triggers). It must stay safe to run again.
- `render.yaml`: Render Blueprint for deploying.

## Rules to keep

- Prices are always calculated on the server from `shared/pricing.js`; the browser only shows a preview.
- Customer data is read with `asUser(token)` so Supabase row-level security applies. `asService()` (secret key) is only for server-side writes after the server has checked everything.
- A payment is only recorded after the server confirms it with Stripe (`finalizeInvoicePayment` in `src/payments.js`).
- Deposit refunds use a claim on `invoices.deposit_refund_id` so a deposit is never refunded twice or both refunded and kept. Read `depositAction` in `src/pages/admin.js` before changing it.
- Keys and settings only come from environment variables. Never commit `.env`.
- The liability terms in `shared/legal.js` are approved wording. If they change, update `LIABILITY_TERMS_VERSION`.
- Customer-facing text is plain and friendly.
