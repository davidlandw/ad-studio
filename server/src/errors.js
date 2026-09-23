class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
const bad = (m, c) => new HttpError(400, m, c);
const forbidden = (m = "אין הרשאה") => new HttpError(403, m, "forbidden");
const notFound = (m = "לא נמצא") => new HttpError(404, m, "not_found");
// Wrap async route handlers so thrown errors reach the error middleware.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
module.exports = { HttpError, bad, forbidden, notFound, wrap };
