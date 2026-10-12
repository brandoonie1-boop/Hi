import { ConfigError } from "../env.js";
import { html } from "../html.js";
import { page } from "../views/layout.js";
import { ui } from "../views/ui.js";

export function notFoundPage(ctx, viewer = null) {
  ctx.html(
    404,
    page(ctx, {
      title: "Page not found",
      viewer,
      noIndex: true,
      body: html`<div class="mx-auto max-w-lg px-4 py-20 text-center">
        <p class="text-sm font-semibold text-brand-700">404</p>
        <h1 class="mt-2 text-2xl font-bold tracking-tight text-stone-900">We couldn't find that page</h1>
        <p class="mt-2 text-stone-600">If you followed a link to an invoice, make sure you're signed in to the account that made the booking.</p>
        <div class="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <a href="/" class="${ui.buttonPrimary}">Go to the home page</a>
          <a href="/rentals" class="${ui.buttonSecondary}">My rentals</a>
        </div>
      </div>`,
    }),
  );
}

export function errorPage(ctx, error) {
  const setup = error instanceof ConfigError;
  ctx.html(
    500,
    page(ctx, {
      title: setup ? "Setup needed" : "Something went wrong",
      viewer: null,
      noIndex: true,
      body: html`<div class="mx-auto max-w-lg px-4 py-20 text-center">
        <h1 class="text-2xl font-bold tracking-tight text-stone-900">${setup ? "The site isn't fully set up yet" : "Something went wrong"}</h1>
        <p class="mt-2 text-stone-600">${setup
          ? `${error.message} See README.md.`
          : "Please try again. If it keeps happening, contact us and say what you were doing."}</p>
        <a href="${ctx.path}" class="${ui.buttonPrimary} mt-8">Try again</a>
      </div>`,
    }),
  );
}
