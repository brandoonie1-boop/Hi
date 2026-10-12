import assert from "node:assert/strict";
import { test } from "node:test";

import { formatCents } from "../shared/format.js";
import { describeBreakdown, pricePeriod, quoteBooking, SECURITY_DEPOSIT_CENTS, taxOn, UNIT_CATALOG } from "../shared/pricing.js";

const standard = UNIT_CATALOG.standard_construction.rates; // $125 day, $175 week, $225 / 28 days

test("each rental length gets the cheapest mix of rates", () => {
  assert.equal(pricePeriod(standard, 1).cents, 12_500);
  // Two daily rates ($250) cost more than one weekly rate ($175).
  assert.equal(pricePeriod(standard, 2).cents, 17_500);
  assert.equal(describeBreakdown(pricePeriod(standard, 2).breakdown), "one weekly rate");
  assert.equal(pricePeriod(standard, 7).cents, 17_500);
  // A 28-day rate ($225) beats a week plus a day ($300).
  assert.equal(pricePeriod(standard, 8).cents, 22_500);
  assert.equal(pricePeriod(standard, 28).cents, 22_500);
  // 29 days: one 28-day rate plus one daily rate.
  assert.deepEqual(pricePeriod(standard, 29), { cents: 35_000, breakdown: { cycles: 1, weeks: 0, days: 1 } });
});

test("longer rentals never cost less than shorter ones", () => {
  for (const { rates } of Object.values(UNIT_CATALOG)) {
    let previous = 0;
    for (let days = 1; days <= 365; days++) {
      const { cents } = pricePeriod(rates, days);
      assert.ok(cents >= previous, `${days} days cost less than ${days - 1}`);
      previous = cents;
    }
  }
});

test("tax is 10.25% of the rental, rounded to the nearest cent", () => {
  assert.equal(taxOn(52_500), 5_381); // $53.8125
  assert.equal(taxOn(200), 21); // $0.205 rounds up
  assert.equal(taxOn(0), 0);
});

test("a quote adds rental, tax and the $50 deposit", () => {
  const quote = quoteBooking({ unitCategory: "standard_construction", quantity: 3, startDate: "2026-11-02", endDate: "2026-11-08" });
  assert.equal(quote.days, 7);
  assert.equal(quote.rentalCents, 52_500);
  assert.equal(quote.taxCents, 5_381);
  assert.equal(quote.depositCents, SECURITY_DEPOSIT_CENTS);
  assert.equal(quote.totalCents, 52_500 + 5_381 + 5_000);
  assert.equal(formatCents(quote.totalCents), "$628.81");
});

test("bad bookings get no quote", () => {
  const base = { unitCategory: "deluxe_event", quantity: 2, startDate: "2026-11-02", endDate: "2026-11-03" };
  assert.ok(quoteBooking(base));
  assert.equal(quoteBooking({ ...base, unitCategory: "gold_plated" }), null);
  assert.equal(quoteBooking({ ...base, quantity: 0 }), null);
  assert.equal(quoteBooking({ ...base, quantity: 51 }), null);
  assert.equal(quoteBooking({ ...base, quantity: 1.5 }), null);
  assert.equal(quoteBooking({ ...base, endDate: "2026-11-01" }), null);
  assert.equal(quoteBooking({ ...base, endDate: "2027-11-02" }), null); // over 365 days
});
