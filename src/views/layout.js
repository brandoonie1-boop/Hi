// The page shell every page shares: <head>, header with navigation, footer.

import { SITE } from "../env.js";
import { cx, html } from "../html.js";
import { icon } from "./icons.js";
import { ui } from "./ui.js";

/** Changes on every server start so browsers pick up new CSS/JS after a deploy. */
export const ASSET_VERSION = Date.now().toString(36);

export function telHref(phone) {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

function navLink(currentPath, href, label) {
  const active = href === "/rentals" ? currentPath === "/rentals" : currentPath === href || currentPath.startsWith(`${href}/`);
  return html`<a href="${href}" ${active ? html`aria-current="page"` : ""} class="${cx(
    "whitespace-nowrap rounded-md px-3 py-2 font-medium transition-colors",
    active ? "bg-brand-50 text-brand-800" : "text-stone-600 hover:bg-stone-100 hover:text-stone-900",
  )}">${label}</a>`;
}

function header(currentPath, viewer) {
  return html`<header class="border-b border-stone-200 bg-white">
    <div class="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
      <a href="/" class="flex items-baseline gap-1.5 rounded-md" aria-label="${SITE.companyName} home">
        <span class="text-lg font-bold tracking-tight text-brand-800">Brown Line</span>
        <span class="text-xs font-semibold uppercase tracking-wider text-stone-500">IL LLC</span>
      </a>
      <nav aria-label="Main" class="order-3 -mx-1 flex w-full items-center gap-1 overflow-x-auto text-sm sm:order-2 sm:mx-0 sm:w-auto">
        ${navLink(currentPath, "/rentals/new", "Book units")}
        ${viewer ? navLink(currentPath, "/rentals", "My rentals") : ""}
        ${viewer?.isAdmin ? navLink(currentPath, "/admin/dashboard", "Dispatch") : ""}
      </nav>
      <div class="order-2 flex items-center gap-3 sm:order-3">
        ${SITE.phone
          ? html`<a href="${telHref(SITE.phone)}" class="hidden items-center gap-1.5 text-sm font-medium text-stone-700 hover:text-stone-900 md:inline-flex">${icon("phone")}${SITE.phone}</a>`
          : ""}
        ${viewer
          ? html`<form action="/logout" method="post"><button type="submit" class="${ui.buttonSecondary}">Sign out</button></form>`
          : html`<a href="/login" class="${ui.buttonSecondary}">Sign in</a>`}
      </div>
    </div>
  </header>`;
}

function footer() {
  return html`<footer class="border-t border-stone-200 bg-white">
    <div class="mx-auto grid max-w-6xl gap-6 px-4 py-8 text-sm text-stone-600 sm:grid-cols-3 sm:px-6">
      <div>
        <p class="font-semibold text-stone-900">${SITE.companyName}</p>
        <p class="mt-1">${SITE.baseLocation}</p>
        <p class="mt-1">${SITE.serviceArea}.</p>
      </div>
      <div>
        <p class="font-semibold text-stone-900">Contact</p>
        ${SITE.phone ? html`<p class="mt-1"><a href="${telHref(SITE.phone)}" class="hover:text-stone-900">${SITE.phone}</a></p>` : ""}
        ${SITE.email ? html`<p class="mt-1"><a href="mailto:${SITE.email}" class="hover:text-stone-900">${SITE.email}</a></p>` : ""}
        <p class="mt-1">Book and pay online any time.</p>
      </div>
      <div>
        <p class="font-semibold text-stone-900">Customers</p>
        <ul class="mt-1 space-y-1">
          <li><a href="/rentals/new" class="hover:text-stone-900">Book units</a></li>
          <li><a href="/rentals" class="hover:text-stone-900">My rentals and invoices</a></li>
          <li><a href="/login" class="hover:text-stone-900">Sign in or create an account</a></li>
        </ul>
      </div>
    </div>
    <div class="border-t border-stone-100">
      <p class="mx-auto max-w-6xl px-4 py-4 text-xs text-stone-500 sm:px-6">© ${new Date().getFullYear()} ${SITE.companyName}. All rights reserved.</p>
    </div>
  </footer>`;
}

/**
 * Full HTML document.
 * options: { title, description, viewer, body, scripts: ["/static/x.js"], head, noIndex }
 */
export function page(ctx, { title, description, viewer, body, scripts = [], head = "", noIndex = false }) {
  const fullTitle = title ? `${title} | ${SITE.companyName}` : `${SITE.companyName} | Portable Toilet Rentals in Chicagoland`;
  // The inline script marks the page as having JavaScript before it paints, so
  // the stylesheet's js: rules (wizard steps, auto-saving menus) apply without a flash.
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title>
<meta name="description" content="${description || SITE.description}">
${noIndex ? html`<meta name="robots" content="noindex, nofollow">` : ""}
<meta name="theme-color" content="#623e28">
<meta property="og:title" content="${fullTitle}">
<meta property="og:description" content="${description || SITE.description}">
<meta property="og:site_name" content="${SITE.companyName}">
<link rel="icon" href="/static/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/static/styles.css?v=${ASSET_VERSION}">
<script>document.documentElement.classList.add("js")</script>
${head}
</head>
<body class="flex min-h-dvh flex-col bg-stone-50 font-sans text-stone-900 antialiased">
<a href="#main" class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow">Skip to content</a>
${header(ctx.path, viewer)}
<main id="main" class="flex-1">${body}</main>
${footer()}
${scripts.map((src) => html`<script type="module" src="${src}?v=${ASSET_VERSION}"></script>`)}
</body>
</html>`;
}
