/**
 * Clients — top of the hierarchy (client -> product -> campaign -> ad).
 * Each client has a brief (P.CLIENT_FIELDS) and a documents folder (logo, brand guide, anything else).
 * Access is by org membership, same as every other resource (D14).
 */
const express = require("express");
const multer = require("multer");
const config = require("../config");
const files = require("../files");
const P = require("../pipeline");
const docs = require("../documents");
const { wrap, bad, notFound } = require("../errors");
const { requireUser, requireOrgRole } = require("../auth");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxImageBytes, files: 1 } });
const J = (s, d = {}) => { if (s == null) return d; try { return JSON.parse(s); } catch { return d; } };

module.exports = (db) => {
  const r = express.Router();
  r.use(requireUser);

  const briefOf = (body) => { const b = {}; for (const k of Object.keys(P.CLIENT_FIELDS)) b[k] = String(body?.[k] ?? "").slice(0, 2000); return b; };
  const dto = (c) => ({ id: c.id, orgId: c.org_id, name: c.name, isDefault: !!c.is_default, brief: J(c.brief_json), createdAt: c.created_at, updatedAt: c.updated_at });
  // Same pattern as auth.loadProject: only a member of the owning org can see the row exists at all (404, not 403).
  function loadClient(req) {
    const c = db.prepare(`SELECT cl.* FROM clients cl JOIN memberships m ON m.org_id = cl.org_id AND m.user_id = ? WHERE cl.id = ?`)
      .get(req.user.id, +req.params.id);
    if (!c) throw notFound("הלקוח לא נמצא");
    return c;
  }

  r.get("/orgs/:orgId/clients", wrap(async (req, res) => {
    requireOrgRole(db, req.user.id, +req.params.orgId);
    res.json(db.prepare("SELECT * FROM clients WHERE org_id = ? ORDER BY is_default, name COLLATE NOCASE").all(+req.params.orgId).map(dto));
  }));

  r.post("/orgs/:orgId/clients", wrap(async (req, res) => {
    requireOrgRole(db, req.user.id, +req.params.orgId);
    const name = String(req.body.name || "").trim().slice(0, 120);
    if (!name) throw bad("יש לתת שם ללקוח");
    const info = db.prepare("INSERT INTO clients (org_id, created_by, name, brief_json) VALUES (?,?,?,?)")
      .run(+req.params.orgId, req.user.id, name, JSON.stringify(briefOf(req.body.brief)));
    res.status(201).json(dto(db.prepare("SELECT * FROM clients WHERE id = ?").get(info.lastInsertRowid)));
  }));

  r.get("/clients/:id", wrap(async (req, res) => {
    const c = loadClient(req);
    const products = db.prepare("SELECT * FROM products WHERE client_id = ? ORDER BY name COLLATE NOCASE").all(c.id)
      .map((p) => ({ id: p.id, name: p.name, brief: J(p.brief_json), createdAt: p.created_at }));
    const campaigns = db.prepare("SELECT * FROM campaigns WHERE client_id = ? ORDER BY is_default, updated_at DESC").all(c.id)
      .map((ca) => ({ id: ca.id, name: ca.name, isDefault: !!ca.is_default, brief: J(ca.brief_json), createdAt: ca.created_at,
        productIds: db.prepare("SELECT product_id FROM campaign_products WHERE campaign_id = ?").all(ca.id).map((x) => x.product_id),
        adCount: db.prepare("SELECT COUNT(*) n FROM projects WHERE campaign_id = ?").get(ca.id).n }));
    const documents = docs.list(db, "client", c.id);
    const logo = documents.find((d) => d.role === "logo") || null;
    res.json({ ...dto(c), products, campaigns, documents, logoDocId: logo?.id || null });
  }));

  r.patch("/clients/:id", wrap(async (req, res) => {
    const c = loadClient(req);
    const name = req.body.name !== undefined ? String(req.body.name).trim().slice(0, 120) || c.name : c.name;
    const brief = req.body.brief !== undefined ? briefOf(req.body.brief) : J(c.brief_json);
    db.prepare("UPDATE clients SET name = ?, brief_json = ?, updated_at = datetime('now') WHERE id = ?").run(name, JSON.stringify(brief), c.id);
    res.json(dto(db.prepare("SELECT * FROM clients WHERE id = ?").get(c.id)));
  }));

  r.delete("/clients/:id", wrap(async (req, res) => {
    const c = loadClient(req);
    const ads = db.prepare("SELECT COUNT(*) n FROM projects WHERE client_id = ?").get(c.id).n;
    if (ads > 0) throw bad("ללקוח הזה יש מודעות קיימות — יש למחוק או להעביר אותן קודם", "has_ads");
    db.prepare("DELETE FROM clients WHERE id = ?").run(c.id); // cascades products/campaigns/documents
    res.json({ ok: true });
  }));

  // ---------- documents folder ----------
  r.get("/clients/:id/documents", wrap(async (req, res) => { const c = loadClient(req); res.json(docs.list(db, "client", c.id)); }));
  r.post("/clients/:id/documents", upload.single("file"), wrap(async (req, res) => {
    const c = loadClient(req);
    if (!req.file) throw bad("לא נבחר קובץ");
    const sig = files.sniffDocument(req.file.buffer);
    const doc = docs.add(db, { ownerType: "client", ownerId: c.id, orgId: c.org_id,
      role: req.body.role ? String(req.body.role).slice(0, 40) : null,
      name: String(req.body.name || req.file.originalname || "מסמך").trim().slice(0, 120) || "מסמך",
      buf: req.file.buffer, mime: sig.mime, note: req.body.note ? String(req.body.note).slice(0, 500) : null, userId: req.user.id });
    res.status(201).json(doc);
  }));

  return r;
};
