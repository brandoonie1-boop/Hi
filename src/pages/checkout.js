// Checkout page (/checkout/:invoiceId) and the payment check route
// (/api/checkout/process).

import { chicagoToday, formatDate, formatDateRange, formatTimestamp, formatTimestampDate, rentalDays } from "../../shared/dates.js";
import { formatDollars, plural } from "../../shared/format.js";
import { TAX_LABEL, UNIT_CATALOG } from "../../shared/pricing.js";
import { requireEnv, SITE, siteUrl } from "../env.js";
import { html, jsonScript } from "../html.js";
import { HttpError } from "../http.js";
import { ensurePaymentIntent, finalizeInvoicePayment, PaymentMismatchError } from "../payments.js";
import { currentViewer, requireViewer } from "../session.js";
import { asUser } from "../supabase.js";
import { icon } from "../views/icons.js";
import { page, telHref } from "../views/layout.js";
import { alert, depositStatusBadge, payStatusBadge, ui } from "../views/ui.js";

const INVOICE_ID = /^BL-IL-\d{4}-\d{5,}$/;
const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9]+$/;

function depositBanner(row) {
  return html`<div class="flex gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4">
    ${icon("shieldCheck", "mt-0.5 size-5 shrink-0 text-brand-700")}
    <div>
      <p class="font-semibold text-brand-900">Includes a mandatory ${formatDollars(row.amount_deposit)} security deposit</p>
      <p class="mt-1 text-sm text-brand-800">The deposit is held until the equipment is picked up and inspected, then released back to the card you pay with if nothing is damaged. It's listed separately on your invoice.</p>
    </div>
  </div>`;
}

function paymentForm(row) {
  return html`<div data-checkout>
    <form class="${ui.card} p-5 sm:p-6" novalidate>
      <h2 class="flex items-center gap-2 text-lg font-semibold text-stone-900">${icon("creditCard", "size-5 text-brand-700")}Pay by card</h2>
      <div class="relative mt-4 js:min-h-48">
        <div class="absolute inset-0 hidden space-y-3 js:block" aria-hidden="true" data-skeleton>
          <div class="h-10 animate-pulse rounded-lg bg-stone-200"></div>
          <div class="grid grid-cols-2 gap-3">
            <div class="h-10 animate-pulse rounded-lg bg-stone-200"></div>
            <div class="h-10 animate-pulse rounded-lg bg-stone-200"></div>
          </div>
          <div class="h-10 animate-pulse rounded-lg bg-stone-200"></div>
          <p class="flex items-center gap-2 pt-1 text-sm text-stone-500">${icon("loaderCircle", "size-4 animate-spin")}Loading secure payment form…</p>
        </div>
        <div id="payment-element" class="opacity-0 transition-opacity duration-300"></div>
      </div>
      <div class="mt-4" data-message hidden></div>
      <button type="submit" disabled class="${ui.buttonPrimary} mt-5 w-full py-3 text-base">
        <span data-label="idle" class="inline-flex items-center gap-2">${icon("lock")}Pay ${formatDollars(row.amount_total)}</span>
        <span data-label="processing" hidden class="inline-flex items-center gap-2">${icon("loaderCircle", "size-5 animate-spin")}Processing payment…</span>
        <span data-label="verifying" hidden class="inline-flex items-center gap-2">${icon("loaderCircle", "size-5 animate-spin")}Confirming your booking…</span>
      </button>
      <p class="mt-3 text-center text-xs text-stone-500">Your card details go straight to Stripe and never touch our servers.</p>
      <noscript><p class="mt-3 text-center text-sm text-red-700">Card payments need JavaScript turned on in your browser.</p></noscript>
    </form>

    <div class="${ui.card} animate-fade-in p-8 text-center" role="status" data-success hidden>
      <div class="mx-auto flex size-16 animate-pop-in items-center justify-center rounded-full bg-emerald-100">${icon("circleCheck", "size-9 text-emerald-700")}</div>
      <h2 class="mt-4 text-xl font-semibold text-stone-900">Payment received</h2>
      <p class="mt-1 text-sm text-stone-600">Your booking is confirmed. Loading your receipt…</p>
    </div>

    <div data-processing hidden>${alert({
      tone: "info",
      title: "Your payment is processing",
      body: "Your bank is still confirming it. We'll mark the booking paid automatically; you can leave this page.",
    })}</div>
  </div>`;
}

function paidPanel(row) {
  return html`<div class="${ui.card} animate-fade-in p-6 sm:p-8">
    <div class="flex items-center gap-4">
      <div class="flex size-14 shrink-0 animate-pop-in items-center justify-center rounded-full bg-emerald-100">${icon("circleCheck", "size-8 text-emerald-700")}</div>
      <div>
        <h2 class="text-xl font-semibold text-stone-900">Payment received. Thank you!</h2>
        <p class="text-sm text-stone-600">${formatDollars(row.amount_total)} paid${row.paid_at ? ` on ${formatTimestamp(row.paid_at)}` : ""}.${row.email ? ` Stripe emails the card receipt to ${row.email}.` : ""}</p>
      </div>
    </div>
    <div class="mt-6 grid gap-4 border-t border-stone-100 pt-6 text-sm sm:grid-cols-2">
      <div><p class="text-stone-500">Delivery</p><p class="font-medium text-stone-900">${formatDate(row.start_date)}</p></div>
      <div><p class="text-stone-500">Pickup</p><p class="font-medium text-stone-900">${formatDate(row.end_date)}</p></div>
      <div class="sm:col-span-2"><p class="text-stone-500">Security deposit</p><p class="mt-1">${depositStatusBadge(row.dep_status)}</p></div>
    </div>
    <div class="mt-6 flex flex-col gap-3 sm:flex-row">
      <a href="/rentals" class="${ui.buttonPrimary}">View my rentals</a>
      <a href="/rentals/new" class="${ui.buttonSecondary}">Book more units</a>
    </div>
  </div>`;
}

function invoiceSummary(row) {
  const unit = UNIT_CATALOG[row.unit_category];
  const days = rentalDays(row.start_date, row.end_date);
  return html`<div class="${ui.card} p-5">
    <div class="flex items-center justify-between gap-3">
      <h2 class="font-semibold text-stone-900">Invoice</h2>
      ${payStatusBadge(row.pay_status)}
    </div>
    <p class="mt-0.5 text-sm text-stone-500">${row.invoice_id} · issued ${formatTimestampDate(row.issued_at)}</p>
    <div class="mt-4 flex items-center gap-3">
      <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">${icon(unit?.icon ?? "truck", "size-5")}</span>
      <div class="min-w-0">
        <p class="font-medium text-stone-900">${unit?.name ?? row.unit_category}</p>
        <p class="text-sm text-stone-500">${plural(row.quantity, "unit")} · ${row.event_type}</p>
      </div>
    </div>
    <ul class="mt-4 space-y-2 text-sm text-stone-700">
      <li class="flex gap-2">${icon("calendarDays", "mt-0.5 size-4 shrink-0 text-stone-400")}<span>${formatDateRange(row.start_date, row.end_date)} (${plural(days, "day")})</span></li>
      <li class="flex gap-2">${icon("mapPin", "mt-0.5 size-4 shrink-0 text-stone-400")}<span class="break-words">${row.delivery_address}</span></li>
    </ul>
    <dl class="mt-5 space-y-2 border-t border-stone-100 pt-4 text-sm">
      <div class="flex justify-between gap-3"><dt class="text-stone-600">Rental</dt><dd class="font-medium text-stone-900">${formatDollars(row.amount_base)}</dd></div>
      <div class="flex justify-between gap-3"><dt class="text-stone-600">${TAX_LABEL}</dt><dd class="font-medium text-stone-900">${formatDollars(row.amount_tax)}</dd></div>
      <div class="flex justify-between gap-3 rounded-lg bg-brand-50 px-3 py-2">
        <dt class="flex items-center gap-1.5 font-medium text-brand-900">${icon("shieldCheck", "size-4")}Security deposit (refundable)</dt>
        <dd class="font-semibold text-brand-900">${formatDollars(row.amount_deposit)}</dd>
      </div>
      <div class="flex justify-between gap-3 border-t border-stone-200 pt-3 text-base"><dt class="font-semibold text-stone-900">Total</dt><dd class="font-bold text-stone-900">${formatDollars(row.amount_total)}</dd></div>
    </dl>
  </div>`;
}

export async function checkoutPage(ctx) {
  const invoiceId = ctx.params.invoiceId;
  if (!INVOICE_ID.test(invoiceId)) throw new HttpError(404, "Invoice not found");
  const viewer = await requireViewer(ctx);

  // Row-level security: only the booking's owner (or an admin) gets the row.
  const db = asUser(viewer.accessToken);
  const [row, invoice] = await Promise.all([
    db.first("rental_manifest", { invoice_id: `eq.${invoiceId}` }),
    db.first("invoices", { select: "id,rental_id,stripe_intent_id,amount_total,pay_status,paid_at", id: `eq.${invoiceId}` }),
  ]);
  if (!row || !invoice) throw new HttpError(404, "Invoice not found");

  let state;
  let clientSecret = null;
  if (invoice.pay_status === "paid") state = "paid";
  else if (invoice.pay_status === "refunded") state = "refunded";
  else {
    const deliveryPassed = row.start_date < chicagoToday();
    try {
      if (deliveryPassed && !invoice.stripe_intent_id) {
        state = "expired";
      } else {
        // Live billing details: the PaymentIntent always matches the stored invoice total.
        const intent = await ensurePaymentIntent(invoice);
        if (intent.status === "succeeded") {
          // Paid, but the confirmation never reached us (e.g. the tab closed).
          const outcome = await finalizeInvoicePayment(invoice.id, intent.id);
          state = outcome === "paid" ? "paid" : outcome === "refunded" ? "refunded" : "processing";
        } else if (intent.status === "processing") {
          state = "processing";
        } else if (deliveryPassed) {
          state = "expired";
        } else {
          state = "pay";
          clientSecret = intent.client_secret;
        }
      }
    } catch (error) {
      if (error instanceof PaymentMismatchError) {
        // Money came in but doesn't match the invoice (for example the total
        // was changed while the customer had this page open). Staff sort it out.
        console.error(`[checkout] payment for ${invoiceId} needs a person to check it: ${error.message}`);
        state = "review";
      } else {
        console.error(`[checkout] could not prepare payment for ${invoiceId}`, error);
        state = "error";
      }
    }
  }

  if (state === "paid" && !row.paid_at) {
    const fresh = await db.first("rental_manifest", { select: "paid_at,dep_status", invoice_id: `eq.${invoiceId}` });
    if (fresh) Object.assign(row, fresh, { pay_status: "paid" });
  }

  let publishableKey = "";
  if (state === "pay") {
    try {
      publishableKey = requireEnv("STRIPE_PUBLISHABLE_KEY");
    } catch {
      state = "error";
    }
  }

  const body = html`<div class="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
    <a href="/rentals" class="inline-flex items-center gap-1.5 text-sm text-stone-600 hover:text-stone-900">${icon("arrowLeft")}My rentals</a>
    <h1 class="mt-3 text-3xl font-bold tracking-tight text-stone-900">${state === "paid" ? "Booking confirmed" : "Secure checkout"}</h1>
    <p class="mt-1 text-stone-600">Invoice ${row.invoice_id}</p>

    <div class="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div class="min-w-0 space-y-6">
        ${state !== "paid" && state !== "refunded" ? depositBanner(row) : ""}
        ${state === "pay" ? paymentForm(row) : ""}
        ${state === "paid" ? paidPanel(row) : ""}
        ${state === "processing"
          ? alert({ tone: "info", title: "Your payment is processing", body: "Your bank is still confirming it. We'll mark the booking paid automatically as soon as it clears." })
          : ""}
        ${state === "refunded"
          ? alert({ tone: "info", title: "This invoice was refunded", body: "The payment for this booking has been refunded to the original card." })
          : ""}
        ${state === "expired"
          ? alert({
              tone: "warning",
              title: "This booking's delivery date has passed",
              body: html`It was never paid, so nothing was charged. <a href="/rentals/new" class="${ui.link}">Make a new booking</a> with new dates.`,
            })
          : ""}
        ${state === "review"
          ? alert({
              tone: "warning",
              title: "We received a payment that needs a quick check",
              body: html`A payment came through for this booking, but it doesn't match the invoice total, so our team will look at it and contact you. Please don't pay again${SITE.phone
                ? html`. Questions? Call <a href="${telHref(SITE.phone)}" class="${ui.link}">${SITE.phone}</a>`
                : ""}.`,
            })
          : ""}
        ${state === "error"
          ? alert({
              tone: "error",
              title: "Payments are temporarily unavailable",
              body: html`We couldn't connect to the payment system. Nothing was charged. Please refresh this page in a minute${SITE.phone
                ? html` or call <a href="${telHref(SITE.phone)}" class="${ui.link}">${SITE.phone}</a>`
                : ""}.`,
            })
          : ""}
      </div>
      <aside class="lg:sticky lg:top-6">${invoiceSummary(row)}</aside>
    </div>
  </div>
  ${state === "pay"
    ? jsonScript("checkout-data", {
        invoiceId: row.invoice_id,
        clientSecret,
        publishableKey,
        returnUrl: `${siteUrl()}/checkout/${encodeURIComponent(row.invoice_id)}`,
      })
    : ""}`;

  ctx.html(
    200,
    page(ctx, {
      title: state === "paid" ? "Booking confirmed" : "Secure checkout",
      viewer,
      body,
      noIndex: true,
      head: state === "pay" ? html`<script src="https://js.stripe.com/v3/"></script>` : "",
      scripts: state === "pay" ? ["/static/checkout.js"] : [],
    }),
  );
}

/**
 * POST /api/checkout/process  { invoiceId, paymentIntentId }
 *
 * Called right after Stripe confirms the card in the browser. The browser's
 * word isn't trusted: the server asks Stripe directly whether this payment
 * succeeded, belongs to this invoice, and is for the right amount. Only then
 * is the invoice set to paid, which flips the rental to active in the same
 * database transaction. The Stripe webhook does the same check as a backup.
 */
export async function processPaymentAction(ctx) {
  const viewer = await currentViewer(ctx);
  if (!viewer) return ctx.json(401, { error: "Please sign in again." });

  const body = (await ctx.jsonBody()) || {};
  const invoiceId = String(body.invoiceId || "");
  const paymentIntentId = String(body.paymentIntentId || "");
  if (!INVOICE_ID.test(invoiceId) || !PAYMENT_INTENT_ID.test(paymentIntentId)) {
    return ctx.json(400, { error: "Invalid payment details." });
  }

  // Row-level security: only finds the invoice if it belongs to this customer (or an admin).
  let visible;
  try {
    visible = await asUser(viewer.accessToken).first("invoices", { select: "id", id: `eq.${invoiceId}` });
  } catch (error) {
    console.error("[api/checkout/process] invoice lookup failed", error);
    return ctx.json(500, { error: "We couldn't look up that invoice. Please refresh the page." });
  }
  if (!visible) return ctx.json(404, { error: "Invoice not found." });

  try {
    const outcome = await finalizeInvoicePayment(invoiceId, paymentIntentId);
    if (outcome === "paid") return ctx.json(200, { status: "paid" });
    if (outcome === "processing") return ctx.json(200, { status: "processing" });
    if (outcome === "refunded") return ctx.json(409, { status: "refunded", error: "This invoice has already been refunded." });
    return ctx.json(402, { status: "requires_payment", error: "The payment hasn't gone through yet. Please try again." });
  } catch (error) {
    if (error instanceof PaymentMismatchError) {
      console.error("[api/checkout/process] payment mismatch", error.message);
      return ctx.json(409, { error: "That payment doesn't match this invoice. Nothing more will be charged; please contact us." });
    }
    console.error("[api/checkout/process] could not verify payment", error);
    return ctx.json(502, { error: "We couldn't confirm the payment with Stripe just now. Refresh the page in a moment." });
  }
}
