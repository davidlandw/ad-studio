const config = require("./config");

function fail(msg) { console.error(`Config error: ${msg}`); process.exit(1); }
if (config.isProd) {
  if (config.appSecret.startsWith("dev-only")) fail("APP_SECRET must be set in production (it encrypts users' Gemini keys).");
  if (!process.env.APP_URL) fail("APP_URL must be set in production (used in emailed links).");
  if (config.mailTransport !== "smtp" && process.env.MAIL_TRANSPORT !== "outbox")
    fail("SMTP_URL is not set. Password reset and invitations need email. (Set MAIL_TRANSPORT=outbox to override knowingly.)");
}

const db = require("./db").open();
const { createApp } = require("./app");

createApp(db).listen(config.port, () => {
  console.log(`קונספטה listening on http://localhost:${config.port}` +
    `${config.geminiMock ? "  [GEMINI_MOCK]" : ""}  [mail: ${config.mailTransport}]`);
});
