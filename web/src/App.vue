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
      <svg viewBox="0 0 100 100" width="26" height="26" aria-hidden="true"><rect width="100" height="100" rx="24" fill="var(--magenta)"/><path d="M50 25Q56 44 75 50Q56 56 50 75Q44 56 25 50Q44 44 50 25Z" fill="#fff"/></svg>
      קונספטה
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
