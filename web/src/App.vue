<script setup>
import { useRouter } from "vue-router";
import { store, setOrg, currentOrg } from "./lib/store";
import { api } from "./lib/api";

const router = useRouter();
async function logout() {
  await api.post("/auth/logout");
  store.me = null;
  router.push("/login");
}
function switchOrg(e) {
  setOrg(Number(e.target.value));
  router.push("/");
}
</script>

<template>
  <header v-if="store.me" class="topbar">
    <router-link to="/" class="brand" aria-label="דף הבית">
      <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true"><path d="M4 10V4h6M22 4h6v6M28 22v6h-6M10 28H4v-6" stroke="currentColor" stroke-width="3" fill="none"/><circle cx="16" cy="16" r="5" fill="var(--magenta)"/></svg>
      סטודיו מודעות
    </router-link>
    <label class="org-switch">
      <span class="sr">ארגון</span>
      <select :value="store.orgId" @change="switchOrg" data-test="org-switch">
        <option v-for="o in store.me.orgs" :key="o.id" :value="o.id">{{ o.name }}</option>
      </select>
    </label>
    <nav>
      <router-link to="/">מודעות</router-link>
      <router-link to="/library">ספרייה</router-link>
      <router-link to="/org">{{ currentOrg()?.role === "member" ? "הארגון" : "ניהול ארגון" }}</router-link>
      <router-link to="/settings">הגדרות{{ store.me.gemini.hasKey ? "" : " ●" }}</router-link>
    </nav>
    <span class="me">{{ store.me.user.name }}</span>
    <button class="ghost" @click="logout">יציאה</button>
  </header>
  <main><router-view v-if="store.me || $route.meta.public" /></main>
  <div v-if="store.toast" class="toast" :class="store.toast.kind" role="status">{{ store.toast.msg }}</div>
</template>
