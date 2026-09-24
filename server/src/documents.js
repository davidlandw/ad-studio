/**
 * Shared "documents folder" for every level of the hierarchy (client, product, campaign, project/ad).
 * One table (`documents`), one small API — callers resolve the owning org and check membership themselves
 * (via `ownerOrg`) before reading or writing, the same way projects.js/library.js already do.
 */
const files = require("./files");
const { notFound } = require("./errors");

const OWNER_TABLE = { client: "clients", product: "products", campaign: "campaigns", project: "projects" };

/** org_id of the owner entity, or null if it doesn't exist. Products/campaigns resolve org_id through their client. */
function orgOf(db, ownerType, ownerId) {
  const table = OWNER_TABLE[ownerType];
  if (!table) return null;
  if (ownerType === "product") {
    const row = db.prepare("SELECT c.org_id AS org_id FROM products p JOIN clients c ON c.id = p.client_id WHERE p.id = ?").get(ownerId);
    return row?.org_id ?? null;
  }
  if (ownerType === "campaign") {
    const row = db.prepare("SELECT c.org_id AS org_id FROM campaigns ca JOIN clients c ON c.id = ca.client_id WHERE ca.id = ?").get(ownerId);
    return row?.org_id ?? null;
  }
  const row = db.prepare(`SELECT org_id FROM ${table} WHERE id = ?`).get(ownerId);
  return row?.org_id ?? null;
}

function list(db, ownerType, ownerId, role = null) {
  const rows = role
    ? db.prepare("SELECT * FROM documents WHERE owner_type = ? AND owner_id = ? AND role = ? ORDER BY created_at DESC").all(ownerType, ownerId, role)
    : db.prepare("SELECT * FROM documents WHERE owner_type = ? AND owner_id = ? ORDER BY created_at DESC").all(ownerType, ownerId);
  return rows.map(dto);
}

function dto(d) {
  return { id: d.id, ownerType: d.owner_type, ownerId: d.owner_id, role: d.role, name: d.name, mime: d.mime,
    note: d.note, meta: d.meta_json ? JSON.parse(d.meta_json) : null, createdAt: d.created_at };
}

function get(db, id) {
  const d = db.prepare("SELECT * FROM documents WHERE id = ?").get(id);
  if (!d) throw notFound("המסמך לא נמצא");
  return d;
}

function add(db, { ownerType, ownerId, orgId, role = null, name, buf, mime, note = null, meta = null, userId }) {
  const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" }[mime] || "bin";
  const rel = files.save(`docs/${ownerType}${ownerId}`, buf, ext);
  const info = db.prepare(`INSERT INTO documents (org_id, owner_type, owner_id, role, name, file, mime, note, meta_json, created_by)
                           VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(orgId, ownerType, ownerId, role, name.slice(0, 120), rel, mime, note, meta ? JSON.stringify(meta) : null, userId);
  return dto(db.prepare("SELECT * FROM documents WHERE id = ?").get(info.lastInsertRowid));
}

function setMeta(db, id, meta) {
  db.prepare("UPDATE documents SET meta_json = ? WHERE id = ?").run(JSON.stringify(meta), id);
}

function remove(db, id) {
  const d = get(db, id);
  db.prepare("DELETE FROM documents WHERE id = ?").run(id);
  files.remove(d.file);
}

module.exports = { orgOf, list, get, add, remove, setMeta, dto };
