<script setup>
import { ref, watch } from "vue";
import { useRouter } from "vue-router";
import { api } from "../lib/api";
import { store, currentOrg, toast } from "../lib/store";

const router = useRouter();
const list = ref([]), name = ref(""), loading = ref(true);

async function load() {
  if (!store.orgId) return;
  loading.value = true;
  try { list.value = await api.get(`/orgs/${store.orgId}/clients`); } catch (e) { toast(e.message, "error"); }
  loading.value = false;
}
watch(() => store.orgId, load, { immediate: true });

async function create() {
  try {
    const c = await api.post(`/orgs/${store.orgId}/clients`, { name: name.value });
    router.push(`/clients/${c.id}`);
  } catch (e) { toast(e.message, "error"); }
}
</script>

<template>
  <section>
    <div class="head row">
      <h1>הלקוחות של {{ currentOrg()?.name }}</h1>
      <form class="row new" @submit.prevent="create">
        <input v-model="name" placeholder="שם הלקוח" aria-label="שם לקוח חדש" data-test="new-client-name" />
        <button class="primary" data-test="new-client">לקוח חדש</button>
      </form>
    </div>
    <p class="muted">כל לקוח מכיל מוצרים וקמפיינים, ולכל אחד תיקיית מסמכים ובריף משלו. לכל לקוח יש גם קמפיין "כללי" ליצירה מהירה בלי לארגן היררכיה.</p>
    <p v-if="!loading && !list.length" class="muted">עוד אין לקוחות בארגון הזה.</p>
    <ul class="sheet">
      <li v-for="c in list" :key="c.id">
        <router-link :to="`/clients/${c.id}`" class="card" :data-test="`client-${c.id}`">
          <strong>{{ c.name }}</strong>
          <span v-if="c.isDefault" class="muted small">ברירת מחדל ליצירה מהירה</span>
          <span v-else class="muted small">{{ c.brief.industry || "—" }}</span>
        </router-link>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.head { justify-content: space-between; margin-bottom: 16px; }
.new input { width: 280px; }
.sheet { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 18px; }
.card { display: flex; flex-direction: column; gap: 4px; text-decoration: none; color: inherit; background: #fff; padding: 16px; border: 1px solid var(--line); }
.card:hover { border-color: var(--ink); }
.small { font-size: 14px; }
</style>
