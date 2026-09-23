<script setup>
import { ref, watch } from "vue";
import { useRouter } from "vue-router";
import { api, assetUrl } from "../lib/api";
import { store, currentOrg, toast } from "../lib/store";

const STEP_NAMES = ["", "ניתוח העסק", "פרטי חובה", "קונספטים", "קומפוזיציה", "ביקורת", "אלמנטים", "הרכבה", "טקסט וייצוא"];
const router = useRouter();
const list = ref([]), name = ref(""), loading = ref(true);

async function load() {
  if (!store.orgId) return;
  loading.value = true;
  try { list.value = await api.get(`/orgs/${store.orgId}/projects`); } catch (e) { toast(e.message, "error"); }
  loading.value = false;
}
watch(() => store.orgId, load, { immediate: true });

async function create() {
  try {
    const p = await api.post(`/orgs/${store.orgId}/projects`, { name: name.value });
    router.push(`/p/${p.id}`);
  } catch (e) { toast(e.message, "error"); }
}
</script>

<template>
  <section>
    <div class="head row">
      <h1>המודעות של {{ currentOrg()?.name }}</h1>
      <form class="row new" @submit.prevent="create">
        <input v-model="name" placeholder="שם המודעה, למשל: קפה עלית — בוקר" aria-label="שם מודעה חדשה" data-test="new-project-name" />
        <button class="primary" data-test="new-project">מודעה חדשה</button>
      </form>
    </div>
    <p v-if="!store.me.gemini.hasKey" class="panel">כדי ליצור תוכן צריך מפתח Gemini משלך. <router-link to="/settings">הוספת מפתח בהגדרות</router-link></p>
    <p v-if="!loading && !list.length" class="muted">עוד אין מודעות בארגון הזה. תנו שם למודעה הראשונה ולחצו "מודעה חדשה".</p>
    <ul class="sheet">
      <li v-for="p in list" :key="p.id">
        <router-link :to="`/p/${p.id}`" class="card">
          <div class="thumb">
            <img v-if="p.export_asset_id || p.plate_asset_id" :src="assetUrl(p.export_asset_id || p.plate_asset_id)" alt="" loading="lazy" />
          </div>
          <strong>{{ p.name }}</strong>
          <span class="muted">שלב {{ p.step }}: {{ STEP_NAMES[p.step] }} · {{ p.created_by_name }}</span>
        </router-link>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.head { justify-content: space-between; margin-bottom: 16px; }
.new input { width: 320px; }
.sheet { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 18px; }
.card { display: flex; flex-direction: column; gap: 4px; text-decoration: none; color: inherit; background: #fff; padding: 10px; border: 1px solid var(--line); }
.card:hover { border-color: var(--ink); }
.thumb { aspect-ratio: 4 / 5; background: repeating-linear-gradient(45deg, #eceef0 0 10px, #e3e6e9 10px 20px); display: grid; place-items: center; overflow: hidden; }
.thumb img { width: 100%; height: 100%; object-fit: cover; }
</style>
