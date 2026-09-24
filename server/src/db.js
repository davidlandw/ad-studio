const path = require("node:path");
const fs = require("node:fs");
const Database = require("better-sqlite3");
const config = require("./config");

// Versioned migrations. Append only — never edit a shipped migration.
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    gemini_key_enc TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX ix_sessions_user ON sessions(user_id);

  CREATE TABLE organizations (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE memberships (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role    TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, org_id)
  );
  CREATE INDEX ix_memberships_org ON memberships(org_id);

  CREATE TABLE projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_by  INTEGER NOT NULL REFERENCES users(id),
    name        TEXT NOT NULL,
    step        INTEGER NOT NULL DEFAULT 1,
    brief_json      TEXT NOT NULL DEFAULT '{}',
    mandatory_json  TEXT NOT NULL DEFAULT '{}',
    analysis_json   TEXT,
    concepts_json   TEXT,
    chosen_concept  INTEGER,
    plan_json       TEXT,
    critique_json   TEXT,
    compose_json    TEXT,
    plate_asset_id  INTEGER,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX ix_projects_org ON projects(org_id);

  CREATE TABLE elements (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    key         TEXT NOT NULL,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('background','object')),
    prompt      TEXT NOT NULL,
    key_color   TEXT NOT NULL DEFAULT '#00FF00',
    layout_json TEXT NOT NULL DEFAULT '{}',
    z           INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','generated','approved')),
    approved_asset_id INTEGER,
    UNIQUE (project_id, key)
  );

  CREATE TABLE assets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    element_id  INTEGER REFERENCES elements(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('element','composite','plate','export','logo')),
    file        TEXT NOT NULL,
    mime        TEXT NOT NULL,
    prompt      TEXT,
    feedback    TEXT,
    created_by  INTEGER NOT NULL REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX ix_assets_project ON assets(project_id);
  CREATE INDEX ix_assets_element ON assets(element_id);

  CREATE TABLE fonts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id        INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    family        TEXT NOT NULL,
    weight        INTEGER NOT NULL DEFAULT 400,
    style         TEXT NOT NULL DEFAULT 'normal',
    file          TEXT NOT NULL,
    format        TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX ix_fonts_owner ON fonts(owner_user_id);
  CREATE INDEX ix_fonts_org ON fonts(org_id);
  `,
  // v2: password reset, email invitations, org quotas + usage, org-level/public libraries (fonts + elements).
  `
  CREATE TABLE password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    used_at    TEXT
  );
  CREATE INDEX ix_resets_user ON password_resets(user_id);

  CREATE TABLE invitations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email       TEXT NOT NULL COLLATE NOCASE,
    role        TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
    token_hash  TEXT NOT NULL UNIQUE,
    invited_by  INTEGER NOT NULL REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at  TEXT NOT NULL,
    accepted_at TEXT,
    revoked_at  TEXT
  );
  CREATE INDEX ix_invitations_org ON invitations(org_id);

  ALTER TABLE assets ADD COLUMN from_library_id INTEGER; -- set when a version was taken from the library (no re-save)
  ALTER TABLE organizations ADD COLUMN quota_text_monthly INTEGER;
  ALTER TABLE organizations ADD COLUMN quota_image_monthly INTEGER;

  CREATE TABLE usage_events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    kind       TEXT NOT NULL CHECK (kind IN ('text','image')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX ix_usage_org_time ON usage_events(org_id, created_at);

  -- Fonts move from user-owned to org-owned (+ optional public visibility).
  -- Former personal fonts go to the uploader's oldest owned org (fallback: any org they belong to).
  CREATE TABLE fonts_v2 (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    visibility  TEXT NOT NULL DEFAULT 'org' CHECK (visibility IN ('org','public')),
    family      TEXT NOT NULL,
    weight      INTEGER NOT NULL DEFAULT 400,
    style       TEXT NOT NULL DEFAULT 'normal',
    file        TEXT NOT NULL,
    format      TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO fonts_v2 (id, org_id, created_by, visibility, family, weight, style, file, format, created_at)
  SELECT f.id,
         COALESCE(f.org_id,
           (SELECT m.org_id FROM memberships m WHERE m.user_id = f.owner_user_id AND m.role = 'owner' ORDER BY m.created_at, m.org_id LIMIT 1),
           (SELECT m.org_id FROM memberships m WHERE m.user_id = f.owner_user_id ORDER BY m.created_at, m.org_id LIMIT 1)),
         f.owner_user_id, 'org', f.family, f.weight, f.style, f.file, f.format, f.created_at
  FROM fonts f
  WHERE COALESCE(f.org_id, (SELECT m.org_id FROM memberships m WHERE m.user_id = f.owner_user_id LIMIT 1)) IS NOT NULL;
  DROP TABLE fonts;
  ALTER TABLE fonts_v2 RENAME TO fonts;
  CREATE INDEX ix_fonts_org ON fonts(org_id);
  CREATE INDEX ix_fonts_public ON fonts(visibility) WHERE visibility = 'public';

  -- Element library: every approved element is saved here (own file copy — survives project deletion).
  CREATE TABLE library_elements (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id          INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    visibility      TEXT NOT NULL DEFAULT 'org' CHECK (visibility IN ('org','public')),
    name            TEXT NOT NULL,
    element_kind    TEXT NOT NULL CHECK (element_kind IN ('background','object')),
    key_color       TEXT,
    prompt          TEXT,
    file            TEXT NOT NULL,
    mime            TEXT NOT NULL,
    source_asset_id INTEGER UNIQUE,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX ix_libel_org ON library_elements(org_id);
  CREATE INDEX ix_libel_public ON library_elements(visibility) WHERE visibility = 'public';
  `,
  // v3: hierarchy — client -> product -> campaign (N products) -> project (ad).
  // Each level gets a brief (brief_json) and a documents folder (generic `documents` table, shared by all levels).
  // Legacy projects (pre-hierarchy) are backfilled under a per-org "לקוח כללי / קמפיין כללי" (is_default=1) so
  // existing data keeps working; POST /orgs/:orgId/projects (the old quick-create route) does the same lazily
  // for orgs created after this migration. See DECISIONS.md D35.
  `
  CREATE TABLE clients (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_by  INTEGER NOT NULL REFERENCES users(id),
    name        TEXT NOT NULL,
    is_default  INTEGER NOT NULL DEFAULT 0,
    brief_json  TEXT NOT NULL DEFAULT '{}', -- description, industry, audience, tone, brandVoice
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX ix_clients_org ON clients(org_id);

  CREATE TABLE products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    created_by  INTEGER NOT NULL REFERENCES users(id),
    name        TEXT NOT NULL,
    brief_json  TEXT NOT NULL DEFAULT '{}', -- description, features, differentiators
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX ix_products_client ON products(client_id);

  CREATE TABLE campaigns (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    created_by  INTEGER NOT NULL REFERENCES users(id),
    name        TEXT NOT NULL,
    is_default  INTEGER NOT NULL DEFAULT 0,
    brief_json  TEXT NOT NULL DEFAULT '{}', -- goal, audience, tone, timeframe, notes
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX ix_campaigns_client ON campaigns(client_id);

  -- A campaign can promote more than one product; an individual ad (below) then focuses on one of them.
  CREATE TABLE campaign_products (
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    PRIMARY KEY (campaign_id, product_id)
  );

  -- One shared "documents folder" table for every level (client/product/campaign/project).
  -- role is a free label used by the app for specific slots (e.g. 'logo', 'product_image', 'reference_ad');
  -- NULL role = a general document. meta_json carries structured extras (e.g. a reference ad's decomposition).
  CREATE TABLE documents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    owner_type  TEXT NOT NULL CHECK (owner_type IN ('client','product','campaign','project')),
    owner_id    INTEGER NOT NULL,
    role        TEXT,
    name        TEXT NOT NULL,
    file        TEXT NOT NULL,
    mime        TEXT NOT NULL,
    note        TEXT,
    meta_json   TEXT,
    created_by  INTEGER NOT NULL REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX ix_documents_owner ON documents(owner_type, owner_id);

  ALTER TABLE projects ADD COLUMN client_id       INTEGER REFERENCES clients(id) ON DELETE SET NULL;
  ALTER TABLE projects ADD COLUMN campaign_id     INTEGER REFERENCES campaigns(id) ON DELETE SET NULL;
  ALTER TABLE projects ADD COLUMN product_id      INTEGER REFERENCES products(id) ON DELETE SET NULL;
  ALTER TABLE projects ADD COLUMN flow_json       TEXT NOT NULL DEFAULT '{}'; -- quick-create step selection: {"mode":"quick","include":{...}}
  ALTER TABLE projects ADD COLUMN directions_json TEXT NOT NULL DEFAULT '{}'; -- free-text steering note per stage, kept for continuity
  CREATE INDEX ix_projects_campaign ON projects(campaign_id);

  -- Backfill: every org that already has projects gets one default client + default campaign, and its
  -- existing projects are attached to them, so nothing already built breaks under the new hierarchy.
  INSERT INTO clients (org_id, created_by, name, is_default, brief_json)
  SELECT p.org_id,
         COALESCE((SELECT m.user_id FROM memberships m WHERE m.org_id = p.org_id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1),
                   (SELECT m.user_id FROM memberships m WHERE m.org_id = p.org_id ORDER BY m.created_at LIMIT 1)),
         'לקוח כללי', 1, '{}'
  FROM (SELECT DISTINCT org_id FROM projects) p;

  INSERT INTO campaigns (client_id, created_by, name, is_default, brief_json)
  SELECT c.id, c.created_by, 'קמפיין כללי', 1, '{}' FROM clients c WHERE c.is_default = 1;

  UPDATE projects SET
    client_id   = (SELECT c.id FROM clients c WHERE c.org_id = projects.org_id AND c.is_default = 1),
    campaign_id = (SELECT ca.id FROM campaigns ca WHERE ca.client_id = (SELECT c.id FROM clients c WHERE c.org_id = projects.org_id AND c.is_default = 1) AND ca.is_default = 1)
  WHERE client_id IS NULL;
  `,
];

function open(file = config.dbFile) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db) {
  const current = db.pragma("user_version", { simple: true });
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

module.exports = { open };
