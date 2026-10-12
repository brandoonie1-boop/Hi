// Booking wizard (/rentals/new) and the booking creation route (/api/rentals).
//
// The page is one server-rendered form. With JavaScript on, /static/book.js
// shows it as three steps with a live price; without it, the whole form shows
// at once. Either way the server re-checks everything and prices the booking
// itself before anything is saved.

import {
  BOOKING_STEPS,
  EVENT_TYPES,
  eventTypeLabel,
  formatDeliveryAddress,
  SERVICE_STATES,
  stepOfField,
  validateBooking,
} from "../../shared/booking.js";
import { addDaysIso, chicagoToday, formatDate } from "../../shared/dates.js";
import { centsToDecimal, formatCents, formatRate, plural } from "../../shared/format.js";
import { LIABILITY_TERMS, LIABILITY_TERMS_VERSION } from "../../shared/legal.js";
import {
  coveredDays,
  describeBreakdown,
  isUnitCategory,
  MAX_QUANTITY,
  MIN_LEAD_DAYS,
  quoteBooking,
  SECURITY_DEPOSIT_CENTS,
  TAX_LABEL,
  UNIT_CATALOG,
  UNIT_CATEGORIES,
} from "../../shared/pricing.js";
import { cx, html } from "../html.js";
import { Redirect } from "../http.js";
import { ensurePaymentIntent, loadPayableInvoice } from "../payments.js";
import { tooManyAttempts } from "../rate-limit.js";
import { currentViewer, requireViewer } from "../session.js";
import { asService } from "../supabase.js";
import { icon } from "../views/icons.js";
import { page } from "../views/layout.js";
import { alert, ui } from "../views/ui.js";

const DEFAULT_VALUES = {
  unitCategory: "",
  quantity: "1",
  startDate: "",
  endDate: "",
  eventType: "",
  eventOther: "",
  street: "",
  city: "Chicago",
  state: "IL",
  zip: "",
  acceptedTerms: false,
};

// ------------------------------------------------------------------ pieces

/** Label, control, optional hint, and an error line the browser script can fill in. */
function bookingField({ id, name, label, hint, error, control }) {
  return html`<div>
    <label for="${id}" class="${ui.label}">${label}</label>
    <div class="mt-1">${control}</div>
    ${hint ? html`<p id="${id}-hint" class="${ui.hint}">${hint}</p>` : ""}
    <p id="${id}-error" class="${ui.error}" data-error-for="${name}" role="alert" ${error ? "" : "hidden"}>${error || ""}</p>
  </div>`;
}

const describedBy = (id, hint) => (hint ? `${id}-error ${id}-hint` : `${id}-error`);

function input({ id, name, value, error, hint, type = "text", attrs = "" }) {
  return html`<input id="${id}" name="${name}" type="${type}" value="${value}" class="${ui.input}"
    aria-invalid="${error ? "true" : "false"}" aria-describedby="${describedBy(id, hint)}" ${attrs}>`;
}

function unitOption(category, checked) {
  const unit = UNIT_CATALOG[category];
  return html`<label class="group relative flex cursor-pointer flex-col rounded-xl border border-stone-200 bg-white p-4 shadow-sm transition hover:border-stone-400 has-[:checked]:border-brand-600 has-[:checked]:ring-2 has-[:checked]:ring-brand-600 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-700">
    <input type="radio" name="unitCategory" value="${category}" class="sr-only" ${checked ? "checked" : ""}>
    <span class="flex items-start justify-between gap-3">
      <span class="flex size-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700">${icon(unit.icon, "size-5")}</span>
      <span class="hidden size-6 animate-pop-in items-center justify-center rounded-full bg-brand-700 text-white group-has-[:checked]:flex">${icon("check", "size-4")}</span>
    </span>
    <span class="mt-3 font-semibold text-stone-900">${unit.name}</span>
    <span class="mt-1 text-sm text-stone-600">${unit.summary}</span>
    <span class="mt-3 text-sm text-stone-700"><span class="font-semibold text-stone-900">${formatRate(unit.rates.dayCents)}</span>/day · ${formatRate(unit.rates.weekCents)}/week · ${formatRate(unit.rates.cycleCents)}/28 days</span>
  </label>`;
}

function stepIndicator(current) {
  return html`<ol class="mt-8 hidden items-center gap-2 text-sm js:flex" aria-label="Booking progress" data-step-indicator>
    ${BOOKING_STEPS.map((step, index) => {
      const done = index < current;
      const active = index === current;
      return html`<li class="flex flex-1 items-center gap-2" data-step-item="${index}" ${active ? html`aria-current="step"` : ""}>
        <span data-step-dot class="${cx(
          "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors",
          done || active ? "bg-brand-700 text-white" : "bg-stone-200 text-stone-600",
          active && "ring-4 ring-brand-100",
        )}"><span data-step-number ${done ? "hidden" : ""}>${index + 1}</span><span data-step-check ${done ? "" : "hidden"}>${icon("check", "size-4")}</span></span>
        <span data-step-label class="${cx("hidden font-medium sm:inline", active ? "text-stone-900" : "text-stone-500")}">${step.title}</span>
        ${index < BOOKING_STEPS.length - 1
          ? html`<span data-step-line class="${cx("h-0.5 flex-1 rounded-full", done ? "bg-brand-700" : "bg-stone-200")}"></span>`
          : ""}
      </li>`;
    })}
  </ol>`;
}

function reviewRows(values, quote) {
  const unit = isUnitCategory(values.unitCategory) ? UNIT_CATALOG[values.unitCategory] : null;
  const quantity = Number(values.quantity);
  const rows = [
    ["unit", "Unit", unit ? unit.name : "Not chosen", 0],
    ["quantity", "Quantity", Number.isInteger(quantity) && quantity > 0 ? plural(quantity, "unit") : "Not chosen", 0],
    ["start", "Delivery", values.startDate ? formatDate(values.startDate) : "Not chosen", 1],
    ["end", "Pickup", values.endDate ? formatDate(values.endDate) : "Not chosen", 1],
    ["length", "Length", quote ? plural(quote.days, "day") : "Not chosen", 1],
    ["event", "For", values.eventType ? eventTypeLabel(values.eventType, values.eventOther) || "Not chosen" : "Not chosen", 1],
    [
      "address",
      "Address",
      values.street && values.city && values.zip ? formatDeliveryAddress(values) : "Not entered",
      1,
    ],
  ];
  return html`<dl class="mt-3 divide-y divide-stone-100">
    ${rows.map(
      ([key, label, value, step]) => html`<div class="flex items-start justify-between gap-4 py-2.5 text-sm">
        <dt class="w-20 shrink-0 text-stone-500">${label}</dt>
        <dd class="min-w-0 flex-1 break-words text-stone-900" data-review="${key}">${value}</dd>
        <button type="button" class="${ui.link} hidden shrink-0 text-sm js:inline" data-go-step="${step}">Edit</button>
      </div>`,
    )}
  </dl>`;
}

function priceLines(quote) {
  if (!quote) return "";
  const covered = coveredDays(quote.perUnit.breakdown);
  return html`<div class="flex items-start justify-between gap-3">
      <dt class="text-stone-600">Rental
        <span class="block text-xs text-stone-500">${plural(quote.quantity, "unit")} × ${plural(quote.days, "day")}, at ${describeBreakdown(quote.perUnit.breakdown)} per unit${covered > quote.days ? " (cheaper than daily rates)" : ""}</span>
      </dt>
      <dd class="font-medium text-stone-900">${formatCents(quote.rentalCents)}</dd>
    </div>
    <div class="flex items-start justify-between gap-3">
      <dt class="text-stone-600">${TAX_LABEL}</dt>
      <dd class="font-medium text-stone-900">${formatCents(quote.taxCents)}</dd>
    </div>`;
}

function priceSummary(values, quote) {
  const unit = isUnitCategory(values.unitCategory) ? UNIT_CATALOG[values.unitCategory] : null;
  const quantity = Number(values.quantity);
  return html`<div class="${ui.card} p-5" data-price-summary>
    <h2 class="font-semibold text-stone-900">Your price</h2>
    <div class="mt-4 flex items-center gap-3" data-price-unit ${unit ? "" : "hidden"}>
      <span class="flex size-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
        ${UNIT_CATEGORIES.map(
          (category) =>
            html`<span data-unit-icon="${category}" ${category === values.unitCategory ? "" : "hidden"}>${icon(UNIT_CATALOG[category].icon, "size-5")}</span>`,
        )}
      </span>
      <div class="min-w-0">
        <p class="font-medium text-stone-900" data-price-unit-name>${unit ? unit.name : ""}</p>
        <p class="text-sm text-stone-500" data-price-unit-quantity>${Number.isInteger(quantity) && quantity > 0 ? plural(quantity, "unit") : "Choose a quantity"}</p>
      </div>
    </div>
    <p class="mt-2 text-sm text-stone-500" data-price-pick-unit ${unit ? "hidden" : ""}>Choose a unit type to see pricing.</p>
    <dl class="mt-4 space-y-3 text-sm">
      <div class="space-y-3" data-price-lines>${priceLines(quote)}</div>
      <p class="text-stone-500" data-price-pick-dates ${unit && !quote ? "" : "hidden"}>Pick delivery and pickup dates to see the rental total.</p>
      <div class="rounded-lg border border-brand-200 bg-brand-50 p-3">
        <div class="flex items-start justify-between gap-3">
          <dt class="flex items-center gap-2 font-medium text-brand-900">${icon("shieldCheck", "size-4 shrink-0")}Security deposit</dt>
          <dd class="font-semibold text-brand-900">${formatCents(SECURITY_DEPOSIT_CENTS)}</dd>
        </div>
        <p class="mt-1 text-xs text-brand-800">Mandatory and refundable. Charged once per booking and returned to your card after pickup if the equipment comes back undamaged.</p>
      </div>
      <div class="flex items-baseline justify-between gap-3 border-t border-stone-200 pt-3">
        <dt class="font-semibold text-stone-900">Total due today</dt>
        <dd class="animate-fade-in text-xl font-bold text-stone-900" data-price-total>${quote ? formatCents(quote.totalCents) : "—"}</dd>
      </div>
    </dl>
    <p class="mt-4 flex items-center gap-2 text-xs text-stone-500">${icon("lock", "size-3.5")}Card payments are processed securely by Stripe.</p>
  </div>`;
}

function bookingBody({ values, errors, serverError, initialStep, earliestStart }) {
  const quote = quoteBooking({
    unitCategory: values.unitCategory,
    quantity: Number(values.quantity),
    startDate: values.startDate,
    endDate: values.endDate,
  });
  const e = errors;

  return html`<div class="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
    <div class="max-w-2xl">
      <h1 class="text-3xl font-bold tracking-tight text-stone-900">Book portable toilets</h1>
      <p class="mt-2 text-stone-600">Three quick steps. Your price updates as you go.</p>
    </div>

    ${stepIndicator(initialStep)}

    <div class="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <form method="post" action="/api/rentals" id="booking-form" novalidate class="min-w-0 space-y-6" data-initial-step="${initialStep}">
        ${serverError ? alert({ tone: "error", body: serverError }) : ""}
        ${Object.keys(e).length && !serverError
          ? alert({ tone: "error", body: "Some details need fixing. They're marked below." })
          : ""}

        <section data-step="0" class="${cx("space-y-6", initialStep !== 0 && "js:hidden")}">
          <fieldset>
            <legend class="text-lg font-semibold text-stone-900">Which unit do you need?</legend>
            <p class="mt-1 text-sm text-stone-600">One unit type per booking. Need a mix? Make a second booking afterwards.</p>
            <div class="mt-4 grid gap-3 sm:grid-cols-2">${UNIT_CATEGORIES.map((category) => unitOption(category, values.unitCategory === category))}</div>
            <p class="${ui.error}" data-error-for="unitCategory" role="alert" ${e.unitCategory ? "" : "hidden"}>${e.unitCategory || ""}</p>
          </fieldset>

          ${bookingField({
            id: "quantity",
            name: "quantity",
            label: "How many units?",
            hint: `Up to ${MAX_QUANTITY} per booking.`,
            error: e.quantity,
            control: html`<div class="flex w-44 items-stretch">
              <button type="button" data-quantity-step="-1" class="hidden w-11 items-center justify-center rounded-l-lg border border-stone-300 bg-white text-stone-700 hover:bg-stone-50 js:flex" aria-label="One fewer unit">${icon("minus")}</button>
              <input id="quantity" name="quantity" type="number" inputmode="numeric" min="1" max="${MAX_QUANTITY}" step="1" value="${values.quantity}"
                aria-invalid="${e.quantity ? "true" : "false"}" aria-describedby="quantity-error quantity-hint"
                class="w-full min-w-0 rounded-lg border border-stone-300 bg-white px-2 py-2 text-center text-base font-semibold text-stone-900 focus:outline-none focus:ring-2 focus:ring-brand-600/20 aria-invalid:border-red-600 js:rounded-none js:border-x-0">
              <button type="button" data-quantity-step="1" class="hidden w-11 items-center justify-center rounded-r-lg border border-stone-300 bg-white text-stone-700 hover:bg-stone-50 js:flex" aria-label="One more unit">${icon("plus")}</button>
            </div>`,
          })}
        </section>

        <section data-step="1" class="${cx("space-y-8", initialStep !== 1 && "js:hidden")}">
          <fieldset class="space-y-4">
            <legend class="flex items-center gap-2 text-lg font-semibold text-stone-900">${icon("calendarDays", "size-5 text-brand-700")}When do you need them?</legend>
            <div class="grid gap-4 sm:grid-cols-2">
              ${bookingField({
                id: "start-date",
                name: "startDate",
                label: "Delivery date",
                hint: `Earliest: ${formatDate(earliestStart)}`,
                error: e.startDate,
                control: input({ id: "start-date", name: "startDate", type: "date", value: values.startDate, error: e.startDate, hint: true, attrs: html`min="${earliestStart}"` }),
              })}
              ${bookingField({
                id: "end-date",
                name: "endDate",
                label: "Pickup date",
                hint: "Same day as delivery for a one-day event.",
                error: e.endDate,
                control: input({ id: "end-date", name: "endDate", type: "date", value: values.endDate, error: e.endDate, hint: true, attrs: html`min="${values.startDate || earliestStart}"` }),
              })}
            </div>
            <p class="text-sm text-stone-600" data-rental-length ${quote ? "" : "hidden"}>Rental length: <span class="font-medium text-stone-900" data-rental-length-value>${quote ? plural(quote.days, "day") : ""}</span></p>
          </fieldset>

          <fieldset class="space-y-4">
            <legend class="text-lg font-semibold text-stone-900">What are they for?</legend>
            ${bookingField({
              id: "event-type",
              name: "eventType",
              label: "Event or job type",
              error: e.eventType,
              control: html`<select id="event-type" name="eventType" class="${ui.input}" aria-invalid="${e.eventType ? "true" : "false"}" aria-describedby="event-type-error">
                <option value="" ${values.eventType ? "" : "selected"} disabled>Choose one…</option>
                ${EVENT_TYPES.map((type) => html`<option value="${type}" ${values.eventType === type ? "selected" : ""}>${type}</option>`)}
              </select>`,
            })}
            <div data-event-other ${values.eventType === "Other" ? "" : html`class="js:hidden"`}>
              ${bookingField({
                id: "event-other",
                name: "eventOther",
                label: "If other, describe it",
                error: e.eventOther,
                control: input({ id: "event-other", name: "eventOther", value: values.eventOther, error: e.eventOther, attrs: html`maxlength="60" placeholder="e.g. Church picnic"` }),
              })}
            </div>
          </fieldset>

          <fieldset class="space-y-4">
            <legend class="flex items-center gap-2 text-lg font-semibold text-stone-900">${icon("mapPin", "size-5 text-brand-700")}Where should we deliver?</legend>
            ${bookingField({
              id: "street",
              name: "street",
              label: "Street address",
              error: e.street,
              control: input({ id: "street", name: "street", value: values.street, error: e.street, attrs: html`autocomplete="street-address" maxlength="150" placeholder="1234 S Example Ave"` }),
            })}
            <div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem_8rem]">
              ${bookingField({
                id: "city",
                name: "city",
                label: "City",
                error: e.city,
                control: input({ id: "city", name: "city", value: values.city, error: e.city, attrs: html`autocomplete="address-level2" maxlength="60"` }),
              })}
              ${bookingField({
                id: "state",
                name: "state",
                label: "State",
                error: e.state,
                control: html`<select id="state" name="state" class="${ui.input}" autocomplete="address-level1" aria-describedby="state-error">
                  ${SERVICE_STATES.map((state) => html`<option value="${state}" ${values.state === state ? "selected" : ""}>${state}</option>`)}
                </select>`,
              })}
              ${bookingField({
                id: "zip",
                name: "zip",
                label: "ZIP code",
                error: e.zip,
                control: input({ id: "zip", name: "zip", value: values.zip, error: e.zip, attrs: html`autocomplete="postal-code" inputmode="numeric" maxlength="5"` }),
              })}
            </div>
          </fieldset>
        </section>

        <section data-step="2" class="${cx("space-y-6", initialStep !== 2 && "js:hidden")}">
          <div class="${ui.card} hidden p-5 js:block">
            <h2 class="text-lg font-semibold text-stone-900">Check your booking</h2>
            <div data-review-rows>${reviewRows(values, quote)}</div>
          </div>

          <div class="${ui.card} p-5">
            <h2 class="flex items-center gap-2 text-lg font-semibold text-stone-900">${icon("clipboardCheck", "size-5 text-brand-700")}Liability terms and security deposit</h2>
            <p class="mt-1 text-sm text-stone-600">Please read before you book.</p>
            <div id="liability-terms" class="mt-4 rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm leading-relaxed text-stone-800">${LIABILITY_TERMS}</div>
            <label class="${cx(
              "mt-4 flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors",
              e.acceptedTerms ? "border-red-300 bg-red-50" : "border-stone-200 hover:bg-stone-50",
            )}" data-terms-box>
              <input type="checkbox" id="accepted-terms" name="acceptedTerms" value="on" required class="mt-0.5 size-5 shrink-0 rounded border-stone-400 accent-brand-700"
                aria-invalid="${e.acceptedTerms ? "true" : "false"}" aria-describedby="liability-terms accepted-terms-error" ${values.acceptedTerms ? "checked" : ""}>
              <span class="text-sm text-stone-900">I have read and accept these liability terms, including the mandatory ${formatCents(SECURITY_DEPOSIT_CENTS)} security deposit.</span>
            </label>
            <p id="accepted-terms-error" class="${ui.error}" data-error-for="acceptedTerms" role="alert" ${e.acceptedTerms ? "" : "hidden"}>${e.acceptedTerms || ""}</p>
          </div>
        </section>

        <div class="flex items-center justify-between rounded-lg bg-stone-100 px-4 py-3 text-sm lg:hidden" data-mobile-total ${quote ? "" : "hidden"}>
          <span class="text-stone-600">Total due today (incl. deposit)</span>
          <span class="text-base font-bold text-stone-900" data-mobile-total-value>${quote ? formatCents(quote.totalCents) : ""}</span>
        </div>

        <div class="flex flex-col-reverse gap-3 border-t border-stone-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <button type="button" data-back hidden class="${ui.buttonSecondary}">${icon("arrowLeft")}Back</button>
          <span data-back-spacer></span>
          <button type="button" data-next hidden class="${ui.buttonPrimary} py-3">Continue ${icon("arrowRight")}</button>
          <button type="submit" data-submit class="${ui.buttonPrimary} py-3">
            <span data-submit-idle class="inline-flex items-center gap-2">${icon("lock")}Continue to payment</span>
            <span data-submit-busy hidden class="inline-flex items-center gap-2">${icon("loaderCircle", "size-4 animate-spin")}Creating your booking…</span>
          </button>
        </div>
      </form>

      <aside class="lg:sticky lg:top-6">${priceSummary(values, quote)}</aside>
    </div>
  </div>`;
}

function renderBooking(ctx, status, viewer, { values = DEFAULT_VALUES, errors = {}, serverError } = {}) {
  const errorFields = Object.keys(errors);
  const initialStep = errorFields.length ? Math.min(...errorFields.map(stepOfField)) : 0;
  const earliestStart = addDaysIso(chicagoToday(), MIN_LEAD_DAYS);
  ctx.html(
    status,
    page(ctx, {
      title: "Book units",
      description: "Book portable toilets, ADA units and handwashing stations anywhere in Chicagoland.",
      viewer,
      body: bookingBody({ values, errors, serverError, initialStep, earliestStart }),
      scripts: ["/static/book.js"],
    }),
  );
}

// ------------------------------------------------------------------ handlers

export async function bookingPage(ctx) {
  const viewer = await requireViewer(ctx);
  renderBooking(ctx, 200, viewer);
}

/**
 * POST /api/rentals: create a booking. Accepts the HTML form (redirects to
 * checkout) or JSON (answers with the invoice id).
 */
export async function createRentalAction(ctx) {
  const wantsJson = String(ctx.req.headers["content-type"] || "").includes("application/json");
  const viewer = await currentViewer(ctx);
  if (!viewer) {
    if (wantsJson) return ctx.json(401, { error: "Please sign in to book." });
    throw new Redirect("/login?next=%2Frentals%2Fnew");
  }

  const input = wantsJson ? (await ctx.jsonBody()) || {} : await ctx.form();
  const { ok, values, errors } = validateBooking(input);
  if (!ok) {
    if (wantsJson) return ctx.json(422, { error: Object.values(errors)[0], errors });
    return renderBooking(ctx, 422, viewer, { values, errors });
  }

  const quote = quoteBooking({
    unitCategory: values.unitCategory,
    quantity: Number(values.quantity),
    startDate: values.startDate,
    endDate: values.endDate,
  });
  if (!quote) {
    const message = "We couldn't price that booking. Check the dates and quantity.";
    if (wantsJson) return ctx.json(422, { error: message });
    return renderBooking(ctx, 422, viewer, { values, errors: {}, serverError: message });
  }

  // Plenty for real customers; stops a script from filling the job list.
  // (Only bookings that pass the checks above count.)
  if (tooManyAttempts(`booking:${viewer.user.id}`, { limit: 20, windowSeconds: 3600 })) {
    const message = "You've made a lot of bookings in the last hour. Please call us if you need more.";
    if (wantsJson) return ctx.json(429, { error: message });
    return renderBooking(ctx, 429, viewer, { values, errors: {}, serverError: message });
  }

  let invoiceId;
  try {
    // Rental + invoice in one database transaction; prices come from the server.
    invoiceId = await asService().rpc("create_booking", {
      p_user_id: viewer.user.id,
      p_unit_category: values.unitCategory,
      p_quantity: quote.quantity,
      p_delivery_address: formatDeliveryAddress(values),
      p_event_type: eventTypeLabel(values.eventType, values.eventOther),
      p_start_date: values.startDate,
      p_end_date: values.endDate,
      p_terms_version: LIABILITY_TERMS_VERSION,
      p_amount_base: centsToDecimal(quote.rentalCents),
      p_amount_tax: centsToDecimal(quote.taxCents),
    });
  } catch (error) {
    console.error("[api/rentals] create_booking failed", error);
    const message = "We couldn't save your booking. Please try again.";
    if (wantsJson) return ctx.json(500, { error: message });
    return renderBooking(ctx, 500, viewer, { values, errors: {}, serverError: message });
  }

  // Prepare the Stripe payment now so checkout opens instantly. If Stripe is
  // briefly unreachable, the checkout page creates it instead.
  try {
    const invoice = await loadPayableInvoice(invoiceId);
    if (invoice) await ensurePaymentIntent(invoice);
  } catch (error) {
    console.error(`[api/rentals] could not prepare payment for ${invoiceId}`, error);
  }

  const checkoutUrl = `/checkout/${encodeURIComponent(invoiceId)}`;
  if (wantsJson) return ctx.json(201, { invoiceId, checkoutUrl });
  throw new Redirect(checkoutUrl);
}
