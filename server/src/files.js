const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const config = require("./config");
const { bad } = require("./errors");

const IMAGE_SIGS = [
  { mime: "image/png", ext: "png", test: (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47 },
  { mime: "image/jpeg", ext: "jpg", test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/webp", ext: "webp", test: (b) => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" },
];
const FONT_SIGS = [
  { format: "truetype", ext: "ttf", test: (b) => b.readUInt32BE(0) === 0x00010000 || b.toString("ascii", 0, 4) === "true" },
  { format: "opentype", ext: "otf", test: (b) => b.toString("ascii", 0, 4) === "OTTO" },
  { format: "woff", ext: "woff", test: (b) => b.toString("ascii", 0, 4) === "wOFF" },
  { format: "woff2", ext: "woff2", test: (b) => b.toString("ascii", 0, 4) === "wOF2" },
];

// Identify by content (magic bytes), never by the client-supplied name/mime.
function sniffImage(buf) {
  const s = IMAGE_SIGS.find((x) => x.test(buf));
  if (!s) throw bad("קובץ התמונה חייב להיות PNG, JPEG או WEBP");
  return s;
}
function sniffFont(buf) {
  const s = buf.length >= 12 && FONT_SIGS.find((x) => x.test(buf));
  if (!s) throw bad("קובץ הפונט חייב להיות TTF, OTF, WOFF או WOFF2");
  return s;
}

function save(subdir, buf, ext) {
  const dir = path.join(config.filesDir, subdir);
  fs.mkdirSync(dir, { recursive: true });
  const rel = path.join(subdir, `${crypto.randomUUID()}.${ext}`);
  fs.writeFileSync(path.join(config.filesDir, rel), buf);
  return rel;
}
const abs = (rel) => {
  const p = path.resolve(config.filesDir, rel);
  if (!p.startsWith(path.resolve(config.filesDir) + path.sep)) throw bad("bad path");
  return p;
};
const read = (rel) => fs.readFileSync(abs(rel));
const remove = (rel) => { try { fs.unlinkSync(abs(rel)); } catch { /* already gone */ } };

module.exports = { sniffImage, sniffFont, save, abs, read, remove };
