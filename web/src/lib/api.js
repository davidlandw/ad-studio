// Thin fetch wrapper: cookie session + CSRF header + Hebrew error messages from the server.
export class ApiError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

async function request(method, url, body) {
  const headers = { "X-Requested-With": "adstudio" };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }
  const res = await fetch("/api" + url, { method, headers, body: payload, credentials: "same-origin" });
  const data = (res.headers.get("content-type") || "").includes("json") ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.error || `שגיאה ${res.status}`, data?.code);
  return data;
}

export const api = {
  get: (u) => request("GET", u),
  post: (u, b) => request("POST", u, b),
  put: (u, b) => request("PUT", u, b),
  patch: (u, b) => request("PATCH", u, b),
  del: (u) => request("DELETE", u),
};

export const assetUrl = (id) => (id ? `/api/assets/${id}/file` : null);
