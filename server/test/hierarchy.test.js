// v3: client -> product -> campaign -> ad hierarchy, documents folders, free-text direction, quick/graphic ad mode,
// and reference-ad decomposition. Same harness style as api.test.js (real server, temp DB, Gemini mock).
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "adstudio-test-v3-"));
process.env.DATA_DIR = tmp;
process.env.GEMINI_MOCK = "1";
process.env.WEB_DIST = path.join(tmp, "no-web");
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
const png = () => new Blob([encodePng(40, 40, (x) => [x * 5, 100, 50])], { type: "image/png" });

test("hierarchy: clients, products, campaigns, documents", async (t) => {
  const a = client();
  await a.post("/auth/register", { email: "hier@example.com", name: "Hier", password: "password123" });
  await a.put("/me/gemini-key", { key: "mock-key-HIER0000" });
  const orgId = (await a.get("/me")).data.orgs[0].id;

  let clientId, productId, campaignId;
  await t.test("client CRUD + brief", async () => {
    const created = await a.post(`/orgs/${orgId}/clients`, { name: "קפה עלית", brief: { description: "רשת בתי קפה", industry: "מזון" } });
    assert.equal(created.status, 201);
    clientId = created.data.id;
    assert.equal(created.data.brief.industry, "מזון");
    const listed = (await a.get(`/orgs/${orgId}/clients`)).data;
    assert.ok(listed.some((c) => c.id === clientId));
    const patched = await a.patch(`/clients/${clientId}`, { name: "קפה עלית בע\"מ" });
    assert.equal(patched.data.name, 'קפה עלית בע"מ');
    const b = client();
    await b.post("/auth/register", { email: "outsider1@example.com", name: "O", password: "password123" });
    assert.equal((await b.get(`/clients/${clientId}`)).status, 404, "outsider can't read");
  });

  await t.test("product + campaign CRUD, campaign can hold >1 product", async () => {
    const p1 = await a.post(`/clients/${clientId}/products`, { name: "קפה שחור", brief: { description: "פולי קפה קלויים" } });
    assert.equal(p1.status, 201);
    productId = p1.data.id;
    const p2 = await a.post(`/clients/${clientId}/products`, { name: "קפה קר" });
    const camp = await a.post(`/clients/${clientId}/campaigns`, { name: "קמפיין קיץ", brief: { goal: "מכירות קיץ" }, productIds: [productId, p2.data.id] });
    assert.equal(camp.status, 201);
    campaignId = camp.data.id;
    assert.deepEqual(new Set(camp.data.productIds), new Set([productId, p2.data.id]));
    const detail = (await a.get(`/campaigns/${campaignId}`)).data;
    assert.equal(detail.products.length, 2);
    assert.equal(detail.ads.length, 0);
  });

  await t.test("documents folder: upload/list/delete, magic-byte sniffing, per-level", async () => {
    const f = new FormData(); f.append("file", png(), "logo.png"); f.append("role", "logo");
    const up = await a.post(`/clients/${clientId}/documents`, undefined, { form: f });
    assert.equal(up.status, 201);
    const detail = (await a.get(`/clients/${clientId}`)).data;
    assert.equal(detail.logoDocId, up.data.id);
    assert.equal((await a.get(`/documents/${up.data.id}/file`)).status, 200);
    const bad = new FormData(); bad.append("file", new Blob(["not an image"]), "x.png");
    assert.equal((await a.post(`/clients/${clientId}/documents`, undefined, { form: bad })).status, 400, "content sniffed");
    // product + campaign each get their own documents folder too
    const fp = new FormData(); fp.append("file", png(), "shot.png");
    assert.equal((await a.post(`/products/${productId}/documents`, undefined, { form: fp })).status, 201);
    const fc = new FormData(); fc.append("file", png(), "brief.png");
    assert.equal((await a.post(`/campaigns/${campaignId}/documents`, undefined, { form: fc })).status, 201);
    assert.equal((await a.get(`/products/${productId}`)).data.documents.length, 1);
    assert.equal((await a.get(`/campaigns/${campaignId}`)).data.documents.length, 1);
    assert.equal((await a.del(`/documents/${up.data.id}`)).status, 200);
    assert.equal((await a.get(`/clients/${clientId}`)).data.documents.length, 0);
  });

  let adId;
  await t.test("create ad under a campaign, with a focused product and quick+graphic flow", async () => {
    const created = await a.post(`/campaigns/${campaignId}/projects`, { name: "מבצע קיץ", productId,
      flow: { mode: "quick", include: { concepts: false, critique: false }, adStyle: "graphic" } });
    assert.equal(created.status, 201);
    adId = created.data.id;
    assert.equal(created.data.clientId, clientId);
    assert.equal(created.data.campaignId, campaignId);
    assert.equal(created.data.productId, productId);
    assert.equal(created.data.adStyle, "graphic");
    assert.equal(created.data.flow.mode, "quick");
    assert.equal(created.data.hierarchy.client, 'קפה עלית בע"מ');
    assert.equal(created.data.hierarchy.campaign, "קמפיין קיץ");
    assert.equal(created.data.hierarchy.product, "קפה שחור");
  });

  await t.test("graphic ad: dynamic text lines, direction persisted, zero elements, export without a plate", async () => {
    await a.patch(`/projects/${adId}`, { brief: { businessName: "קפה עלית", offering: "קפה", goal: "מבצע קיץ", format: "1:1" } });
    const an = await a.post(`/projects/${adId}/analyze`, { direction: "תתמקד בקהל הצעיר" });
    assert.equal(an.status, 200);
    assert.equal(an.data.directions.analyze, "תתמקד בקהל הצעיר");

    const lines = [{ text: "אספרסו 10 ש\"ח", role: "price" }, { text: "קפוצ'ינו 12 ש\"ח", role: "price" }, { text: "✓ ללא תשלום עד 20 דק'", role: "bullet" }];
    await a.patch(`/projects/${adId}`, { mandatory: { centerProduct: "קפה שחור", businessName: "קפה עלית", lines } });
    const saved = (await a.get(`/projects/${adId}`)).data;
    assert.equal(saved.mandatory.lines.length, 3);

    await a.post(`/projects/${adId}/concepts`);
    const chosen = await a.post(`/projects/${adId}/choose`, { index: 0, direction: "קח את הצבעוניות מקונספט 2" });
    assert.equal(chosen.status, 200);
    assert.equal(chosen.data.directions.plan, "קח את הצבעוניות מקונספט 2");

    const locked = await a.post(`/projects/${adId}/lock-plan`, {});
    assert.equal(locked.status, 200);
    assert.equal(locked.data.elements.length, 0, "graphic ad can lock a plan with zero photographed elements");
    assert.equal(locked.data.step, 6);

    const tl = (await a.get(`/projects/${adId}/text-layers`)).data;
    assert.ok(tl.some((t) => t.text.includes("אספרסו")), "extra line text rendered verbatim");
    assert.ok(tl.some((t) => t.role === "bullet" && t.text.startsWith("✓")), "bullet role gets a check prefix");

    // no elements to approve, no plate needed — export straight from a blank/panel canvas
    const ex = new FormData(); ex.append("file", png(), "final.png");
    const exported = await a.post(`/projects/${adId}/export`, undefined, { form: ex });
    assert.equal(exported.status, 201);
    assert.equal((await a.get(`/projects/${adId}`)).data.step, 8);
  });

  await t.test("legacy quick-create (POST /orgs/:orgId/projects) still files ads under a default client+campaign", async () => {
    const p = await a.post(`/orgs/${orgId}/projects`, { name: "מודעה ישנה" });
    assert.equal(p.status, 201);
    assert.ok(p.data.clientId && p.data.campaignId, "auto-filed under a default client/campaign");
    const c2 = await a.post(`/orgs/${orgId}/projects`, { name: "מודעה נוספת" });
    assert.equal(c2.data.clientId, p.data.clientId, "reuses the same default client on the second call");
    assert.equal(c2.data.campaignId, p.data.campaignId);
  });

  await t.test("deleting a client/campaign with existing ads is blocked", async () => {
    const blocked = await a.del(`/clients/${clientId}`);
    assert.equal(blocked.status, 400);
    assert.equal(blocked.data.code, "has_ads");
    const blockedCamp = await a.del(`/campaigns/${campaignId}`);
    assert.equal(blockedCamp.status, 400);
    assert.equal(blockedCamp.data.code, "has_ads");
  });

  await t.test("reference-ad decomposition (vision, mock mode) writes a concept .md document", async () => {
    const f = new FormData(); f.append("file", png(), "newspaper-ad.png");
    const up = await a.post(`/clients/${clientId}/reference-ads`, undefined, { form: f });
    assert.equal(up.status, 201);
    assert.equal(up.data.role, "reference_ad");
    const listed = (await a.get(`/clients/${clientId}/reference-ads`)).data;
    assert.equal(listed.length, 1);

    const decomposed = await a.post(`/documents/${up.data.id}/decompose`, {});
    assert.equal(decomposed.status, 201);
    assert.equal(decomposed.data.concept.mime, "text/markdown");
    assert.equal(decomposed.data.concept.meta.sourceDocId, up.data.id);
    const mdFile = await a.get(`/documents/${decomposed.data.concept.id}/file`);
    assert.equal(mdFile.status, 200);
    assert.match(mdFile.data.toString("utf8"), /#/, "markdown content saved");

    const refreshed = (await a.get(`/clients/${clientId}`)).data;
    const analyzedRef = refreshed.documents.find((d) => d.id === up.data.id);
    assert.equal(analyzedRef.meta.archetype, "graphic");
    assert.ok(refreshed.documents.some((d) => d.role === "concept_md"));
  });
});
