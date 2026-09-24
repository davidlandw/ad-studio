/** Generic file serving + delete for the shared `documents` table (client/product/campaign/project folders). */
const express = require("express");
const files = require("../files");
const docs = require("../documents");
const { wrap, notFound } = require("../errors");
const { requireUser, requireOrgRole } = require("../auth");

module.exports = (db) => {
  const r = express.Router();
  r.use(requireUser);

  function loadDoc(req) {
    const d = docs.get(db, +req.params.id);
    const orgId = docs.orgOf(db, d.owner_type, d.owner_id);
    requireOrgRole(db, req.user.id, orgId); // 404s if not a member — same "don't leak existence" rule as everywhere else
    return d;
  }

  r.get("/documents/:id/file", wrap(async (req, res) => {
    const d = loadDoc(req);
    res.set("Content-Type", d.mime).set("Cache-Control", "private, max-age=31536000, immutable").sendFile(files.abs(d.file));
  }));

  r.delete("/documents/:id", wrap(async (req, res) => {
    loadDoc(req);
    docs.remove(db, +req.params.id);
    res.json({ ok: true });
  }));

  return r;
};
