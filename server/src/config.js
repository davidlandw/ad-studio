const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dataDir = process.env.DATA_DIR || path.join(root, "data");

module.exports = {
  port: Number(process.env.PORT || 3000),
  dataDir,
  dbFile: process.env.DB_FILE || path.join(dataDir, "adstudio.db"),
  filesDir: path.join(dataDir, "files"),
  webDist: process.env.WEB_DIST || path.resolve(root, "..", "web", "dist"),
  // Used to encrypt users' Gemini keys at rest. MUST be set in production.
  appSecret: process.env.APP_SECRET || "dev-only-insecure-secret-change-me",
  isProd: process.env.NODE_ENV === "production",
  geminiMock: process.env.GEMINI_MOCK === "1",
  geminiTextModel: process.env.GEMINI_TEXT_MODEL || "gemini-2.5-flash",
  geminiImageModel: process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image",
  sessionDays: 14,
  trustProxy: !process.env.TRUST_PROXY ? false : /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY,
  // Public base URL used in emailed links. Never derived from the request Host header (host-header injection).
  appUrl: (process.env.APP_URL || `http://localhost:${Number(process.env.PORT || 3000)}`).replace(/\/$/, ""),
  // Mail: SMTP_URL like smtp://user:pass@smtp.example.com:587 ; without it mails go to DATA_DIR/outbox (dev/test only).
  smtpUrl: process.env.SMTP_URL || "",
  mailFrom: process.env.MAIL_FROM || "קונספטה <no-reply@localhost>",
  mailTransport: process.env.MAIL_TRANSPORT || (process.env.SMTP_URL ? "smtp" : "outbox"),
  resetTokenMinutes: 60,
  inviteDays: 7,
  // Default monthly quotas per organization (overridable per org by a platform admin). 0 = blocked.
  quotaTextMonthly: Number(process.env.QUOTA_TEXT_MONTHLY ?? 300),
  quotaImageMonthly: Number(process.env.QUOTA_IMAGE_MONTHLY ?? 200),
  // Comma-separated emails allowed to change org quotas.
  platformAdmins: (process.env.PLATFORM_ADMINS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  maxFontBytes: 10 * 1024 * 1024,
  maxImageBytes: 15 * 1024 * 1024,
};
