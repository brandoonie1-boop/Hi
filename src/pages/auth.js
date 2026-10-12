// Accounts: sign in, create account, password reset, email links, sign out.

import { SITE, siteUrl } from "../env.js";
import { cx, html } from "../html.js";
import { Redirect } from "../http.js";
import { LIMITS, overLimit, tooManyAttempts } from "../rate-limit.js";
import {
  clearSessionCookies,
  currentSession,
  currentViewer,
  PKCE_COOKIE,
  requireViewer,
  safeNext,
  setSessionCookies,
} from "../session.js";
import { auth, createPkcePair, SupabaseError } from "../supabase.js";
import { icon } from "../views/icons.js";
import { page } from "../views/layout.js";
import { alert, field, fieldAria, ui } from "../views/ui.js";

// Checked for length first, and written so it can't be made to run slowly.
const EMAIL = /^[^\s@]+@(?:[^\s@.]+\.)+[^\s@.]{2,}$/;
const isEmail = (value) => value.length <= 254 && EMAIL.test(value);
const PHONE = /^[0-9()+\-.\s]{10,20}$/;
const OTP_TYPES = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];
const TOO_MANY = "Too many attempts. Please wait a few minutes and try again.";
const LOGIN_NOTICES = {
  link: { tone: "warning", body: "That email link has expired or was already used. Sign in, or request a new link." },
  busy: { tone: "warning", body: "Too many sign-in attempts from your connection. Please wait a few minutes, then sign in or ask for a new email link." },
  "signed-out": { tone: "info", body: "You're signed out." },
};

function friendlyAuthError(error) {
  if (!(error instanceof SupabaseError)) return "We couldn't reach the sign-in service. Please try again in a minute.";
  const text = error.message.toLowerCase();
  if (text.includes("invalid login credentials")) return "That email and password don't match an account.";
  if (text.includes("email not confirmed")) return "Please confirm your email first. Check your inbox for the link we sent.";
  if (text.includes("already registered")) return "An account with this email already exists. Sign in instead.";
  if (text.includes("rate limit") || error.status === 429) return "Too many attempts. Please wait a minute and try again.";
  // Supabase couldn't send the confirmation or reset email (for example, no email sender set up yet).
  if (text.includes("sending") || text.includes("not authorized")) {
    return `We couldn't send you an email just now. Please try again later${SITE.phone ? ` or call us at ${SITE.phone}` : ""}.`;
  }
  if (text.includes("password")) return error.message;
  return "Something went wrong. Please try again.";
}

function nextTarget(ctx, fromForm) {
  const target = safeNext(fromForm ?? ctx.query.get("next"));
  return target.startsWith("/login") ? "/rentals" : target;
}

function callbackUrl(next) {
  return `${siteUrl()}/auth/callback?next=${encodeURIComponent(next)}`;
}

// ------------------------------------------------------------------ views

function submitButton(label) {
  return html`<button type="submit" class="${ui.buttonPrimary} w-full py-3" data-busy-label="Please wait…">${label}</button>`;
}

function textField({ id, name, label, type = "text", value = "", error, hint, autocomplete, inputmode, optional }) {
  return field({
    id,
    label,
    error,
    hint,
    optional,
    control: html`<input id="${id}" name="${name}" type="${type}" value="${value}" class="${ui.input}"
      ${autocomplete ? html`autocomplete="${autocomplete}"` : ""} ${inputmode ? html`inputmode="${inputmode}"` : ""}
      ${optional ? "" : "required"} ${fieldAria(id, error, hint)}>`,
  });
}

function authCard({ mode, next, values = {}, errors = {}, message, notice }) {
  const heading = mode === "signup" ? "Create your account" : mode === "reset" ? "Reset your password" : "Sign in to Brown Line";
  const intro =
    mode === "reset"
      ? "Enter your email and we'll send you a link to set a new password."
      : "You need an account to book units, pay invoices and track deliveries.";
  const tab = (target, label) =>
    html`<a href="/login?mode=${target}&next=${encodeURIComponent(next)}" ${mode === target ? html`aria-current="page"` : ""}
      class="${cx("rounded-md px-3 py-2 text-center transition-colors", mode === target ? "bg-white text-stone-900 shadow-sm" : "text-stone-600 hover:text-stone-900")}">${label}</a>`;

  let form;
  if (mode === "signup") {
    form = html`<form method="post" action="/signup" class="space-y-4" data-busy-form>
      <input type="hidden" name="next" value="${next}">
      ${textField({ id: "signup-name", name: "fullName", label: "Full name", value: values.fullName, error: errors.fullName, autocomplete: "name" })}
      ${textField({ id: "signup-company", name: "companyName", label: "Company", value: values.companyName, error: errors.companyName, autocomplete: "organization", optional: true })}
      ${textField({ id: "signup-phone", name: "phone", label: "Phone", type: "tel", value: values.phone, error: errors.phone, hint: "For delivery-day questions.", autocomplete: "tel", inputmode: "tel" })}
      ${textField({ id: "signup-email", name: "email", label: "Email", type: "email", value: values.email, error: errors.email, autocomplete: "email", inputmode: "email" })}
      ${textField({ id: "signup-password", name: "password", label: "Password", type: "password", error: errors.password, hint: "At least 8 characters.", autocomplete: "new-password" })}
      ${submitButton("Create account")}
    </form>`;
  } else if (mode === "reset") {
    form = html`<form method="post" action="/reset" class="space-y-4" data-busy-form>
      ${textField({ id: "reset-email", name: "email", label: "Email", type: "email", value: values.email, error: errors.email, autocomplete: "email", inputmode: "email" })}
      ${submitButton("Send reset link")}
      <a href="/login?next=${encodeURIComponent(next)}" class="${ui.link} inline-block text-sm">Back to sign in</a>
    </form>`;
  } else {
    form = html`<form method="post" action="/login" class="space-y-4" data-busy-form>
      <input type="hidden" name="next" value="${next}">
      ${textField({ id: "signin-email", name: "email", label: "Email", type: "email", value: values.email, error: errors.email, autocomplete: "email", inputmode: "email" })}
      ${textField({ id: "signin-password", name: "password", label: "Password", type: "password", error: errors.password, autocomplete: "current-password" })}
      <div class="flex justify-end"><a href="/login?mode=reset&next=${encodeURIComponent(next)}" class="${ui.link} text-sm">Forgot your password?</a></div>
      ${submitButton("Sign in")}
    </form>`;
  }

  return html`<div class="mx-auto max-w-md px-4 py-12 sm:py-16">
    <div class="${ui.card} p-6 sm:p-8">
      <h1 class="text-2xl font-bold tracking-tight text-stone-900">${heading}</h1>
      <p class="mt-1 text-sm text-stone-600">${intro}</p>
      ${mode !== "reset"
        ? html`<div class="mt-6 grid grid-cols-2 rounded-lg bg-stone-100 p-1 text-sm font-medium">${tab("signin", "Sign in")}${tab("signup", "Create account")}</div>`
        : ""}
      ${notice ? alert({ tone: notice.tone, title: notice.title, body: notice.body, className: "mt-6" }) : ""}
      ${message ? alert({ tone: "error", body: message, className: "mt-6" }) : ""}
      <div class="mt-6">${form}</div>
    </div>
  </div>`;
}

function renderAuth(ctx, status, options) {
  ctx.html(status, page(ctx, { title: "Sign in", viewer: null, body: authCard(options), scripts: ["/static/forms.js"] }));
}

function checkEmailPage(ctx, { title, body }) {
  ctx.html(
    200,
    page(ctx, {
      title,
      viewer: null,
      body: html`<div class="mx-auto max-w-md px-4 py-12 sm:py-16">
        <div class="${ui.card} animate-fade-in p-8 text-center">
          ${icon("mailCheck", "mx-auto size-10 text-brand-700")}
          <h1 class="mt-3 text-xl font-semibold text-stone-900">${title}</h1>
          <p class="mt-1 text-sm text-stone-600">${body}</p>
        </div>
      </div>`,
    }),
  );
}

// ------------------------------------------------------------------ handlers

export async function loginPage(ctx) {
  const next = nextTarget(ctx);
  if (await currentViewer(ctx)) throw new Redirect(next);

  const modeParam = ctx.query.get("mode");
  const mode = modeParam === "signup" || modeParam === "reset" ? modeParam : "signin";
  const key = [ctx.query.get("error"), ctx.query.get("notice")].find((value) => value && Object.hasOwn(LOGIN_NOTICES, value));
  const notice = key ? LOGIN_NOTICES[key] : null;
  renderAuth(ctx, 200, { mode, next, notice });
}

export async function loginAction(ctx) {
  const form = await ctx.form();
  const next = nextTarget(ctx, form.next);
  const email = String(form.email || "").trim().toLowerCase();
  const password = String(form.password || "");

  const errors = {};
  if (!isEmail(email)) errors.email = "Enter a valid email address";
  if (!password) errors.password = "Enter your password";
  if (Object.keys(errors).length) return renderAuth(ctx, 422, { mode: "signin", next, values: { email }, errors });

  if (overLimit(ctx, "signin", LIMITS.signIn) || tooManyAttempts(`signin-email:${email}`, { limit: 10, windowSeconds: 900 })) {
    return renderAuth(ctx, 429, { mode: "signin", next, values: { email }, message: TOO_MANY });
  }

  try {
    const session = await auth.signInWithPassword(email, password);
    setSessionCookies(ctx, session);
  } catch (error) {
    return renderAuth(ctx, 401, { mode: "signin", next, values: { email }, message: friendlyAuthError(error) });
  }
  throw new Redirect(next);
}

export async function signupAction(ctx) {
  const form = await ctx.form();
  const next = nextTarget(ctx, form.next);
  const values = {
    fullName: String(form.fullName || "").trim(),
    companyName: String(form.companyName || "").trim(),
    phone: String(form.phone || "").trim(),
    email: String(form.email || "").trim().toLowerCase(),
  };
  const password = String(form.password || "");

  const errors = {};
  if (values.fullName.length < 2) errors.fullName = "Enter your name";
  else if (values.fullName.length > 80) errors.fullName = "That name is too long";
  if (values.companyName.length > 100) errors.companyName = "That company name is too long";
  if (!PHONE.test(values.phone)) errors.phone = "Enter a phone number we can reach you at";
  if (!isEmail(values.email)) errors.email = "Enter a valid email address";
  if (password.length < 8) errors.password = "Use at least 8 characters";
  else if (password.length > 72) errors.password = "Use 72 characters or fewer";
  if (Object.keys(errors).length) return renderAuth(ctx, 422, { mode: "signup", next, values, errors });
  if (overLimit(ctx, "signup", LIMITS.signUp)) {
    return renderAuth(ctx, 429, { mode: "signup", next, values, message: TOO_MANY });
  }

  const pkce = createPkcePair();
  let result;
  try {
    result = await auth.signUp({
      email: values.email,
      password,
      data: { full_name: values.fullName, company_name: values.companyName, phone_number: values.phone },
      redirectTo: callbackUrl(next),
      codeChallenge: pkce.challenge,
    });
  } catch (error) {
    return renderAuth(ctx, 400, { mode: "signup", next, values, message: friendlyAuthError(error) });
  }

  if (result?.access_token) {
    // Email confirmation is turned off in Supabase: signed in already.
    setSessionCookies(ctx, result);
    throw new Redirect(next);
  }

  ctx.setCookie(PKCE_COOKIE, pkce.verifier, { maxAge: 60 * 60 * 24 });
  checkEmailPage(ctx, {
    title: "Check your email",
    body: `We sent a confirmation link to ${values.email}. Open it on this device to finish creating your account.`,
  });
}

export async function resetAction(ctx) {
  const form = await ctx.form();
  const email = String(form.email || "").trim().toLowerCase();
  if (!isEmail(email)) {
    return renderAuth(ctx, 422, { mode: "reset", next: "/rentals", values: { email }, errors: { email: "Enter a valid email address" } });
  }
  if (overLimit(ctx, "reset", LIMITS.reset) || tooManyAttempts(`reset-email:${email}`, { limit: 3, windowSeconds: 3600 })) {
    return renderAuth(ctx, 429, { mode: "reset", next: "/rentals", values: { email }, message: TOO_MANY });
  }

  const pkce = createPkcePair();
  try {
    await auth.sendPasswordReset({ email, redirectTo: callbackUrl("/account/update-password"), codeChallenge: pkce.challenge });
  } catch (error) {
    return renderAuth(ctx, 400, { mode: "reset", next: "/rentals", values: { email }, message: friendlyAuthError(error) });
  }
  ctx.setCookie(PKCE_COOKIE, pkce.verifier, { maxAge: 60 * 60 * 24 });
  checkEmailPage(ctx, {
    title: "Check your email",
    body: "If an account exists for that address, a password reset link is on its way.",
  });
}

/** Landing point for links in Supabase emails (confirm sign-up, reset password). */
export async function authCallback(ctx) {
  const next = safeNext(ctx.query.get("next"));
  const code = ctx.query.get("code");
  const tokenHash = ctx.query.get("token_hash");
  const type = ctx.query.get("type");

  try {
    let session = null;
    const wantsLogin = Boolean((code && ctx.cookies[PKCE_COOKIE]) || (tokenHash && OTP_TYPES.includes(type)));
    if (wantsLogin && overLimit(ctx, "email-link", LIMITS.emailLink)) {
      throw new Redirect("/login?error=busy");
    }
    if (code && ctx.cookies[PKCE_COOKIE]) {
      session = await auth.exchangeCode(code, ctx.cookies[PKCE_COOKIE]);
    } else if (tokenHash && OTP_TYPES.includes(type)) {
      session = await auth.verifyTokenHash(tokenHash, type);
    }
    if (session?.access_token) {
      setSessionCookies(ctx, session);
      ctx.clearCookie(PKCE_COOKIE);
      throw new Redirect(next);
    }
  } catch (error) {
    if (error instanceof Redirect) throw error;
    console.error("[auth/callback] email link failed", error);
  }
  throw new Redirect("/login?error=link");
}

export async function logoutAction(ctx) {
  const session = await currentSession(ctx).catch(() => null);
  if (session) await auth.signOut(session.accessToken).catch(() => {});
  clearSessionCookies(ctx);
  throw new Redirect("/");
}

function passwordCard({ errors = {}, message } = {}) {
  return html`<div class="mx-auto max-w-md px-4 py-12 sm:py-16">
    <div class="${ui.card} p-6 sm:p-8">
      <h1 class="text-2xl font-bold tracking-tight text-stone-900">Choose a new password</h1>
      <p class="mt-1 text-sm text-stone-600">Use at least 8 characters.</p>
      ${message ? alert({ tone: "error", body: message, className: "mt-6" }) : ""}
      <form method="post" action="/account/update-password" class="mt-6 space-y-4" data-busy-form>
        ${textField({ id: "new-password", name: "password", label: "New password", type: "password", error: errors.password, autocomplete: "new-password" })}
        ${textField({ id: "confirm-password", name: "confirm", label: "Confirm new password", type: "password", error: errors.confirm, autocomplete: "new-password" })}
        ${submitButton("Save new password")}
      </form>
    </div>
  </div>`;
}

export async function updatePasswordPage(ctx) {
  const viewer = await requireViewer(ctx);
  ctx.html(200, page(ctx, { title: "New password", viewer, body: passwordCard(), scripts: ["/static/forms.js"] }));
}

export async function updatePasswordAction(ctx) {
  const viewer = await requireViewer(ctx);
  const form = await ctx.form();
  const password = String(form.password || "");
  const errors = {};
  if (password.length < 8) errors.password = "Use at least 8 characters";
  else if (password.length > 72) errors.password = "Use 72 characters or fewer";
  if (password !== String(form.confirm || "")) errors.confirm = "The passwords don't match";

  const render = (status, options) =>
    ctx.html(status, page(ctx, { title: "New password", viewer, body: passwordCard(options), scripts: ["/static/forms.js"] }));
  if (Object.keys(errors).length) return render(422, { errors });

  try {
    await auth.updateUser(viewer.accessToken, { password });
  } catch (error) {
    return render(400, { message: error instanceof SupabaseError ? error.message : friendlyAuthError(error) });
  }
  throw new Redirect("/rentals?notice=password");
}
