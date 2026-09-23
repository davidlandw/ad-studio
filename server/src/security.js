const crypto = require("node:crypto");
const config = require("./config");

// Passwords: scrypt (built into Node), salt per user.
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}
function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split("$");
  if (alg !== "scrypt") return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, "hex"), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, "hex"));
}

// Session tokens: random, only the SHA-256 is stored.
const newToken = () => crypto.randomBytes(32).toString("base64url");
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

// Gemini keys at rest: AES-256-GCM with a key derived from APP_SECRET.
const encKey = crypto.createHash("sha256").update("gemini-key:" + config.appSecret).digest();
function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", encKey, iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}
function decrypt(blob) {
  const [iv, tag, data] = blob.split(".").map((s) => Buffer.from(s, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", encKey, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}
const maskKey = (k) => (k ? `••••${k.slice(-4)}` : null);

module.exports = { hashPassword, verifyPassword, newToken, sha256, encrypt, decrypt, maskKey };
