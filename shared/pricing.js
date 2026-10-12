// Pricing for Brown Line IL LLC. Shared by the booking page (live price
// preview in the browser) and the server (the invoice that actually gets
// charged), so the customer always sees exactly what they will pay.
//
// To change prices, edit UNIT_CATALOG below. Amounts are in cents.

import { rentalDays } from "./dates.js";

export const UNIT_CATEGORIES = ["standard_construction", "deluxe_event", "ada_compliant", "handwashing_station"];

// Rates include delivery, placement, pickup, and weekly servicing and
// restocking on rentals of a week or longer.
export const UNIT_CATALOG = {
  standard_construction: {
    name: "Standard Construction Unit",
    icon: "hardHat",
    summary: "Tough single-stall unit for job sites and long-term placements.",
    features: ["Seat and urinal", "Hand sanitizer dispenser", "Locking door with occupancy indicator"],
    rates: { dayCents: 12_500, weekCents: 17_500, cycleCents: 22_500 },
  },
  deluxe_event: {
    name: "Deluxe Event Unit",
    icon: "sparkles",
    summary: "Flushing unit with a sink and mirror for guests.",
    features: ["Foot-pump flush", "Fresh-water sink and soap", "Mirror, coat hook and interior light"],
    rates: { dayCents: 29_500, weekCents: 39_500, cycleCents: 52_500 },
  },
  ada_compliant: {
    name: "ADA-Compliant Unit",
    icon: "accessibility",
    summary: "Wheelchair-accessible unit with a ground-level entry and grab bars.",
    features: ["Ground-level entry", "Grab bars", "Room to turn a wheelchair"],
    rates: { dayCents: 17_500, weekCents: 22_500, cycleCents: 29_500 },
  },
  handwashing_station: {
    name: "Handwashing Station",
    icon: "droplets",
    summary: "Freestanding two-sided sink station with foot pumps.",
    features: ["Two foot-pump sinks", "Soap and paper towels", "Refilled on every service visit"],
    rates: { dayCents: 9_500, weekCents: 13_500, cycleCents: 17_500 },
  },
};

/** Mandatory refundable security deposit, charged once per booking. */
export const SECURITY_DEPOSIT_CENTS = 5_000;

/** 10.25% Cook County rental tax, in basis points (1/100 of a percent). */
export const TAX_RATE_BASIS_POINTS = 1_025;
export const TAX_LABEL = "Cook County rental tax (10.25%)";

export const MAX_QUANTITY = 50;
export const MAX_RENTAL_DAYS = 365;
/** Earliest delivery is this many days after today (Chicago time). */
export const MIN_LEAD_DAYS = 1;

export function isUnitCategory(value) {
  return typeof value === "string" && UNIT_CATEGORIES.includes(value);
}

/**
 * Cheapest mix of 28-day cycles, weeks and single days that covers the
 * rental, per unit. A 5-day event is billed as one week if that is cheaper
 * than five day rates, a 10-day job as one 28-day cycle, and so on.
 */
export function pricePeriod(rates, days) {
  if (!Number.isInteger(days) || days < 1) return { cents: 0, breakdown: { cycles: 0, weeks: 0, days: 0 } };

  // best[d] = lowest price that covers d days; pick[d] = last block used.
  const best = new Array(days + 1).fill(0);
  const pick = new Array(days + 1).fill("day");

  for (let d = 1; d <= days; d++) {
    // Longer blocks are checked first so they win ties.
    let price = best[Math.max(0, d - 28)] + rates.cycleCents;
    let choice = "cycle";

    const byWeek = best[Math.max(0, d - 7)] + rates.weekCents;
    if (byWeek < price) {
      price = byWeek;
      choice = "week";
    }

    const byDay = best[d - 1] + rates.dayCents;
    if (byDay < price) {
      price = byDay;
      choice = "day";
    }

    best[d] = price;
    pick[d] = choice;
  }

  const breakdown = { cycles: 0, weeks: 0, days: 0 };
  let remaining = days;
  while (remaining > 0) {
    const choice = pick[remaining];
    if (choice === "cycle") {
      breakdown.cycles += 1;
      remaining = Math.max(0, remaining - 28);
    } else if (choice === "week") {
      breakdown.weeks += 1;
      remaining = Math.max(0, remaining - 7);
    } else {
      breakdown.days += 1;
      remaining -= 1;
    }
  }

  return { cents: best[days], breakdown };
}

/** "one weekly rate", "one 28-day rate + 2 daily rates" */
export function describeBreakdown(breakdown) {
  const parts = [];
  if (breakdown.cycles) parts.push(breakdown.cycles === 1 ? "one 28-day rate" : `${breakdown.cycles} 28-day rates`);
  if (breakdown.weeks) parts.push(breakdown.weeks === 1 ? "one weekly rate" : `${breakdown.weeks} weekly rates`);
  if (breakdown.days) parts.push(breakdown.days === 1 ? "one daily rate" : `${breakdown.days} daily rates`);
  return parts.join(" + ");
}

/** Days paid for by the chosen rates (can exceed the rental when that's cheaper). */
export function coveredDays(breakdown) {
  return breakdown.cycles * 28 + breakdown.weeks * 7 + breakdown.days;
}

/** Tax on a rental amount, rounded half-up to the cent. */
export function taxOn(cents) {
  return Math.floor((cents * TAX_RATE_BASIS_POINTS + 5_000) / 10_000);
}

/**
 * Full price for a booking, or null if the details aren't complete yet.
 * Returns { unitCategory, quantity, days, perUnit, rentalCents, taxCents,
 * depositCents, totalCents }, matching the invoice columns.
 */
export function quoteBooking({ unitCategory, quantity, startDate, endDate }) {
  if (!isUnitCategory(unitCategory)) return null;
  if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    return null;
  }

  const days = rentalDays(startDate, endDate);
  if (days < 1 || days > MAX_RENTAL_DAYS) return null;

  const perUnit = pricePeriod(UNIT_CATALOG[unitCategory].rates, days);
  const rentalCents = perUnit.cents * quantity;
  const taxCents = taxOn(rentalCents);

  return {
    unitCategory,
    quantity,
    days,
    perUnit,
    rentalCents,
    taxCents,
    depositCents: SECURITY_DEPOSIT_CENTS,
    totalCents: rentalCents + taxCents + SECURITY_DEPOSIT_CENTS,
  };
}
