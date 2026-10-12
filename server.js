// Brown Line IL LLC: booking, payments and dispatch site.
// Plain HTML pages rendered on the server. Start it with:  node server.js

import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadDotEnv, missingSettings } from "./src/env.js";
import { createContext, createRouter, HttpError, isSameOrigin, Redirect, serveStatic } from "./src/http.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
loadDotEnv(join(ROOT, ".env"));

// Pages are imported after .env is loaded.
const { adminDashboardPage, depositAction, rentalStatusAction } = await import("./src/pages/admin.js");
const {
  authCallback,
  loginAction,
  loginPage,
  logoutAction,
  resetAction,
  signupAction,
  updatePasswordAction,
  updatePasswordPage,
} = await import("./src/pages/auth.js");
const { bookingPage, createRentalAction } = await import("./src/pages/book.js");
const { checkoutPage, processPaymentAction } = await import("./src/pages/checkout.js");
const { errorPage, notFoundPage } = await import("./src/pages/errors.js");
const { homePage } = await import("./src/pages/home.js");
const { myRentalsPage } = await import("./src/pages/rentals.js");
const { stripeWebhook } = await import("./src/pages/webhooks.js");

const router = createRouter();

router.get("/", homePage);
router.get("/healthz", (ctx) => ctx.send(200, "ok", { "Content-Type": "text/plain" }));

// Accounts
router.get("/login", loginPage);
router.post("/login", loginAction);
router.post("/signup", signupAction);
router.post("/reset", resetAction);
router.post("/logout", logoutAction);
router.get("/auth/callback", authCallback);
router.get("/account/update-password", updatePasswordPage);
router.post("/account/update-password", updatePasswordAction);

// Customers
router.get("/rentals", myRentalsPage);
router.get("/rentals/new", bookingPage);
router.post("/api/rentals", createRentalAction);
router.get("/checkout/:invoiceId", checkoutPage);
router.post("/api/checkout/process", processPaymentAction);

// Staff
router.get("/admin", () => {
  throw new Redirect("/admin/dashboard");
});
router.get("/admin/dashboard", adminDashboardPage);
router.post("/api/admin/deposit", depositAction);
router.post("/api/admin/rentals/status", rentalStatusAction);

// Stripe
router.post("/api/webhooks/stripe", stripeWebhook);

const PUBLIC_DIR = join(ROOT, "public");
const SHARED_DIR = join(ROOT, "shared");

async function handle(req, res) {
  const ctx = createContext(req, res);
  const started = Date.now();
  res.on("finish", () => {
    if (!ctx.path.startsWith("/static/") && !ctx.path.startsWith("/shared/")) {
      console.log(`${req.method} ${ctx.path} ${res.statusCode} ${Date.now() - started}ms`);
    }
  });

  try {
    if (ctx.method === "GET" && ctx.path.startsWith("/static/")) {
      if (serveStatic(ctx, PUBLIC_DIR, ctx.path.slice("/static/".length))) return;
      return notFoundPage(ctx);
    }
    // Pricing, dates and booking rules are shared with the browser.
    if (ctx.method === "GET" && ctx.path.startsWith("/shared/")) {
      if (serveStatic(ctx, SHARED_DIR, ctx.path.slice("/shared/".length))) return;
      return notFoundPage(ctx);
    }
    if (ctx.method === "GET" && ctx.path === "/favicon.ico") {
      return ctx.redirect("/static/icon.svg", 301);
    }

    const route = router.match(ctx.method, ctx.path);
    if (!route) return notFoundPage(ctx);
    if (route.methodNotAllowed) return ctx.send(405, "Method not allowed", { "Content-Type": "text/plain" });

    // Form posts must come from this site (the Stripe webhook is checked by signature instead).
    if (ctx.method === "POST" && ctx.path !== "/api/webhooks/stripe" && !isSameOrigin(ctx)) {
      return ctx.send(403, "Forbidden", { "Content-Type": "text/plain" });
    }

    ctx.params = route.params;
    await route.handler(ctx);
    if (!res.headersSent) notFoundPage(ctx);
  } catch (error) {
    if (res.headersSent) return;
    if (error instanceof Redirect) return ctx.redirect(error.location, error.status);
    if (error instanceof HttpError && error.status === 404) return notFoundPage(ctx);
    if (error instanceof HttpError) return ctx.send(error.status, error.message, { "Content-Type": "text/plain" });
    console.error(`[server] ${req.method} ${ctx.path} failed`, error);
    errorPage(ctx, error);
  }
}

const missing = missingSettings();
if (missing.length) {
  console.warn(`Warning: these settings are missing, so parts of the site won't work yet: ${missing.join(", ")}`);
}

const port = Number(process.env.PORT) || 3000;
const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error("[server] unexpected error", error);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal error");
    }
  });
});
server.listen(port, () => {
  console.log(`Brown Line site running on http://localhost:${port}`);
});

// Finish in-flight requests when the host restarts the app.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
