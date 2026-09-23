const express = require("express");
const { wrap, bad, HttpError } = require("../errors");
const { hashPassword, verifyPassword, encrypt, decrypt, maskKey, newToken, sha256 } = require("../security");
const { startSession, endSession, requireUser } = require("../auth");
const gemini = require("../gemini");
const config = require("../config");
const mailer = require("../mailer");
const rl = require("../ratelimit");
const { isPlatformAdmin } = require("../quota");

const L = rl.LIMITS;
const MSG_LOGIN = "יותר מדי ניסיונות התחברות";

module.exports = (db) => {
  const r = express.Router();

  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  r.post("/auth/register", rl.limit("register-ip", ...L.registerPerIp, rl.ip), wrap(async (req, res) => {
    const email = String(req.body.email || "").trim();
    const name = String(req.body.name || "").trim();
    const password = String(req.body.password || "");
    if (!EMAIL.test(email)) throw bad("כתובת אימייל לא תקינה");
    if (!name) throw bad("יש למלא שם");
    if (password.length < 8) throw bad("סיסמה חייבת להכיל לפחות 8 תווים");
    if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) throw new HttpError(409, "האימייל כבר רשום", "email_taken");
    const userId = db.transaction(() => {
      const u = db.prepare("INSERT INTO users (email, name, password_hash) VALUES (?,?,?)").run(email, name, hashPassword(password));
      const o = db.prepare("INSERT INTO organizations (name) VALUES (?)").run(`הסטודיו של ${name}`);
      db.prepare("INSERT INTO memberships (user_id, org_id, role) VALUES (?,?, 'owner')").run(u.lastInsertRowid, o.lastInsertRowid);
      return u.lastInsertRowid;
    })();
    startSession(db, res, userId);
    res.status(201).json({ ok: true });
  }));

  r.post("/auth/login",
    rl.limit("login-ip", ...L.loginPerIp, rl.ip, MSG_LOGIN),
    rl.limit("login-acct-ip", ...L.loginPerAccountIp, (req) => (rl.email(req) ? `${rl.email(req)}|${rl.ip(req)}` : null), MSG_LOGIN),
    rl.limit("login-acct", ...L.loginPerAccount, (req) => rl.email(req) || null, MSG_LOGIN),
    wrap(async (req, res) => {
    const u = db.prepare("SELECT id, password_hash FROM users WHERE email = ?").get(String(req.body.email || "").trim());
    if (!u || !verifyPassword(String(req.body.password || ""), u.password_hash)) throw new HttpError(401, "אימייל או סיסמה שגויים", "bad_login");
    startSession(db, res, u.id);
    res.json({ ok: true });
  }));

  // Always the same answer, whether or not the email exists (no account enumeration).
  r.post("/auth/forgot",
    rl.limit("forgot-ip", ...L.forgotPerIp, rl.ip),
    wrap(async (req, res) => {
      const email = rl.email(req);
      if (!EMAIL.test(email)) throw bad("כתובת אימייל לא תקינה");
      const ok = { ok: true, message: "אם הכתובת רשומה, נשלח אליה קישור לאיפוס סיסמה. הקישור תקף לשעה." };
      if (!rl.hit(`forgot-email:${email}`, ...L.forgotPerEmail).ok) return res.json(ok); // silently cap per address
      const u = db.prepare("SELECT id, name, email FROM users WHERE email = ?").get(email);
      if (u) {
        const token = newToken();
        const expires = new Date(Date.now() + config.resetTokenMinutes * 60e3).toISOString();
        db.transaction(() => {
          db.prepare("DELETE FROM password_resets WHERE user_id = ?").run(u.id); // one live token per user
          db.prepare("INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?,?,?)").run(sha256(token), u.id, expires);
        })();
        mailer.sendQuiet({
          to: u.email, subject: "איפוס סיסמה — קונספטה", title: `שלום ${u.name},`,
          paragraphs: ["קיבלנו בקשה לאפס את הסיסמה לחשבון שלך.", `הקישור תקף ל-${config.resetTokenMinutes} דקות ולשימוש אחד.`, "אם לא ביקשת איפוס, אפשר להתעלם מההודעה — הסיסמה לא תשתנה."],
          action: { label: "בחירת סיסמה חדשה", url: `${config.appUrl}/reset/${token}` },
        });
      }
      res.json(ok);
    }));

  r.post("/auth/reset", rl.limit("reset-ip", ...L.resetPerIp, rl.ip), wrap(async (req, res) => {
    const token = String(req.body.token || "");
    const password = String(req.body.password || "");
    if (password.length < 8) throw bad("סיסמה חייבת להכיל לפחות 8 תווים");
    const row = db.prepare("SELECT * FROM password_resets WHERE token_hash = ?").get(sha256(token));
    if (!row || row.used_at || row.expires_at < new Date().toISOString())
      throw new HttpError(400, "הקישור לא תקף או שפג תוקפו. בקשו קישור חדש.", "bad_token");
    db.transaction(() => {
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(password), row.user_id);
      db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE token_hash = ?").run(row.token_hash);
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(row.user_id); // log out everywhere
    })();
    startSession(db, res, row.user_id);
    res.json({ ok: true });
  }));

  r.post("/auth/logout", (req, res) => { endSession(db, req, res); res.json({ ok: true }); });

  function meDto(req) {
    const orgs = db.prepare(`SELECT o.id, o.name, m.role FROM memberships m JOIN organizations o ON o.id = m.org_id
                             WHERE m.user_id = ? ORDER BY o.name`).all(req.user.id);
    let masked = null;
    if (req.user.gemini_key_enc) { try { masked = maskKey(decrypt(req.user.gemini_key_enc)); } catch { masked = "(לא ניתן לפענח — הזינו מחדש)"; } }
    return { user: { id: req.user.id, email: req.user.email, name: req.user.name }, orgs,
      gemini: { hasKey: !!req.user.gemini_key_enc, masked }, isPlatformAdmin: isPlatformAdmin(req.user) };
  }
  r.get("/me", requireUser, (req, res) => res.json(meDto(req)));
  // Boot probe for the SPA: 200 either way, so a logged-out visit is not an error.
  r.get("/auth/session", (req, res) => res.json(req.user ? meDto(req) : { user: null }));

  r.put("/me/gemini-key", requireUser, rl.limit("keyverify", ...L.keyVerifyPerUser, (req) => req.user.id), wrap(async (req, res) => {
    const key = String(req.body.key || "").trim();
    if (key.length < 8 || /\s/.test(key)) throw bad("מפתח לא תקין");
    const check = await gemini.verifyKey(key).catch(() => ({ ok: false }));
    if (!check.ok) throw bad("גוגל דחתה את המפתח — בדקו אותו ב-Google AI Studio");
    db.prepare("UPDATE users SET gemini_key_enc = ? WHERE id = ?").run(encrypt(key), req.user.id);
    res.json({ ok: true, masked: maskKey(key) });
  }));

  r.delete("/me/gemini-key", requireUser, (req, res) => {
    db.prepare("UPDATE users SET gemini_key_enc = NULL WHERE id = ?").run(req.user.id);
    res.json({ ok: true });
  });

  return r;
};
