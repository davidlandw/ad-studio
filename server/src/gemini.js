/**
 * Gemini client (Google AI Studio REST API, v1beta generateContent).
 * The key is always the *user's* key, passed per call — never a server-wide key.
 * GEMINI_MOCK=1 swaps in a deterministic offline mock (tests / demos without a key).
 */
const config = require("./config");
const { HttpError } = require("./errors");
const { encodePng } = require("./png");

const BASE = "https://generativelanguage.googleapis.com/v1beta";

async function call(apiKey, model, body) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${BASE}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) return json;
    last = new HttpError(res.status === 400 || res.status === 403 ? 400 : 502,
      `Gemini ${res.status}: ${json?.error?.message || res.statusText}`, "gemini_error");
    if (!(res.status === 429 || res.status >= 500)) break;
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  throw last;
}

function extractText(json) {
  return (json?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
}

function parseJson(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  try { return JSON.parse(clean); } catch {
    const s = clean.indexOf("{"), e = clean.lastIndexOf("}");
    if (s >= 0 && e > s) return JSON.parse(clean.slice(s, e + 1));
    throw new HttpError(502, "Gemini returned invalid JSON", "gemini_bad_json");
  }
}

/** Text step → JSON object. `images` (optional) are reference inputs [{mime, base64}] for vision analysis. `mock` is the canned answer used in mock mode. */
async function generateJSON({ apiKey, system, prompt, images = [], mock }) {
  if (config.geminiMock) return typeof mock === "function" ? mock() : mock;
  const parts = [...images.map((i) => ({ inlineData: { mimeType: i.mime, data: i.base64 } })), { text: prompt }];
  const json = await call(apiKey, config.geminiTextModel, {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.9 },
  });
  return parseJson(extractText(json));
}

/** Image generation / editing. `images` are reference inputs [{mime, base64}]. */
async function generateImage({ apiKey, prompt, images = [], aspectRatio = "1:1", mockHint = {} }) {
  if (config.geminiMock) return mockImage(aspectRatio, mockHint);
  const parts = [
    ...images.map((i) => ({ inlineData: { mimeType: i.mime, data: i.base64 } })),
    { text: prompt },
  ];
  const json = await call(apiKey, config.geminiImageModel, {
    contents: [{ role: "user", parts }],
    generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio } },
  });
  const img = (json?.candidates?.[0]?.content?.parts || []).map((p) => p.inlineData || p.inline_data).find(Boolean);
  if (!img?.data) {
    const reason = json?.candidates?.[0]?.finishReason || json?.promptFeedback?.blockReason || "unknown";
    throw new HttpError(502, `Gemini did not return an image (reason: ${reason})`, "gemini_no_image");
  }
  return { base64: img.data, mime: img.mimeType || img.mime_type || "image/png" };
}

async function verifyKey(apiKey) {
  if (config.geminiMock) return { ok: apiKey.length >= 8 };
  const res = await fetch(`${BASE}/models?pageSize=1`, { headers: { "x-goog-api-key": apiKey } });
  return { ok: res.ok, status: res.status };
}

// ---- mock -----------------------------------------------------------------
const RATIOS = { "1:1": [1, 1], "4:5": [4, 5], "9:16": [9, 16], "16:9": [16, 9], "3:4": [3, 4] };
function hashColor(s = "") {
  let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return [60 + (h % 150), 40 + ((h >> 8) % 120), 30 + ((h >> 16) % 100)];
}
function hex(c) { return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)); }

function mockImage(aspectRatio, { kind = "background", label = "", keyColor = "#00FF00" }) {
  const [rw, rh] = RATIOS[aspectRatio] || [1, 1];
  const long = 480;
  const w = rw >= rh ? long : Math.round((long * rw) / rh);
  const h = rh >= rw ? long : Math.round((long * rh) / rw);
  const col = hashColor(label);
  const cx = w / 2, cy = h / 2, rad = Math.min(w, h) * 0.32;
  const key = hex(keyColor);
  const png = encodePng(w, h, (x, y) => {
    const t = y / h;
    if (kind === "object") {
      const inside = (x - cx) ** 2 + (y - cy) ** 2 < rad ** 2;
      return inside ? [col[0] + 40 * t, col[1] + 20, col[2]] : key;
    }
    // background / plate: warm vertical gradient with a soft vignette
    const v = 1 - 0.5 * (((x - cx) / w) ** 2 + ((y - cy) / h) ** 2);
    return [col[0] * v * (1 - 0.4 * t), col[1] * v * (1 - 0.3 * t), col[2] * v];
  });
  return { base64: png.toString("base64"), mime: "image/png" };
}

module.exports = { generateJSON, generateImage, verifyKey, parseJson };
