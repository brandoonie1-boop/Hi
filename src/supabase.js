// Supabase over plain HTTPS (no SDK): Auth for accounts and sessions, and the
// REST API for the database.
//
// Keys go in the `apikey` header. A signed-in user's own token goes in
// `Authorization: Bearer`, so row-level security applies to everything they
// read. The secret key bypasses row-level security and is only used on the
// server for writes customers must not make themselves.

import { createHash, randomBytes } from "node:crypto";

import { requireEnv } from "./env.js";

export class SupabaseError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "SupabaseError";
    this.status = status;
    this.body = body;
  }
}

const publishableKey = () => requireEnv("SUPABASE_PUBLISHABLE_KEY");
const secretKey = () => requireEnv("SUPABASE_SECRET_KEY");
const baseUrl = () => requireEnv("SUPABASE_URL").replace(/\/$/, "");

// Older Supabase projects use JWT-style keys ("eyJ..."), which also go in the
// Authorization header. The newer sb_publishable_/sb_secret_ keys must not.
const isLegacyJwtKey = (key) => key.startsWith("eyJ");

async function call(path, { method = "GET", key, token, query, body, headers = {} }) {
  const url = new URL(baseUrl() + path);
  for (const [name, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null) url.searchParams.set(name, String(value));
  }

  const requestHeaders = { apikey: key, Accept: "application/json", ...headers };
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  else if (isLegacyJwtKey(key)) requestHeaders.Authorization = `Bearer ${key}`;
  if (body !== undefined) requestHeaders["Content-Type"] = "application/json";

  const response = await fetch(url, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const message =
      (data && (data.msg || data.message || data.error_description || data.error)) ||
      `Supabase request failed (${response.status})`;
    throw new SupabaseError(String(message), response.status, data);
  }
  return data;
}

// ------------------------------------------------------------------ database

function restClient(auth) {
  return {
    /** Rows from a table or view. `query` holds PostgREST filters, e.g. { id: "eq.5", order: "created_at.desc" }. */
    select(table, query = {}) {
      return call(`/rest/v1/${table}`, { ...auth, query: { select: "*", ...query } });
    },
    async first(table, query = {}) {
      const rows = await call(`/rest/v1/${table}`, { ...auth, query: { select: "*", ...query, limit: 1 } });
      return Array.isArray(rows) && rows.length ? rows[0] : null;
    },
    /** PATCH matching rows; returns the updated rows (empty if nothing matched). */
    update(table, query, values) {
      return call(`/rest/v1/${table}`, {
        ...auth,
        method: "PATCH",
        query,
        body: values,
        headers: { Prefer: "return=representation" },
      });
    },
    /** Call a database function. */
    rpc(fn, args = {}) {
      return call(`/rest/v1/rpc/${fn}`, { ...auth, method: "POST", body: args });
    },
  };
}

/** Database access as the signed-in user: row-level security applies. */
export function asUser(accessToken) {
  return restClient({ key: publishableKey(), token: accessToken });
}

/** Database access with the secret key: bypasses row-level security. Server-only. */
export function asService() {
  return restClient({ key: secretKey() });
}

// ------------------------------------------------------------------ auth

/** PKCE pair for email links: the verifier stays in a cookie, the challenge goes to Supabase. */
export function createPkcePair() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

const authCall = (path, options) => call(`/auth/v1${path}`, { key: publishableKey(), ...options });

export const auth = {
  /** Returns a session if email confirmation is off, otherwise the new user. */
  signUp({ email, password, data, redirectTo, codeChallenge }) {
    return authCall("/signup", {
      method: "POST",
      query: { redirect_to: redirectTo },
      body: { email, password, data, code_challenge: codeChallenge, code_challenge_method: "s256" },
    });
  },
  signInWithPassword(email, password) {
    return authCall("/token", { method: "POST", query: { grant_type: "password" }, body: { email, password } });
  },
  refresh(refreshToken) {
    return authCall("/token", {
      method: "POST",
      query: { grant_type: "refresh_token" },
      body: { refresh_token: refreshToken },
    });
  },
  /** Finish an email link that came back with ?code= (same browser). */
  exchangeCode(authCode, codeVerifier) {
    return authCall("/token", {
      method: "POST",
      query: { grant_type: "pkce" },
      body: { auth_code: authCode, code_verifier: codeVerifier },
    });
  },
  /** Finish an email link that came back with ?token_hash=&type= (any device). */
  verifyTokenHash(tokenHash, type) {
    return authCall("/verify", { method: "POST", body: { type, token_hash: tokenHash } });
  },
  /** Checks a token with Supabase and returns its user. */
  getUser(accessToken) {
    return authCall("/user", { token: accessToken });
  },
  signOut(accessToken) {
    return authCall("/logout", { method: "POST", token: accessToken });
  },
  sendPasswordReset({ email, redirectTo, codeChallenge }) {
    return authCall("/recover", {
      method: "POST",
      query: { redirect_to: redirectTo },
      body: { email, code_challenge: codeChallenge, code_challenge_method: "s256" },
    });
  },
  updateUser(accessToken, attributes) {
    return authCall("/user", { method: "PUT", token: accessToken, body: attributes });
  },
};
