// Payments: keeping a Stripe PaymentIntent in step with each invoice, and
// recording a payment only after Stripe itself confirms it.

import { randomUUID } from "node:crypto";

import { toCents } from "../shared/format.js";
import { stripe, StripeError } from "./stripe.js";
import { asService } from "./supabase.js";

/** The payment and the invoice don't line up. Never retried automatically. */
export class PaymentMismatchError extends Error {
  constructor(message) {
    super(message);
    this.name = "PaymentMismatchError";
  }
}

const EDITABLE_INTENT_STATUSES = new Set(["requires_payment_method", "requires_confirmation", "requires_action"]);

export function loadPayableInvoice(invoiceId) {
  return asService().first("invoices", {
    select: "id,rental_id,stripe_intent_id,amount_total,pay_status",
    id: `eq.${invoiceId}`,
  });
}

/**
 * Returns the PaymentIntent for an invoice, creating it the first time.
 * Safe to call repeatedly or from two places at once: every value sent to
 * Stripe comes from the database row, and the idempotency key is fixed per
 * invoice, so both calls get the same PaymentIntent.
 */
export async function ensurePaymentIntent(invoice) {
  const amount = toCents(invoice.amount_total);

  if (invoice.stripe_intent_id) {
    const existing = await stripe.retrievePaymentIntent(invoice.stripe_intent_id);
    if (existing.status !== "canceled") {
      // If staff corrected an unpaid invoice's amount, charge the new amount.
      if (existing.amount !== amount && EDITABLE_INTENT_STATUSES.has(existing.status)) {
        return stripe.updatePaymentIntent(existing.id, { amount });
      }
      return existing;
    }
  }

  const db = asService();
  const owner = await db.first("rental_manifest", { select: "email", invoice_id: `eq.${invoice.id}` });
  const previousIntentId = invoice.stripe_intent_id;
  const params = {
    amount,
    currency: "usd",
    payment_method_types: ["card"],
    description: `Brown Line IL LLC invoice ${invoice.id}`,
    receipt_email: owner?.email || undefined,
    metadata: { invoice_id: invoice.id, rental_id: invoice.rental_id },
  };
  const key = previousIntentId ? `invoice-${invoice.id}-replaces-${previousIntentId}` : `invoice-${invoice.id}`;

  let intent;
  try {
    intent = await stripe.createPaymentIntent(params, key);
  } catch (error) {
    // Stripe remembers an error under its idempotency key for a day and keeps
    // answering with it, so trying again needs a fresh key.
    if (!(error instanceof StripeError && error.status >= 500)) throw error;
    intent = await stripe.createPaymentIntent(params, `${key}-retry-${randomUUID()}`);
  }

  const saved = await db.update(
    "invoices",
    previousIntentId
      ? { id: `eq.${invoice.id}`, stripe_intent_id: `eq.${previousIntentId}` }
      : { id: `eq.${invoice.id}`, stripe_intent_id: "is.null" },
    { stripe_intent_id: intent.id },
  );
  if (saved.length) return intent;

  // Another request saved a payment for this invoice first (two tabs opening
  // checkout at once): always use the saved one, so the customer can only pay
  // the payment the invoice knows about.
  const current = await loadPayableInvoice(invoice.id);
  if (current?.stripe_intent_id && current.stripe_intent_id !== intent.id) {
    stripe.cancelPaymentIntent(intent.id).catch((error) => console.warn(`[payments] couldn't cancel unused payment ${intent.id}: ${error.message}`));
    return stripe.retrievePaymentIntent(current.stripe_intent_id);
  }
  return intent;
}

/**
 * Looks the PaymentIntent up with Stripe and, if the money has cleared, marks
 * the invoice paid. The database flips the rental to active in the same
 * transaction (mark_invoice_paid + the invoices_on_paid trigger).
 *
 * Used right after the customer pays, by the Stripe webhook (in case they
 * closed the tab), and by the checkout page itself. Safe to repeat.
 * Returns "paid", "processing", "requires_payment" or "refunded".
 */
export async function finalizeInvoicePayment(invoiceId, paymentIntentId) {
  let intent;
  try {
    intent = await stripe.retrievePaymentIntent(paymentIntentId);
  } catch (error) {
    if (error instanceof StripeError && error.status === 404) {
      throw new PaymentMismatchError(`Payment ${paymentIntentId} doesn't exist in this Stripe account.`);
    }
    throw error;
  }
  if (intent.metadata?.invoice_id !== invoiceId) {
    throw new PaymentMismatchError(`Payment ${paymentIntentId} is not for invoice ${invoiceId}.`);
  }

  const invoice = await loadPayableInvoice(invoiceId);
  if (!invoice) throw new PaymentMismatchError(`Invoice ${invoiceId} does not exist.`);
  if (invoice.stripe_intent_id !== intent.id) {
    throw new PaymentMismatchError(`Payment ${intent.id} is not the current payment for invoice ${invoiceId}.`);
  }

  // Already recorded (for example by the webhook a moment ago).
  if (invoice.pay_status === "paid") return "paid";
  if (invoice.pay_status === "refunded") return "refunded";

  if (intent.currency !== "usd" || intent.amount !== toCents(invoice.amount_total)) {
    throw new PaymentMismatchError(
      `Payment ${intent.id} was for ${intent.amount} ${intent.currency}, but invoice ${invoiceId} totals ${toCents(invoice.amount_total)} usd.`,
    );
  }

  if (intent.status === "succeeded") {
    const status = await asService().rpc("mark_invoice_paid", { p_invoice_id: invoiceId, p_intent_id: intent.id });
    return status === "refunded" ? "refunded" : "paid";
  }
  if (intent.status === "processing") return "processing";
  return "requires_payment";
}
