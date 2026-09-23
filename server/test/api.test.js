// End-to-end API test against a real server instance, temp DB, and the Gemini mock.
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "adstudio-test-"));
process.env.DATA_DIR = tmp;
process.env.GEMINI_MOCK = "1";
process.env.WEB_DIST = path.join(tmp, "no-web");
process.env.PLATFORM_ADMINS = "admin@example.com";
process.env.APP_URL = "http://app.test";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../src/app");
const { encodePng } = require("../src/png");

let server, base;
test.before(async () => {
  const db = require("../src/db").open();
  server = createApp(db).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
test.after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

function client() {
  let cookie = "";
  const req = async (method, url, body, { form } = {}) => {
    const headers = { "X-Requested-With": "adstudio" };
    if (cookie) headers.Cookie = cookie;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
    const res = await fetch(base + url, { method, headers, body: payload });
    const sc = res.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    const type = res.headers.get("content-type") || "";
    const data = type.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, type };
  };
  return { req, get: (u) => req("GET", u), post: (u, b, o) => req("POST", u, b, o), put: (u, b) => req("PUT", u, b),
    patch: (u, b) => req("PATCH", u, b), del: (u) => req("DELETE", u) };
}

/** Latest outbox mail to `to`, and the token at the end of its link. */
function lastMail(to) {
  const dir = path.join(tmp, "outbox");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
  for (const f of files.reverse()) {
    const m = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    if (m.to === to) return { ...m, token: m.link?.split("/").pop() };
  }
  return null;
}

const png = () => new Blob([encodePng(40, 40, (x) => [x * 5, 100, 50])], { type: "image/png" });
const fakeFont = () => { const b = Buffer.alloc(64); b.writeUInt32BE(0x00010000, 0); return new Blob([b]); };

test("full flow", async (t) => {
  const a = client(), b = client(), c = client();

  await t.test("register + me", async () => {
    assert.equal((await a.post("/auth/register", { email: "dudi@example.com", name: "דודי", password: "password123" })).status, 201);
    assert.equal((await b.post("/auth/register", { email: "b@example.com", name: "B", password: "password123" })).status, 201);
    assert.equal((await c.post("/auth/register", { email: "c@example.com", name: "C", password: "password123" })).status, 201);
    assert.equal((await a.post("/auth/register", { email: "DUDI@example.com", name: "x", password: "password123" })).status, 409);
    const me = await a.get("/me");
    assert.equal(me.data.orgs.length, 1);
    assert.equal(me.data.orgs[0].role, "owner");
    assert.equal(me.data.gemini.hasKey, false);
  });

  await t.test("csrf header required", async () => {
    const res = await fetch(base + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(res.status, 403);
  });

  await t.test("login / logout", async () => {
    const x = client();
    assert.equal((await x.post("/auth/login", { email: "dudi@example.com", password: "wrong-pass" })).status, 401);
    assert.equal((await x.post("/auth/login", { email: "dudi@example.com", password: "password123" })).status, 200);
    assert.equal((await x.get("/me")).status, 200);
    await x.post("/auth/logout");
    assert.equal((await x.get("/me")).status, 401);
  });

  let orgId, projectId;
  await t.test("orgs + email invitations + multi-membership", async () => {
    const o = await a.post("/orgs", { name: "A Point Systems" });
    assert.equal(o.status, 201);
    orgId = o.data.id;
    assert.equal((await a.post(`/orgs/${orgId}/invitations`, { email: "not-an-email" })).status, 400);
    assert.equal((await a.post(`/orgs/${orgId}/invitations`, { email: "b@example.com", role: "member" })).status, 201);
    const mail = lastMail("b@example.com");
    assert.ok(mail.link.startsWith("http://app.test/invite/"), "link uses APP_URL, not Host header");
    assert.match(mail.html, /dir="rtl"/);

    // public preview
    const pv = await client().get(`/invitations/${mail.token}`);
    assert.equal(pv.data.status, "pending");
    assert.equal(pv.data.orgName, "A Point Systems");
    // must be logged in, and as the invited address
    assert.equal((await client().post(`/invitations/${mail.token}/accept`)).status, 401);
    const wrong = await c.post(`/invitations/${mail.token}/accept`);
    assert.equal(wrong.status, 403);
    assert.equal(wrong.data.code, "wrong_account");
    assert.equal((await b.post(`/invitations/${mail.token}/accept`)).status, 200);
    assert.equal((await b.post(`/invitations/${mail.token}/accept`)).status, 400, "single use");
    assert.equal((await b.get("/me")).data.orgs.length, 2, "B belongs to own org + A's org");
    assert.equal((await a.post(`/orgs/${orgId}/invitations`, { email: "b@example.com" })).status, 409, "already member");

    // re-invite replaces; revoke works
    await a.post(`/orgs/${orgId}/invitations`, { email: "later@example.com" });
    const first = lastMail("later@example.com").token;
    await a.post(`/orgs/${orgId}/invitations`, { email: "later@example.com" });
    assert.equal((await client().get(`/invitations/${first}`)).data.status, "revoked");
    const pending = (await a.get(`/orgs/${orgId}/invitations`)).data;
    assert.equal(pending.length, 1);
    assert.equal((await a.del(`/orgs/${orgId}/invitations/${pending[0].id}`)).status, 200);
    assert.equal((await a.get(`/orgs/${orgId}/invitations`)).data.length, 0);

    // member cannot invite; outsider cannot see members
    assert.equal((await b.post(`/orgs/${orgId}/invitations`, { email: "c@example.com" })).status, 403);
    assert.equal((await c.get(`/orgs/${orgId}/members`)).status, 404);
    const meA = (await a.get("/me")).data.user.id;
    assert.equal((await a.del(`/orgs/${orgId}/members/${meA}`)).status, 409, "last owner cannot leave");
  });

  await t.test("gemini key stored encrypted, masked", async () => {
    assert.equal((await a.put("/me/gemini-key", { key: "short" })).status, 400);
    const r = await a.put("/me/gemini-key", { key: "mock-key-ABCD1234" });
    assert.equal(r.status, 200);
    assert.equal(r.data.masked, "••••1234");
    const me = await a.get("/me");
    assert.equal(me.data.gemini.masked, "••••1234");
    assert.ok(!JSON.stringify(me.data).includes("mock-key-ABCD"));
  });

  let cOrgId;
  await t.test("fonts: org library for all members, public across orgs", async () => {
    cOrgId = (await c.get("/me")).data.orgs[0].id;
    const f1 = new FormData(); f1.append("file", fakeFont(), "Org.ttf"); f1.append("family", "Org Font"); f1.append("orgId", String(orgId)); f1.append("weight", "700");
    const r1 = await a.post("/fonts", undefined, { form: f1 });
    assert.equal(r1.status, 201);
    const noOrg = new FormData(); noOrg.append("file", fakeFont(), "x.ttf");
    assert.equal((await a.post("/fonts", undefined, { form: noOrg })).status, 404, "orgId required");
    const bad = new FormData(); bad.append("file", new Blob(["not a font at all!!"]), "x.ttf"); bad.append("orgId", String(orgId));
    assert.equal((await a.post("/fonts", undefined, { form: bad })).status, 400);

    // B (member) sees and can use it, but can't manage it
    const bList = (await b.get(`/fonts?orgId=${orgId}`)).data;
    assert.deepEqual(bList.map((f) => [f.family, f.canManage]), [["Org Font", false]]);
    assert.equal((await b.get(`/fonts/${r1.data.id}/file`)).status, 200);
    assert.equal((await b.patch(`/fonts/${r1.data.id}`, { visibility: "public" })).status, 403);
    assert.equal((await b.del(`/fonts/${r1.data.id}`)).status, 403);
    // C (other org) can't see it while it's org-only
    assert.equal((await c.get(`/fonts?orgId=${cOrgId}`)).data.length, 0);
    assert.equal((await c.get(`/fonts/${r1.data.id}/file`)).status, 404);
    assert.equal((await c.get(`/fonts?orgId=${orgId}`)).status, 404, "can't list another org's library");
    // creator makes it public → visible to C (in C's own org context), read-only
    assert.equal((await a.patch(`/fonts/${r1.data.id}`, { visibility: "public" })).status, 200);
    const cList = (await c.get(`/fonts?orgId=${cOrgId}`)).data;
    assert.equal(cList.length, 1);
    assert.equal(cList[0].own, false);
    assert.equal(cList[0].orgName, "A Point Systems");
    assert.equal((await c.get(`/fonts/${r1.data.id}/file`)).status, 200);
    assert.equal((await c.del(`/fonts/${r1.data.id}`)).status, 403);
    assert.equal((await c.get(`/fonts?orgId=${cOrgId}&scope=org`)).data.length, 0, "scope=org excludes public");
  });

  await t.test("project pipeline steps 1-5", async () => {
    const p = await a.post(`/orgs/${orgId}/projects`, { name: "קפה עלית" });
    assert.equal(p.status, 201);
    projectId = p.data.id;
    assert.equal((await c.get(`/projects/${projectId}`)).status, 404, "outsider can't read");

    assert.equal((await a.post(`/projects/${projectId}/analyze`)).status, 400, "brief required");
    await a.patch(`/projects/${projectId}`, { brief: { businessName: "עלית", offering: "קפה", audience: "משפחות", differentiators: "מסורת", tone: "חמימות", goal: "מיתוג", format: "4:5" } });
    const an = await a.post(`/projects/${projectId}/analyze`);
    assert.equal(an.status, 200);
    assert.ok(an.data.analysis.summary);

    assert.equal((await a.post(`/projects/${projectId}/concepts`)).status, 400, "mandatory required");
    await a.patch(`/projects/${projectId}`, { mandatory: { centerProduct: "קפה שחור", businessName: "קפה עלית", slogan: "הרגע ששווה לחכות לו", phone: "", addressOrSite: "", offer: "", extra: "" } });
    const co = await a.post(`/projects/${projectId}/concepts`);
    assert.equal(co.data.concepts.length, 10);

    const ch = await a.post(`/projects/${projectId}/choose`, { index: 2 });
    assert.equal(ch.status, 200);
    assert.equal(ch.data.plan.elements.filter((e) => e.kind === "background").length, 1);

    const cr = await a.post(`/projects/${projectId}/critique`);
    assert.ok(cr.data.critique.improvements.length > 0);
    const lock = await a.post(`/projects/${projectId}/lock-plan`, { useRevised: true });
    assert.equal(lock.data.elements.length, 3);
    assert.ok(lock.data.elements.every((e) => e.status === "pending"));
  });

  await t.test("text layers are verbatim from mandatory fields", async () => {
    const tl = (await a.get(`/projects/${projectId}/text-layers`)).data;
    assert.deepEqual(tl.map((x) => x.text), ["הרגע ששווה לחכות לו", "קפה עלית"]);
  });

  await t.test("step 6: generate, refine, upload, approve per element", async () => {
    let proj = (await b.get(`/projects/${projectId}`)).data;
    const [bg, table, product] = proj.elements;
    // B (org member) has no key → clear error
    const noKey = await b.post(`/elements/${bg.id}/generate`, {});
    assert.equal(noKey.status, 400);
    assert.equal(noKey.data.code, "no_gemini_key");

    proj = (await a.post(`/elements/${bg.id}/generate`, {})).data;
    const bgAsset = proj.assets.find((x) => x.element_id === bg.id);
    const img = await a.get(`/assets/${bgAsset.id}/file`);
    assert.equal(img.type, "image/png");
    assert.equal(img.data.readUInt32BE(0), 0x89504e47);
    assert.equal((await c.get(`/assets/${bgAsset.id}/file`)).status, 404);

    // refine requires feedback
    assert.equal((await a.post(`/elements/${bg.id}/generate`, { fromAssetId: bgAsset.id })).status, 400);
    proj = (await a.post(`/elements/${bg.id}/generate`, { fromAssetId: bgAsset.id, feedback: "יותר חם" })).data;
    const refined = proj.assets.find((x) => x.element_id === bg.id && x.feedback === "יותר חם");
    assert.ok(refined);
    // approving another element's asset is rejected
    assert.equal((await a.post(`/elements/${table.id}/approve`, { assetId: refined.id })).status, 400);
    await a.post(`/elements/${bg.id}/approve`, { assetId: refined.id });

    proj = (await a.post(`/elements/${table.id}/generate`, {})).data;
    await a.post(`/elements/${table.id}/approve`, { assetId: proj.assets.find((x) => x.element_id === table.id).id });

    const f = new FormData(); f.append("file", png(), "pack.png");
    proj = (await a.post(`/elements/${product.id}/upload`, undefined, { form: f })).data;
    const up = proj.assets.find((x) => x.element_id === product.id);
    proj = (await a.post(`/elements/${product.id}/approve`, { assetId: up.id })).data;
    assert.ok(proj.elements.every((e) => e.status === "approved"));
  });

  await t.test("step 7-8: composite, fuse, plate, export", async () => {
    assert.equal((await a.post(`/projects/${projectId}/fuse`, { compositeAssetId: 999 })).status, 404);
    const f = new FormData(); f.append("file", png(), "c.png");
    const comp = await a.post(`/projects/${projectId}/composite`, undefined, { form: f });
    assert.equal(comp.status, 201);
    const txt = new FormData(); txt.append("file", new Blob(["<svg onload=alert(1)>"], { type: "image/png" }), "x.png");
    assert.equal((await a.post(`/projects/${projectId}/composite`, undefined, { form: txt })).status, 400, "content sniffed, not trusted mime");

    const fused = await a.post(`/projects/${projectId}/fuse`, { compositeAssetId: comp.data.id, instructions: "צללים רכים" });
    assert.equal(fused.status, 201);
    assert.equal(fused.data.kind, "plate");
    const pl = await a.post(`/projects/${projectId}/plate`, { assetId: fused.data.id });
    assert.equal(pl.data.plateAssetId, fused.data.id);

    await a.put(`/projects/${projectId}/compose`, { compose: { layers: [], texts: [] } });
    const ex = new FormData(); ex.append("file", png(), "final.png");
    assert.equal((await a.post(`/projects/${projectId}/export`, undefined, { form: ex })).status, 201);
    const list = (await b.get(`/orgs/${orgId}/projects`)).data;
    assert.ok(list[0].export_asset_id);
    assert.equal(list[0].step, 8);
  });

  await t.test("changing an element prompt via plan resets its approval", async () => {
    const proj = (await a.get(`/projects/${projectId}`)).data;
    const plan = proj.plan;
    plan.elements[1].prompt += " (oak)";
    await a.put(`/projects/${projectId}/plan`, { plan });
    const after = (await a.post(`/projects/${projectId}/lock-plan`, {})).data;
    const changed = after.elements.find((e) => e.key === plan.elements[1].key);
    assert.equal(changed.status, "generated");
    assert.equal(changed.approved_asset_id, null);
    assert.equal(after.elements.filter((e) => e.status === "approved").length, 2);
  });

  let libIds;
  await t.test("element library: every approved element is saved, org-wide", async () => {
    const lib = (await b.get(`/library/elements?orgId=${orgId}`)).data;
    assert.equal(lib.length, 3, "3 approved elements auto-saved");
    assert.ok(lib.every((x) => x.own && !x.canManage), "B sees them, can't manage");
    libIds = lib.map((x) => x.id);
    const file = await b.get(`/library/elements/${libIds[0]}/file`);
    assert.equal(file.data.readUInt32BE(0), 0x89504e47);
    // approving the same asset again must not duplicate
    const proj = (await a.get(`/projects/${projectId}`)).data;
    const e = proj.elements.find((x) => x.status === "approved");
    await a.post(`/elements/${e.id}/approve`, { assetId: e.approved_asset_id });
    assert.equal((await a.get(`/library/elements?orgId=${orgId}`)).data.length, 3);
    // manual save of a non-approved version
    const other = proj.assets.find((x) => x.element_id === proj.elements[0].id && x.id !== proj.elements[0].approved_asset_id);
    const saved = await a.post(`/elements/${proj.elements[0].id}/save-to-library`, { assetId: other.id, name: "רקע חלופי" });
    assert.equal(saved.status, 201);
    assert.equal((await a.get(`/library/elements?orgId=${orgId}&q=חלופי`)).data.length, 1);
    // C can't see org-only items; filter by kind works
    assert.equal((await c.get(`/library/elements?orgId=${cOrgId}`)).data.length, 0);
    assert.equal((await c.get(`/library/elements/${libIds[0]}/file`)).status, 404);
    assert.equal((await a.get(`/library/elements?orgId=${orgId}&kind=background`)).data.length, 2);
  });

  await t.test("public element reused by another org", async () => {
    assert.equal((await b.patch(`/library/elements/${libIds[0]}`, { visibility: "public" })).status, 403);
    assert.equal((await a.patch(`/library/elements/${libIds[0]}`, { visibility: "public", name: "חדר ציבורי" })).status, 200);
    const cl = (await c.get(`/library/elements?orgId=${cOrgId}&scope=public`)).data;
    assert.deepEqual(cl.map((x) => x.name), ["חדר ציבורי"]);
    // C uses it in C's own project
    await c.put("/me/gemini-key", { key: "mock-key-CCCC0000" });
    const p = (await c.post(`/orgs/${cOrgId}/projects`, { name: "C ad" })).data;
    await c.patch(`/projects/${p.id}`, { brief: { businessName: "x", offering: "y", goal: "z" }, mandatory: { centerProduct: "c", businessName: "x" } });
    await c.post(`/projects/${p.id}/analyze`); await c.post(`/projects/${p.id}/concepts`);
    await c.post(`/projects/${p.id}/choose`, { index: 0 });
    const locked = (await c.post(`/projects/${p.id}/lock-plan`, {})).data;
    const bg = locked.elements.find((x) => x.kind === "background");
    assert.equal((await c.post(`/elements/${bg.id}/from-library`, { itemId: libIds[1] })).status, 404, "org-only item is not reachable");
    const used = (await c.post(`/elements/${bg.id}/from-library`, { itemId: libIds[0] })).data;
    const asset = used.assets.find((x) => x.element_id === bg.id);
    assert.equal(asset.feedback, "מהספרייה: חדר ציבורי");
    await c.post(`/elements/${bg.id}/approve`, { assetId: asset.id });
    assert.equal((await c.get(`/library/elements?orgId=${cOrgId}&scope=org`)).data.length, 0, "library-origin versions are not re-saved");
  });

  await t.test("usage + quotas", async () => {
    const u = (await b.get(`/orgs/${orgId}/usage`)).data;
    assert.equal(u.text.used, 4);
    assert.equal(u.image.used, 4);
    assert.equal(u.image.custom, false);
    assert.equal((await a.put(`/admin/orgs/${orgId}/quota`, { text: 5, image: 4 })).status, 403, "org owner is not platform admin");
    const admin = client();
    await admin.post("/auth/register", { email: "admin@example.com", name: "Admin", password: "password123" });
    assert.equal((await admin.get("/me")).data.isPlatformAdmin, true);
    const set = await admin.put(`/admin/orgs/${orgId}/quota`, { text: 5, image: 4 });
    assert.equal(set.data.image.limit, 4);
    assert.equal(set.data.image.custom, true);
    assert.ok((await admin.get("/admin/orgs")).data.length >= 4);

    const proj = (await a.get(`/projects/${projectId}`)).data;
    const blocked = await a.post(`/elements/${proj.elements[0].id}/generate`, {});
    assert.equal(blocked.status, 429);
    assert.equal(blocked.data.code, "quota_exceeded");
    assert.equal((await a.post(`/projects/${projectId}/critique`)).status, 200, "text quota still has 1 left");
    assert.equal((await a.post(`/projects/${projectId}/critique`)).data.code, "quota_exceeded");
    // failed (blocked) calls are not counted
    assert.equal((await a.get(`/orgs/${orgId}/usage`)).data.image.used, 4);
    // back to defaults
    const back = await admin.put(`/admin/orgs/${orgId}/quota`, { text: null, image: null });
    assert.equal(back.data.image.custom, false);
    assert.equal((await a.post(`/elements/${proj.elements[0].id}/generate`, {})).status, 200);
  });

  await t.test("delete project removes files", async () => {
    assert.equal((await c.del(`/projects/${projectId}`)).status, 404);
    assert.equal((await a.del(`/projects/${projectId}`)).status, 200);
    assert.equal(fs.readdirSync(path.join(tmp, "files", `p${projectId}`)).length, 0);
  });

  await t.test("library items survive project deletion", async () => {
    const lib = (await a.get(`/library/elements?orgId=${orgId}&scope=org`)).data;
    assert.equal(lib.length, 4, "3 approved + 1 manual save");
    assert.equal((await a.get(`/library/elements/${lib[0].id}/file`)).status, 200);
    assert.equal((await a.del(`/library/elements/${lib[0].id}`)).status, 200);
  });
});

test("password reset", async () => {
  const u = client();
  await u.post("/auth/register", { email: "reset@example.com", name: "R", password: "old-password" });
  const other = client();
  await other.post("/auth/login", { email: "reset@example.com", password: "old-password" });
  // same response for unknown and known emails
  const unknown = await client().post("/auth/forgot", { email: "nobody@example.com" });
  const known = await client().post("/auth/forgot", { email: "reset@example.com" });
  assert.equal(unknown.status, 200); assert.deepEqual(unknown.data, known.data);
  assert.equal(lastMail("nobody@example.com"), null);
  const mail = lastMail("reset@example.com");
  assert.ok(mail.link.startsWith("http://app.test/reset/"));
  assert.equal((await client().post("/auth/reset", { token: mail.token, password: "short" })).status, 400);
  assert.equal((await client().post("/auth/reset", { token: "bogus", password: "new-password" })).status, 400);
  const x = client();
  assert.equal((await x.post("/auth/reset", { token: mail.token, password: "new-password" })).status, 200);
  assert.equal((await x.get("/me")).status, 200, "logged in after reset");
  assert.equal((await other.get("/me")).status, 401, "other sessions revoked");
  assert.equal((await client().post("/auth/reset", { token: mail.token, password: "another-pass" })).status, 400, "single use");
  assert.equal((await client().post("/auth/login", { email: "reset@example.com", password: "old-password" })).status, 401);
  assert.equal((await client().post("/auth/login", { email: "reset@example.com", password: "new-password" })).status, 200);
  // per-email cap: after 3 requests/hour, no more mails (response unchanged)
  const dir = path.join(tmp, "outbox");
  for (let i = 0; i < 4; i++) await client().post("/auth/forgot", { email: "reset@example.com" });
  const count = fs.readdirSync(dir).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f)))).filter((m) => m.to === "reset@example.com").length;
  assert.equal(count, 3);
});

test("login rate limit", async () => {
  const u = client();
  await u.post("/auth/register", { email: "rl@example.com", name: "RL", password: "password123" });
  let last;
  for (let i = 0; i < 11; i++) last = await client().post("/auth/login", { email: "rl@example.com", password: "wrong-wrong" });
  assert.equal(last.status, 429);
  assert.equal(last.data.code, "rate_limited");
  // correct password also blocked from this source during the window
  assert.equal((await client().post("/auth/login", { email: "rl@example.com", password: "password123" })).status, 429);
  // spoofed X-Forwarded-For must not reset the limit (TRUST_PROXY is off by default)
  const spoof = await fetch(base + "/auth/login", { method: "POST", headers: { "Content-Type": "application/json",
    "X-Requested-With": "adstudio", "X-Forwarded-For": "203.0.113.7" }, body: JSON.stringify({ email: "rl@example.com", password: "password123" }) });
  assert.equal(spoof.status, 429);
  // other accounts unaffected
  assert.equal((await client().post("/auth/login", { email: "dudi@example.com", password: "password123" })).status, 200);
});

test("generation burst limit per user", async () => {
  const rl = require("../src/ratelimit");
  const orig = rl.LIMITS.generatePerUser;
  rl.LIMITS.generatePerUser = [2, 60e3];
  try {
    const u = client();
    await u.post("/auth/register", { email: "burst@example.com", name: "Burst", password: "password123" });
    await u.put("/me/gemini-key", { key: "mock-key-BURST123" });
    const org = (await u.get("/me")).data.orgs[0].id;
    const p = (await u.post(`/orgs/${org}/projects`, { name: "b" })).data;
    await u.patch(`/projects/${p.id}`, { brief: { businessName: "x", offering: "y", goal: "z" } });
    assert.equal((await u.post(`/projects/${p.id}/analyze`)).status, 200);
    assert.equal((await u.post(`/projects/${p.id}/analyze`)).status, 200);
    const third = await u.post(`/projects/${p.id}/analyze`);
    assert.equal(third.status, 429);
    assert.equal(third.data.code, "rate_limited");
  } finally { rl.LIMITS.generatePerUser = orig; }
});
