// Small in-memory limits per visitor on sign-in, sign-up, password resets,
// email links, session refreshes and bookings.
//
// Supabase limits its sign-in service per internet address, and to Supabase
// every request comes from this one server (sign-ins, session refreshes and
// email-link logins share about 150 calls per 5 minutes). These limits stop
// any one visitor from using up much of that, and slow down password
// guessing. Raise Supabase's own limits (Authentication -> Rate Limits) as the
// site grows, since this server is the only thing calling it.

const buckets = new Map(); // key -> { count, resetAt }

/**
 * The visitor's IP address. Each proxy in front of the site (Render's,
 * Railway's, Caddy...) adds the address it saw to the end of X-Forwarded-For,
 * so the entry TRUSTED_PROXY_HOPS from the end (default 1) was written by
 * your own host and can't be faked by the visitor. Set TRUSTED_PROXY_HOPS=0
 * when nothing sits in front of the site.
 */
export function clientIp(ctx) {
  const setting = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? "", 10);
  const hops = Number.isNaN(setting) ? 1 : setting;
  const forwarded = String(ctx.req.headers["x-forwarded-for"] || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (hops > 0 && forwarded.length) return forwarded[Math.max(0, forwarded.length - hops)];
  return ctx.req.socket?.remoteAddress || "unknown";
}

/**
 * Who to count an attempt against: the IPv4 address, or for IPv6 the /64
 * network, since one home or phone gets a whole /64 to pick addresses from.
 */
export function visitorKey(ctx) {
  let ip = clientIp(ctx).replace(/^\[|\](:\d+)?$/g, "").replace(/%.*$/, "");
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/i.exec(ip);
  if (v4) return v4[1];
  if (!ip.includes(":")) return ip;
  ip = ip.toLowerCase();
  const [head, tail = ""] = ip.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const fill = Array(Math.max(0, 8 - headParts.length - tailParts.length)).fill("0");
  const parts = [...headParts, ...fill, ...tailParts].map((part) => part.replace(/^0+(?=.)/, ""));
  return `${parts.slice(0, 4).join(":")}::/64`;
}

/**
 * Counts one attempt for `key` and returns true once there have been more
 * than `limit` attempts within `windowSeconds`.
 */
export function tooManyAttempts(key, { limit, windowSeconds }) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowSeconds * 1000 };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count > limit;
}

/** True once this visitor has used up its limit for `action`. */
export function overLimit(ctx, action, limit) {
  return tooManyAttempts(`${action}:${visitorKey(ctx)}`, limit);
}

/** Per-visitor limits. A real customer never gets near these. */
export const LIMITS = {
  signIn: { limit: 10, windowSeconds: 300 },
  refresh: { limit: 30, windowSeconds: 300 },
  emailLink: { limit: 10, windowSeconds: 300 },
  signUp: { limit: 5, windowSeconds: 600 },
  reset: { limit: 5, windowSeconds: 600 },
};

// Forget finished windows so memory stays small.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
}, 60_000).unref();
