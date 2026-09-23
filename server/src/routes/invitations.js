// Public-token endpoints for accepting an invitation (the org-side management lives in orgs.js).
const express = require("express");
const { wrap, HttpError } = require("../errors");
const { sha256 } = require("../security");
const rl = require("../ratelimit");

module.exports = (db) => {
  const r = express.Router();
  const find = (token) => db.prepare(`SELECT i.*, o.name AS org_name, u.name AS inviter FROM invitations i
      JOIN organizations o ON o.id = i.org_id JOIN users u ON u.id = i.invited_by WHERE i.token_hash = ?`).get(sha256(String(token)));
  const state = (i) => (!i ? "invalid" : i.revoked_at ? "revoked" : i.accepted_at ? "accepted" : i.expires_at < new Date().toISOString() ? "expired" : "pending");

  // Readable without login so the invitee sees what they were invited to before registering.
  r.get("/invitations/:token", rl.limit("invite-view", ...rl.LIMITS.inviteAcceptPerIp, rl.ip), wrap(async (req, res) => {
    const i = find(req.params.token);
    const s = state(i);
    if (s === "invalid") throw new HttpError(404, "ההזמנה לא נמצאה", "not_found");
    res.json({ status: s, orgName: i.org_name, inviter: i.inviter, email: i.email, role: i.role, expiresAt: i.expires_at });
  }));

  r.post("/invitations/:token/accept", rl.limit("invite-accept", ...rl.LIMITS.inviteAcceptPerIp, rl.ip), wrap(async (req, res) => {
    if (!req.user) throw new HttpError(401, "יש להתחבר", "unauthenticated");
    const i = find(req.params.token);
    const s = state(i);
    if (s !== "pending") throw new HttpError(400, { invalid: "ההזמנה לא נמצאה", revoked: "ההזמנה בוטלה", accepted: "ההזמנה כבר מומשה", expired: "פג תוקף ההזמנה. בקשו הזמנה חדשה." }[s], "bad_invite");
    // Bound to the invited address: a forwarded link can't be used by someone else.
    if (i.email.toLowerCase() !== req.user.email.toLowerCase())
      throw new HttpError(403, `ההזמנה נשלחה ל-${i.email}. התחברו עם הכתובת הזו כדי לקבל אותה.`, "wrong_account");
    db.transaction(() => {
      db.prepare("INSERT OR IGNORE INTO memberships (user_id, org_id, role) VALUES (?,?,?)").run(req.user.id, i.org_id, i.role);
      db.prepare("UPDATE invitations SET accepted_at = datetime('now') WHERE id = ?").run(i.id);
    })();
    res.json({ ok: true, orgId: i.org_id, orgName: i.org_name });
  }));
  return r;
};
