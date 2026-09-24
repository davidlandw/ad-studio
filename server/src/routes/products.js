/**
 * Products — belong to a client. A campaign can promote more than one product (see campaigns.js).
 * Each product has a brief (P.PRODUCT_FIELDS: description, features, differentiators) and a documents
 * folder for product photos / spec sheets.
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

module.exports = (db) => {
  const r = express.Router();
  r.use(requireUser);

  const briefOf = (body) => { const b = {}; for (const k of Object.keys(P.PRODUCT_FIELDS)) b[k] = String(body?.[k] ?? "").slice(0, 2000); return b; };
  const dto = (p) => ({ id: p.id, clientId: p.client_id, name: p.name, brief: J(p.brief_json), createdAt: p.created_at, updatedAt: p.updated_at });

  function loadClient(req, clientId) {
    const c = db.prepare(`SELECT cl.* FROM clients cl JOIN memberships m ON m.org_id = cl.org_id AND m.user_id = ? WHERE cl.id = ?`)
      .get(req.user.id, clientId);
    if (!c) throw notFound("הלקוח לא נמצא");
    return c;
  }
  function loadProduct(req) {
    const p = db.prepare(`SELECT pr.* FROM products pr JOIN clients cl ON cl.id = pr.client_id
                          JOIN memberships m ON m.org_id = cl.org_id AND m.user_id = ? WHERE pr.id = ?`).get(req.user.id, +req.params.id);
    if (!p) throw notFound("המוצר לא נמצא");
    return p;
  }

  r.post("/clients/:clientId/products", wrap(async (req, res) => {
    const c = loadClient(req, +req.params.clientId);
    const name = String(req.body.name || "").trim().slice(0, 120);
    if (!name) throw bad("יש לתת שם למוצר");
    const info = db.prepare("INSERT INTO products (client_id, created_by, name, brief_json) VALUES (?,?,?,?)")
      .run(c.id, req.user.id, name, JSON.stringify(briefOf(req.body.brief)));
    res.status(201).json(dto(db.prepare("SELECT * FROM products WHERE id = ?").get(info.lastInsertRowid)));
  }));

  r.get("/products/:id", wrap(async (req, res) => {
    const p = loadProduct(req);
    res.json({ ...dto(p), documents: docs.list(db, "product", p.id) });
  }));

  r.patch("/products/:id", wrap(async (req, res) => {
    const p = loadProduct(req);
    const name = req.body.name !== undefined ? String(req.body.name).trim().slice(0, 120) || p.name : p.name;
    const brief = req.body.brief !== undefined ? briefOf(req.body.brief) : J(p.brief_json);
    db.prepare("UPDATE products SET name = ?, brief_json = ?, updated_at = datetime('now') WHERE id = ?").run(name, JSON.stringify(brief), p.id);
    res.json(dto(db.prepare("SELECT * FROM products WHERE id = ?").get(p.id)));
  }));

  r.delete("/products/:id", wrap(async (req, res) => {
    const p = loadProduct(req);
    db.prepare("DELETE FROM products WHERE id = ?").run(p.id); // campaign_products rows cascade; ads keep product_id = NULL
    res.json({ ok: true });
  }));

  r.get("/products/:id/documents", wrap(async (req, res) => { const p = loadProduct(req); res.json(docs.list(db, "product", p.id)); }));
  r.post("/products/:id/documents", upload.single("file"), wrap(async (req, res) => {
    const p = loadProduct(req);
    if (!req.file) throw bad("לא נבחר קובץ");
    const sig = files.sniffDocument(req.file.buffer);
    const client = db.prepare("SELECT org_id FROM clients WHERE id = ?").get(p.client_id);
    const doc = docs.add(db, { ownerType: "product", ownerId: p.id, orgId: client.org_id,
      role: req.body.role ? String(req.body.role).slice(0, 40) : null,
      name: String(req.body.name || req.file.originalname || "מסמך").trim().slice(0, 120) || "מסמך",
      buf: req.file.buffer, mime: sig.mime, note: req.body.note ? String(req.body.note).slice(0, 500) : null, userId: req.user.id });
    res.status(201).json(doc);
  }));

  return r;
};
