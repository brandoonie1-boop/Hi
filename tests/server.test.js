import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import { html, jsonScript, raw } from "../src/html.js";
import { createRouter, isSameOrigin, parseCookies } from "../src/http.js";
import { clientIp, overLimit, tooManyAttempts, visitorKey } from "../src/rate-limit.js";
import { refreshWindowSeconds, safeNext, tokenSecondsLeft } from "../src/session.js";
import { constructWebhookEvent } from "../src/stripe.js";

test("customer text can't inject markup", () => {
  const name = `<img src=x onerror="alert(1)">`;
  assert.equal(String(html`<p>${name}</p>`), "<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>");
  assert.equal(String(html`<p>${raw("<b>ok</b>")}</p>`), "<p><b>ok</b></p>");
  assert.equal(String(html`${[html`<i>a</i>`, "<b>"]}${null}${false}`), "<i>a</i>&lt;b&gt;");
  const tag = String(jsonScript("data", { note: "</script><script>alert(1)</script> " }));
  assert.ok(!tag.slice(0, -"</script>".length).includes("</script>"));
  assert.ok(!tag.includes(" "));
});

test("cookies and routes", () => {
  assert.deepEqual(parseCookies("bl_at=abc; bl_rt=d%3De; bl_at=second"), { bl_at: "abc", bl_rt: "d=e" });
  const router = createRouter();
  const handler = () => {};
  router.get("/checkout/:invoiceId", handler);
  assert.deepEqual(router.match("GET", "/checkout/BL-IL-2026-00001"), { handler, params: { invoiceId: "BL-IL-2026-00001" } });
  assert.deepEqual(router.match("POST", "/checkout/x"), { methodNotAllowed: true });
  assert.equal(router.match("GET", "/checkout/%E0%A4%A"), null);
  assert.equal(router.match("GET", "/nope"), null);
});

test("form posts must come from this site", () => {
  process.env.SITE_URL = "https://brownline.example";
  const ctx = (headers) => ({ req: { headers: { host: "brownline.example", ...headers } } });
  assert.equal(isSameOrigin(ctx({ origin: "https://brownline.example" })), true);
  assert.equal(isSameOrigin(ctx({})), true);
  assert.equal(isSameOrigin(ctx({ origin: "https://evil.example" })), false);
  assert.equal(isSameOrigin(ctx({ origin: "https://brownline.example", "sec-fetch-site": "cross-site" })), false);
  delete process.env.SITE_URL;
});

test("sign-in redirects stay on this site", () => {
  assert.equal(safeNext("/rentals/new"), "/rentals/new");
  assert.equal(safeNext("//evil.example"), "/rentals");
  assert.equal(safeNext("/\\evil.example"), "/rentals");
  assert.equal(safeNext("https://evil.example"), "/rentals");
  assert.equal(safeNext(""), "/rentals");
  // Browsers drop tabs and newlines from addresses, which would turn these into "//evil.example".
  assert.equal(safeNext("/\t/evil.example"), "/rentals");
  assert.equal(safeNext("/\n/evil.example"), "/rentals");
  assert.equal(safeNext("/checkout/BL-IL-2026-00001?x=1"), "/checkout/BL-IL-2026-00001?x=1");
  // Dot segments that collapse into "//evil.example".
  assert.equal(safeNext("/.//evil.example"), "/rentals");
  assert.equal(safeNext("/..//evil.example"), "/rentals");
  assert.equal(safeNext("/%2e%2e//evil.example"), "/rentals");
});

test("visitors are told apart by the address your host's proxy saw", () => {
  const ctx = (xff) => ({ req: { headers: xff ? { "x-forwarded-for": xff } : {}, socket: { remoteAddress: "10.0.0.9" } } });
  delete process.env.TRUSTED_PROXY_HOPS;
  // The visitor can put anything at the start; the proxy adds the real address at the end.
  assert.equal(clientIp(ctx("6.6.6.6, 203.0.113.7")), "203.0.113.7");
  assert.equal(clientIp(ctx("")), "10.0.0.9");
  process.env.TRUSTED_PROXY_HOPS = "0";
  assert.equal(clientIp(ctx("6.6.6.6")), "10.0.0.9");
  delete process.env.TRUSTED_PROXY_HOPS;
});

test("attempt limits", () => {
  const key = `test-${Math.random()}`;
  const results = Array.from({ length: 4 }, () => tooManyAttempts(key, { limit: 3, windowSeconds: 60 }));
  assert.deepEqual(results, [false, false, false, true]);

  // Each visitor has its own count, so one person can't lock others out.
  const ctx = (ip) => ({ req: { headers: { "x-forwarded-for": ip }, socket: {} } });
  const limit = { limit: 2, windowSeconds: 60 };
  const action = `test-${Math.random()}`;
  assert.equal(overLimit(ctx("203.0.113.1"), action, limit), false);
  assert.equal(overLimit(ctx("203.0.113.1"), action, limit), false);
  assert.equal(overLimit(ctx("203.0.113.1"), action, limit), true);
  assert.equal(overLimit(ctx("203.0.113.2"), action, limit), false);
});

test("one IPv6 network counts as one visitor", () => {
  const key = (ip) => visitorKey({ req: { headers: { "x-forwarded-for": ip }, socket: {} } });
  assert.equal(key("2001:db8:abcd:12:1:2:3:4"), key("2001:db8:abcd:12:ffff::9"));
  assert.notEqual(key("2001:db8:abcd:12::1"), key("2001:db8:abcd:13::1"));
  assert.equal(key("2001:db8:abcd:12::1"), "2001:db8:abcd:12::/64");
  assert.equal(key("::ffff:203.0.113.9"), "203.0.113.9");
  assert.equal(key("203.0.113.9:51234"), "203.0.113.9");
});

test("sessions refresh a few minutes before the token expires", () => {
  const now = Math.floor(Date.now() / 1000);
  const token = (claims) => `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;
  assert.equal(refreshWindowSeconds(token({ iat: now, exp: now + 3600 })), 300);
  assert.equal(refreshWindowSeconds(token({ iat: now, exp: now + 300 })), 75);
  assert.equal(refreshWindowSeconds("not a token"), 300);
  assert.ok(Math.abs(tokenSecondsLeft(token({ exp: now + 120 })) - 120) <= 1);
  assert.equal(tokenSecondsLeft(token({ exp: now - 10 })), 0);
});

test("Stripe webhooks need a valid, recent signature", () => {
  const secret = "whsec_test";
  const payload = JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded" });
  const sign = (t, key = secret) => createHmac("sha256", key).update(`${t}.${payload}`).digest("hex");
  const now = Math.floor(Date.now() / 1000);

  assert.equal(constructWebhookEvent(payload, `t=${now},v1=${sign(now)}`, secret).id, "evt_1");
  // Stripe sends several signatures while a secret is being rolled.
  assert.equal(constructWebhookEvent(payload, `t=${now},v1=${sign(now, "old")},v1=${sign(now)}`, secret).id, "evt_1");
  assert.throws(() => constructWebhookEvent(payload, `t=${now},v1=${sign(now, "wrong")}`, secret), /doesn't match/);
  assert.throws(() => constructWebhookEvent(payload, `t=${now - 600},v1=${sign(now - 600)}`, secret), /too old/);
  assert.throws(() => constructWebhookEvent(payload + " ", `t=${now},v1=${sign(now)}`, secret), /doesn't match/);
  assert.throws(() => constructWebhookEvent(payload, "garbage", secret), /Malformed/);
});

test("the site address comes from SITE_URL, or from Render or Railway", async () => {
  const { siteUrl } = await import("../src/env.js");
  const saved = { ...process.env };
  try {
    for (const name of ["SITE_URL", "RENDER_EXTERNAL_URL", "RAILWAY_PUBLIC_DOMAIN", "PORT"]) delete process.env[name];
    assert.equal(siteUrl(), "http://localhost:3000");
    process.env.RAILWAY_PUBLIC_DOMAIN = "brown-line.up.railway.app";
    assert.equal(siteUrl(), "https://brown-line.up.railway.app");
    process.env.RENDER_EXTERNAL_URL = "https://brown-line-site.onrender.com";
    assert.equal(siteUrl(), "https://brown-line-site.onrender.com");
    process.env.SITE_URL = "https://www.brownlineil.com/";
    assert.equal(siteUrl(), "https://www.brownlineil.com");
  } finally {
    for (const name of ["SITE_URL", "RENDER_EXTERNAL_URL", "RAILWAY_PUBLIC_DOMAIN", "PORT"]) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
});
