// Date helpers, shared by the server and the browser.
// Rental dates are plain calendar dates ("YYYY-MM-DD") in Chicago time, so all
// math happens in UTC to stay clear of daylight saving.

export const BUSINESS_TIME_ZONE = "America/Chicago";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** Today's calendar date in Chicago, e.g. "2026-10-09". */
export function chicagoToday(now = new Date()) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Milliseconds for midnight UTC of an ISO date, or NaN if invalid. */
function isoToUtcMs(iso) {
  const match = ISO_DATE.exec(String(iso ?? ""));
  if (!match) return Number.NaN;
  const [, y, m, d] = match;
  const ms = Date.UTC(Number(y), Number(m) - 1, Number(d));
  // Reject dates like 2026-02-31 that Date.UTC silently rolls over.
  const check = new Date(ms);
  if (
    check.getUTCFullYear() !== Number(y) ||
    check.getUTCMonth() !== Number(m) - 1 ||
    check.getUTCDate() !== Number(d)
  ) {
    return Number.NaN;
  }
  return ms;
}

export function isValidIsoDate(iso) {
  return !Number.isNaN(isoToUtcMs(iso));
}

export function addDaysIso(iso, days) {
  const ms = isoToUtcMs(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Rental days, counting both the delivery and the pickup day (same day = 1).
 * Returns 0 when a date is missing or invalid, or the end is before the start.
 */
export function rentalDays(startIso, endIso) {
  if (!startIso || !endIso) return 0;
  const start = isoToUtcMs(startIso);
  const end = isoToUtcMs(endIso);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.round((end - start) / DAY_MS) + 1;
}

/** "Sat, Oct 24, 2026" */
export function formatDate(iso) {
  const ms = isoToUtcMs(iso);
  if (Number.isNaN(ms)) return String(iso ?? "");
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(ms));
}

/** "Oct 24" */
export function formatDateShort(iso) {
  const ms = isoToUtcMs(iso);
  if (Number.isNaN(ms)) return String(iso ?? "");
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(ms));
}

/** "Wed, Oct 14 – Thu, Oct 15, 2026", or one date for a one-day rental. */
export function formatDateRange(startIso, endIso) {
  if (startIso === endIso) return formatDate(startIso);
  if (String(startIso).slice(0, 4) !== String(endIso).slice(0, 4)) {
    return `${formatDate(startIso)} – ${formatDate(endIso)}`;
  }
  const start = isoToUtcMs(startIso);
  if (Number.isNaN(start)) return `${startIso} – ${endIso}`;
  const startText = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(start));
  return `${startText} – ${formatDate(endIso)}`;
}

/** Calendar date of a database timestamp in Chicago: "Oct 9, 2026". */
export function formatTimestampDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

/** Database timestamp in Chicago time: "Oct 9, 2026, 9:59 PM". */
export function formatTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
