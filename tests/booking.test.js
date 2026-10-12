import assert from "node:assert/strict";
import { test } from "node:test";

import { eventTypeLabel, formatDeliveryAddress, stepOfField, validateBooking } from "../shared/booking.js";
import { addDaysIso, isValidIsoDate, rentalDays } from "../shared/dates.js";
import { LIABILITY_TERMS } from "../shared/legal.js";

const TODAY = "2026-10-09";
const valid = {
  unitCategory: "standard_construction",
  quantity: "4",
  startDate: "2026-10-12",
  endDate: "2026-10-30",
  eventType: "Construction site",
  eventOther: "",
  street: "233 S Wacker Dr",
  city: "Chicago",
  state: "IL",
  zip: "60606",
  acceptedTerms: "on",
};

test("a complete booking passes", () => {
  const { ok, errors, values } = validateBooking(valid, TODAY);
  assert.equal(ok, true, JSON.stringify(errors));
  assert.equal(values.acceptedTerms, true);
  assert.equal(formatDeliveryAddress(values), "233 S Wacker Dr, Chicago, IL 60606");
});

test("the liability terms can't be skipped", () => {
  for (const acceptedTerms of [undefined, "", "off", false]) {
    const { ok, errors } = validateBooking({ ...valid, acceptedTerms }, TODAY);
    assert.equal(ok, false);
    assert.equal(errors.acceptedTerms, "You must accept the liability terms to book");
  }
});

test("each field is checked", () => {
  const check = (changes) => validateBooking({ ...valid, ...changes }, TODAY).errors;
  assert.equal(check({ unitCategory: "" }).unitCategory, "Choose a unit type");
  assert.equal(check({ quantity: "0" }).quantity, "At least 1 unit");
  assert.equal(check({ quantity: "2.5" }).quantity, "Whole units only");
  assert.match(check({ quantity: "51" }).quantity, /call us/);
  assert.match(check({ startDate: TODAY }).startDate, /earliest delivery date/); // needs a day's notice
  assert.equal(check({ endDate: "2026-10-11" }).endDate, "Pickup can't be before delivery");
  assert.match(check({ endDate: "2027-12-01" }).endDate, /365 days/);
  assert.equal(check({ eventType: "Rave" }).eventType, "Choose what the units are for");
  assert.equal(check({ eventType: "Other", eventOther: "" }).eventOther, "Tell us what the event or job is");
  assert.equal(check({ street: "12" }).street, "Enter the street address");
  assert.equal(check({ state: "CA" }).state, "Choose a state");
  assert.equal(check({ zip: "6060" }).zip, "Enter a 5-digit ZIP code");
});

test("errors point the wizard at the right step", () => {
  assert.equal(stepOfField("quantity"), 0);
  assert.equal(stepOfField("zip"), 1);
  assert.equal(stepOfField("acceptedTerms"), 2);
});

test("'Other' events are saved as their description", () => {
  assert.equal(eventTypeLabel("Other", "Graduation party"), "Graduation party");
  assert.equal(eventTypeLabel("Wedding", "ignored"), "Wedding");
});

test("dates count both the delivery and pickup day", () => {
  assert.equal(rentalDays("2026-10-12", "2026-10-12"), 1);
  assert.equal(rentalDays("2026-12-30", "2027-01-02"), 4);
  assert.equal(addDaysIso("2026-02-27", 2), "2026-03-01");
  assert.equal(isValidIsoDate("2026-02-30"), false);
  assert.equal(isValidIsoDate("2028-02-29"), true);
});

test("the liability terms are the approved wording", () => {
  assert.equal(
    LIABILITY_TERMS,
    "By submitting this operational ledger, Customer explicitly assumes full financial and civil liability for any theft, graffiti, tip-overs, vandalism, or structural damage to all Brown Line IL LLC equipment while deployed at the specified delivery location. Customer acknowledges that a mandatory $50.00 security deposit is collected upfront per transaction. This deposit will be securely held in escrow and fully released back to the original payment method upon post-rental inspection, provided the equipment is returned free of damage. Customer agrees to reimburse Brown Line IL LLC at fair market replacement value for any destroyed units if damage metrics exceed the $50.00 deposit baseline. All deployment configurations strictly adhere to OSHA standard 1926.51 sanitation requirements.",
  );
});

test("a booking date range always ends on a real date", () => {
  let day = "2026-01-01";
  for (let i = 0; i < 800; i++) {
    assert.ok(isValidIsoDate(day), day);
    day = addDaysIso(day, 1);
  }
  assert.equal(day, "2028-03-11");
});
