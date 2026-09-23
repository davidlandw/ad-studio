/**
 * Outgoing email. Transports:
 *   smtp   — real delivery (SMTP_URL)
 *   outbox — writes JSON files to DATA_DIR/outbox (dev/test; tests read the links from there)
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const config = require("./config");

let smtp;
function transport() {
  if (!smtp) smtp = require("nodemailer").createTransport(config.smtpUrl);
  return smtp;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function layout(title, paragraphs, action) {
  const html = `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;background:#eef0f2;font-family:Arial,sans-serif;color:#23272e">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #c3c7cd;text-align:right" dir="rtl">
<tr><td style="padding:24px 28px">
<h1 style="font-size:22px;margin:0 0 16px">${esc(title)}</h1>
${paragraphs.map((p) => `<p style="font-size:16px;line-height:1.5;margin:0 0 12px">${esc(p)}</p>`).join("")}
${action ? `<p style="margin:20px 0"><a href="${esc(action.url)}" style="background:#c8177e;color:#fff;text-decoration:none;padding:10px 20px;display:inline-block;font-weight:bold">${esc(action.label)}</a></p>
<p style="font-size:13px;color:#5d6470;margin:0">אם הכפתור לא עובד, העתיקו את הקישור: <span dir="ltr">${esc(action.url)}</span></p>` : ""}
</td></tr></table></td></tr></table></body></html>`;
  const text = [title, "", ...paragraphs, ...(action ? ["", `${action.label}: ${action.url}`] : [])].join("\n");
  return { html, text };
}

async function send({ to, subject, title, paragraphs, action }) {
  const { html, text } = layout(title || subject, paragraphs, action);
  const msg = { from: config.mailFrom, to, subject, text, html };
  if (config.mailTransport === "smtp") return transport().sendMail(msg);
  const dir = path.join(config.dataDir, "outbox");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${crypto.randomBytes(3).toString("hex")}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...msg, link: action?.url || null, createdAt: new Date().toISOString() }, null, 2));
  if (!config.isProd) console.log(`[mail:outbox] to=${to} subject="${subject}" link=${action?.url || "-"}`);
  return { outbox: file };
}

/** Fire-and-forget with logging: mail failures must not leak account existence via timing/errors. */
function sendQuiet(msg) {
  send(msg).catch((e) => console.error("[mail] send failed:", e.message));
}

module.exports = { send, sendQuiet, layout };
