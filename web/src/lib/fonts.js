// Registers the user's uploaded fonts in the browser via the FontFace API.
// Each font gets an internal family name (uf<ID>) so user-chosen names can't collide or inject CSS.
import { api } from "./api";

const loaded = new Map(); // id -> Promise<FontFace>

export const BUILTIN_FONTS = [
  { id: "b:assistant", family: "Assistant, Arial, sans-serif", label: "Assistant (מובנה)" },
  { id: "b:suez", family: "'Suez One', Georgia, serif", label: "Suez One (מובנה)" },
  { id: "b:sans", family: "Arial, sans-serif", label: "Sans (מערכת)" },
  { id: "b:serif", family: "Georgia, serif", label: "Serif (מערכת)" },
];

/** Fonts usable in orgId: the org's own library + public fonts of other orgs. */
export async function listFonts(orgId, { scope = "all", q = "" } = {}) {
  return api.get(`/fonts?orgId=${orgId}&scope=${scope}&q=${encodeURIComponent(q)}`);
}

export function familyFor(fontId) {
  if (!fontId) return BUILTIN_FONTS[0].family;
  const b = BUILTIN_FONTS.find((f) => f.id === fontId);
  if (b) return b.family;
  return `uf${fontId}, Arial, sans-serif`; // fallback if the file fails to load
}

export function registerFont(font) {
  if (loaded.has(font.id)) return loaded.get(font.id);
  const p = fetch(`/api/fonts/${font.id}/file`, { credentials: "same-origin" })
    .then((r) => { if (!r.ok) throw new Error("font fetch failed"); return r.arrayBuffer(); })
    .then((buf) => new FontFace(`uf${font.id}`, buf, { weight: String(font.weight), style: font.style }).load())
    .then((ff) => { document.fonts.add(ff); return ff; })
    .catch((e) => { loaded.delete(font.id); throw e; });
  loaded.set(font.id, p);
  return p;
}

export async function registerAll(fonts) {
  await Promise.allSettled(fonts.map(registerFont));
}
