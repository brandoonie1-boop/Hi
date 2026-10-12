// Money helpers, shared by the server and the browser.

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** 60125 -> "$601.25" */
export function formatCents(cents) {
  return usd.format(cents / 100);
}

/** Price-list style: 12500 -> "$125", 12550 -> "$125.50". */
export function formatRate(cents) {
  return cents % 100 === 0 ? `$${(cents / 100).toLocaleString("en-US")}` : formatCents(cents);
}

/** Database numeric (dollars, sometimes a string) -> integer cents. */
export function toCents(amount) {
  if (amount === null || amount === undefined || amount === "") return 0;
  const value = typeof amount === "string" ? Number(amount) : amount;
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

/** Database numeric -> "$601.25" */
export function formatDollars(amount) {
  return formatCents(toCents(amount));
}

/** 60125 -> "601.25", for writing numeric columns without float noise. */
export function centsToDecimal(cents) {
  return (cents / 100).toFixed(2);
}

export function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}
