// Dispatch dashboard (/admin/dashboard) and the admin actions behind it.

import { randomUUID } from "node:crypto";

import { chicagoToday, formatDateShort, formatTimestamp, rentalDays } from "../../shared/dates.js";
import { formatDollars, plural, toCents } from "../../shared/format.js";
import { UNIT_CATALOG } from "../../shared/pricing.js";
import { requireEnv } from "../env.js";
import { cx, html, jsonScript } from "../html.js";
import { Redirect } from "../http.js";
import { refreshWindowSeconds, requireViewer, tokenSecondsLeft } from "../session.js";
import { stripe, StripeError } from "../stripe.js";
import { asService, asUser } from "../supabase.js";
import { icon } from "../views/icons.js";
import { page, telHref } from "../views/layout.js";
import {
  alert,
  depositStatusBadge,
  payStatusBadge,
  RENTAL_STATUS_LABEL,
  RENTAL_STATUSES,
  rentalStatusBadge,
  ui,
} from "../views/ui.js";

const VIEWS = {
  live: { label: "Live", query: { pay_status: "eq.paid", status: "neq.completed", order: "start_date.asc" } },
  unpaid: { label: "Unpaid", query: { pay_status: "in.(unpaid,overdue)", order: "created_at.desc" } },
  // Deposits still waiting for a decision first, then the newest jobs.
  completed: { label: "Completed", query: { status: "eq.completed", order: "dep_status.asc,end_date.desc" } },
  all: { label: "All", query: { order: "created_at.desc" } },
};

const NOTICES = {
  refunded: { tone: "success", body: "Deposit refunded to the customer's card." },
  kept: { tone: "success", body: "Deposit kept and the damage note saved. The customer can see the note." },
  status: { tone: "success", body: "Job status updated." },
};
const ERRORS = {
  "not-paid": "Deposits can only be resolved on paid invoices.",
  "already-resolved": "That deposit was already refunded or kept.",
  "not-completed": "Set the job to Completed after pickup and inspection, then refund or keep the deposit.",
  "refund-in-progress": "A refund for this deposit was started in the last 10 minutes, so it can't be kept right now. Click Release $50 Refund to finish the refund, or try again after 10 minutes (the customer is never refunded twice).",
  "refund-busy": "A refund for this deposit was started in the last 10 minutes and may still be going through. Refresh the page in a few minutes; if it still shows as held, click Release again.",
  "already-refunded": "That deposit had already been refunded in Stripe, so it's now marked as refunded instead of kept.",
  "stripe-check-failed": "Couldn't check with Stripe whether this deposit was already refunded. Please try again in a minute.",
  "stripe-slow": "Stripe is slow or busy right now, so nothing was refunded. Please try again in a minute.",
  "no-payment": "No card payment is linked to that invoice. Refund the deposit manually in Stripe.",
  "refund-failed": "Stripe turned the refund down. Check the payment in the Stripe dashboard.",
  "refund-interrupted": "The refund didn't finish (Stripe may be having trouble). To be safe, this deposit is locked for 10 minutes; then click Release again. The customer is never refunded twice.",
  "note-required": "Describe the damage (at least a few words) before keeping a deposit.",
  "bad-request": "That action didn't look right. Please try again.",
  "not-found": "That job or invoice couldn't be found.",
  failed: "Something went wrong saving that change. Please try again.",
};

function dashboardUrl(view, q) {
  const params = new URLSearchParams();
  if (view && view !== "live") params.set("view", view);
  if (q) params.set("q", q);
  const query = params.toString();
  return `/admin/dashboard${query ? `?${query}` : ""}`;
}

/** Only ever send admins back to the dashboard itself. */
function safeReturn(value) {
  const target = String(value || "");
  return target.startsWith("/admin/dashboard") ? target : "/admin/dashboard";
}

function withParam(url, key, value) {
  const parsed = new URL(url, "http://localhost");
  parsed.searchParams.delete("notice");
  parsed.searchParams.delete("error");
  parsed.searchParams.set(key, value);
  return parsed.pathname + parsed.search;
}

function staffOnly(ctx, viewer) {
  ctx.html(
    403,
    page(ctx, {
      title: "Staff only",
      viewer,
      noIndex: true,
      body: html`<div class="mx-auto max-w-lg px-4 py-16">
        <div class="${ui.card} p-8 text-center">
          <h1 class="text-xl font-semibold text-stone-900">Staff only</h1>
          <p class="mt-2 text-sm text-stone-600">The dispatch dashboard is for Brown Line IL LLC administrators. If you work here, ask the owner to give your account admin access.</p>
          <a href="/rentals" class="${ui.buttonSecondary} mt-6">Go to my rentals</a>
        </div>
      </div>`,
    }),
  );
}

function statCard({ iconName, label, value, note, highlight = false }) {
  return html`<div class="${ui.card} p-4 sm:p-5">
    <div class="flex items-start justify-between gap-3">
      <p class="text-sm font-medium text-stone-600">${label}</p>
      ${icon(iconName, "size-5 shrink-0 text-brand-700")}
    </div>
    <p class="mt-2 text-2xl font-bold tracking-tight text-stone-900 tabular-nums sm:text-3xl">${value}</p>
    ${note ? html`<p class="${cx("mt-1 text-xs", highlight ? "font-medium text-amber-800" : "text-stone-500")}">${note}</p>` : ""}
  </div>`;
}

function depositNote(stats) {
  if (!stats) return "";
  if (stats.deposits_ready_count > 0) {
    const n = stats.deposits_ready_count;
    return `${n} completed ${n === 1 ? "job needs" : "jobs need"} a refund or damage decision`;
  }
  const n = stats.deposits_held_count;
  return `${plural(n, "deposit")} held until pickup and inspection`;
}

function statusForm(row, returnTo) {
  return html`<form method="post" action="/api/admin/rentals/status" class="flex items-center gap-2" data-status-form>
    <input type="hidden" name="rentalId" value="${row.rental_id}">
    <input type="hidden" name="returnTo" value="${returnTo}">
    <label for="status-${row.rental_id}" class="sr-only">Job status</label>
    <select id="status-${row.rental_id}" name="status" class="rounded-lg border border-stone-300 bg-white py-1.5 pl-2 pr-8 text-sm font-medium text-stone-800 shadow-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20">
      ${RENTAL_STATUSES.map((status) => html`<option value="${status}" ${row.status === status ? "selected" : ""}>${RENTAL_STATUS_LABEL[status]}</option>`)}
    </select>
    <button type="submit" class="${ui.buttonSecondary} px-3 py-1.5 js:hidden">Update</button>
    <span data-status-busy hidden>${icon("loaderCircle", "size-4 animate-spin text-stone-500")}</span>
  </form>`;
}

const summaryButton =
  "inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg border bg-white px-3 py-1.5 text-sm font-semibold [&::-webkit-details-marker]:hidden";

function depositActions(row, returnTo) {
  const amount = formatDollars(row.amount_deposit);
  const short = amount.replace(/\.00$/, "");
  return html`<div class="flex flex-col gap-2 sm:items-end">
    <div class="flex flex-wrap gap-2 sm:justify-end">
      <details class="group w-full sm:w-auto" data-action>
        <summary class="${summaryButton} border-emerald-300 text-emerald-800 hover:bg-emerald-50">${icon("undo2")}Release ${short} Refund</summary>
        <form method="post" action="/api/admin/deposit" class="mt-2 animate-fade-in rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm sm:w-80" data-busy-form>
          <input type="hidden" name="invoiceId" value="${row.invoice_id}">
          <input type="hidden" name="action" value="release">
          <input type="hidden" name="returnTo" value="${returnTo}">
          <p class="font-medium text-emerald-900">Refund ${amount} to the customer's card?</p>
          <p class="mt-0.5 text-emerald-800">Use this after pickup, when the inspection found no damage.</p>
          <button type="submit" class="${ui.buttonSuccess} mt-3" data-busy-label="Refunding…">${icon("undo2")}Confirm refund</button>
        </form>
      </details>
      <details class="group w-full sm:w-auto" data-action>
        <summary class="${summaryButton} border-red-300 text-red-800 hover:bg-red-50">${icon("ban")}Seize for Damages</summary>
        <form method="post" action="/api/admin/deposit" class="mt-2 animate-fade-in rounded-lg border border-red-200 bg-red-50 p-3 text-sm sm:w-80" data-busy-form>
          <input type="hidden" name="invoiceId" value="${row.invoice_id}">
          <input type="hidden" name="action" value="forfeit">
          <input type="hidden" name="returnTo" value="${returnTo}">
          <label for="note-${row.invoice_id}" class="font-medium text-red-900">What damage did the inspection find?</label>
          <p class="text-red-800">The customer sees this note on their rental.</p>
          <textarea id="note-${row.invoice_id}" name="note" rows="2" minlength="3" maxlength="500" required class="${ui.input} mt-2" placeholder="e.g. Graffiti on both side panels, cracked door hinge"></textarea>
          <button type="submit" class="${ui.buttonDanger} mt-3" data-busy-label="Saving…">${icon("ban")}Keep the ${amount} deposit</button>
        </form>
      </details>
    </div>
  </div>`;
}

function jobCard(row, today, returnTo) {
  const unit = UNIT_CATALOG[row.unit_category];
  const days = rentalDays(row.start_date, row.end_date);
  const paid = row.pay_status === "paid";
  const inField = row.status === "active" || row.status === "scheduled_pickup";
  const deliveryToday = paid && row.start_date === today && (row.status === "pending_delivery" || row.status === "active");
  const pickupDue = paid && inField && row.end_date <= today;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.delivery_address)}`;

  return html`<li class="${ui.card} p-4 sm:p-5">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-mono text-sm font-semibold text-stone-900">${row.invoice_id}</span>
        ${rentalStatusBadge(row.status)}
        ${payStatusBadge(row.pay_status)}
        ${paid || row.pay_status === "refunded" ? depositStatusBadge(row.dep_status) : ""}
        ${deliveryToday ? html`<span class="rounded-full bg-brand-700 px-2 py-0.5 text-xs font-semibold text-white">Delivery today</span>` : ""}
        ${pickupDue ? html`<span class="rounded-full bg-sky-700 px-2 py-0.5 text-xs font-semibold text-white">Pickup due</span>` : ""}
      </div>
      <span class="text-sm text-stone-500">Booked ${formatTimestamp(row.created_at)}</span>
    </div>

    <div class="mt-4 grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
      <div class="min-w-0">
        <p class="text-xs font-medium uppercase tracking-wide text-stone-500">Customer</p>
        <p class="mt-1 font-medium text-stone-900">${row.full_name || "No name on file"}</p>
        ${row.company_name ? html`<p class="text-stone-600">${row.company_name}</p>` : ""}
        ${row.phone_number ? html`<a href="${telHref(row.phone_number)}" class="mt-1 flex items-center gap-1.5 text-brand-700 hover:underline">${icon("phone", "size-3.5")}${row.phone_number}</a>` : ""}
        ${row.email ? html`<a href="mailto:${row.email}" class="flex items-center gap-1.5 break-all text-brand-700 hover:underline">${icon("mail", "size-3.5 shrink-0")}${row.email}</a>` : ""}
      </div>
      <div class="min-w-0">
        <p class="text-xs font-medium uppercase tracking-wide text-stone-500">Units</p>
        <p class="mt-1 flex items-center gap-2 font-medium text-stone-900">${icon(unit?.icon ?? "truck", "size-4 shrink-0 text-brand-700")}${row.quantity} × ${unit?.name ?? row.unit_category}</p>
        <p class="text-stone-600">${row.event_type}</p>
      </div>
      <div class="min-w-0">
        <p class="text-xs font-medium uppercase tracking-wide text-stone-500">Site and dates</p>
        <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="mt-1 flex gap-1.5 text-stone-900 hover:text-brand-700 hover:underline">${icon("mapPin", "mt-0.5 size-3.5 shrink-0")}<span class="break-words">${row.delivery_address}</span></a>
        <p class="mt-1 flex items-center gap-1.5 text-stone-600">${icon("calendarDays", "size-3.5 shrink-0")}${formatDateShort(row.start_date)} to ${formatDateShort(row.end_date)} (${plural(days, "day")})</p>
      </div>
      <div class="min-w-0">
        <p class="text-xs font-medium uppercase tracking-wide text-stone-500">Invoice</p>
        <p class="mt-1 font-semibold text-stone-900">${formatDollars(row.amount_total)}</p>
        <p class="text-stone-600">Rental ${formatDollars(row.amount_base)} · Tax ${formatDollars(row.amount_tax)} · Deposit ${formatDollars(row.amount_deposit)}</p>
        ${row.paid_at ? html`<p class="text-stone-500">Paid ${formatTimestamp(row.paid_at)}</p>` : ""}
      </div>
    </div>

    ${row.deposit_note
      ? html`<p class="mt-3 rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700"><span class="font-medium">Inspection note:</span> ${row.deposit_note}${row.deposit_resolved_at
          ? html`<span class="text-stone-500"> (${formatTimestamp(row.deposit_resolved_at)})</span>`
          : ""}</p>`
      : ""}

    <div class="mt-4 flex flex-col gap-3 border-t border-stone-100 pt-4 sm:flex-row sm:items-start sm:justify-between">
      ${statusForm(row, returnTo)}
      ${paid && row.dep_status === "held"
        ? row.status === "completed"
          ? depositActions(row, returnTo)
          : html`<p class="text-sm text-stone-500 sm:max-w-xs sm:text-right">After pickup and inspection, set the job to Completed to refund or keep the deposit.</p>`
        : ""}
    </div>
  </li>`;
}

function matches(row, needle) {
  if (!needle) return true;
  return [row.invoice_id, row.full_name, row.company_name, row.phone_number, row.email, row.delivery_address, row.event_type, UNIT_CATALOG[row.unit_category]?.name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

export async function adminDashboardPage(ctx) {
  const viewer = await requireViewer(ctx);
  if (!viewer.isAdmin) return staffOnly(ctx, viewer);

  const view = Object.hasOwn(VIEWS, ctx.query.get("view") ?? "") ? ctx.query.get("view") : "live";
  const q = String(ctx.query.get("q") || "").trim().slice(0, 80);
  const returnTo = dashboardUrl(view, q);
  const db = asUser(viewer.accessToken);

  let stats = null;
  let rows = [];
  let loadError = null;
  try {
    [stats, rows] = await Promise.all([
      db.rpc("admin_dashboard_stats"),
      db.select("rental_manifest", { ...VIEWS[view].query, limit: 500 }),
    ]);
  } catch (error) {
    console.error("[admin] dashboard data failed", error);
    loadError = error.message;
  }

  const needle = q.toLowerCase();
  const visible = rows.filter((row) => matches(row, needle));
  const today = chicagoToday();
  const notice = Object.hasOwn(NOTICES, ctx.query.get("notice") ?? "") ? NOTICES[ctx.query.get("notice")] : null;
  const errorMessage = Object.hasOwn(ERRORS, ctx.query.get("error") ?? "") ? ERRORS[ctx.query.get("error")] : null;
  const readyCount = stats?.deposits_ready_count ?? 0;

  let realtime = null;
  try {
    realtime = {
      supabaseUrl: requireEnv("SUPABASE_URL"),
      publishableKey: requireEnv("SUPABASE_PUBLISHABLE_KEY"),
      accessToken: viewer.accessToken,
      // Reload a little before the sign-in token runs out; the reload hands
      // the page a fresh one (see refreshWindowSeconds in session.js).
      reloadAfterSeconds: Math.max(
        30,
        tokenSecondsLeft(viewer.accessToken) - Math.floor(refreshWindowSeconds(viewer.accessToken) / 2),
      ),
    };
  } catch {
    realtime = null;
  }

  const body = html`<div class="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
    <h1 class="text-3xl font-bold tracking-tight text-stone-900">Dispatch dashboard</h1>
    <p class="mt-1 text-stone-600">Every job across Chicagoland, updated live.</p>

    ${notice ? alert({ ...notice, className: "mt-6" }) : ""}
    ${errorMessage ? alert({ tone: "error", body: errorMessage, className: "mt-6" }) : ""}
    ${loadError ? alert({ tone: "error", title: "Some data couldn't load", body: loadError, className: "mt-6" }) : ""}

    <section aria-label="Key numbers" class="mt-8 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      ${statCard({ iconName: "banknote", label: "Gross earnings", value: stats ? formatDollars(stats.gross_earnings) : "—", note: "Paid rentals plus deposits kept for damage, before tax" })}
      ${statCard({ iconName: "truck", label: "Active field units", value: stats ? String(stats.units_in_field) : "—", note: stats ? `Across ${plural(stats.jobs_in_field, "job")}` : "" })}
      ${statCard({ iconName: "shieldCheck", label: "Security deposits held", value: stats ? formatDollars(stats.deposits_held) : "—", note: depositNote(stats), highlight: readyCount > 0 })}
      ${statCard({ iconName: "receiptText", label: "Unpaid bookings", value: stats ? String(stats.unpaid_count) : "—", note: "Created but not yet paid" })}
    </section>

    <section aria-label="Job manifest" class="mt-10">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div class="flex items-center gap-3">
          <h2 class="text-xl font-semibold text-stone-900">Manifest</h2>
          <span class="inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600" data-live-badge title="Updates appear automatically while this says Live">
            <span class="relative flex size-2">
              <span class="absolute hidden size-full animate-ping rounded-full bg-emerald-500 opacity-60" data-live-ping></span>
              <span class="relative inline-flex size-2 rounded-full bg-stone-400" data-live-dot></span>
            </span>
            <span data-live-text>Connecting</span>
          </span>
        </div>
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
          <nav aria-label="Filter jobs" class="flex gap-1 overflow-x-auto rounded-lg bg-stone-100 p-1 text-sm">
            ${Object.entries(VIEWS).map(
              ([key, { label }]) => html`<a href="${dashboardUrl(key, q)}" ${view === key ? html`aria-current="page"` : ""}
                class="${cx("whitespace-nowrap rounded-md px-3 py-1.5 font-medium transition-colors", view === key ? "bg-white text-stone-900 shadow-sm" : "text-stone-600 hover:text-stone-900")}">${label}${key === "completed" && readyCount > 0
                  ? html`<span class="ml-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-xs font-semibold text-white" title="Deposits waiting for a refund or damage decision">${readyCount}</span>`
                  : ""}</a>`,
            )}
          </nav>
          <form method="get" action="/admin/dashboard" class="relative block" role="search">
            ${view !== "live" ? html`<input type="hidden" name="view" value="${view}">` : ""}
            <label for="manifest-search" class="sr-only">Search jobs</label>
            ${icon("search", "pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400")}
            <input id="manifest-search" type="search" name="q" value="${q}" placeholder="Search name, address, invoice" class="${ui.input} pl-9 sm:w-72">
          </form>
        </div>
      </div>

      <p class="mt-3 text-sm text-stone-500">${plural(visible.length, "job")}${q ? ` matching "${q}"` : ""}</p>
      <div class="mt-3" data-refresh-banner hidden>${alert({
        tone: "info",
        body: html`New updates are in. <button type="button" class="${ui.link}" data-refresh-now>Refresh the list</button>`,
      })}</div>

      ${visible.length === 0
        ? html`<div class="${ui.card} mt-4 p-8 text-center text-sm text-stone-600">${q ? "No jobs match that search." : "Nothing here right now."}</div>`
        : html`<ul class="mt-4 space-y-3">${visible.map((row) => jobCard(row, today, returnTo))}</ul>`}
    </section>
  </div>
  ${realtime ? jsonScript("realtime-config", realtime) : ""}`;

  ctx.html(200, page(ctx, { title: "Dispatch dashboard", viewer, body, noIndex: true, scripts: ["/static/admin.js", "/static/forms.js"] }));
}

// While a deposit refund is on its way to Stripe, deposit_refund_id holds
// "pending:<attempt>:<time>". That stops "keep" from going through at the
// same moment, and lets only one refund attempt run at a time. An attempt
// only asks Stripe for the refund within its first 30 seconds, and a Stripe
// call (with retries) gives up after about a minute, so a claim older than
// 10 minutes was left by an attempt that stopped part-way and can be taken over.
const CLAIM_PREFIX = "pending";
const CLAIM_LEASE_MS = 10 * 60 * 1000;
const CLAIM_SEND_WITHIN_MS = 30 * 1000;
const isClaim = (value) => typeof value === "string" && value.startsWith(CLAIM_PREFIX);
const claimStartedAt = (value) => Number(String(value).split(":")[2]);
const claimIsStale = (value) => {
  const startedAt = claimStartedAt(value);
  return !Number.isFinite(startedAt) || Date.now() - startedAt > CLAIM_LEASE_MS;
};

/** A deposit refund already sent for this payment, if any. */
async function earlierDepositRefund(paymentIntentId) {
  const existing = await stripe.listRefunds(paymentIntentId);
  return (
    (existing.data || []).find(
      (refund) =>
        refund.metadata?.purpose === "security_deposit_release" && refund.status !== "failed" && refund.status !== "canceled",
    ) || null
  );
}

async function requireAdminForAction(ctx) {
  const viewer = await requireViewer(ctx);
  if (!viewer.isAdmin) throw new Redirect("/admin/dashboard");
  return viewer;
}

/** POST /api/admin/deposit: refund the deposit to the card, or keep it for damage. */
export async function depositAction(ctx) {
  const viewer = await requireAdminForAction(ctx);
  const form = await ctx.form();
  const returnTo = safeReturn(form.returnTo);
  const fail = (code) => {
    throw new Redirect(withParam(returnTo, "error", code));
  };

  const invoiceId = String(form.invoiceId || "");
  const action = String(form.action || "");
  const note = String(form.note || "").trim();
  if (!/^BL-IL-\d{4}-\d{5,}$/.test(invoiceId) || !["release", "forfeit"].includes(action)) fail("bad-request");
  if (action === "forfeit" && (note.length < 3 || note.length > 500)) fail("note-required");

  const db = asService();
  const byId = { id: `eq.${invoiceId}` };
  const load = () =>
    db.first("invoices", { select: "id,rental_id,stripe_intent_id,amount_deposit,pay_status,dep_status,deposit_refund_id", ...byId });
  const invoice = await load();
  if (!invoice) fail("not-found");
  if (invoice.pay_status !== "paid") fail("not-paid");
  if (invoice.dep_status !== "held") fail("already-resolved");
  // The deposit is settled after pickup and inspection, never while units are out.
  const rental = await db.first("rentals", { select: "status", id: `eq.${invoice.rental_id}` });
  if (rental?.status !== "completed") fail("not-completed");

  const resolvedAt = new Date().toISOString();

  // PATCH that reports whether a row matched; a database error ends the request.
  const updateWhere = async (filters, values, what) => {
    try {
      return (await db.update("invoices", { ...byId, ...filters }, values)).length > 0;
    } catch (error) {
      console.error(`[admin] ${what} failed for ${invoice.id}`, error);
      return fail("failed");
    }
  };

  if (action === "release") {
    if (!invoice.stripe_intent_id) fail("no-payment");

    // Claim the deposit before contacting Stripe (see CLAIM_PREFIX above).
    const attempt = randomUUID();
    const claim = `${CLAIM_PREFIX}:${attempt}:${Date.now()}`;
    let tookOver = false;
    let claimed = await updateWhere({ dep_status: "eq.held", deposit_refund_id: "is.null" }, { deposit_refund_id: claim }, "starting the refund");
    if (!claimed) {
      const current = await load();
      if (current?.dep_status !== "held" || !isClaim(current.deposit_refund_id)) fail("already-resolved");
      if (!claimIsStale(current.deposit_refund_id)) fail("refund-busy");
      // The last attempt stopped part-way: take over from it.
      claimed = await updateWhere(
        { dep_status: "eq.held", deposit_refund_id: `eq.${current.deposit_refund_id}` },
        { deposit_refund_id: claim },
        "taking over the refund",
      );
      if (!claimed) fail("refund-busy");
      tookOver = true;
    }
    // Give the deposit back to "held" when it's certain no refund went out.
    const unclaim = () => updateWhere({ deposit_refund_id: `eq.${claim}` }, { deposit_refund_id: null }, "freeing the deposit again");

    // Never refund twice: reuse an earlier deposit refund if there is one
    // (for example if an earlier attempt's refund went through but saving it failed).
    let earlier;
    try {
      earlier = await earlierDepositRefund(invoice.stripe_intent_id);
    } catch (error) {
      console.error(`[admin] couldn't check Stripe for an earlier refund on ${invoice.id}`, error);
      // After taking over, an earlier attempt might have refunded: keep the claim.
      if (tookOver) fail("refund-interrupted");
      await unclaim();
      fail("stripe-slow");
    }

    let refundId = earlier?.id;
    if (!refundId) {
      // Too slow so far: stop before sending, rather than risk the refund
      // going out after this claim could be taken over. Nothing was sent.
      if (Date.now() - claimStartedAt(claim) > CLAIM_SEND_WITHIN_MS) {
        await unclaim();
        fail("stripe-slow");
      }
      try {
        const refund = await stripe.createRefund(
          {
            payment_intent: invoice.stripe_intent_id,
            amount: toCents(invoice.amount_deposit),
            metadata: { invoice_id: invoice.id, purpose: "security_deposit_release", released_by: viewer.user.id },
          },
          `deposit-release-${invoice.id}-${attempt}`,
        );
        refundId = refund.id;
      } catch (error) {
        console.error(`[admin] deposit refund failed for ${invoice.id}`, error);
        // Stripe clearly said no, so nothing was refunded: free the deposit up
        // again. If it's unclear (connection trouble, or 409: the request may
        // still be going through), the claim stays until it goes stale.
        if (error instanceof StripeError && error.status >= 400 && error.status < 500 && error.status !== 409) {
          await unclaim();
          fail(error.status === 429 ? "stripe-slow" : "refund-failed");
        }
        fail("refund-interrupted");
      }
    }

    const saved = await updateWhere(
      { dep_status: "eq.held", deposit_refund_id: `eq.${claim}` },
      { dep_status: "released", deposit_refund_id: refundId, deposit_resolved_at: resolvedAt },
      `saving refund ${refundId}`,
    );
    if (!saved) {
      const current = await load();
      if (current?.dep_status !== "released" || current.deposit_refund_id !== refundId) {
        console.error(`[admin] refund ${refundId} went out for ${invoice.id}, but the deposit now shows ${current?.dep_status}`);
        fail("already-resolved");
      }
    }
    throw new Redirect(withParam(returnTo, "notice", "refunded"));
  }

  // Keep the deposit, unless a refund for it has been started.
  const keep = { dep_status: "forfeited_damage", deposit_note: note, deposit_resolved_at: resolvedAt };
  if (await updateWhere({ dep_status: "eq.held", deposit_refund_id: "is.null" }, keep, "keeping the deposit")) {
    throw new Redirect(withParam(returnTo, "notice", "kept"));
  }
  const current = await load();
  if (current?.dep_status !== "held" || !isClaim(current.deposit_refund_id)) fail("already-resolved");
  if (!claimIsStale(current.deposit_refund_id)) fail("refund-in-progress");

  // A refund attempt stopped part-way long ago. Ask Stripe what happened:
  // if the refund went out, record that; if not, the deposit can be kept.
  let earlier;
  try {
    earlier = await earlierDepositRefund(invoice.stripe_intent_id);
  } catch (error) {
    console.error(`[admin] couldn't check Stripe for an earlier refund on ${invoice.id}`, error);
    fail("stripe-check-failed");
  }
  const sameClaim = { dep_status: "eq.held", deposit_refund_id: `eq.${current.deposit_refund_id}` };
  if (earlier) {
    await updateWhere(sameClaim, { dep_status: "released", deposit_refund_id: earlier.id, deposit_resolved_at: resolvedAt }, "recording an earlier refund");
    fail("already-refunded");
  }
  if (!(await updateWhere(sameClaim, { ...keep, deposit_refund_id: null }, "keeping the deposit"))) fail("already-resolved");
  throw new Redirect(withParam(returnTo, "notice", "kept"));
}

/** POST /api/admin/rentals/status: move a job along (delivery → field → pickup → completed). */
export async function rentalStatusAction(ctx) {
  await requireAdminForAction(ctx);
  const form = await ctx.form();
  const returnTo = safeReturn(form.returnTo);
  const rentalId = String(form.rentalId || "");
  const status = String(form.status || "");
  if (!/^[0-9a-f-]{36}$/i.test(rentalId) || !RENTAL_STATUSES.includes(status)) {
    throw new Redirect(withParam(returnTo, "error", "bad-request"));
  }

  let updated;
  try {
    updated = await asService().update("rentals", { id: `eq.${rentalId}` }, { status });
  } catch (error) {
    console.error(`[admin] status update failed for ${rentalId}`, error);
    throw new Redirect(withParam(returnTo, "error", "failed"));
  }
  if (!updated.length) throw new Redirect(withParam(returnTo, "error", "not-found"));
  throw new Redirect(withParam(returnTo, "notice", "status"));
}
