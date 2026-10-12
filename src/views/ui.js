// Shared building blocks for pages: class strings, alerts, badges, form fields.

import { cx, html } from "../html.js";
import { icon } from "./icons.js";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700";

export const ui = {
  buttonPrimary: cx(
    "inline-flex items-center justify-center gap-2 rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-50",
    focusRing,
  ),
  buttonSecondary: cx(
    "inline-flex items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-800 shadow-sm transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50",
    focusRing,
  ),
  buttonDanger: cx(
    "inline-flex items-center justify-center gap-2 rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50",
    focusRing,
  ),
  buttonSuccess: cx(
    "inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50",
    focusRing,
  ),
  // text-base on phones stops iOS from zooming into the field.
  input:
    "block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base text-stone-900 shadow-sm placeholder:text-stone-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 aria-invalid:border-red-600 aria-invalid:ring-red-600/20 sm:text-sm",
  label: "block text-sm font-medium text-stone-800",
  hint: "mt-1 text-sm text-stone-500",
  error: "mt-1 text-sm text-red-700",
  card: "rounded-xl border border-stone-200 bg-white shadow-sm",
  link: "font-medium text-brand-700 underline-offset-2 hover:underline",
};

const ALERT_TONES = {
  error: { box: "border-red-200 bg-red-50 text-red-900", icon: "circleAlert", iconClass: "text-red-600" },
  success: { box: "border-emerald-200 bg-emerald-50 text-emerald-900", icon: "circleCheck", iconClass: "text-emerald-600" },
  info: { box: "border-sky-200 bg-sky-50 text-sky-900", icon: "info", iconClass: "text-sky-600" },
  warning: { box: "border-amber-200 bg-amber-50 text-amber-900", icon: "triangleAlert", iconClass: "text-amber-600" },
};

export function alert({ tone = "info", title, body, className = "" }) {
  const t = ALERT_TONES[tone];
  return html`<div role="${tone === "error" ? "alert" : "status"}" class="${cx("flex gap-3 rounded-lg border p-3 text-sm animate-fade-in", t.box, className)}">
    ${icon(t.icon, cx("mt-0.5 size-4 shrink-0", t.iconClass))}
    <div class="min-w-0">
      ${title ? html`<p class="font-semibold">${title}</p>` : ""}
      ${body ? html`<div class="${title ? "mt-0.5" : ""}">${body}</div>` : ""}
    </div>
  </div>`;
}

// ------------------------------------------------------------------ badges

export const RENTAL_STATUSES = ["pending_delivery", "active", "scheduled_pickup", "completed"];

export const RENTAL_STATUS_LABEL = {
  pending_delivery: "Pending delivery",
  active: "Active",
  scheduled_pickup: "Pickup scheduled",
  completed: "Completed",
};
const PAY_STATUS_LABEL = { unpaid: "Unpaid", paid: "Paid", overdue: "Overdue", refunded: "Refunded" };
const DEPOSIT_STATUS_LABEL = {
  held: "Deposit held",
  released: "Deposit refunded",
  forfeited_damage: "Deposit kept for damage",
};

const badgeBase = "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset";
const RENTAL_TONE = {
  pending_delivery: "bg-amber-50 text-amber-800 ring-amber-600/20",
  active: "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
  scheduled_pickup: "bg-sky-50 text-sky-800 ring-sky-600/20",
  completed: "bg-stone-100 text-stone-700 ring-stone-500/20",
};
const PAY_TONE = {
  unpaid: "bg-amber-50 text-amber-800 ring-amber-600/20",
  paid: "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
  overdue: "bg-red-50 text-red-800 ring-red-600/20",
  refunded: "bg-stone-100 text-stone-700 ring-stone-500/20",
};
const DEPOSIT_TONE = {
  held: "bg-brand-50 text-brand-800 ring-brand-600/20",
  released: "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
  forfeited_damage: "bg-red-50 text-red-800 ring-red-600/20",
};

export const rentalStatusBadge = (status) =>
  html`<span class="${cx(badgeBase, RENTAL_TONE[status])}">${RENTAL_STATUS_LABEL[status] ?? status}</span>`;
export const payStatusBadge = (status) =>
  html`<span class="${cx(badgeBase, PAY_TONE[status])}">${PAY_STATUS_LABEL[status] ?? status}</span>`;
export const depositStatusBadge = (status) =>
  html`<span class="${cx(badgeBase, DEPOSIT_TONE[status])}">${DEPOSIT_STATUS_LABEL[status] ?? status}</span>`;

// ------------------------------------------------------------------ forms

/** Label + control + hint/error. The control must use id=`id` and the aria attributes from fieldAria(). */
export function field({ id, label, error, hint, optional = false, control }) {
  return html`<div>
    <label for="${id}" class="${ui.label}">${label}${optional
      ? html`<span class="font-normal text-stone-500"> (optional)</span>`
      : ""}</label>
    <div class="mt-1">${control}</div>
    ${error
      ? html`<p id="${id}-error" class="${ui.error}" role="alert">${error}</p>`
      : hint
        ? html`<p id="${id}-hint" class="${ui.hint}">${hint}</p>`
        : ""}
  </div>`;
}

/** aria-invalid / aria-describedby for a control inside field(). */
export function fieldAria(id, error, hint) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : "";
  return html`aria-invalid="${error ? "true" : "false"}"${describedBy ? html` aria-describedby="${describedBy}"` : ""}`;
}
