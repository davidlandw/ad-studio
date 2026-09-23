/**
 * Shared libraries: fonts and saved elements.
 * Ownership is the organization (every member can use them). Visibility:
 *   org    — members of the owning org
 *   public — every signed-in user of the system, in any org (read/use only)
 * Only the creator or an owner/admin of the owning org may rename, change visibility or delete.
 */
const express = require("express");
const multer = require("multer");
const config = require("../config");
const files = require("../files");
const { wrap, bad, notFound, forbidden } = require("../errors");
const { requireUser, membership, requireOrgRole } = require("../auth");

const fontUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxFontBytes, files: 1 } });
const VIS = ["org", "public"];

module.exports = (db) => {
  const r = express.Router();
  r.use(["/fonts", "/library"], requireUser);

  const myOrgIds = (uid) => db.prepare("SELECT org_id FROM memberships WHERE user_id = ?").all(uid).map((m) => m.org_id);
  const canManage = (user, row) => row.created_by === user.id || ["owner", "admin"].includes(membership(db, user.id, row.org_id));
  const canUse = (user, row) => row.visibility === "public" || !!membership(db, user.id, row.org_id);

  /**
   * scope: "org" = items of orgId; "public" = public items of other orgs; "all" = both (default).
   * Items of the user's other orgs are NOT mixed in: a library is per org, cross-org sharing is via public.
   */
  function listQuery(table, user, { orgId, scope = "all", q = "", extra = "" }) {
    if (!orgId || !membership(db, user.id, orgId)) throw notFound("הארגון לא נמצא");
    const where = [];
    if (scope !== "public") where.push("t.org_id = @orgId");
    if (scope !== "org") where.push("(t.visibility = 'public' AND t.org_id <> @orgId)");
    const search = q ? `AND ${table === "fonts" ? "t.family" : "t.name"} LIKE @q` : "";
    return db.prepare(`SELECT t.*, o.name AS org_name, u.name AS creator_name FROM ${table} t
        JOIN organizations o ON o.id = t.org_id LEFT JOIN users u ON u.id = t.created_by
        WHERE (${where.join(" OR ")}) ${search} ${extra} ORDER BY t.org_id = @orgId DESC, t.created_at DESC LIMIT 500`)
      .all({ orgId, q: `%${q}%` });
  }
  const loadRow = (table, id) => db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);

  // ---------------- fonts ----------------
  const fontDto = (f, user, orgId) => ({
    id: f.id, family: f.family, weight: f.weight, style: f.style, format: f.format,
    orgId: f.org_id, orgName: f.org_name, visibility: f.visibility,
    creatorName: f.org_id === orgId ? f.creator_name : null, // don't expose people's names to other orgs
    own: f.org_id === orgId, canManage: canManage(user, f),
  });

  r.get("/fonts", wrap(async (req, res) => {
    const orgId = +req.query.orgId;
    res.json(listQuery("fonts", req.user, { orgId, scope: req.query.scope, q: String(req.query.q || "") })
      .map((f) => fontDto(f, req.user, orgId)));
  }));

  r.post("/fonts", fontUpload.single("file"), wrap(async (req, res) => {
    if (!req.file) throw bad("לא נבחר קובץ");
    const orgId = +req.body.orgId;
    requireOrgRole(db, req.user.id, orgId); // any member can add to the org library
    const sig = files.sniffFont(req.file.buffer);
    const family = String(req.body.family || req.file.originalname.replace(/\.[^.]+$/, "")).trim().slice(0, 80);
    if (!family) throw bad("יש לתת שם למשפחת הפונט");
    const weight = Math.min(900, Math.max(100, Math.round((+req.body.weight || 400) / 100) * 100));
    const style = req.body.style === "italic" ? "italic" : "normal";
    const visibility = VIS.includes(req.body.visibility) ? req.body.visibility : "org";
    const rel = files.save("fonts", req.file.buffer, sig.ext);
    const info = db.prepare(`INSERT INTO fonts (org_id, created_by, visibility, family, weight, style, file, format) VALUES (?,?,?,?,?,?,?,?)`)
      .run(orgId, req.user.id, visibility, family, weight, style, rel, sig.format);
    res.status(201).json({ id: info.lastInsertRowid, family, weight, style, format: sig.format, orgId, visibility });
  }));

  r.get("/fonts/:id/file", wrap(async (req, res) => {
    const f = loadRow("fonts", +req.params.id);
    if (!f || !canUse(req.user, f)) throw notFound("הפונט לא נמצא");
    const mime = { truetype: "font/ttf", opentype: "font/otf", woff: "font/woff", woff2: "font/woff2" }[f.format];
    res.set("Content-Type", mime).set("Cache-Control", "private, max-age=86400").sendFile(files.abs(f.file));
  }));

  r.patch("/fonts/:id", wrap(async (req, res) => {
    const f = loadRow("fonts", +req.params.id);
    if (!f || !canUse(req.user, f)) throw notFound("הפונט לא נמצא");
    if (!canManage(req.user, f)) throw forbidden("רק מי שהעלה את הפונט או מנהל בארגון שלו יכולים לשנות אותו");
    const visibility = VIS.includes(req.body.visibility) ? req.body.visibility : f.visibility;
    const family = req.body.family !== undefined ? String(req.body.family).trim().slice(0, 80) || f.family : f.family;
    db.prepare("UPDATE fonts SET visibility = ?, family = ? WHERE id = ?").run(visibility, family, f.id);
    res.json({ ok: true, visibility, family });
  }));

  r.delete("/fonts/:id", wrap(async (req, res) => {
    const f = loadRow("fonts", +req.params.id);
    if (!f || !canUse(req.user, f)) throw notFound("הפונט לא נמצא");
    if (!canManage(req.user, f)) throw forbidden("רק מי שהעלה את הפונט או מנהל בארגון שלו יכולים למחוק אותו");
    db.prepare("DELETE FROM fonts WHERE id = ?").run(f.id);
    files.remove(f.file);
    res.json({ ok: true });
  }));

  // ---------------- element library ----------------
  const elDto = (e, user, orgId) => ({
    id: e.id, name: e.name, kind: e.element_kind, keyColor: e.key_color, prompt: e.prompt,
    orgId: e.org_id, orgName: e.org_name, visibility: e.visibility, createdAt: e.created_at,
    creatorName: e.org_id === orgId ? e.creator_name : null, // don't expose people's names to other orgs
    own: e.org_id === orgId, canManage: canManage(user, e),
  });

  r.get("/library/elements", wrap(async (req, res) => {
    const orgId = +req.query.orgId;
    const kind = ["background", "object"].includes(req.query.kind) ? req.query.kind : null;
    res.json(listQuery("library_elements", req.user, { orgId, scope: req.query.scope, q: String(req.query.q || ""),
      extra: kind ? `AND t.element_kind = '${kind}'` : "" }).map((e) => elDto(e, req.user, orgId)));
  }));

  r.get("/library/elements/:id/file", wrap(async (req, res) => {
    const e = loadRow("library_elements", +req.params.id);
    if (!e || !canUse(req.user, e)) throw notFound("האלמנט לא נמצא");
    res.set("Content-Type", e.mime).set("Cache-Control", "private, max-age=31536000, immutable").sendFile(files.abs(e.file));
  }));

  r.patch("/library/elements/:id", wrap(async (req, res) => {
    const e = loadRow("library_elements", +req.params.id);
    if (!e || !canUse(req.user, e)) throw notFound("האלמנט לא נמצא");
    if (!canManage(req.user, e)) throw forbidden("רק מי ששמר את האלמנט או מנהל בארגון שלו יכולים לשנות אותו");
    const visibility = VIS.includes(req.body.visibility) ? req.body.visibility : e.visibility;
    const name = req.body.name !== undefined ? String(req.body.name).trim().slice(0, 80) || e.name : e.name;
    db.prepare("UPDATE library_elements SET visibility = ?, name = ? WHERE id = ?").run(visibility, name, e.id);
    res.json({ ok: true, visibility, name });
  }));

  r.delete("/library/elements/:id", wrap(async (req, res) => {
    const e = loadRow("library_elements", +req.params.id);
    if (!e || !canUse(req.user, e)) throw notFound("האלמנט לא נמצא");
    if (!canManage(req.user, e)) throw forbidden("רק מי ששמר את האלמנט או מנהל בארגון שלו יכולים למחוק אותו");
    db.prepare("DELETE FROM library_elements WHERE id = ?").run(e.id);
    files.remove(e.file);
    res.json({ ok: true });
  }));

  return r;
};

/**
 * Copies a project asset into the org library (own file, so it survives project deletion).
 * Idempotent per source asset.
 */
module.exports.saveToLibrary = function saveToLibrary(db, { asset, element, orgId, userId, name }) {
  if (asset.from_library_id) { // already in a library — don't duplicate
    const src = db.prepare("SELECT * FROM library_elements WHERE id = ?").get(asset.from_library_id);
    if (src) return src;
  }
  const existing = db.prepare("SELECT * FROM library_elements WHERE source_asset_id = ?").get(asset.id);
  if (existing) return existing;
  const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[asset.mime] || "png";
  const rel = files.save(`library/o${orgId}`, files.read(asset.file), ext);
  const info = db.prepare(`INSERT INTO library_elements (org_id, created_by, name, element_kind, key_color, prompt, file, mime, source_asset_id)
                           VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(orgId, userId, (name || element.name).slice(0, 80), element.kind, element.kind === "object" ? element.key_color : null,
      element.prompt, rel, asset.mime, asset.id);
  return db.prepare("SELECT * FROM library_elements WHERE id = ?").get(info.lastInsertRowid);
};
