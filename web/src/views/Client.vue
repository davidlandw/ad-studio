<script setup>
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { api } from "../lib/api";
import { toast } from "../lib/store";

const props = defineProps({ id: Number });
const router = useRouter();
const client = ref(null), tab = ref("brief"), error = ref("");
const BRIEF_FIELDS = [["description", "על הלקוח / העסק", true], ["industry", "תחום", false], ["audience", "קהל יעד כללי", false], ["tone", "טון וקול המותג", false], ["notes", "הערות נוספות", true]];
const brief = ref({});
const newProduct = ref(""), newCampaign = ref("");
const docName = ref(""), docFile = ref(null), docRole = ref("");
const refFile = ref(null), decomposing = ref(null);

async function load() {
  try { client.value = await api.get(`/clients/${props.id}`); brief.value = { ...client.value.brief }; }
  catch (e) { error.value = e.message; }
}
load();

const logo = computed(() => client.value?.documents.find((d) => d.id === client.value.logoDocId));
const generalDocs = computed(() => client.value?.documents.filter((d) => d.role !== "logo" && d.role !== "reference_ad" && d.role !== "concept_md") || []);
const referenceAds = computed(() => client.value?.documents.filter((d) => d.role === "reference_ad") || []);
const conceptDocs = computed(() => client.value?.documents.filter((d) => d.role === "concept_md") || []);

async function saveBrief() {
  // PATCH only returns the client's own fields, not products/campaigns/documents — merge, don't replace.
  try { client.value = { ...client.value, ...(await api.patch(`/clients/${props.id}`, { brief: brief.value })) }; toast("הבריף נשמר"); }
  catch (e) { toast(e.message, "error"); }
}
async function rename(e) {
  const name = e.target.value.trim();
  if (name && name !== client.value.name) { try { client.value = { ...client.value, ...(await api.patch(`/clients/${props.id}`, { name })) }; } catch (e2) { toast(e2.message, "error"); } }
}
async function addProduct() {
  try { await api.post(`/clients/${props.id}/products`, { name: newProduct.value }); newProduct.value = ""; await load(); }
  catch (e) { toast(e.message, "error"); }
}
async function addCampaign() {
  try { const c = await api.post(`/clients/${props.id}/campaigns`, { name: newCampaign.value }); router.push(`/campaigns/${c.id}`); }
  catch (e) { toast(e.message, "error"); }
}
async function uploadDoc(role) {
  if (!docFile.value) return toast("יש לבחור קובץ", "error");
  const fd = new FormData(); fd.append("file", docFile.value); if (docName.value) fd.append("name", docName.value);
  if (role) fd.append("role", role); else if (docRole.value) fd.append("role", docRole.value);
  try { await api.post(`/clients/${props.id}/documents`, fd); docFile.value = null; docName.value = ""; docRole.value = ""; await load(); toast("המסמך נשמר בתיקייה"); }
  catch (e) { toast(e.message, "error"); }
}
async function removeDoc(id) {
  try { await api.del(`/documents/${id}`); await load(); } catch (e) { toast(e.message, "error"); }
}
async function uploadReference() {
  if (!refFile.value) return toast("יש לבחור תמונה", "error");
  const fd = new FormData(); fd.append("file", refFile.value);
  try { await api.post(`/clients/${props.id}/reference-ads`, fd); refFile.value = null; await load(); }
  catch (e) { toast(e.message, "error"); }
}
async function decompose(doc) {
  decomposing.value = doc.id;
  try { await api.post(`/documents/${doc.id}/decompose`, {}); await load(); toast("הניתוח נשמר כקובץ MD בתיקיית המסמכים"); }
  catch (e) { toast(e.message, "error"); }
  decomposing.value = null;
}
async function removeClient() {
  if (!confirm(`למחוק את ${client.value.name}?`)) return;
  try { await api.del(`/clients/${props.id}`); router.push("/clients"); }
  catch (e) { toast(e.message, "error"); }
}
</script>

<template>
  <p v-if="error" class="panel error-text">{{ error }} <router-link to="/clients">חזרה ללקוחות</router-link></p>
  <section v-else-if="client">
    <div class="row" style="justify-content:space-between">
      <input class="title" :value="client.name" @change="rename" aria-label="שם הלקוח" data-test="client-name" />
      <button class="danger" @click="removeClient">מחיקת לקוח</button>
    </div>
    <nav class="tabs row">
      <button :class="tab === 'brief' ? 'primary' : 'ghost'" @click="tab = 'brief'">בריף</button>
      <button :class="tab === 'docs' ? 'primary' : 'ghost'" @click="tab = 'docs'">מסמכים ({{ generalDocs.length }})</button>
      <button :class="tab === 'products' ? 'primary' : 'ghost'" @click="tab = 'products'">מוצרים ({{ client.products.length }})</button>
      <button :class="tab === 'campaigns' ? 'primary' : 'ghost'" @click="tab = 'campaigns'">קמפיינים ({{ client.campaigns.length }})</button>
      <button :class="tab === 'refs' ? 'primary' : 'ghost'" @click="tab = 'refs'" data-test="tab-refs">מודעות רפרנס ({{ referenceAds.length }})</button>
    </nav>

    <div v-if="tab === 'brief'" class="panel">
      <label class="field"><span>לוגו</span>
        <img v-if="logo" :src="`/api/documents/${logo.id}/file`" alt="לוגו" class="logo-preview" />
        <input type="file" accept="image/png,image/jpeg,image/webp" @change="(e) => { docFile = e.target.files[0]; uploadDoc('logo'); }" data-test="logo-upload" />
      </label>
      <div class="grid2">
        <label v-for="[k, l, long] in BRIEF_FIELDS" :key="k" class="field"><span>{{ l }}</span>
          <textarea v-if="long" v-model="brief[k]" :data-test="`client-brief-${k}`"></textarea>
          <input v-else v-model="brief[k]" :data-test="`client-brief-${k}`" />
        </label>
      </div>
      <button class="primary" @click="saveBrief" data-test="save-client-brief">שמירת הבריף</button>
    </div>

    <div v-if="tab === 'docs'" class="panel">
      <h2>תיקיית מסמכים</h2>
      <p class="muted">קבצים כלליים (PDF או תמונה) — מסמכי מותג, הנחיות, חוזים.</p>
      <ul class="docs">
        <li v-for="d in generalDocs" :key="d.id">
          <a :href="`/api/documents/${d.id}/file`" target="_blank" rel="noopener">{{ d.name }}</a>
          <button class="link danger" @click="removeDoc(d.id)">מחיקה</button>
        </li>
      </ul>
      <form class="row" @submit.prevent="uploadDoc(null)">
        <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" @change="(e) => (docFile = e.target.files[0])" />
        <input v-model="docName" placeholder="שם (לא חובה)" style="max-width:200px" />
        <button class="primary" data-test="upload-doc">העלאה</button>
      </form>
    </div>

    <div v-if="tab === 'products'" class="panel">
      <ul class="list">
        <li v-for="p in client.products" :key="p.id"><router-link :to="`/products/${p.id}`" :data-test="`product-${p.id}`">{{ p.name }}</router-link></li>
      </ul>
      <form class="row" @submit.prevent="addProduct">
        <input v-model="newProduct" placeholder="שם מוצר חדש" data-test="new-product-name" />
        <button class="primary" data-test="new-product">הוספת מוצר</button>
      </form>
    </div>

    <div v-if="tab === 'campaigns'" class="panel">
      <ul class="list">
        <li v-for="c in client.campaigns" :key="c.id">
          <router-link :to="`/campaigns/${c.id}`" :data-test="`campaign-${c.id}`">{{ c.name }}</router-link>
          <span class="muted"> · {{ c.adCount }} מודעות{{ c.isDefault ? " · ברירת מחדל" : "" }}</span>
        </li>
      </ul>
      <form class="row" @submit.prevent="addCampaign">
        <input v-model="newCampaign" placeholder="שם קמפיין חדש" data-test="new-campaign-name" />
        <button class="primary" data-test="new-campaign">הוספת קמפיין</button>
      </form>
    </div>

    <div v-if="tab === 'refs'" class="panel">
      <p class="muted">מודעות אמיתיות (למשל מהעיתון) לניתוח. הניתוח מפרק את המודעה לאלמנטים/פאנלים/שורות טקסט וכותב MD שמסביר איך לבנות אותה במערכת.</p>
      <form class="row" @submit.prevent="uploadReference">
        <input type="file" accept="image/png,image/jpeg,image/webp" @change="(e) => (refFile = e.target.files[0])" data-test="ref-file" />
        <button class="primary" data-test="upload-ref">העלאת מודעת רפרנס</button>
      </form>
      <ul class="refs">
        <li v-for="d in referenceAds" :key="d.id">
          <img :src="`/api/documents/${d.id}/file`" :alt="d.name" loading="lazy" />
          <div>
            <strong>{{ d.name }}</strong>
            <p v-if="d.meta?.archetype" class="muted small">נותח: {{ d.meta.archetype === "graphic" ? "מודעה גרפית" : d.meta.archetype === "hybrid" ? "משולבת" : "צילומית" }}</p>
            <button class="ghost" :disabled="decomposing === d.id" @click="decompose(d)" :data-test="`decompose-${d.id}`">{{ decomposing === d.id ? "מנתח…" : "ניתוח קונספט" }}</button>
          </div>
        </li>
      </ul>
      <template v-if="conceptDocs.length">
        <h3 style="margin-top:20px">ניתוחים (קבצי MD)</h3>
        <ul class="docs">
          <li v-for="d in conceptDocs" :key="d.id"><a :href="`/api/documents/${d.id}/file`" target="_blank" rel="noopener">{{ d.name }}</a></li>
        </ul>
      </template>
    </div>
  </section>
</template>

<style scoped>
.title { font-family: var(--display); font-size: 1.6rem; background: transparent; border-color: transparent; }
.title:hover, .title:focus { border-color: var(--line); background: #fff; }
.tabs { margin: 16px 0; }
.logo-preview { max-height: 80px; display: block; margin-bottom: 8px; }
.docs, .list, .refs { list-style: none; padding: 0; margin: 0 0 16px; }
.docs li, .list li { padding: 6px 0; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center; }
.refs { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
.refs li { display: flex; flex-direction: column; gap: 6px; background: #fff; border: 1px solid var(--line); padding: 8px; }
.refs img { width: 100%; max-height: 220px; object-fit: contain; background: repeating-conic-gradient(#e6e8eb 0 25%, #fff 0 50%) 0 0 / 16px 16px; }
.small { font-size: 13px; }
</style>
