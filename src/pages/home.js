import { formatCents, formatRate } from "../../shared/format.js";
import { SECURITY_DEPOSIT_CENTS, UNIT_CATALOG, UNIT_CATEGORIES } from "../../shared/pricing.js";
import { SITE } from "../env.js";
import { html } from "../html.js";
import { currentViewer } from "../session.js";
import { icon } from "../views/icons.js";
import { page, telHref } from "../views/layout.js";
import { ui } from "../views/ui.js";

const STEPS = [
  {
    icon: "creditCard",
    title: "Book and pay online",
    body: `Pick your units and dates, then pay the rental, tax and a ${formatCents(SECURITY_DEPOSIT_CENTS)} refundable deposit by card.`,
  },
  {
    icon: "truck",
    title: "We deliver and service",
    body: "We place the units where you need them, and service and restock them on rentals of a week or longer.",
  },
  {
    icon: "clipboardCheck",
    title: "Pickup and deposit refund",
    body: "After pickup we inspect the equipment. If it comes back undamaged, the deposit goes back to your card.",
  },
];

function unitCard(category) {
  const unit = UNIT_CATALOG[category];
  return html`<article class="${ui.card} flex flex-col p-5">
    <div class="flex size-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">${icon(unit.icon, "size-5")}</div>
    <h3 class="mt-4 font-semibold text-stone-900">${unit.name}</h3>
    <p class="mt-1 text-sm text-stone-600">${unit.summary}</p>
    <ul class="mb-5 mt-3 space-y-1 text-sm text-stone-700">
      ${unit.features.map(
        (feature) => html`<li class="flex gap-2"><span aria-hidden="true" class="mt-2 size-1 shrink-0 rounded-full bg-stone-400"></span>${feature}</li>`,
      )}
    </ul>
    <dl class="mt-auto grid grid-cols-3 gap-2 border-t border-stone-100 pt-4 text-center">
      <div><dt class="text-xs text-stone-500">Day</dt><dd class="text-lg font-semibold text-stone-900">${formatRate(unit.rates.dayCents)}</dd></div>
      <div><dt class="text-xs text-stone-500">Week</dt><dd class="text-lg font-semibold text-stone-900">${formatRate(unit.rates.weekCents)}</dd></div>
      <div><dt class="text-xs text-stone-500">28 days</dt><dd class="text-lg font-semibold text-stone-900">${formatRate(unit.rates.cycleCents)}</dd></div>
    </dl>
  </article>`;
}

export async function homePage(ctx) {
  const viewer = await currentViewer(ctx);
  const body = html`
  <section class="border-b border-stone-200 bg-white">
    <div class="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
      <p class="text-sm font-medium text-brand-700">${SITE.baseLocation} · Serving all of Chicagoland</p>
      <h1 class="mt-3 max-w-3xl text-3xl font-bold tracking-tight text-stone-900 sm:text-5xl">Portable toilet rentals for Chicagoland job sites and events</h1>
      <p class="mt-4 max-w-2xl text-lg text-stone-600">Delivery, placement, servicing and restocking, all year round. Book online in a few minutes and pay securely by card.</p>
      <div class="mt-8 flex flex-col gap-3 sm:flex-row">
        <a href="/rentals/new" class="${ui.buttonPrimary} px-5 py-3 text-base">Book units ${icon("arrowRight")}</a>
        <a href="#units" class="${ui.buttonSecondary} px-5 py-3 text-base">See units and prices</a>
      </div>
      <ul class="mt-10 grid gap-3 text-sm text-stone-700 sm:grid-cols-3">
        <li class="flex items-center gap-2">${icon("calendarCheck", "size-5 shrink-0 text-brand-700")}Year-round service for events of any size</li>
        <li class="flex items-center gap-2">${icon("shieldCheck", "size-5 shrink-0 text-brand-700")}${formatCents(SECURITY_DEPOSIT_CENTS)} deposit, refunded after inspection</li>
        <li class="flex items-center gap-2">${icon("clipboardCheck", "size-5 shrink-0 text-brand-700")}Job-site setups to OSHA 1926.51 sanitation rules</li>
      </ul>
    </div>
  </section>

  <section id="units" class="mx-auto max-w-6xl scroll-mt-6 px-4 py-14 sm:px-6">
    <h2 class="text-2xl font-bold tracking-tight text-stone-900">Units and prices</h2>
    <p class="mt-2 max-w-2xl text-stone-600">Prices are per unit and include delivery, placement and pickup. Longer rentals automatically get the cheapest mix of daily, weekly and 28-day rates.</p>
    <div class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">${UNIT_CATEGORIES.map(unitCard)}</div>
  </section>

  <section class="border-y border-stone-200 bg-white">
    <div class="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <h2 class="text-2xl font-bold tracking-tight text-stone-900">How it works</h2>
      <ol class="mt-8 grid gap-6 sm:grid-cols-3">
        ${STEPS.map(
          (step, index) => html`<li class="flex gap-4">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-700 text-sm font-bold text-white">${index + 1}</div>
            <div>
              <h3 class="flex items-center gap-2 font-semibold text-stone-900">${icon(step.icon, "size-4 text-brand-700")}${step.title}</h3>
              <p class="mt-1 text-sm text-stone-600">${step.body}</p>
            </div>
          </li>`,
        )}
      </ol>
    </div>
  </section>

  <section class="mx-auto max-w-6xl px-4 py-14 sm:px-6">
    <div class="${ui.card} flex flex-col items-start justify-between gap-6 p-6 sm:flex-row sm:items-center">
      <div>
        <h2 class="text-xl font-bold tracking-tight text-stone-900">Construction sites, weddings, festivals, block parties</h2>
        <p class="mt-1 text-stone-600">Need more than one unit type? Book each type as its own booking.${SITE.phone
          ? html` For large events, call <a href="${telHref(SITE.phone)}" class="${ui.link}">${SITE.phone}</a>.`
          : ""}</p>
      </div>
      <a href="/rentals/new" class="${ui.buttonPrimary}">Start a booking ${icon("arrowRight")}</a>
    </div>
  </section>`;

  ctx.html(200, page(ctx, { viewer, body }));
}
