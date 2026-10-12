// POST /api/webhooks/stripe
//
// Stripe calls this when a payment succeeds, so bookings are confirmed even if
// the customer closed the checkout tab. Set it up in Stripe -> Developers ->
// Webhooks with the event payment_intent.succeeded (see README).

import { requireEnv } from "../env.js";
import { finalizeInvoicePayment, PaymentMismatchError } from "../payments.js";
import { constructWebhookEvent } from "../stripe.js";

export async function stripeWebhook(ctx) {
  const signature = ctx.req.headers["stripe-signature"];
  if (!signature) return ctx.json(400, { error: "Missing Stripe signature." });

  // The signature covers the exact raw body, so it must not be re-encoded.
  const payload = (await ctx.rawBody()).toString("utf8");

  let event;
  try {
    event = constructWebhookEvent(payload, signature, requireEnv("STRIPE_WEBHOOK_SECRET"));
  } catch (error) {
    console.error("[webhooks/stripe] signature check failed:", error.message);
    return ctx.json(400, { error: "Invalid signature." });
  }

  const intent = event?.data?.object;
  if (event.type === "payment_intent.succeeded" && intent?.metadata?.invoice_id) {
    try {
      const outcome = await finalizeInvoicePayment(intent.metadata.invoice_id, intent.id);
      console.info(`[webhooks/stripe] ${intent.id} -> invoice ${intent.metadata.invoice_id}: ${outcome}`);
    } catch (error) {
      if (error instanceof PaymentMismatchError) {
        // Retrying won't fix a mismatch; log it for a person to look at.
        console.error("[webhooks/stripe] payment mismatch:", error.message);
      } else {
        console.error("[webhooks/stripe] could not record payment", error);
        // A 500 makes Stripe try again later.
        return ctx.json(500, { error: "Temporary failure." });
      }
    }
  } else if (event.type === "payment_intent.payment_failed") {
    console.warn(
      `[webhooks/stripe] payment failed for invoice ${intent?.metadata?.invoice_id ?? "unknown"}: ${
        intent?.last_payment_error?.message ?? "no reason given"
      }`,
    );
  }

  return ctx.json(200, { received: true });
}
