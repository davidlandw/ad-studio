import { reactive } from "vue";
import { api } from "./api";

export const store = reactive({
  me: null,
  orgId: Number(localStorage.getItem("orgId")) || null,
  toast: null,
});

export async function loadMe() {
  try { const s = await api.get("/auth/session"); store.me = s.user ? s : null; } catch { store.me = null; }
  if (!store.me) return null;
  const ids = store.me.orgs.map((o) => o.id);
  if (!ids.includes(store.orgId)) setOrg(ids[0] || null);
  return store.me;
}

export function setOrg(id) {
  store.orgId = id;
  if (id) localStorage.setItem("orgId", String(id)); else localStorage.removeItem("orgId");
}

export const currentOrg = () => store.me?.orgs.find((o) => o.id === store.orgId) || null;

let t;
export function toast(msg, kind = "ok") {
  store.toast = { msg, kind };
  clearTimeout(t);
  t = setTimeout(() => (store.toast = null), kind === "error" ? 6000 : 3000);
}
