const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const config = require("./config");
const { sessionMiddleware, csrfGuard } = require("./auth");
const { HttpError } = require("./errors");

function createApp(db) {
  const app = express();
  app.disable("x-powered-by");
  // Only trust X-Forwarded-For when actually behind a proxy — otherwise clients could spoof their IP
  // and bypass the per-IP rate limits. TRUST_PROXY=1 (one hop: IIS/nginx/Cloudflare Tunnel) or a number/CSV of subnets.
  if (config.trustProxy) app.set("trust proxy", config.trustProxy);
  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff").set("Referrer-Policy", "same-origin").set("X-Frame-Options", "DENY");
    next();
  });
  app.use(express.json({ limit: "1mb" }));

  const api = express.Router();
  api.use(sessionMiddleware(db));
  api.use(csrfGuard);
  api.get("/health", (_req, res) => res.json({ ok: true, mock: config.geminiMock }));
  api.use(require("./routes/account")(db));
  api.use(require("./routes/invitations")(db));
  api.use(require("./routes/orgs")(db));
  api.use(require("./routes/library")(db));
  api.use(require("./routes/clients")(db));
  api.use(require("./routes/products")(db));
  api.use(require("./routes/campaigns")(db));
  api.use(require("./routes/documents")(db));
  api.use(require("./routes/references")(db));
  api.use(require("./routes/projects")(db));
  api.use((_req, _res, next) => next(new HttpError(404, "נתיב לא קיים", "not_found")));
  app.use("/api", api);

  // Serve the built Vue app (SPA fallback) when present.
  if (fs.existsSync(path.join(config.webDist, "index.html"))) {
    app.use(express.static(config.webDist, { index: false, maxAge: "1h" }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(config.webDist, "index.html")));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err?.code === "LIMIT_FILE_SIZE") err = new HttpError(413, "הקובץ גדול מדי", "too_large");
    if (err?.type === "entity.parse.failed") err = new HttpError(400, "JSON לא תקין", "bad_json");
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 && !(err instanceof HttpError) ? "שגיאת שרת" : err.message, code: err.code || "error" });
  });
  return app;
}

module.exports = { createApp };
