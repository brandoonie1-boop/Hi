// "My rentals": the signed-in customer's bookings, invoices and deposit status.

import { chicagoToday, formatDateRange } from "../../shared/dates.js";
import { formatDollars } from "../../shared/format.js";
import { UNIT_CATALOG } from "../../shared/pricing.js";
import { cx, html } from "../html.js";
import { requireViewer } from "../session.js";
import { asUser } from "../supabase.js";
import { icon } from "../views/icons.js";
import { page } from "../views/layout.js";
import { alert, depositStatusBadge, payStatusBadge, rentalStatusBadge, ui } from "../views/ui.js";

const NOTICES = {
  password: { tone: "success", body: "Your password was updated." },
};

function rentalCard(row, today) {
  const unit = UNIT_CATALOG[row.unit_category];
  const payable = (row.pay_status === "unpaid" || row.pay_status === "overdue") && row.start_date >= today;
  const settled = row.pay_status === "paid" || row.pay_status === "refunded";
  const checkoutUrl = `/checkout/${encodeURIComponent(row.invoice_id)}`;

  return html`<li class="${ui.card} p-5">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div class="flex min-w-0 gap-3">
        <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">${icon(unit?.icon ?? "truck", "size-5")}</span>
        <div class="min-w-0">
          <p class="font-semibold text-stone-900">${row.quantity} × ${unit?.name ?? row.unit_category}</p>
          <p class="text-sm text-stone-500">Invoice ${row.invoice_id} · ${row.event_type}</p>
          <ul class="mt-2 space-y-1 text-sm text-stone-700">
            <li class="flex gap-2">${icon("calendarDays", "mt-0.5 size-4 shrink-0 text-stone-400")}${formatDateRange(row.start_date, row.end_date)}</li>
            <li class="flex gap-2">${icon("mapPin", "mt-0.5 size-4 shrink-0 text-stone-400")}<span class="break-words">${row.delivery_address}</span></li>
          </ul>
        </div>
      </div>
      <div class="flex shrink-0 flex-col items-start gap-2 sm:items-end">
        <p class="text-lg font-bold text-stone-900">${formatDollars(row.amount_total)}</p>
        <div class="flex flex-wrap gap-1.5 sm:justify-end">
          ${payStatusBadge(row.pay_status)}
          ${settled ? rentalStatusBadge(row.status) : ""}
          ${settled ? depositStatusBadge(row.dep_status) : ""}
        </div>
        ${payable
          ? html`<a href="${checkoutUrl}" class="${ui.buttonPrimary} mt-1">Pay now ${icon("arrowRight")}</a>`
          : settled
            ? html`<a href="${checkoutUrl}" class="${ui.link} text-sm">View receipt</a>`
            : html`<p class="text-xs text-stone-500">Delivery date passed without payment</p>`}
      </div>
    </div>
    ${row.dep_status === "forfeited_damage" && row.deposit_note
      ? html`<p class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">Deposit kept after inspection: ${row.deposit_note}</p>`
      : ""}
  </li>`;
}

export async function myRentalsPage(ctx) {
  const viewer = await requireViewer(ctx);

  let rows = [];
  let loadError = false;
  try {
    rows = await asUser(viewer.accessToken).select("rental_manifest", {
      user_id: `eq.${viewer.user.id}`,
      order: "created_at.desc",
      limit: 200,
    });
  } catch (error) {
    console.error("[rentals] could not load rentals", error);
    loadError = true;
  }

  const today = chicagoToday();
  const notice = Object.hasOwn(NOTICES, ctx.query.get("notice") ?? "") ? NOTICES[ctx.query.get("notice")] : null;
  const body = html`<div class="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight text-stone-900">My rentals</h1>
        <p class="mt-1 text-stone-600">Bookings, invoices and deposit refunds.</p>
      </div>
      <a href="/rentals/new" class="${ui.buttonPrimary}">${icon("plus")}New booking</a>
    </div>
    ${notice ? alert({ ...notice, className: "mt-6" }) : ""}
    ${loadError ? alert({ tone: "error", body: "We couldn't load your rentals right now. Please refresh the page.", className: "mt-8" }) : ""}
    ${!loadError && rows.length === 0
      ? html`<div class="${cx(ui.card, "mt-8 p-8 text-center")}">
          <p class="font-medium text-stone-900">No rentals yet</p>
          <p class="mt-1 text-sm text-stone-600">Book units for your job site or event in a few minutes.</p>
          <a href="/rentals/new" class="${ui.buttonPrimary} mt-5">Book units ${icon("arrowRight")}</a>
        </div>`
      : ""}
    <ul class="mt-8 space-y-4">${rows.map((row) => rentalCard(row, today))}</ul>
  </div>`;

  ctx.html(200, page(ctx, { title: "My rentals", viewer, body, noIndex: true }));
}
