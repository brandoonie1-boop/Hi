// Stripe over plain HTTPS (no SDK), plus webhook signature checking.

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { requireEnv } from "./env.js";

export class StripeError extends Error {
  constructor(message, status, type, code) {
    super(message);
    this.name = "StripeError";
    this.status = status;
    this.type = type;
    this.code = code;
  }
}

const apiBase = () => (process.env.STRIPE_API_BASE || "https://api.stripe.com").replace(/\/$/, "");

/**
 * The Stripe API version this code is written for. Pinning it means the site
 * keeps working the same way even if the account's default version is
 * upgraded later. (Newer versions are phasing out payment_method_types.)
 * The Stripe webhook endpoint uses this same version.
 */
export const STRIPE_API_VERSION = "2025-03-31.basil";

/** Stripe's form encoding: metadata[invoice_id]=..., payment_method_types[0]=card */
function encodeForm(params, prefix = "", out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) value.forEach((item, i) => out.append(`${name}[${i}]`, String(item)));
    else if (typeof value === "object") encodeForm(value, name, out);
    else out.append(name, String(value));
  }
  return out;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(method, path, params, idempotencyKey) {
  const url = new URL(apiBase() + path);
  const body = method === "GET" ? undefined : encodeForm(params).toString();
  if (method === "GET") encodeForm(params).forEach((value, key) => url.searchParams.append(key, value));

  const headers = { Authorization: `Bearer ${requireEnv("STRIPE_SECRET_KEY")}`, "Stripe-Version": STRIPE_API_VERSION };
  if (body !== undefined) headers["Content-Type"] = "application/x-www-form-urlencoded";
  // Every write gets an idempotency key, so retrying after a network blip is safe.
  if (method !== "GET") headers["Idempotency-Key"] = idempotencyKey || randomUUID();

  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(20_000) });
    } catch (error) {
      if (attempt < 2) {
        await sleep(300 * 2 ** attempt);
        continue;
      }
      throw new StripeError(`Couldn't reach Stripe: ${error.message}`, 0, "api_connection_error");
    }

    // 409: the same request (same idempotency key) is still being handled;
    // asking again shortly gets its result.
    if ((response.status === 409 || response.status === 429 || response.status >= 500) && attempt < 2) {
      await sleep(300 * 2 ** attempt);
      continue;
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = data.error || {};
      throw new StripeError(error.message || `Stripe request failed (${response.status})`, response.status, error.type, error.code);
    }
    return data;
  }
}

export const stripe = {
  createPaymentIntent: (params, idempotencyKey) => request("POST", "/v1/payment_intents", params, idempotencyKey),
  retrievePaymentIntent: (id) => request("GET", `/v1/payment_intents/${encodeURIComponent(id)}`),
  updatePaymentIntent: (id, params) => request("POST", `/v1/payment_intents/${encodeURIComponent(id)}`, params),
  cancelPaymentIntent: (id) => request("POST", `/v1/payment_intents/${encodeURIComponent(id)}/cancel`, {}),
  createRefund: (params, idempotencyKey) => request("POST", "/v1/refunds", params, idempotencyKey),
  listRefunds: (paymentIntentId) =>
    request("GET", "/v1/refunds", { payment_intent: paymentIntentId, limit: 100 }),
};

/**
 * Verifies the Stripe-Signature header against the raw request body and
 * returns the parsed event. Throws if the signature is wrong or too old.
 */
export function constructWebhookEvent(payload, signatureHeader, secret, toleranceSeconds = 300) {
  let timestamp = null;
  const signatures = [];
  for (const part of String(signatureHeader || "").split(",")) {
    const [key, value] = part.split("=", 2).map((s) => s && s.trim());
    if (key === "t") timestamp = Number(value);
    if (key === "v1" && value) signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) throw new Error("Malformed Stripe-Signature header");

  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const valid = signatures.some((signature) => {
    const candidate = Buffer.from(signature, "utf8");
    return candidate.length === expectedBuffer.length && timingSafeEqual(candidate, expectedBuffer);
  });
  if (!valid) throw new Error("Stripe signature doesn't match");
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) throw new Error("Stripe signature is too old");

  return JSON.parse(payload);
}
