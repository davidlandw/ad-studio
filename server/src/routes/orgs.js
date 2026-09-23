const express = require("express");
const { wrap, bad, notFound, HttpError } = require("../errors");
const { requireUser, requireOrgRole } = require("../auth");
const { newToken, sha256 } = require("../security");
const config = require("../config");
const mailer = require("../mailer");
const quota = require("../quota");
const rl = require("../ratelimit");

module.exports = (db) => {
  const r = express.Router();
  r.use(requireUser);

  r.post("/orgs", wrap(async (req, res) => {
    const name = String(req.body.name || "").trim();
    if (!name) throw bad("יש למלא שם ארגון");
    const id = db.transaction(() => {
      const o = db.prepare("INSERT INTO organizations (name) VALUES (?)").run(name);
      db.prepare("INSERT INTO memberships (user_id, org_id, role) VALUES (?,?,'owner')").run(req.user.id, o.lastInsertRowid);
      return o.lastInsertRowid;
    })();
    res.status(201).json({ id, name, role: "owner" });
  }));

  r.patch("/orgs/:orgId", wrap(async (req, res) => {
    requireOrgRole(db, req.user.id, +req.params.orgId, ["owner", "admin"]);
    const name = String(req.body.name || "").trim();
    if (!name) throw bad("יש למלא שם ארגון");
    db.prepare("UPDATE organizations SET name = ? WHERE id = ?").run(name, +req.params.orgId);
    res.json({ ok: true });
  }));

  r.get("/orgs/:orgId/members", wrap(async (req, res) => {
    requireOrgRole(db, req.user.id, +req.params.orgId);
    res.json(db.prepare(`SELECT u.id, u.name, u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id
                         WHERE m.org_id = ? ORDER BY m.role, u.name`).all(+req.params.orgId));
  }));

  // ---------- invitations (email) ----------
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const ROLE_HE = { owner: "בעלים", admin: "מנהל/ת", member: "חבר/ה" };

  r.get("/orgs/:orgId/invitations", wrap(async (req, res) => {
    requireOrgRole(db, req.user.id, +req.params.orgId, ["owner", "admin"]);
    res.json(db.prepare(`SELECT i.id, i.email, i.role, i.created_at, i.expires_at, u.name AS invited_by_name FROM invitations i
      JOIN users u ON u.id = i.invited_by WHERE i.org_id = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ?
      ORDER BY i.created_at DESC`).all(+req.params.orgId, new Date().toISOString()));
  }));

  r.post("/orgs/:orgId/invitations", wrap(async (req, res) => {
    const orgId = +req.params.orgId;
    const myRole = requireOrgRole(db, req.user.id, orgId, ["owner", "admin"]);
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!EMAIL.test(email)) throw bad("כתובת אימייל לא תקינה");
    const role = ["admin", "member", "owner"].includes(req.body.role) ? req.body.role : "member";
    if (role === "owner" && myRole !== "owner") throw new HttpError(403, "רק בעלים יכול להזמין בעלים", "forbidden");
    if (db.prepare("SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ? AND u.email = ?").get(orgId, email))
      throw new HttpError(409, "המשתמש כבר חבר בארגון", "exists");
    rl.consume(res, `invite-org:${orgId}`, ...rl.LIMITS.invitesPerOrg, "נשלחו יותר מדי הזמנות היום");
    const token = newToken();
    const expires = new Date(Date.now() + config.inviteDays * 864e5).toISOString();
    const org = db.prepare("SELECT name FROM organizations WHERE id = ?").get(orgId);
    db.transaction(() => {
      // re-inviting the same address replaces the previous pending invitation
      db.prepare("UPDATE invitations SET revoked_at = datetime('now') WHERE org_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL").run(orgId, email);
      db.prepare("INSERT INTO invitations (org_id, email, role, token_hash, invited_by, expires_at) VALUES (?,?,?,?,?,?)")
        .run(orgId, email, role, sha256(token), req.user.id, expires);
    })();
    await mailer.send({
      to: email, subject: `הזמנה להצטרף ל-${org.name} — קונספטה`, title: "הוזמנת לעבוד יחד",
      paragraphs: [`${req.user.name} הזמין/ה אותך להצטרף לארגון "${org.name}" בתפקיד ${ROLE_HE[role]}.`,
        `ההזמנה תקפה ל-${config.inviteDays} ימים. אם אין לך עדיין חשבון, אפשר להירשם מהקישור עם הכתובת הזו.`],
      action: { label: "צפייה בהזמנה", url: `${config.appUrl}/invite/${token}` },
    }).catch((e) => { throw new HttpError(502, `ההזמנה נשמרה אבל שליחת המייל נכשלה: ${e.message}`, "mail_failed"); });
    res.status(201).json({ ok: true });
  }));

  r.delete("/orgs/:orgId/invitations/:iid", wrap(async (req, res) => {
    requireOrgRole(db, req.user.id, +req.params.orgId, ["owner", "admin"]);
    const info = db.prepare("UPDATE invitations SET revoked_at = datetime('now') WHERE id = ? AND org_id = ? AND accepted_at IS NULL AND revoked_at IS NULL")
      .run(+req.params.iid, +req.params.orgId);
    if (!info.changes) throw notFound("ההזמנה לא נמצאה");
    res.json({ ok: true });
  }));

  // ---------- usage & quotas ----------
  r.get("/orgs/:orgId/usage", wrap(async (req, res) => {
    requireOrgRole(db, req.user.id, +req.params.orgId);
    res.json(quota.usage(db, +req.params.orgId));
  }));

  // Platform admins (PLATFORM_ADMINS env) set per-org quotas. null = back to the server default.
  r.put("/admin/orgs/:orgId/quota", wrap(async (req, res) => {
    if (!quota.isPlatformAdmin(req.user)) throw new HttpError(403, "פעולה למנהלי מערכת בלבד", "forbidden");
    const orgId = +req.params.orgId;
    if (!db.prepare("SELECT 1 FROM organizations WHERE id = ?").get(orgId)) throw notFound("הארגון לא נמצא");
    const val = (v) => (v === null || v === "" || v === undefined ? null : Math.max(0, Math.floor(+v)));
    const t = val(req.body.text), i = val(req.body.image);
    if ((t !== null && !Number.isFinite(t)) || (i !== null && !Number.isFinite(i))) throw bad("מכסה לא תקינה");
    db.prepare("UPDATE organizations SET quota_text_monthly = ?, quota_image_monthly = ? WHERE id = ?").run(t, i, orgId);
    res.json(quota.usage(db, orgId));
  }));

  r.get("/admin/orgs", wrap(async (req, res) => {
    if (!quota.isPlatformAdmin(req.user)) throw new HttpError(403, "פעולה למנהלי מערכת בלבד", "forbidden");
    const orgs = db.prepare("SELECT id, name FROM organizations ORDER BY name").all();
    res.json(orgs.map((o) => ({ ...o, usage: quota.usage(db, o.id) })));
  }));

  r.patch("/orgs/:orgId/members/:userId", wrap(async (req, res) => {
    const orgId = +req.params.orgId, userId = +req.params.userId;
    const myRole = requireOrgRole(db, req.user.id, orgId, ["owner", "admin"]);
    const role = req.body.role;
    if (!["owner", "admin", "member"].includes(role)) throw bad("תפקיד לא תקין");
    const target = db.prepare("SELECT role FROM memberships WHERE user_id=? AND org_id=?").get(userId, orgId);
    if (!target) throw notFound("החבר לא נמצא");
    if ((role === "owner" || target.role === "owner") && myRole !== "owner") throw new HttpError(403, "רק בעלים יכול לשנות בעלות", "forbidden");
    if (target.role === "owner" && role !== "owner") assertNotLastOwner(orgId);
    db.prepare("UPDATE memberships SET role=? WHERE user_id=? AND org_id=?").run(role, userId, orgId);
    res.json({ ok: true });
  }));

  r.delete("/orgs/:orgId/members/:userId", wrap(async (req, res) => {
    const orgId = +req.params.orgId, userId = +req.params.userId;
    const self = userId === req.user.id;
    const myRole = requireOrgRole(db, req.user.id, orgId, self ? ["owner", "admin", "member"] : ["owner", "admin"]);
    const target = db.prepare("SELECT role FROM memberships WHERE user_id=? AND org_id=?").get(userId, orgId);
    if (!target) throw notFound("החבר לא נמצא");
    if (target.role === "owner" && !self && myRole !== "owner") throw new HttpError(403, "רק בעלים יכול להסיר בעלים", "forbidden");
    if (target.role === "owner") assertNotLastOwner(orgId);
    db.prepare("DELETE FROM memberships WHERE user_id=? AND org_id=?").run(userId, orgId);
    res.json({ ok: true });
  }));

  function assertNotLastOwner(orgId) {
    const n = db.prepare("SELECT COUNT(*) n FROM memberships WHERE org_id=? AND role='owner'").get(orgId).n;
    if (n <= 1) throw new HttpError(409, "לארגון חייב להישאר לפחות בעלים אחד", "last_owner");
  }

  return r;
};
