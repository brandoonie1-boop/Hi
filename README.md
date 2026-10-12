# Brown Line IL LLC website

Booking, payments and dispatch for Brown Line IL LLC (portable toilet rentals across Chicagoland).

The pages are plain HTML built on the server by one small Node.js program. There's no React and no build step, and the site doesn't need any npm packages to run. Supabase handles accounts and the database, and Stripe handles card payments.

What's included:

- Booking at /rentals/new: three steps with a live price, the liability terms and a checkbox that has to be ticked. It still works if a customer's browser has JavaScript turned off.
- Checkout at /checkout/BL-IL-2026-00001 (etc.): Stripe's card form, with the $50 security deposit shown on its own line.
- My rentals at /rentals: a customer's bookings, invoices and deposit status.
- Dispatch dashboard at /admin/dashboard (staff only): gross earnings, units in the field, deposits held, unpaid bookings, and the job list. It updates live, and each job has a status menu plus Release $50 Refund and Seize for Damages buttons.
- Stripe webhook at /api/webhooks/stripe, so a booking still gets marked paid if the customer closes the tab right after paying.

## Files

- `server.js` starts the site and lists every page and form address.
- `src/pages/` has one file per part of the site (booking, checkout, admin, sign-in...).
- `src/views/` has the page layout, icons and shared pieces like badges and alerts.
- `src/supabase.js`, `src/stripe.js`, `src/payments.js` talk to Supabase and Stripe.
- `shared/` has pricing, dates, booking rules and the legal text. The server and the browser both use these files, so the price a customer sees is calculated the same way as the price they're charged.
- `public/` has the browser scripts, the compiled stylesheet and the icon.
- `supabase/schema.sql` is the whole database: tables, security rules, invoice numbering and dashboard totals.
- `tests/` has tests you can run with `npm test`.
- `render.yaml` sets up the site on Render in one go, and `CLAUDE.md` explains the project to Claude when you work on it in Claude Code.

## 1. Set up Supabase

1. Create a project at supabase.com.
2. Open SQL Editor, paste in all of `supabase/schema.sql` and click Run. It's safe to run again later if the file changes.
3. Go to Authentication → URL Configuration. Set Site URL to the site's address (for example `https://www.brownlineil.com`). Under Redirect URLs, add `https://www.brownlineil.com/auth/callback`, plus `http://localhost:3000/auth/callback` for testing on your computer.
4. Go to Authentication → Sign In / Providers → Email and decide on "Confirm email". With it on, customers click a link in an email before they can book. With it off, they can book right after signing up.
5. Supabase's built-in email sender is only for testing. It only delivers to people on your Supabase team, and only 2 emails an hour, so customers won't get confirmation or password reset emails until you set up your own sender under Authentication → Emails → SMTP Settings (Resend, Postmark and Amazon SES all work). Until then, turn "Confirm email" off (it's on by default in new projects).
6. Go to Project Settings → API Keys and copy the Project URL, the publishable key and the secret key. The secret key can read and change everything, so it only goes in `.env` or your host's settings, never in a page or a chat.

Optional but recommended: make the email links work on any device. By default a confirmation or reset link only works in the same browser the customer started in. In Authentication → Emails, change the link in these two templates:

- Confirm signup: `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email&next=/rentals/new`
- Reset password: `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/account/update-password`

Live updates on the dashboard use Supabase Realtime. The SQL file already turns it on for the rentals and invoices tables (you can check under Database → Publications).

## 2. Set up Stripe

1. In the Stripe Dashboard, go to Developers → API keys and copy the publishable key and the secret key. Use the test keys (`pk_test_...`, `sk_test_...`) until launch day.
2. Go to Developers → Webhooks (Stripe also calls these event destinations) and add an endpoint:
   - URL: `https://www.brownlineil.com/api/webhooks/stripe`
   - Events: `payment_intent.succeeded` and `payment_intent.payment_failed`
3. Copy that endpoint's signing secret (`whsec_...`).

To test a payment, use card number 4242 4242 4242 4242 with any future expiration date and any CVC. In live mode, Stripe emails each customer a receipt.

## 3. Run it on your computer

You need Node.js 22 or newer (nodejs.org).

```
cp .env.example .env
```

(On Windows, `copy .env.example .env`.) Fill in `.env` with the keys from steps 1 and 2, then:

```
npm start
```

Open http://localhost:3000.

Stripe can't reach your computer, so the webhook won't fire locally unless you use the Stripe CLI: `stripe listen --forward-to localhost:3000/api/webhooks/stripe` prints a `whsec_...` secret to put in `.env`. Payments still get recorded without it, because the checkout page double-checks with Stripe itself. The webhook is the backup for customers who close the tab.

## 4. Make yourself an admin

Create an account on the site, then run this in Supabase's SQL Editor with your email:

```sql
update public.profiles set role = 'admin' where email = 'you@example.com';
```

Reload the page and a Dispatch link shows up in the header.

## 5. Put it online

Any host that runs Node.js works. All of them need the settings from `.env.example`. On Render and Railway you can skip `SITE_URL` until the site has its own domain, because the site picks up the address they give it.

Render (easiest, and it all works from a phone):

1. Do steps 1 and 2 above first, so you have your Supabase and Stripe keys.
2. In Render, choose New → Blueprint and pick this repo. Render reads `render.yaml` and sets everything up: the build and start commands, the health check, and the Ohio region (closest to Chicago).
3. Render asks for each setting. Paste in your keys. For `STRIPE_WEBHOOK_SECRET`, type anything for now.
4. Once it's live, Render shows the address at the top of the service page (something like `https://brown-line-site.onrender.com`). Use that address for the Supabase URL settings in step 1, and to add the Stripe webhook in step 2. Then paste the webhook's real `whsec_...` secret into the service's Environment tab. Render restarts the site with it.

The Blueprint starts on Render's free instance type, which goes to sleep when nobody visits, so the first visit after a while takes up to a minute. For the live site, switch to a paid instance type in the service's settings so it stays awake.

Without the Blueprint, make a Web Service by hand: build command `npm install --omit=dev`, start command `node server.js`, health check path `/healthz`, plus the environment variables. Render sets `PORT` on its own.

Railway: create a project from the GitHub repo, add the variables in the Variables tab, then generate a domain under Settings → Networking. Railway uses `npm start` automatically.

Your own server (Ubuntu or similar): install Node.js 22, copy the folder to `/srv/brown-line`, put the settings in `.env`, and run it with systemd:

```
# /etc/systemd/system/brown-line.service
[Unit]
Description=Brown Line website
After=network.target

[Service]
WorkingDirectory=/srv/brown-line
ExecStart=/usr/bin/node server.js
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

Put Caddy in front of it for https. The whole Caddyfile is:

```
www.brownlineil.com {
  reverse_proxy localhost:3000
}
```

When you add your own domain, update the address in three places: `SITE_URL`, the Supabase Site URL and redirect URL, and the Stripe webhook URL. On launch day, switch to the live Stripe keys and add a live-mode webhook, which has its own signing secret.

## Changing things

- Prices: `UNIT_CATALOG` in `shared/pricing.js` (in cents, so `12_500` is $125). The current prices are placeholders. Customers automatically get the cheapest mix of daily, weekly and 28-day rates.
- Tax rate: `TAX_RATE_BASIS_POINTS` and `TAX_LABEL` in the same file (1025 means 10.25%).
- Liability terms: `shared/legal.js`. If you change the wording, also change `LIABILITY_TERMS_VERSION` to the date, so each booking records which version the customer agreed to.
- Phone number and email in the header and footer: the `BUSINESS_PHONE` and `BUSINESS_EMAIL` settings.
- Styles: the pages use Tailwind classes. The compiled stylesheet is already included. If you add or change classes, run `npm install` once and then `npm run css`.
- Tests: `npm test`.

## How payments and deposits work

- Booking saves the rental and its invoice together in one database step. The server calculates the price; the price in the browser is only a preview. Invoice numbers count up each year (BL-IL-2026-00001, BL-IL-2026-00002...).
- At checkout, card details go straight to Stripe and never pass through this server.
- After Stripe says the payment went through, the server asks Stripe again and checks the amount, the currency and the invoice before marking the invoice paid. The database switches the rental to active in the same step.
- The $50 deposit is charged together with the rental. Release $50 Refund sends $50 back to the customer's card through Stripe, and it only ever refunds once, even if someone clicks twice. Seize for Damages keeps the deposit and saves the inspection note, which the customer can see on their rentals page. Both buttons only appear after the job is set to Completed. If a refund gets interrupted (say Stripe was having trouble), that deposit is locked for 10 minutes so it can never be refunded twice. After that, click Release again, or Seize, which first checks with Stripe whether the refund went out.
- If a customer is told "We received a payment that needs a quick check", their payment didn't match the invoice total (usually because the invoice was edited in Supabase while they were paying). Look the payment up in Stripe and sort it out with them.
- Customers only see their own bookings, which the database itself enforces (Supabase row-level security). Only admins can change job statuses or deposits.
- Supabase limits sign-ins per internet address, and to Supabase every request looks like it comes from your server. So the site has its own limits for each visitor (in `src/rate-limit.js`), which stop any one person from using up Supabase's allowance or guessing passwords. As the site gets busier, raise Supabase's limits under Authentication → Rate Limits, since your server is the only thing calling it. The site tells visitors apart by the address your host's proxy adds to each request; if your host has more than one proxy layer, set `TRUSTED_PROXY_HOPS` (see `.env.example`).

## Check these before launch

- Tax. The 10.25% "Cook County rental tax" came from the original plan, but it might not be the right tax. Chicago's Personal Property Lease Transaction Tax, which covers renting out equipment, went up to 15% on January 1, 2026, and 10.25% is Chicago's sales tax rate. Ask an accountant which taxes apply to portable toilet rentals, then change the rate in `shared/pricing.js`. (Sources: https://www.salestaxinstitute.com/resources/chicago-personal-property-lease-transaction-tax-increase-2026 and https://taxnews.ey.com/news/2026-0384-chicago-fy26-budget-bill-increases-various-taxes-creates-new-social-media-amusement-tax)
- The word "escrow". The terms say the deposit is "held in escrow", but it's actually charged to the card and refunded through Stripe later, not kept in a separate escrow account. Have a lawyer look at that wording.
- Refund fees. Stripe doesn't give back its processing fee when you refund, so every released deposit costs the business Stripe's fee on that $50.
- OSHA 1926.51. The terms promise every setup meets it, and the rule sets how many toilets a construction site needs for its number of workers, so crews should check the counts on construction jobs.
- Prices. Set real prices in `shared/pricing.js`.
