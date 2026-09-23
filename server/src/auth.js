const config = require("./config");
const { newToken, sha256 } = require("./security");
const { HttpError, forbidden, notFound } = require("./errors");

const COOKIE = "sid";

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map((c) => c.trim().split("=")).filter((p) => p[0])
    .map(([k, ...v]) => [k, decodeURIComponent(v.join("="))]));
}

function startSession(db, res, userId) {
  const token = newToken();
  const expires = new Date(Date.now() + config.sessionDays * 864e5);
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)").run(sha256(token), userId, expires.toISOString());
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Expires=${expires.toUTCString()}${config.isProd ? "; Secure" : ""}`);
}
function endSession(db, req, res) {
  const t = parseCookies(req.headers.cookie)[COOKIE];
  if (t) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(t));
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

/** Attaches req.user if the session cookie is valid. */
function sessionMiddleware(db) {
  const q = db.prepare(`SELECT u.id, u.email, u.name, u.gemini_key_enc FROM sessions s JOIN users u ON u.id = s.user_id
                        WHERE s.token_hash = ? AND s.expires_at > ?`);
  return (req, _res, next) => {
    const t = parseCookies(req.headers.cookie)[COOKIE];
    req.user = t ? q.get(sha256(t), new Date().toISOString()) || null : null;
    next();
  };
}

// CSRF mitigation for cookie auth: state-changing requests must carry a header a cross-site form cannot set.
function csrfGuard(req, _res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.get("X-Requested-With") !== "adstudio") return next(new HttpError(403, "חסרה כותרת בקשה", "csrf"));
  next();
}

function requireUser(req, _res, next) {
  if (!req.user) return next(new HttpError(401, "יש להתחבר", "unauthenticated"));
  next();
}

function membership(db, userId, orgId) {
  return db.prepare("SELECT role FROM memberships WHERE user_id = ? AND org_id = ?").get(userId, orgId)?.role || null;
}
function requireOrgRole(db, userId, orgId, roles = ["owner", "admin", "member"]) {
  const role = membership(db, userId, orgId);
  if (!role) throw notFound("הארגון לא נמצא");
  if (!roles.includes(role)) throw forbidden();
  return role;
}
/** Loads a project only if the user is a member of its org (404 otherwise — don't leak existence). */
function loadProject(db, userId, projectId) {
  const p = db.prepare(`SELECT p.* FROM projects p JOIN memberships m ON m.org_id = p.org_id AND m.user_id = ?
                        WHERE p.id = ?`).get(userId, projectId);
  if (!p) throw notFound("הפרויקט לא נמצא");
  return p;
}

module.exports = { startSession, endSession, sessionMiddleware, csrfGuard, requireUser, membership, requireOrgRole, loadProject };
