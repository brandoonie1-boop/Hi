// Dispatch dashboard: live updates through Supabase Realtime, status menus
// that save as soon as they change, and one open action at a time.

const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm";

function readConfig() {
  const tag = document.getElementById("realtime-config");
  if (!tag) return null;
  try {
    return JSON.parse(tag.textContent);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ status menus

for (const form of document.querySelectorAll("[data-status-form]")) {
  const select = form.querySelector("select");
  select.addEventListener("change", () => {
    form.querySelector("[data-status-busy]").hidden = false;
    form.setAttribute("aria-busy", "true");
    form.requestSubmit();
  });
}

// Opening "Release" closes "Seize" on the same job, and the other way round.
for (const details of document.querySelectorAll("details[data-action]")) {
  details.addEventListener("toggle", () => {
    if (!details.open) return;
    const card = details.closest("li");
    for (const other of card?.querySelectorAll("details[data-action][open]") ?? []) {
      if (other !== details) other.open = false;
    }
    details.querySelector("textarea")?.focus();
  });
}

// ------------------------------------------------------------------ live badge

function setLive(state) {
  const badge = document.querySelector("[data-live-badge]");
  if (!badge) return;
  const dot = badge.querySelector("[data-live-dot]");
  const ping = badge.querySelector("[data-live-ping]");
  const text = badge.querySelector("[data-live-text]");
  badge.classList.toggle("bg-emerald-50", state === "live");
  badge.classList.toggle("text-emerald-800", state === "live");
  badge.classList.toggle("bg-amber-50", state === "offline");
  badge.classList.toggle("text-amber-800", state === "offline");
  badge.classList.toggle("bg-stone-100", state === "connecting");
  badge.classList.toggle("text-stone-600", state === "connecting");
  dot.classList.toggle("bg-emerald-600", state === "live");
  dot.classList.toggle("bg-amber-500", state === "offline");
  dot.classList.toggle("bg-stone-400", state === "connecting");
  ping.classList.toggle("hidden", state !== "live");
  text.textContent = state === "live" ? "Live" : state === "offline" ? "Offline: refresh to update" : "Connecting";
}

// ------------------------------------------------------------------ refreshing

function userIsBusy() {
  const active = document.activeElement;
  const typing = active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName) && active.type !== "hidden";
  return Boolean(typing || document.querySelector("details[data-action][open]"));
}

// Reload the same view and search, without repeating an old "Saved" message.
function reloadFresh() {
  const url = new URL(window.location.href);
  url.searchParams.delete("notice");
  url.searchParams.delete("error");
  window.location.replace(url);
}

let refreshTimer;
function onDatabaseChange() {
  // Don't wipe out a note someone is typing; offer a refresh instead.
  if (userIsBusy()) {
    document.querySelector("[data-refresh-banner]").hidden = false;
    return;
  }
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(reloadFresh, 600);
}

document.querySelector("[data-refresh-now]")?.addEventListener("click", reloadFresh);

// ------------------------------------------------------------------ Supabase Realtime

const config = readConfig();

// The live connection uses the sign-in token the page was loaded with, and
// those expire (usually after an hour). Reload shortly before that, when
// nobody is in the middle of something, to pick up a fresh token.
if (config?.reloadAfterSeconds) {
  const reloadAt = Date.now() + config.reloadAfterSeconds * 1000;
  let waiting = false;
  const reloadWhenIdle = () => {
    if (!userIsBusy()) return reloadFresh();
    if (waiting) return;
    waiting = true;
    setTimeout(() => {
      waiting = false;
      reloadWhenIdle();
    }, 15_000);
  };
  setTimeout(reloadWhenIdle, config.reloadAfterSeconds * 1000);
  // Timers pause while a laptop sleeps; catch up when the tab is looked at again.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() >= reloadAt) reloadWhenIdle();
  });
}

if (!config) {
  setLive("offline");
} else {
  try {
    const { createClient } = await import(SUPABASE_JS);
    // The page passes the admin's own sign-in token, so Realtime applies the
    // same row-level security as everything else.
    const supabase = createClient(config.supabaseUrl, config.publishableKey, {
      accessToken: async () => config.accessToken,
    });
    // New bookings show up as new invoices; rental changes that matter are
    // status updates. (New rentals on their own, without an invoice, never
    // appear on the dashboard, so they don't trigger a refresh.)
    supabase
      .channel(`dispatch-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, onDatabaseChange)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rentals" }, onDatabaseChange)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "rentals" }, onDatabaseChange)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setLive("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setLive("offline");
      });
  } catch (error) {
    console.error("Live updates unavailable", error);
    setLive("offline");
  }
}
