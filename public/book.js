// Booking page: turns the server-rendered form into a 3-step wizard with a
// live price. The server still re-checks and prices everything on submit.

import { BOOKING_STEPS, eventTypeLabel, formatDeliveryAddress, stepOfField, validateBooking } from "/shared/booking.js";
import { formatDate } from "/shared/dates.js";
import { formatCents, plural } from "/shared/format.js";
import { coveredDays, describeBreakdown, isUnitCategory, MAX_QUANTITY, quoteBooking, TAX_LABEL, UNIT_CATALOG } from "/shared/pricing.js";

const form = document.getElementById("booking-form");
if (form) setUp(form);

function setUp(form) {
  const sections = [...form.querySelectorAll("[data-step]")];
  const backButton = form.querySelector("[data-back]");
  const nextButton = form.querySelector("[data-next]");
  const submitButton = form.querySelector("[data-submit]");
  const lastStep = BOOKING_STEPS.length - 1;
  let step = Number(form.dataset.initialStep) || 0;

  function readValues() {
    const data = new FormData(form);
    const text = (name) => String(data.get(name) ?? "");
    return {
      unitCategory: text("unitCategory"),
      quantity: text("quantity"),
      startDate: text("startDate"),
      endDate: text("endDate"),
      eventType: text("eventType"),
      eventOther: text("eventOther"),
      street: text("street"),
      city: text("city"),
      state: text("state"),
      zip: text("zip"),
      acceptedTerms: data.get("acceptedTerms") === "on",
    };
  }

  // ---------------------------------------------------------------- errors

  function showErrors(errors, fields) {
    for (const name of fields) {
      const message = errors[name] || "";
      form.querySelectorAll(`[data-error-for="${name}"]`).forEach((line) => {
        line.textContent = message;
        line.hidden = !message;
      });
      const control = form.elements.namedItem(name);
      if (control instanceof HTMLElement) control.setAttribute("aria-invalid", message ? "true" : "false");
      if (name === "acceptedTerms") {
        const box = form.querySelector("[data-terms-box]");
        box.classList.toggle("border-red-300", Boolean(message));
        box.classList.toggle("bg-red-50", Boolean(message));
        box.classList.toggle("border-stone-200", !message);
      }
    }
  }

  function focusField(name) {
    const control = form.elements.namedItem(name);
    const target = control instanceof RadioNodeList ? control[0] : control;
    if (!target) return;
    target.focus({ preventScroll: true });
    (target.closest("label, div") || target).scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // ---------------------------------------------------------------- steps

  function updateIndicator() {
    document.querySelectorAll("[data-step-item]").forEach((item) => {
      const index = Number(item.dataset.stepItem);
      const done = index < step;
      const active = index === step;
      if (active) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");

      const dot = item.querySelector("[data-step-dot]");
      dot.classList.toggle("bg-brand-700", done || active);
      dot.classList.toggle("text-white", done || active);
      dot.classList.toggle("bg-stone-200", !done && !active);
      dot.classList.toggle("text-stone-600", !done && !active);
      dot.classList.toggle("ring-4", active);
      dot.classList.toggle("ring-brand-100", active);

      item.querySelector("[data-step-number]").hidden = done;
      const check = item.querySelector("[data-step-check]");
      check.hidden = !done;
      check.classList.toggle("animate-pop-in", done);

      const label = item.querySelector("[data-step-label]");
      label.classList.toggle("text-stone-900", active);
      label.classList.toggle("text-stone-500", !active);

      const line = item.querySelector("[data-step-line]");
      if (line) {
        line.classList.toggle("bg-brand-700", done);
        line.classList.toggle("bg-stone-200", !done);
      }
    });
  }

  function setStep(next, { scroll = true } = {}) {
    step = Math.max(0, Math.min(lastStep, next));
    sections.forEach((section, index) => {
      const visible = index === step;
      section.classList.toggle("js:hidden", !visible);
      if (visible) {
        section.classList.remove("animate-fade-in");
        void section.offsetWidth; // restart the fade
        section.classList.add("animate-fade-in");
      }
    });
    backButton.hidden = step === 0;
    nextButton.hidden = step === lastStep;
    submitButton.hidden = step !== lastStep;
    updateIndicator();
    if (step === lastStep) renderReview();
    updateSubmitState();
    if (scroll) form.closest("main")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  nextButton.addEventListener("click", () => {
    const { errors } = validateBooking(readValues());
    const fields = BOOKING_STEPS[step].fields;
    showErrors(errors, fields);
    const firstProblem = fields.find((name) => errors[name]);
    if (firstProblem) {
      focusField(firstProblem);
      return;
    }
    setStep(step + 1);
  });
  backButton.addEventListener("click", () => setStep(step - 1));
  form.querySelectorAll("[data-go-step]").forEach((button) =>
    button.addEventListener("click", () => setStep(Number(button.dataset.goStep))),
  );

  // ---------------------------------------------------------------- live updates

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function updatePrice() {
    const values = readValues();
    const unit = isUnitCategory(values.unitCategory) ? UNIT_CATALOG[values.unitCategory] : null;
    const quantity = Number(values.quantity);
    const quote = quoteBooking({
      unitCategory: values.unitCategory,
      quantity,
      startDate: values.startDate,
      endDate: values.endDate,
    });

    document.querySelector("[data-price-unit]").hidden = !unit;
    document.querySelector("[data-price-pick-unit]").hidden = Boolean(unit);
    document.querySelectorAll("[data-unit-icon]").forEach((node) => {
      node.hidden = node.dataset.unitIcon !== values.unitCategory;
    });
    if (unit) {
      document.querySelector("[data-price-unit-name]").textContent = unit.name;
      document.querySelector("[data-price-unit-quantity]").textContent =
        Number.isInteger(quantity) && quantity > 0 ? plural(quantity, "unit") : "Choose a quantity";
    }

    const lines = document.querySelector("[data-price-lines]");
    lines.replaceChildren();
    if (quote) {
      const rental = el("div", "flex items-start justify-between gap-3");
      const label = el("dt", "text-stone-600", "Rental");
      const covered = coveredDays(quote.perUnit.breakdown) > quote.days ? " (cheaper than daily rates)" : "";
      label.append(
        el(
          "span",
          "block text-xs text-stone-500",
          `${plural(quote.quantity, "unit")} × ${plural(quote.days, "day")}, at ${describeBreakdown(quote.perUnit.breakdown)} per unit${covered}`,
        ),
      );
      rental.append(label, el("dd", "font-medium text-stone-900", formatCents(quote.rentalCents)));
      const tax = el("div", "flex items-start justify-between gap-3");
      tax.append(el("dt", "text-stone-600", TAX_LABEL), el("dd", "font-medium text-stone-900", formatCents(quote.taxCents)));
      lines.append(rental, tax);
    }
    document.querySelector("[data-price-pick-dates]").hidden = !(unit && !quote);

    const total = document.querySelector("[data-price-total]");
    const totalText = quote ? formatCents(quote.totalCents) : "—";
    if (total.textContent !== totalText) {
      total.textContent = totalText;
      total.classList.remove("animate-fade-in");
      void total.offsetWidth;
      total.classList.add("animate-fade-in");
    }
    document.querySelector("[data-mobile-total]").hidden = !quote;
    document.querySelector("[data-mobile-total-value]").textContent = quote ? formatCents(quote.totalCents) : "";

    document.querySelector("[data-rental-length]").hidden = !quote;
    document.querySelector("[data-rental-length-value]").textContent = quote ? plural(quote.days, "day") : "";
  }

  function renderReview() {
    const values = readValues();
    const unit = isUnitCategory(values.unitCategory) ? UNIT_CATALOG[values.unitCategory] : null;
    const quantity = Number(values.quantity);
    const quote = quoteBooking({ unitCategory: values.unitCategory, quantity, startDate: values.startDate, endDate: values.endDate });
    const set = (key, text) => {
      const node = form.querySelector(`[data-review="${key}"]`);
      if (node) node.textContent = text;
    };
    set("unit", unit ? unit.name : "Not chosen");
    set("quantity", Number.isInteger(quantity) && quantity > 0 ? plural(quantity, "unit") : "Not chosen");
    set("start", values.startDate ? formatDate(values.startDate) : "Not chosen");
    set("end", values.endDate ? formatDate(values.endDate) : "Not chosen");
    set("length", quote ? plural(quote.days, "day") : "Not chosen");
    set("event", values.eventType ? eventTypeLabel(values.eventType, values.eventOther) || "Not chosen" : "Not chosen");
    set("address", values.street && values.city && values.zip ? formatDeliveryAddress(values) : "Not entered");
  }

  function updateSubmitState() {
    // The payment button stays off until the liability terms are accepted.
    submitButton.disabled = !form.elements.namedItem("acceptedTerms").checked;
  }

  function onChange(event) {
    const name = event.target.name;
    const startInput = form.elements.namedItem("startDate");
    const endInput = form.elements.namedItem("endDate");

    if (name === "startDate") {
      endInput.min = startInput.value || startInput.min;
      if (startInput.value && (!endInput.value || endInput.value < startInput.value)) endInput.value = startInput.value;
    }
    if (name === "eventType") {
      form.querySelector("[data-event-other]").classList.toggle("js:hidden", event.target.value !== "Other");
    }

    // Clear an error as soon as the field is fixed (new errors wait for Continue).
    if (name) {
      const { errors } = validateBooking(readValues());
      const related = name === "startDate" || name === "endDate" ? ["startDate", "endDate"] : [name];
      showErrors(
        errors,
        related.filter((field) => !errors[field]),
      );
    }
    updatePrice();
    if (name === "acceptedTerms") updateSubmitState();
  }
  form.addEventListener("input", onChange);
  form.addEventListener("change", onChange);

  form.querySelectorAll("[data-quantity-step]").forEach((button) =>
    button.addEventListener("click", () => {
      const input = form.elements.namedItem("quantity");
      const current = Number(input.value);
      const next = Math.min(MAX_QUANTITY, Math.max(1, (Number.isFinite(current) ? current : 0) + Number(button.dataset.quantityStep)));
      input.value = String(next);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }),
  );

  form.addEventListener("submit", (event) => {
    if (step !== lastStep) {
      // Enter key on an earlier step means "Continue".
      event.preventDefault();
      nextButton.click();
      return;
    }
    const { errors } = validateBooking(readValues());
    const problems = Object.keys(errors);
    if (problems.length) {
      event.preventDefault();
      const allFields = BOOKING_STEPS.flatMap((s) => s.fields);
      showErrors(errors, allFields);
      const first = allFields.find((name) => errors[name]);
      setStep(stepOfField(first), { scroll: false });
      focusField(first);
      return;
    }
    // Valid: let the browser post the form. Show progress and block double clicks.
    submitButton.disabled = true;
    submitButton.querySelector("[data-submit-idle]").hidden = true;
    submitButton.querySelector("[data-submit-busy]").hidden = false;
  });

  // Coming back with the browser's Back button can restore a disabled button.
  window.addEventListener("pageshow", () => {
    submitButton.querySelector("[data-submit-idle]").hidden = false;
    submitButton.querySelector("[data-submit-busy]").hidden = true;
    updateSubmitState();
    updatePrice();
  });

  setStep(step, { scroll: false });
  updatePrice();
}
