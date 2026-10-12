// Booking form rules, shared by the server (the real check) and the browser
// (instant feedback while stepping through the form).

import { addDaysIso, chicagoToday, formatDate, isValidIsoDate, rentalDays } from "./dates.js";
import { isUnitCategory, MAX_QUANTITY, MAX_RENTAL_DAYS, MIN_LEAD_DAYS } from "./pricing.js";

export const EVENT_TYPES = [
  "Construction site",
  "Wedding",
  "Festival or concert",
  "Block party",
  "Sporting event",
  "Private party",
  "Corporate event",
  "Other",
];

/** Chicagoland reaches into northwest Indiana and southeast Wisconsin. */
export const SERVICE_STATES = ["IL", "IN", "WI"];

export const BOOKING_STEPS = [
  { title: "Units", fields: ["unitCategory", "quantity"] },
  {
    title: "Dates & site",
    fields: ["startDate", "endDate", "eventType", "eventOther", "street", "city", "state", "zip"],
  },
  { title: "Review & agree", fields: ["acceptedTerms"] },
];

export function stepOfField(field) {
  const index = BOOKING_STEPS.findIndex((step) => step.fields.includes(field));
  return index === -1 ? 0 : index;
}

/**
 * Checks the raw form fields (all strings, as a browser sends them).
 * Returns { ok, values, errors } where errors maps a field name to a message.
 */
export function validateBooking(input, today = chicagoToday()) {
  const text = (key) => String(input?.[key] ?? "").trim();
  const terms = input?.acceptedTerms;

  const values = {
    unitCategory: text("unitCategory"),
    quantity: text("quantity"),
    startDate: text("startDate"),
    endDate: text("endDate"),
    eventType: text("eventType"),
    eventOther: text("eventOther"),
    street: text("street"),
    city: text("city"),
    state: text("state") || "IL",
    zip: text("zip"),
    acceptedTerms: terms === true || terms === "on" || terms === "true",
  };
  const errors = {};

  if (!isUnitCategory(values.unitCategory)) errors.unitCategory = "Choose a unit type";

  const quantity = Number(values.quantity);
  if (values.quantity === "" || !Number.isFinite(quantity)) errors.quantity = "Enter how many units you need";
  else if (!Number.isInteger(quantity)) errors.quantity = "Whole units only";
  else if (quantity < 1) errors.quantity = "At least 1 unit";
  else if (quantity > MAX_QUANTITY) errors.quantity = `For more than ${MAX_QUANTITY} units, call us for a quote`;

  const earliest = addDaysIso(today, MIN_LEAD_DAYS);
  const startOk = isValidIsoDate(values.startDate);
  if (!startOk) errors.startDate = "Choose a delivery date";
  else if (values.startDate < earliest) errors.startDate = `The earliest delivery date is ${formatDate(earliest)}`;

  if (!isValidIsoDate(values.endDate)) errors.endDate = "Choose a pickup date";
  else if (startOk && values.endDate < values.startDate) errors.endDate = "Pickup can't be before delivery";
  else if (startOk && rentalDays(values.startDate, values.endDate) > MAX_RENTAL_DAYS) {
    errors.endDate = `Book up to ${MAX_RENTAL_DAYS} days at a time`;
  }

  if (!EVENT_TYPES.includes(values.eventType)) errors.eventType = "Choose what the units are for";
  else if (values.eventType === "Other" && values.eventOther.length < 2) errors.eventOther = "Tell us what the event or job is";
  if (values.eventType === "Other" && values.eventOther.length > 60) errors.eventOther = "Keep it under 60 characters";

  if (values.street.length < 5) errors.street = "Enter the street address";
  else if (values.street.length > 150) errors.street = "That address is too long";

  if (values.city.length < 2) errors.city = "Enter the city";
  else if (values.city.length > 60) errors.city = "That city name is too long";

  if (!SERVICE_STATES.includes(values.state)) errors.state = "Choose a state";
  if (!/^\d{5}$/.test(values.zip)) errors.zip = "Enter a 5-digit ZIP code";

  if (!values.acceptedTerms) errors.acceptedTerms = "You must accept the liability terms to book";

  return { ok: Object.keys(errors).length === 0, values, errors };
}

export function formatDeliveryAddress({ street, city, state, zip }) {
  return `${street}, ${city}, ${state} ${zip}`;
}

export function eventTypeLabel(eventType, eventOther) {
  return eventType === "Other" ? eventOther : eventType;
}
