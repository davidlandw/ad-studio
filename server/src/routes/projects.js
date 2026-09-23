const express = require("express");
const multer = require("multer");
const config = require("../config");
const files = require("../files");
const gemini = require("../gemini");
const P = require("../pipeline");
const { wrap, bad, notFound, HttpError } = require("../errors");
const { requireUser, requireOrgRole, loadProject } = require("../auth");
const { decrypt } = require("../security");
const { metered } = require("../quota");
const { saveToLibrary } = require("./library");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxImageBytes, files: 1 } });

const J = (s, d = null) => { if (s == null) return d; try { return JSON.parse(s); } catch { return d; } };

module.exports = (db) => {
  const r = express.Router();
  r.use(requireUser);

  // ---------- helpers ----------
  function userKey(req) {
    if (!req.user.gemini_key_enc) throw new HttpError(400, "יש להגדיר מפתח Gemini בהגדרות לפני יצירה", "no_gemini_key");
    try { return decrypt(req.user.gemini_key_enc); } catch { throw new HttpError(400, "לא ניתן לפענח את מפתח ה-Gemini — הזינו אותו מחדש", "bad_gemini_key"); }
  }
  const project = (req) => loadProject(db, req.user.id, +req.params.id);
  const aspectOf = (p) => (P.ASPECTS[J(p.brief_json, {}).format] ? J(p.brief_json, {}).format : "4:5");

  function update(id, fields) {
    const keys = Object.keys(fields);
    db.prepare(`UPDATE projects SET ${keys.map((k) => `${k} = @${k}`).join(", ")}, updated_at = datetime('now') WHERE id = @id`)
      .run({ ...fields, id });
  }

  function saveAsset({ projectId, elementId = null, kind, buf, mime, prompt = null, feedback = null, userId, fromLibraryId = null }) {
    const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[mime] || "png";
    const rel = files.save(`p${projectId}`, buf, ext);
    const info = db.prepare(`INSERT INTO assets (project_id, element_id, kind, file, mime, prompt, feedback, created_by, from_library_id)
                             VALUES (?,?,?,?,?,?,?,?,?)`).run(projectId, elementId, kind, rel, mime, prompt, feedback, userId, fromLibraryId);
    return db.prepare("SELECT id, element_id, kind, mime, feedback, created_at FROM assets WHERE id = ?").get(info.lastInsertRowid);
  }

  function assetB64(projectId, assetId) {
    const a = db.prepare("SELECT * FROM assets WHERE id = ? AND project_id = ?").get(assetId, projectId);
    if (!a) throw notFound("התמונה לא נמצאה");
    return { asset: a, mime: a.mime, base64: files.read(a.file).toString("base64") };
  }

  function full(p) {
    const elements = db.prepare("SELECT * FROM elements WHERE project_id = ? ORDER BY z, id").all(p.id)
      .map((e) => ({ ...e, layout: J(e.layout_json, {}), layout_json: undefined }));
    const assets = db.prepare("SELECT id, element_id, kind, mime, feedback, created_at FROM assets WHERE project_id = ? ORDER BY id DESC").all(p.id);
    return {
      id: p.id, orgId: p.org_id, name: p.name, step: p.step,
      brief: J(p.brief_json, {}), mandatory: J(p.mandatory_json, {}),
      analysis: J(p.analysis_json), concepts: J(p.concepts_json), chosenConcept: p.chosen_concept,
      plan: J(p.plan_json), critique: J(p.critique_json), compose: J(p.compose_json),
      plateAssetId: p.plate_asset_id, aspect: aspectOf(p), size: P.ASPECTS[aspectOf(p)],
      elements, assets, createdAt: p.created_at, updatedAt: p.updated_at,
    };
  }
  const send = (res, id) => res.json(full(db.prepare("SELECT * FROM projects WHERE id = ?").get(id)));

  function requireFilled(obj, fields, label) {
    const missing = fields.filter((f) => !String(obj?.[f] ?? "").trim());
    if (missing.length) throw bad(`חסרים שדות ב${label}: ${missing.map((f) => P.BRIEF_FIELDS[f] || P.MANDATORY_FIELDS[f]).join(", ")}`);
  }

  /** Mirrors plan.elements into the elements table. Keeps approvals unless the element's prompt changed. */
  function syncElements(projectId, plan) {
    const existing = Object.fromEntries(db.prepare("SELECT * FROM elements WHERE project_id = ?").all(projectId).map((e) => [e.key, e]));
    const keep = new Set();
    db.transaction(() => {
      for (const el of plan.elements) {
        keep.add(el.key);
        const cur = existing[el.key];
        if (!cur) {
          db.prepare(`INSERT INTO elements (project_id, key, name, kind, prompt, layout_json, z) VALUES (?,?,?,?,?,?,?)`)
            .run(projectId, el.key, el.name, el.kind, el.prompt, JSON.stringify(el.layout), el.z);
        } else {
          const changed = cur.prompt !== el.prompt || cur.kind !== el.kind;
          db.prepare(`UPDATE elements SET name=?, kind=?, prompt=?, layout_json=?, z=?,
                      status = CASE WHEN ? THEN (CASE WHEN status='approved' THEN 'generated' ELSE status END) ELSE status END,
                      approved_asset_id = CASE WHEN ? THEN NULL ELSE approved_asset_id END WHERE id=?`)
            .run(el.name, el.kind, el.prompt, JSON.stringify(el.layout), el.z, changed ? 1 : 0, changed ? 1 : 0, cur.id);
        }
      }
      for (const [key, e] of Object.entries(existing)) if (!keep.has(key)) db.prepare("DELETE FROM elements WHERE id = ?").run(e.id);
    })();
  }

  // ---------- CRUD ----------
  r.get("/orgs/:orgId/projects", wrap(async (req, res) => {
    requireOrgRole(db, req.user.id, +req.params.orgId);
    res.json(db.prepare(`SELECT p.id, p.name, p.step, p.updated_at, p.plate_asset_id, u.name AS created_by_name,
                         (SELECT a.id FROM assets a WHERE a.project_id = p.id AND a.kind = 'export' ORDER BY a.id DESC LIMIT 1) AS export_asset_id
                         FROM projects p JOIN users u ON u.id = p.created_by WHERE p.org_id = ? ORDER BY p.updated_at DESC`).all(+req.params.orgId));
  }));

  r.post("/orgs/:orgId/projects", wrap(async (req, res) => {
    requireOrgRole(db, req.user.id, +req.params.orgId);
    const name = String(req.body.name || "").trim() || "מודעה חדשה";
    const info = db.prepare("INSERT INTO projects (org_id, created_by, name, brief_json) VALUES (?,?,?,?)")
      .run(+req.params.orgId, req.user.id, name.slice(0, 120), JSON.stringify({ format: "4:5" }));
    res.status(201);
    send(res, info.lastInsertRowid);
  }));

  r.get("/projects/:id", wrap(async (req, res) => res.json(full(project(req)))));

  r.patch("/projects/:id", wrap(async (req, res) => {
    const p = project(req);
    const f = {};
    if (req.body.name !== undefined) f.name = String(req.body.name).trim().slice(0, 120) || p.name;
    if (req.body.brief !== undefined) {
      const b = {}; for (const k of [...Object.keys(P.BRIEF_FIELDS), "format"]) b[k] = String(req.body.brief[k] ?? "").slice(0, 2000);
      if (!P.ASPECTS[b.format]) b.format = "4:5";
      f.brief_json = JSON.stringify(b);
    }
    if (req.body.mandatory !== undefined) {
      const m = {}; for (const k of Object.keys(P.MANDATORY_FIELDS)) m[k] = String(req.body.mandatory[k] ?? "").slice(0, 500);
      f.mandatory_json = JSON.stringify(m);
    }
    if (req.body.step !== undefined) f.step = Math.min(8, Math.max(1, +req.body.step || 1));
    if (Object.keys(f).length) update(p.id, f);
    send(res, p.id);
  }));

  r.delete("/projects/:id", wrap(async (req, res) => {
    const p = project(req);
    const list = db.prepare("SELECT file FROM assets WHERE project_id = ?").all(p.id);
    db.prepare("DELETE FROM projects WHERE id = ?").run(p.id);
    list.forEach((a) => files.remove(a.file));
    res.json({ ok: true });
  }));

  // ---------- Step 1: analysis ----------
  r.post("/projects/:id/analyze", wrap(async (req, res) => {
    const p = project(req);
    const brief = J(p.brief_json, {});
    requireFilled(brief, ["businessName", "offering", "goal"], "פרטי העסק");
    const apiKey = userKey(req);
    const analysis = await metered(db, req, res, p.org_id, "text", () => P.analyze({ apiKey, brief }));
    update(p.id, { analysis_json: JSON.stringify(analysis), step: Math.max(p.step, 1) });
    send(res, p.id);
  }));

  // ---------- Step 2: suggestions for the mandatory fields, based on the analysis ----------
  r.post("/projects/:id/suggest-mandatory", wrap(async (req, res) => {
    const p = project(req);
    if (!p.analysis_json) throw bad("יש להשלים את ניתוח העסק קודם");
    const apiKey = userKey(req);
    const suggestion = await metered(db, req, res, p.org_id, "text", () =>
      P.suggestMandatory({ apiKey, brief: J(p.brief_json, {}), analysis: J(p.analysis_json) }));
    res.json(suggestion);
  }));

  // ---------- Step 3: concepts ----------
  r.post("/projects/:id/concepts", wrap(async (req, res) => {
    const p = project(req);
    if (!p.analysis_json) throw bad("יש להשלים את ניתוח העסק קודם");
    const mandatory = J(p.mandatory_json, {});
    requireFilled(mandatory, ["centerProduct", "businessName"], "פרטי החובה");
    const apiKey = userKey(req);
    const list = await metered(db, req, res, p.org_id, "text", () =>
      P.concepts({ apiKey, brief: J(p.brief_json, {}), mandatory, analysis: J(p.analysis_json) }));
    update(p.id, { concepts_json: JSON.stringify(list), chosen_concept: null, step: Math.max(p.step, 3) });
    send(res, p.id);
  }));

  // ---------- Step 4: choose + plan ----------
  r.post("/projects/:id/choose", wrap(async (req, res) => {
    const p = project(req);
    const list = J(p.concepts_json, []);
    const idx = +req.body.index;
    if (!Number.isInteger(idx) || !list[idx]) throw bad("יש לבחור קונספט מהרשימה");
    const apiKey = userKey(req);
    const plan = await metered(db, req, res, p.org_id, "text", () => P.plan({ apiKey, brief: J(p.brief_json, {}),
      mandatory: J(p.mandatory_json, {}), analysis: J(p.analysis_json), concept: list[idx], aspect: aspectOf(p) }));
    update(p.id, { chosen_concept: idx, plan_json: JSON.stringify(plan), critique_json: null, compose_json: null, step: Math.max(p.step, 4) });
    send(res, p.id);
  }));

  r.put("/projects/:id/plan", wrap(async (req, res) => {
    const p = project(req);
    const plan = P.normalizePlan(req.body.plan, J(p.mandatory_json, {}));
    update(p.id, { plan_json: JSON.stringify(plan) });
    send(res, p.id);
  }));

  // ---------- Step 5: critique ----------
  r.post("/projects/:id/critique", wrap(async (req, res) => {
    const p = project(req);
    if (!p.plan_json) throw bad("יש לבחור קונספט ולבנות קומפוזיציה קודם");
    const apiKey = userKey(req);
    const c = await metered(db, req, res, p.org_id, "text", () =>
      P.critique({ apiKey, brief: J(p.brief_json, {}), mandatory: J(p.mandatory_json, {}), plan: J(p.plan_json) }));
    update(p.id, { critique_json: JSON.stringify(c), step: Math.max(p.step, 5) });
    send(res, p.id);
  }));

  // Accept (revised) or keep (original) — both lock the plan and create the element list.
  r.post("/projects/:id/lock-plan", wrap(async (req, res) => {
    const p = project(req);
    let plan = J(p.plan_json);
    if (!plan) throw bad("אין תוכנית לנעול");
    if (req.body.useRevised) {
      const c = J(p.critique_json);
      if (!c?.revised_plan) throw bad("אין תוכנית משופרת — הריצו ביקורת קודם");
      plan = c.revised_plan;
    }
    update(p.id, { plan_json: JSON.stringify(plan), compose_json: null, step: Math.max(p.step, 6) });
    syncElements(p.id, plan);
    send(res, p.id);
  }));

  // ---------- Step 6: elements ----------
  function loadElement(req) {
    const e = db.prepare(`SELECT e.* FROM elements e JOIN projects p ON p.id = e.project_id
                          JOIN memberships m ON m.org_id = p.org_id AND m.user_id = ? WHERE e.id = ?`).get(req.user.id, +req.params.eid);
    if (!e) throw notFound("האלמנט לא נמצא");
    return e;
  }

  r.patch("/elements/:eid", wrap(async (req, res) => {
    const e = loadElement(req);
    const prompt = req.body.prompt !== undefined ? String(req.body.prompt).slice(0, 2000) : e.prompt;
    const keyColor = /^#[0-9a-f]{6}$/i.test(req.body.key_color || "") ? req.body.key_color.toUpperCase() : e.key_color;
    db.prepare("UPDATE elements SET prompt = ?, key_color = ? WHERE id = ?").run(prompt, keyColor, e.id);
    // keep plan in sync so later syncs don't revert the manual edit
    const p = db.prepare("SELECT * FROM projects WHERE id = ?").get(e.project_id);
    const plan = J(p.plan_json);
    if (plan) { const pe = plan.elements.find((x) => x.key === e.key); if (pe) pe.prompt = prompt; update(p.id, { plan_json: JSON.stringify(plan) }); }
    send(res, e.project_id);
  }));

  r.post("/elements/:eid/generate", wrap(async (req, res) => {
    const e = loadElement(req);
    const p = db.prepare("SELECT * FROM projects WHERE id = ?").get(e.project_id);
    const plan = J(p.plan_json);
    const feedback = String(req.body.feedback || "").trim().slice(0, 1000);
    const base = P.elementPrompt(e, plan);
    let prompt = base, images = [];
    if (req.body.fromAssetId) {
      if (!feedback) throw bad("לעריכת תמונה קיימת יש לכתוב מה לשנות");
      const src = assetB64(p.id, +req.body.fromAssetId);
      if (src.asset.element_id !== e.id) throw bad("התמונה לא שייכת לאלמנט הזה");
      images = [src]; prompt = P.refinePrompt(base, feedback);
    } else if (feedback) {
      prompt = `${base}\nAdditional direction: ${feedback}`;
    }
    const aspect = e.kind === "background" ? aspectOf(p) : "1:1";
    const apiKey = userKey(req);
    const img = await metered(db, req, res, p.org_id, "image", () => gemini.generateImage({ apiKey, prompt, images, aspectRatio: aspect,
      mockHint: { kind: e.kind, label: e.key + feedback, keyColor: e.key_color } }));
    const buf = Buffer.from(img.base64, "base64");
    const sig = files.sniffImage(buf);
    saveAsset({ projectId: p.id, elementId: e.id, kind: "element", buf, mime: sig.mime, prompt, feedback: feedback || null, userId: req.user.id });
    db.prepare("UPDATE elements SET status = CASE WHEN status='approved' THEN 'approved' ELSE 'generated' END WHERE id = ?").run(e.id);
    send(res, p.id);
  }));

  // Use a real photo (e.g. the official product packshot) instead of generating.
  r.post("/elements/:eid/upload", upload.single("file"), wrap(async (req, res) => {
    const e = loadElement(req);
    if (!req.file) throw bad("לא נבחר קובץ");
    const sig = files.sniffImage(req.file.buffer);
    saveAsset({ projectId: e.project_id, elementId: e.id, kind: "element", buf: req.file.buffer, mime: sig.mime, feedback: "הועלה ידנית", userId: req.user.id });
    db.prepare("UPDATE elements SET status = CASE WHEN status='approved' THEN 'approved' ELSE 'generated' END WHERE id = ?").run(e.id);
    send(res, e.project_id);
  }));

  r.post("/elements/:eid/approve", wrap(async (req, res) => {
    const e = loadElement(req);
    const a = db.prepare("SELECT * FROM assets WHERE id = ? AND element_id = ?").get(+req.body.assetId, e.id);
    if (!a) throw bad("יש לבחור תמונה של האלמנט הזה");
    const p = db.prepare("SELECT org_id FROM projects WHERE id = ?").get(e.project_id);
    db.transaction(() => {
      db.prepare("UPDATE elements SET status='approved', approved_asset_id=? WHERE id=?").run(a.id, e.id);
      saveToLibrary(db, { asset: a, element: e, orgId: p.org_id, userId: req.user.id }); // every approved element is kept
    })();
    send(res, e.project_id);
  }));

  // Save any version (not only the approved one) to the org library.
  r.post("/elements/:eid/save-to-library", wrap(async (req, res) => {
    const e = loadElement(req);
    const a = db.prepare("SELECT * FROM assets WHERE id = ? AND element_id = ?").get(+req.body.assetId, e.id);
    if (!a) throw bad("יש לבחור תמונה של האלמנט הזה");
    const p = db.prepare("SELECT org_id FROM projects WHERE id = ?").get(e.project_id);
    const item = saveToLibrary(db, { asset: a, element: e, orgId: p.org_id, userId: req.user.id, name: req.body.name ? String(req.body.name) : undefined });
    res.status(201).json({ id: item.id, name: item.name });
  }));

  // Reuse a library element (own org or public) as a new version of this element.
  r.post("/elements/:eid/from-library", wrap(async (req, res) => {
    const e = loadElement(req);
    const item = db.prepare(`SELECT l.* FROM library_elements l WHERE l.id = ? AND (l.visibility = 'public'
      OR l.org_id IN (SELECT org_id FROM memberships WHERE user_id = ?))`).get(+req.body.itemId, req.user.id);
    if (!item) throw notFound("האלמנט לא נמצא בספרייה");
    const buf = files.read(item.file);
    saveAsset({ projectId: e.project_id, elementId: e.id, kind: "element", buf, mime: item.mime, prompt: item.prompt,
      feedback: `מהספרייה: ${item.name}`, userId: req.user.id, fromLibraryId: item.id });
    if (e.kind === "object" && item.key_color && item.key_color !== e.key_color)
      db.prepare("UPDATE elements SET key_color = ? WHERE id = ?").run(item.key_color, e.id);
    db.prepare("UPDATE elements SET status = CASE WHEN status='approved' THEN 'approved' ELSE 'generated' END WHERE id = ?").run(e.id);
    send(res, e.project_id);
  }));

  r.post("/elements/:eid/unapprove", wrap(async (req, res) => {
    const e = loadElement(req);
    db.prepare("UPDATE elements SET status = CASE WHEN approved_asset_id IS NULL THEN 'pending' ELSE 'generated' END, approved_asset_id=NULL WHERE id=?").run(e.id);
    send(res, e.project_id);
  }));

  // ---------- assets ----------
  r.get("/assets/:aid/file", wrap(async (req, res) => {
    const a = db.prepare(`SELECT a.* FROM assets a JOIN projects p ON p.id = a.project_id
                          JOIN memberships m ON m.org_id = p.org_id AND m.user_id = ? WHERE a.id = ?`).get(req.user.id, +req.params.aid);
    if (!a) throw notFound("התמונה לא נמצאה");
    res.set("Content-Type", a.mime).set("Cache-Control", "private, max-age=31536000, immutable").sendFile(files.abs(a.file));
  }));

  // ---------- Step 7: compose + fuse ----------
  r.put("/projects/:id/compose", wrap(async (req, res) => {
    const p = project(req);
    const c = req.body.compose;
    if (!c || typeof c !== "object") throw bad("נתוני הרכבה חסרים");
    const s = JSON.stringify(c);
    if (s.length > 200000) throw bad("נתוני הרכבה גדולים מדי");
    update(p.id, { compose_json: s, step: Math.max(p.step, +req.body.step || 7) });
    send(res, p.id);
  }));

  // Default text layers built from the mandatory fields (verbatim).
  r.get("/projects/:id/text-layers", wrap(async (req, res) => {
    const p = project(req);
    res.json(P.buildTextLayers(J(p.plan_json, {}), J(p.mandatory_json, {}), aspectOf(p)));
  }));

  function saveUploaded(req, kind) {
    const p = project(req);
    if (!req.file) throw bad("לא התקבלה תמונה");
    const sig = files.sniffImage(req.file.buffer);
    return { p, asset: saveAsset({ projectId: p.id, kind, buf: req.file.buffer, mime: sig.mime, userId: req.user.id }) };
  }
  r.post("/projects/:id/composite", upload.single("file"), wrap(async (req, res) => res.status(201).json(saveUploaded(req, "composite").asset)));
  r.post("/projects/:id/logo", upload.single("file"), wrap(async (req, res) => res.status(201).json(saveUploaded(req, "logo").asset)));
  r.post("/projects/:id/export", upload.single("file"), wrap(async (req, res) => {
    const { p, asset } = saveUploaded(req, "export");
    update(p.id, { step: 8 });
    res.status(201).json(asset);
  }));

  r.post("/projects/:id/fuse", wrap(async (req, res) => {
    const p = project(req);
    const plan = J(p.plan_json);
    const elements = db.prepare("SELECT * FROM elements WHERE project_id = ? ORDER BY z, id").all(p.id);
    if (!elements.length || elements.some((e) => e.status !== "approved")) throw bad("כל האלמנטים חייבים להיות מאושרים לפני איחוד");
    const composite = assetB64(p.id, +req.body.compositeAssetId);
    if (composite.asset.kind !== "composite") throw bad("יש לשלוח קולאז' הרכבה");
    const refs = elements.map((e) => assetB64(p.id, e.approved_asset_id));
    const extra = String(req.body.instructions || "").trim().slice(0, 1000);
    const prompt = P.fusionPrompt(plan, elements) + (extra ? `\nAdditional direction: ${extra}` : "");
    const apiKey = userKey(req);
    const img = await metered(db, req, res, p.org_id, "image", () => gemini.generateImage({ apiKey, prompt, images: [composite, ...refs],
      aspectRatio: aspectOf(p), mockHint: { kind: "background", label: "plate" + extra } }));
    const buf = Buffer.from(img.base64, "base64");
    const sig = files.sniffImage(buf);
    const a = saveAsset({ projectId: p.id, kind: "plate", buf, mime: sig.mime, prompt, feedback: extra || null, userId: req.user.id });
    res.status(201).json(a);
  }));

  r.post("/projects/:id/plate", wrap(async (req, res) => {
    const p = project(req);
    const a = db.prepare("SELECT id, kind FROM assets WHERE id = ? AND project_id = ?").get(+req.body.assetId, p.id);
    if (!a || !["plate", "composite"].includes(a.kind)) throw bad("יש לבחור תמונת בסיס או קולאז'");
    update(p.id, { plate_asset_id: a.id, step: Math.max(p.step, 8) });
    send(res, p.id);
  }));

  return r;
};
