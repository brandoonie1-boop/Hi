// Sign-in sessions kept in HttpOnly cookies: the Supabase access token
// (short-lived) and refresh token (long-lived). The access token is refreshed
// automatically shortly before it expires.

import { ConfigError } from "./env.js";
import { Redirect } from "./http.js";
import { LIMITS, overLimit } from "./rate-limit.js";
import { asUser, auth, SupabaseError } from "./supabase.js";

const ACCESS_COOKIE = "bl_at";
const REFRESH_COOKIE = "bl_rt";
export const PKCE_COOKIE = "bl_pkce";

const REFRESH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

function tokenClaims(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

/** Seconds until an access token expires, by this server's clock. */
export function tokenSecondsLeft(token) {
  return Math.max(0, Math.floor((Number(tokenClaims(token).exp) || 0) - Date.now() / 1000));
}

/**
 * Swap for a fresh token when this little time is left, so a page never fails
 * half-way and the dispatch page's live updates stay connected: 5 minutes for
 * Supabase's usual 1-hour tokens, a quarter of the lifetime for shorter ones.
 */
export function refreshWindowSeconds(token) {
  const { iat, exp } = tokenClaims(token);
  const lifetime = Number(exp) - Number(iat);
  return Number.isFinite(lifetime) && lifetime > 0 ? Math.min(300, Math.floor(lifetime / 4)) : 300;
}

export function setSessionCookies(ctx, session) {
  ctx.setCookie(ACCESS_COOKIE, session.access_token, { maxAge: session.expires_in || 3600 });
  ctx.setCookie(REFRESH_COOKIE, session.refresh_token, { maxAge: REFRESH_COOKIE_MAX_AGE });
}

export function clearSessionCookies(ctx) {
  ctx.clearCookie(ACCESS_COOKIE);
  ctx.clearCookie(REFRESH_COOKIE);
}

/**
 * Only allow paths on this site as "come back here after signing in" targets.
 * Parsing it the way a browser would catches tricks like "//evil.example",
 * "/\evil.example" and tabs or newlines hidden inside.
 */
export function safeNext(next, fallback = "/rentals") {
  if (typeof next !== "string" || !next.startsWith("/")) return fallback;
  const base = "http://this-site.invalid";
  try {
    const url = new URL(next, base);
    // "/.//evil.example" resolves to the path "//evil.example", which a
    // browser would treat as another site.
    if (url.origin !== base || url.pathname.startsWith("//")) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}

/** Supabase answered that the refresh token is no good (not "busy" or "down"). */
const isRejected = (error) => error instanceof SupabaseError && [400, 401, 403, 404, 422].includes(error.status);

/** This visitor hit the refresh limit for now (see rate-limit.js). */
class RefreshLimited extends Error {}

// Requests from the same browser often arrive together (a page, then its
// payment check). They share one refresh instead of each spending the
// refresh token, and a refresh token that just failed isn't sent again.
const recentRefreshes = new Map(); // refresh token -> { promise, at }
const SHARE_REFRESH_MS = 10_000;

function refreshOnce(ctx, refreshToken) {
  const now = Date.now();
  for (const [token, entry] of recentRefreshes) if (now - entry.at >= SHARE_REFRESH_MS) recentRefreshes.delete(token);
  const recent = recentRefreshes.get(refreshToken);
  if (recent) return recent.promise;
  if (overLimit(ctx, "refresh", LIMITS.refresh)) return Promise.reject(new RefreshLimited("Too many refreshes from this visitor"));
  const promise = auth.refresh(refreshToken);
  recentRefreshes.set(refreshToken, { promise, at: now });
  // Remember a refresh token Supabase turned down, but not one that only
  // failed because Supabase was busy or down: that one can be tried again.
  promise.catch((error) => {
    if (!isRejected(error)) recentRefreshes.delete(refreshToken);
  });
  return promise;
}

/**
 * The signed-in user for this request, or null.
 * Returns { user, accessToken }. Cached per request.
 */
export function currentSession(ctx) {
  ctx.state.sessionPromise ??= (async () => {
    let accessToken = ctx.cookies[ACCESS_COOKIE];
    const refreshToken = ctx.cookies[REFRESH_COOKIE];
    if (!accessToken && !refreshToken) return null;
    let lastRefresh = null; // null until a refresh is tried

    // Swaps the refresh token for a new pair: "ok", "rejected" (sign in
    // again) or "unavailable" (Supabase busy or down, or too many refreshes
    // right now; keep the cookies and try again on the next page).
    const refresh = async () => {
      lastRefresh = await (async () => {
        if (!refreshToken) {
          clearSessionCookies(ctx);
          return "rejected";
        }
        try {
          const session = await refreshOnce(ctx, refreshToken);
          setSessionCookies(ctx, session);
          accessToken = session.access_token;
          return "ok";
        } catch (error) {
          if (isRejected(error)) {
            clearSessionCookies(ctx);
            return "rejected";
          }
          if (error instanceof RefreshLimited || error instanceof SupabaseError || error?.name === "TimeoutError" || error instanceof TypeError) {
            console.warn(`[session] couldn't refresh a sign-in right now: ${error.message}`);
            return "unavailable";
          }
          throw error;
        }
      })();
      return lastRefresh;
    };

    if (!accessToken || tokenSecondsLeft(accessToken) < refreshWindowSeconds(accessToken)) {
      const outcome = await refresh();
      if (outcome === "rejected") return null;
      // Couldn't refresh this time: the current token still works for a few minutes.
      if (outcome === "unavailable" && !(accessToken && tokenSecondsLeft(accessToken) > 10)) return null;
    }

    for (;;) {
      try {
        const user = await auth.getUser(accessToken);
        return { user, accessToken };
      } catch (error) {
        if (error instanceof SupabaseError && (error.status === 401 || error.status === 403)) {
          // Supabase turned the token down (for example the server clocks
          // disagree about the time): try one refresh before signing out.
          if (lastRefresh === null && (await refresh()) === "ok") continue;
          // Only sign out for good if the refresh token itself was turned down.
          if (lastRefresh !== "unavailable") clearSessionCookies(ctx);
          return null;
        }
        throw error;
      }
    }
  })();
  return ctx.state.sessionPromise;
}

/**
 * Like currentSession plus the profile (name, role). Never throws: if
 * Supabase isn't configured or reachable, the visitor is treated as signed out.
 */
export function currentViewer(ctx) {
  ctx.state.viewerPromise ??= (async () => {
    try {
      const session = await currentSession(ctx);
      if (!session) return null;
      const profile = await asUser(session.accessToken).first("profiles", {
        select: "id,full_name,company_name,phone_number,email,role",
        id: `eq.${session.user.id}`,
      });
      return { ...session, profile, isAdmin: profile?.role === "admin" };
    } catch (error) {
      if (!(error instanceof ConfigError)) console.error("[session] could not load the signed-in user", error);
      return null;
    }
  })();
  return ctx.state.viewerPromise;
}

/** Pages: send signed-out visitors to /login and back here afterwards. */
export async function requireViewer(ctx) {
  const viewer = await currentViewer(ctx);
  if (!viewer) throw new Redirect(`/login?next=${encodeURIComponent(ctx.path + ctx.url.search)}`);
  return viewer;
}
