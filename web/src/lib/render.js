// Canvas rendering shared by the preview and the full-resolution export,
// so what the user approves on screen is exactly what gets exported.
import { familyFor } from "./fonts";

const imgCache = new Map();
export function loadImage(src) {
  if (!imgCache.has(src)) {
    imgCache.set(src, new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => { imgCache.delete(src); rej(new Error("image load failed")); };
      i.src = src;
    }));
  }
  return imgCache.get(src);
}

const keyCache = new Map();
/** Chroma-key an element image: pixels near keyColor become transparent, edges feathered, spill reduced. */
export function keyOut(img, keyColor, tolerance) {
  const k = `${img.src}|${keyColor}|${tolerance}`;
  if (keyCache.has(k)) return keyCache.get(k);
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const [kr, kg, kb] = [1, 3, 5].map((i) => parseInt(keyColor.slice(i, i + 2), 16));
  const tol = tolerance, soft = tolerance * 1.6;
  const dom = kg >= kr && kg >= kb ? 1 : kr >= kb ? 0 : 2; // dominant channel of the key, for despill
  for (let i = 0; i < d.data.length; i += 4) {
    const r = d.data[i], g = d.data[i + 1], b = d.data[i + 2];
    const dist = Math.sqrt((r - kr) ** 2 + (g - kg) ** 2 + (b - kb) ** 2);
    if (dist < tol) d.data[i + 3] = 0;
    else if (dist < soft) {
      d.data[i + 3] = Math.round(255 * ((dist - tol) / (soft - tol)));
      const px = [r, g, b];
      const others = px.filter((_, j) => j !== dom);
      px[dom] = Math.min(px[dom], Math.max(...others)); // despill the edge
      d.data[i] = px[0]; d.data[i + 1] = px[1]; d.data[i + 2] = px[2];
    }
  }
  ctx.putImageData(d, 0, 0);
  keyCache.set(k, c);
  return c;
}

export function drawCover(ctx, img, W, H) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const s = Math.max(W / iw, H / ih);
  ctx.drawImage(img, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s);
}

/** Composition collage: background covers the frame, object layers placed by box. */
export async function renderComposite(ctx, W, H, layers) {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#808080"; ctx.fillRect(0, 0, W, H);
  const sorted = [...layers].filter((l) => l.visible !== false).sort((a, b) => a.z - b.z);
  for (const l of sorted) {
    const img = await loadImage(l.src);
    if (l.kind === "background") { drawCover(ctx, img, W, H); continue; }
    const src = l.keyOut ? keyOut(img, l.keyColor, l.tolerance) : img;
    ctx.save();
    if (l.flip) { ctx.translate(l.x + l.w, l.y); ctx.scale(-1, 1); ctx.drawImage(src, 0, 0, l.w, l.h); }
    else ctx.drawImage(src, l.x, l.y, l.w, l.h);
    ctx.restore();
  }
}

export function wrapLines(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const t = line ? `${line} ${w}` : w;
      if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}

export const fontString = (t) => `${t.weight || 400} ${t.size}px ${familyFor(t.fontId)}`;

export async function ensureFonts(texts) {
  await Promise.allSettled(texts.map((t) => document.fonts.load(fontString(t), t.text)));
}

/** Measured text block height (for the drag overlay). */
export function textBlockHeight(ctx, t) {
  ctx.font = fontString(t);
  return wrapLines(ctx, t.text, t.w).length * t.size * (t.lineHeight || 1.15);
}

/** Final ad: plate + text layers + logo. */
export async function renderAd(ctx, W, H, { plateSrc, texts = [], logo }) {
  ctx.clearRect(0, 0, W, H);
  if (plateSrc) drawCover(ctx, await loadImage(plateSrc), W, H);
  await ensureFonts(texts);
  ctx.direction = "rtl";
  ctx.textBaseline = "top";
  for (const t of texts) {
    if (t.hidden) continue;
    ctx.save();
    ctx.font = fontString(t);
    ctx.fillStyle = t.color || "#fff";
    if (t.shadow) { ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = Math.round(t.size * 0.25); ctx.shadowOffsetY = Math.round(t.size * 0.04); }
    ctx.textAlign = t.align === "center" ? "center" : t.align === "left" ? "left" : "right";
    const x = t.align === "center" ? t.x + t.w / 2 : t.align === "left" ? t.x : t.x + t.w;
    const lh = t.size * (t.lineHeight || 1.15);
    wrapLines(ctx, t.text, t.w).forEach((line, i) => ctx.fillText(line, x, t.y + i * lh));
    ctx.restore();
  }
  if (logo?.src && !logo.hidden) {
    const img = await loadImage(logo.src);
    const s = Math.min(logo.w / img.naturalWidth, logo.h / img.naturalHeight);
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    ctx.drawImage(img, logo.x + (logo.w - w) / 2, logo.y + (logo.h - h) / 2, w, h);
  }
}

export function canvasToBlob(canvas) {
  return new Promise((res) => canvas.toBlob(res, "image/png"));
}
