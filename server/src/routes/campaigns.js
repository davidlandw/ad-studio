/**
 * Campaigns — belong to a client, can promote more than one product (campaign_products), and hold the
 * ads (projects) created under them. Each campaign has a brief (P.CAMPAIGN_FIELDS: goal, audience, tone,
 * timeframe) and a documents folder.
 */
const express = require("express");
const multer = require("multer");
const config = require("../config");
const files = require("../files");
const P = require("../pipeline");
const docs = require("../documents");
const { wrap, bad, notFound } = require("../errors");
const { requireUser } = require("../auth");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxImageBytes, files: 1 } });
const J = (s, d = {}) => { if (s == null) return d; try { return JSON.parse(s); } catch { return d; } };
const STEP_NAMES = ["", "ניתוח העסק", "פרטי חובה", "קונספטים", "קומפוזיציה", "ביקורת", "אלמנטים", "הרכבה", "טקסט וייצוא"];

module.exports = (db) => {
  const r = express.Router();
  r.use(requireUser);

  const briefOf = (body) => { const b = {}; for (const k of Object.keys(P.CAMPAIGN_FIELDS)) b[k] = String(body?.[k] ?? "").slice(0, 2000); return b; };
  const dto = (c) => ({ id: c.id, clientId: c.client_id, name: c.name, isDefault: !!c.is_default, brief: J(c.brief_json), createdAt: c.created_at, updatedAt: c.updated_at });

  function loadClient(req, clientId) {
    const c = db.prepare(`SELECT cl.* FROM clients cl JOIN memberships m ON m.org_id = cl.org_id AND m.user_id = ? WHERE cl.id = ?`)
      .get(req.user.id, clientId);
    if (!c) throw notFound("הלקוח לא נמצא");
    return c;
  }
  function loadCampaign(req) {
    const c = db.prepare(`SELECT ca.*, cl.org_id AS org_id FROM campaigns ca JOIN clients cl ON cl.id = ca.client_id
                          JOIN memberships m ON m.org_id = cl.org_id AND m.user_id = ? WHERE ca.id = ?`).get(req.user.id, +req.params.id);
    if (!c) throw notFound("הקמפיין לא נמצא");
    return c;
  }
  function productIds(campaignId) { return db.prepare("SELECT product_id FROM campaign_products WHERE campaign_id = ?").all(campaignId).map((x) => x.product_id); }
  function setProducts(campaignId, ids, clientId) {
    const valid = db.prepare(`SELECT id FROM products WHERE client_id = ? AND id IN (${ids.map(() => "?").join(",") || "NULL"})`).all(clientId, ...ids).map((r) => r.id);
    db.transaction(() => {
      db.prepare("DELETE FROM campaign_products WHERE campaign_id = ?").run(campaignId);
      for (const pid of valid) db.prepare("INSERT INTO campaign_products (campaign_id, product_id) VALUES (?,?)").run(campaignId, pid);
    })();
  }

  r.post("/clients/:clientId/campaigns", wrap(async (req, res) => {
    const c = loadClient(req, +req.params.clientId);
    const name = String(req.body.name || "").trim().slice(0, 120);
    if (!name) throw bad("יש לתת שם לקמפיין");
    const info = db.prepare("INSERT INTO campaigns (client_id, created_by, name, brief_json) VALUES (?,?,?,?)")
      .run(c.id, req.user.id, name, JSON.stringify(briefOf(req.body.brief)));
    if (Array.isArray(req.body.productIds)) setProducts(info.lastInsertRowid, req.body.productIds.map(Number), c.id);
    res.status(201).json({ ...dto(db.prepare("SELECT * FROM campaigns WHERE id = ?").get(info.lastInsertRowid)), productIds: productIds(info.lastInsertRowid) });
  }));

  r.get("/campaigns/:id", wrap(async (req, res) => {
    const c = loadCampaign(req);
    const ads = db.prepare(`SELECT p.id, p.name, p.step, p.updated_at, p.plate_asset_id, p.product_id,
                            (SELECT a.id FROM assets a WHERE a.project_id = p.id AND a.kind = 'export' ORDER BY a.id DESC LIMIT 1) AS export_asset_id
                            FROM projects p WHERE p.campaign_id = ? ORDER BY p.updated_at DESC`).all(c.id)
      .map((p) => ({ ...p, stepName: STEP_NAMES[p.step] }));
    const products = db.prepare("SELECT id, name FROM products WHERE client_id = ?").all(c.client_id);
    res.json({ ...dto(c), productIds: productIds(c.id), products, ads, documents: docs.list(db, "campaign", c.id) });
  }));

  r.patch("/campaigns/:id", wrap(async (req, res) => {
    const c = loadCampaign(req);
    const name = req.body.name !== undefined ? String(req.body.name).trim().slice(0, 120) || c.name : c.name;
    const brief = req.body.brief !== undefined ? briefOf(req.body.brief) : J(c.brief_json);
    db.prepare("UPDATE campaigns SET name = ?, brief_json = ?, updated_at = datetime('now') WHERE id = ?").run(name, JSON.stringify(brief), c.id);
    if (Array.isArray(req.body.productIds)) setProducts(c.id, req.body.productIds.map(Number), c.client_id);
    res.json({ ...dto(db.prepare("SELECT * FROM campaigns WHERE id = ?").get(c.id)), productIds: productIds(c.id) });
  }));

  r.delete("/campaigns/:id", wrap(async (req, res) => {
    const c = loadCampaign(req);
    const ads = db.prepare("SELECT COUNT(*) n FROM projects WHERE campaign_id = ?").get(c.id).n;
    if (ads > 0) throw bad("לקמפיין הזה יש מודעות קיימות — יש למחוק או להעביר אותן קודם", "has_ads");
    db.prepare("DELETE FROM campaigns WHERE id = ?").run(c.id);
    res.json({ ok: true });
  }));

  r.get("/campaigns/:id/documents", wrap(async (req, res) => { const c = loadCampaign(req); res.json(docs.list(db, "campaign", c.id)); }));
  r.post("/campaigns/:id/documents", upload.single("file"), wrap(async (req, res) => {
    const c = loadCampaign(req);
    if (!req.file) throw bad("לא נבחר קובץ");
    const sig = files.sniffDocument(req.file.buffer);
    const doc = docs.add(db, { ownerType: "campaign", ownerId: c.id, orgId: c.org_id,
      role: req.body.role ? String(req.body.role).slice(0, 40) : null,
      name: String(req.body.name || req.file.originalname || "מסמך").trim().slice(0, 120) || "מסמך",
      buf: req.file.buffer, mime: sig.mime, note: req.body.note ? String(req.body.note).slice(0, 500) : null, userId: req.user.id });
    res.status(201).json(doc);
  }));

  return r;
};
