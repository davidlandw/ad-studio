/**
 * In-memory sliding-window rate limiter (single process). See DECISIONS.md D29 for the multi-instance caveat.
 */
const { HttpError } = require("./errors");

const buckets = new Map(); // key -> number[] (timestamps, ms)

function hit(key, limit, windowMs, now = Date.now()) {
  const arr = (buckets.get(key) || []).filter((t) => t > now - windowMs);
  if (arr.length >= limit) {
    buckets.set(key, arr);
    return { ok: false, retryAfter: Math.ceil((arr[0] + windowMs - now) / 1000) };
  }
  arr.push(now);
  buckets.set(key, arr);
  return { ok: true };
}

/** Throws 429 (with Retry-After) when over the limit. */
function consume(res, key, limit, windowMs, message = "יותר מדי ניסיונות. נסו שוב מאוחר יותר.") {
  const r = hit(key, limit, windowMs);
  if (!r.ok) {
    res?.set?.("Retry-After", String(r.retryAfter));
    const mins = Math.max(1, Math.ceil(r.retryAfter / 60));
    throw new HttpError(429, `${message} (בעוד כ-${mins} דק')`, "rate_limited");
  }
}

/** Middleware form. keyFn(req) -> string | null (null = skip). */
const limit = (name, max, windowMs, keyFn, message) => (req, res, next) => {
  try {
    const k = keyFn(req);
    if (k != null) consume(res, `${name}:${k}`, max, windowMs, message);
    next();
  } catch (e) { next(e); }
};

const reset = () => buckets.clear();
setInterval(() => { // drop idle keys (1h+)
  const cutoff = Date.now() - 36e5;
  for (const [k, arr] of buckets) if (!arr.length || arr[arr.length - 1] < cutoff) buckets.delete(k);
}, 6e5).unref();

const MIN = 60e3, HOUR = 36e5;
const ip = (req) => req.ip || req.socket?.remoteAddress || "unknown";
const email = (req) => String(req.body?.email || "").trim().toLowerCase();

module.exports = {
  hit, consume, limit, reset, MIN, HOUR, ip, email,
  // Named limits (single place to tune)
  LIMITS: {
    loginPerAccountIp: [10, 15 * MIN], // brute force from one source
    loginPerAccount: [100, 15 * MIN],  // distributed attack on one account, high enough to limit lockout-DoS
    loginPerIp: [50, 15 * MIN],
    registerPerIp: [20, HOUR],
    forgotPerEmail: [3, HOUR],
    forgotPerIp: [10, HOUR],
    resetPerIp: [20, HOUR],
    inviteAcceptPerIp: [30, HOUR],
    invitesPerOrg: [50, 24 * HOUR],
    keyVerifyPerUser: [10, HOUR],
    generatePerUser: [30, MIN],
    generatePerOrg: [120, MIN],
  },
};
