/** Monthly generation quotas per organization + per-user/org burst rate limits. */
const config = require("./config");
const { HttpError } = require("./errors");
const rl = require("./ratelimit");

function monthStart(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}
function nextMonthStart(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
}

function limits(db, orgId) {
  const o = db.prepare("SELECT quota_text_monthly t, quota_image_monthly i FROM organizations WHERE id = ?").get(orgId) || {};
  return { text: o.t ?? config.quotaTextMonthly, image: o.i ?? config.quotaImageMonthly, customText: o.t != null, customImage: o.i != null };
}

function usage(db, orgId) {
  const since = monthStart();
  const rows = db.prepare("SELECT kind, COUNT(*) n FROM usage_events WHERE org_id = ? AND created_at >= ? GROUP BY kind").all(orgId, since);
  const used = { text: 0, image: 0 };
  for (const r of rows) used[r.kind] = r.n;
  const lim = limits(db, orgId);
  return {
    periodStart: since, resetsAt: nextMonthStart(),
    text: { used: used.text, limit: lim.text, custom: lim.customText },
    image: { used: used.image, limit: lim.image, custom: lim.customImage },
  };
}

/**
 * Wraps one Gemini call: burst limits → monthly quota check → call → record usage (only on success).
 * Counting only successes means concurrent calls can overshoot by at most the in-flight count (documented, D31).
 */
async function metered(db, req, res, orgId, kind, fn) {
  const [pu, wu] = rl.LIMITS.generatePerUser, [po, wo] = rl.LIMITS.generatePerOrg;
  rl.consume(res, `gen-user:${req.user.id}`, pu, wu, "יותר מדי יצירות בזמן קצר");
  rl.consume(res, `gen-org:${orgId}`, po, wo, "הארגון שלח יותר מדי יצירות בזמן קצר");
  const u = usage(db, orgId)[kind];
  if (u.used >= u.limit) {
    const d = new Date(nextMonthStart()).toLocaleDateString("he-IL");
    throw new HttpError(429, `מכסת ה${kind === "image" ? "תמונות" : "יצירות הטקסט"} החודשית של הארגון נוצלה (${u.used}/${u.limit}). היא תתחדש ב-${d}.`, "quota_exceeded");
  }
  const out = await fn();
  db.prepare("INSERT INTO usage_events (org_id, user_id, kind) VALUES (?,?,?)").run(orgId, req.user.id, kind);
  return out;
}

const isPlatformAdmin = (user) => !!user && config.platformAdmins.includes(String(user.email).toLowerCase());

module.exports = { usage, limits, metered, isPlatformAdmin, monthStart };
