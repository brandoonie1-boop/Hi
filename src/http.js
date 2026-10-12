// Small HTTP toolkit on top of node:http: routing, cookies, form/JSON bodies,
// responses, and static files. No framework needed.

import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";

import { siteUrl } from "./env.js";

/** Thrown by a handler to send the browser somewhere else. */
export class Redirect extends Error {
  constructor(location, status = 303) {
    super(`Redirect to ${location}`);
    this.location = location;
    this.status = status;
  }
}

/** Thrown by a handler for an error page with a given status. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

/** On the live https site, also tell browsers to always use https. */
function securityHeaders() {
  return siteUrl().startsWith("https://")
    ? { ...SECURITY_HEADERS, "Strict-Transport-Security": "max-age=31536000" }
    : SECURITY_HEADERS;
}

export function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (!name || name in cookies) continue;
    try {
      cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      cookies[name] = part.slice(index + 1).trim();
    }
  }
  return cookies;
}

function serializeCookie(name, value, { maxAge, httpOnly = true, sameSite = "Lax", path = "/" } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`);
  if (httpOnly) parts.push("HttpOnly");
  if (siteUrl().startsWith("https://")) parts.push("Secure");
  return parts.join("; ");
}

async function readBody(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "That request was too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Everything a page handler needs for one request. */
export function createContext(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  // One Set-Cookie per name; the last change to a cookie wins.
  const outgoingCookies = new Map();

  const ctx = {
    req,
    res,
    url,
    method: req.method === "HEAD" ? "GET" : req.method,
    path: url.pathname,
    query: url.searchParams,
    params: {},
    cookies: parseCookies(req.headers.cookie),
    state: {},

    setCookie(name, value, options) {
      outgoingCookies.set(name, serializeCookie(name, value, options));
    },
    clearCookie(name) {
      outgoingCookies.set(name, serializeCookie(name, "", { maxAge: 0 }));
    },

    /** The request body (up to 1 MB, for Stripe's webhook events). */
    async rawBody(limit = 1_000_000) {
      ctx._rawBody ??= await readBody(req, limit);
      return ctx._rawBody;
    },
    /** A submitted form. Forms on this site are small, so 64 KB is plenty. */
    async form() {
      const params = new URLSearchParams((await ctx.rawBody(64_000)).toString("utf8"));
      return Object.fromEntries(params.entries());
    },
    /** The request body parsed as JSON (ctx.json() below sends a JSON response). */
    async jsonBody() {
      const text = (await ctx.rawBody(64_000)).toString("utf8");
      try {
        return JSON.parse(text || "null");
      } catch {
        throw new HttpError(400, "Unreadable request.");
      }
    },

    send(status, body, headers = {}) {
      if (res.headersSent) return;
      const allHeaders = { ...securityHeaders(), ...headers };
      if (outgoingCookies.size) allHeaders["Set-Cookie"] = [...outgoingCookies.values()];
      res.writeHead(status, allHeaders);
      res.end(req.method === "HEAD" ? undefined : body);
    },
    html(status, page) {
      ctx.send(status, String(page), {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
    },
    json(status, value) {
      ctx.send(status, JSON.stringify(value), {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
    },
    redirect(location, status = 303) {
      ctx.send(status, "", { Location: location, "Cache-Control": "no-store" });
    },
  };
  return ctx;
}

/** Route table: router.get("/checkout/:invoiceId", handler). */
export function createRouter() {
  const routes = [];
  const add = (method, pattern, handler) => {
    const keys = [];
    const regex = new RegExp(
      `^${pattern.replace(/\//g, "\\/").replace(/:([A-Za-z]+)/g, (_, key) => {
        keys.push(key);
        return "([^/]+)";
      })}\\/?$`,
    );
    routes.push({ method, regex, keys, handler });
  };
  return {
    get: (pattern, handler) => add("GET", pattern, handler),
    post: (pattern, handler) => add("POST", pattern, handler),
    match(method, path) {
      let pathMatched = false;
      for (const route of routes) {
        const found = route.regex.exec(path);
        if (!found) continue;
        pathMatched = true;
        if (route.method !== method) continue;
        const params = {};
        try {
          route.keys.forEach((key, i) => {
            params[key] = decodeURIComponent(found[i + 1]);
          });
        } catch {
          return null; // malformed %-encoding: treat as not found
        }
        return { handler: route.handler, params };
      }
      return pathMatched ? { methodNotAllowed: true } : null;
    },
  };
}

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

/** Serve a file from `root` (no directory listings, no escaping the folder). */
export function serveStatic(ctx, root, relativePath) {
  const safe = normalize(relativePath).replace(/^([/\\])+/, "");
  const file = join(root, safe);
  if (!file.startsWith(root + sep) || safe.split(/[/\\]/).includes("..")) return false;
  let stats;
  try {
    stats = statSync(file);
  } catch {
    return false;
  }
  if (!stats.isFile()) return false;
  const type = MIME[extname(file)];
  if (!type) return false;
  ctx.res.writeHead(200, {
    ...securityHeaders(),
    "Content-Type": type,
    "Content-Length": stats.size,
    "Cache-Control": "public, max-age=300",
  });
  if (ctx.req.method === "HEAD") ctx.res.end();
  else createReadStream(file).pipe(ctx.res);
  return true;
}

/**
 * Basic cross-site request check for form posts: browsers send an Origin
 * header, and it must be this site. (Session cookies are SameSite=Lax too.)
 */
export function isSameOrigin(ctx) {
  // Browsers label requests another site started; turn those away outright.
  if (ctx.req.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = ctx.req.headers.origin;
  if (!origin) return true;
  try {
    const expected = new URL(siteUrl()).host;
    const host = ctx.req.headers.host;
    const actual = new URL(origin).host;
    return actual === expected || actual === host;
  } catch {
    return false;
  }
}
