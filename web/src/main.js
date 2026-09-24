import { createApp } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import App from "./App.vue";
import { store, loadMe } from "./lib/store";
import "./style.css";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", component: () => import("./views/Login.vue"), meta: { public: true } },
    { path: "/", component: () => import("./views/Projects.vue") },
    { path: "/clients", component: () => import("./views/Clients.vue") },
    { path: "/clients/:id", component: () => import("./views/Client.vue"), props: (r) => ({ id: Number(r.params.id) }) },
    { path: "/products/:id", component: () => import("./views/Product.vue"), props: (r) => ({ id: Number(r.params.id) }) },
    { path: "/campaigns/:id", component: () => import("./views/Campaign.vue"), props: (r) => ({ id: Number(r.params.id) }) },
    { path: "/org", component: () => import("./views/Org.vue") },
    { path: "/settings", component: () => import("./views/Settings.vue") },
    { path: "/library", component: () => import("./views/Library.vue") },
    { path: "/forgot", component: () => import("./views/Forgot.vue"), meta: { public: true, guestOnly: true } },
    { path: "/reset/:token", component: () => import("./views/Reset.vue"), meta: { public: true }, props: true },
    { path: "/invite/:token", component: () => import("./views/Invite.vue"), meta: { public: true }, props: true },
    { path: "/p/:id", component: () => import("./views/Project.vue"), props: (r) => ({ id: Number(r.params.id) }) },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});

let booted = false;
router.beforeEach(async (to) => {
  if (!booted) { booted = true; await loadMe(); }
  if (!to.meta.public && !store.me) return { path: "/login", query: { next: to.fullPath } };
  if ((to.path === "/login" || to.meta.guestOnly) && store.me) return to.query.next || "/";
});

createApp(App).use(router).mount("#app");
