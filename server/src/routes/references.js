/**
 * Reference ads: real ad images (e.g. scanned from a newspaper) uploaded under a client, and a vision-based
 * "decompose" action that reverse-engineers one into this app's own building blocks (elements/panels/text lines)
 * plus a Hebrew Markdown recipe explaining how to recreate it. See DECISIONS.md D36.
 */
const express = require("express");
const multer = require("multer");
const config = require("../config");
const files = require("../files");
const P = require("../pipeline");
const docs = require("../documents");
const { wrap, bad, notFound, HttpError } = require("../errors");
const { requireUser } = require("../auth");
const { decrypt } = require("../security");
const { metered } = require("../quota");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxImageBytes, files: 1 } });

module.exports = (db) => {
  const r = express.Router();
  r.use(requireUser);

  function userKey(req) {
    if (!req.user.gemini_key_enc) throw new HttpError(400, "יש להגדיר מפתח Gemini בהגדרות לפני יצירה", "no_gemini_key");
    try { return decrypt(req.user.gemini_key_enc); } catch { throw new HttpError(400, "לא ניתן לפענח את מפתח ה-Gemini — הזינו אותו מחדש", "bad_gemini_key"); }
  }
  function loadClient(req, clientId) {
    const c = db.prepare(`SELECT cl.* FROM clients cl JOIN memberships m ON m.org_id = cl.org_id AND m.user_id = ? WHERE cl.id = ?`)
      .get(req.user.id, clientId);
    if (!c) throw notFound("הלקוח לא נמצא");
    return c;
  }
  function loadDoc(req) {
    const d = docs.get(db, +req.params.id);
    const orgId = docs.orgOf(db, d.owner_type, d.owner_id);
    if (!db.prepare("SELECT 1 FROM memberships WHERE user_id = ? AND org_id = ?").get(req.user.id, orgId)) throw notFound("המסמך לא נמצא");
    return d;
  }

  r.get("/clients/:id/reference-ads", wrap(async (req, res) => {
    const c = loadClient(req, +req.params.id);
    res.json(docs.list(db, "client", c.id, "reference_ad"));
  }));

  r.post("/clients/:id/reference-ads", upload.single("file"), wrap(async (req, res) => {
    const c = loadClient(req, +req.params.id);
    if (!req.file) throw bad("לא נבחר קובץ");
    const sig = files.sniffImage(req.file.buffer); // reference ads are always images (photos/scans), never PDF
    const doc = docs.add(db, { ownerType: "client", ownerId: c.id, orgId: c.org_id, role: "reference_ad",
      name: String(req.body.name || req.file.originalname || "מודעת רפרנס").trim().slice(0, 120) || "מודעת רפרנס",
      buf: req.file.buffer, mime: sig.mime, note: req.body.note ? String(req.body.note).slice(0, 500) : null, userId: req.user.id });
    res.status(201).json(doc);
  }));

  // Reverse-engineer a reference ad into elements/panels/text lines + a Hebrew Markdown recipe, saved as a
  // sibling .md document in the same folder. Uses the requester's own Gemini key (vision), like every other call.
  r.post("/documents/:id/decompose", wrap(async (req, res) => {
    const d = loadDoc(req);
    if (!d.mime.startsWith("image/")) throw bad("אפשר לנתח רק תמונה של מודעה");
    const orgId = docs.orgOf(db, d.owner_type, d.owner_id);
    const apiKey = userKey(req);
    const image = { mime: d.mime, base64: files.read(d.file).toString("base64") };
    const result = await metered(db, req, res, orgId, "text", () => P.decomposeReferenceAd({ apiKey, image }));
    const mdBuf = Buffer.from(String(result.concept_md || "# ניתוח מודעה\n\n(לא הוחזר תוכן)"), "utf8");
    const mdDoc = docs.add(db, { ownerType: d.owner_type, ownerId: d.owner_id, orgId, role: "concept_md",
      name: `ניתוח קונספט: ${d.name}.md`, buf: mdBuf, mime: "text/markdown",
      meta: { sourceDocId: d.id, archetype: result.archetype, summary: result.summary_he, elements: result.elements,
        panels: result.panels, textLines: result.textLines }, userId: req.user.id });
    docs.setMeta(db, d.id, { analyzedDocId: mdDoc.id, archetype: result.archetype });
    res.status(201).json({ source: docs.dto(docs.get(db, d.id)), concept: mdDoc });
  }));

  return r;
};
