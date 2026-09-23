<script setup>
import { ref, watch, computed } from "vue";
import { api } from "../lib/api";
import { store, currentOrg, toast } from "../lib/store";
import { listFonts, registerAll } from "../lib/fonts";

const tab = ref("elements");
const scope = ref("all"); // all | org | public
const q = ref("");
const fonts = ref([]), elements = ref([]), loading = ref(false);
const up = ref({ family: "", weight: 400, style: "normal", visibility: "org" });
const file = ref(null), busy = ref(false);
const org = computed(currentOrg);
const VIS = { org: "הארגון", public: "כולם" };

async function load() {
  if (!store.orgId) return;
  loading.value = true;
  try {
    if (tab.value === "fonts") {
      fonts.value = await listFonts(store.orgId, { scope: scope.value, q: q.value });
      registerAll(fonts.value);
    } else {
      elements.value = await api.get(`/library/elements?orgId=${store.orgId}&scope=${scope.value}&q=${encodeURIComponent(q.value)}`);
    }
  } catch (e) { toast(e.message, "error"); }
  loading.value = false;
}
let t;
watch([tab, scope, () => store.orgId], load, { immediate: true });
watch(q, () => { clearTimeout(t); t = setTimeout(load, 250); });

function pick(e) {
  file.value = e.target.files[0] || null;
  if (file.value && !up.value.family) up.value.family = file.value.name.replace(/\.[^.]+$/, "");
}
async function uploadFont() {
  if (!file.value) return toast("בחרו קובץ פונט", "error");
  const fd = new FormData();
  fd.append("file", file.value); fd.append("family", up.value.family); fd.append("orgId", store.orgId);
  fd.append("weight", up.value.weight); fd.append("style", up.value.style); fd.append("visibility", up.value.visibility);
  busy.value = true;
  try {
    await api.post("/fonts", fd); toast("הפונט נוסף לספרייה");
    up.value.family = ""; file.value = null; document.getElementById("font-file").value = "";
    await load();
  } catch (e) { toast(e.message, "error"); } finally { busy.value = false; }
}

const path = (item) => (tab.value === "fonts" ? `/fonts/${item.id}` : `/library/elements/${item.id}`);
async function setVis(item, visibility) {
  if (visibility === "public" && !confirm(`"${item.family || item.name}" יהיה זמין לכל משתמשי המערכת, בכל הארגונים. להמשיך?`)) return load();
  try { await api.patch(path(item), { visibility }); item.visibility = visibility; toast(visibility === "public" ? "זמין לכולם" : "זמין לארגון בלבד"); }
  catch (e) { toast(e.message, "error"); load(); }
}
async function rename(item, ev) {
  const name = ev.target.value.trim();
  if (!name || name === item.name) return;
  try { await api.patch(path(item), { name }); item.name = name; toast("השם עודכן"); } catch (e) { toast(e.message, "error"); }
}
async function del(item) {
  if (!confirm(`למחוק את "${item.family || item.name}" מהספרייה? פרויקטים שכבר השתמשו בו לא יושפעו.`)) return;
  try { await api.del(path(item)); await load(); } catch (e) { toast(e.message, "error"); }
}
</script>

<template>
  <section>
    <h1>הספרייה של {{ org?.name }}</h1>
    <p class="muted">כל מה שכאן זמין לכל חברי הארגון. פריט שמסומן "כולם" זמין גם לכל משתמש בכל ארגון אחר, לשימוש בלבד. רק מי שהוסיף אותו, או מנהל בארגון, יכולים לשנות או למחוק.</p>

    <div class="bar row">
      <div class="tabs" role="tablist">
        <button role="tab" :aria-selected="tab === 'elements'" :class="{ on: tab === 'elements' }" @click="tab = 'elements'" data-test="tab-elements">אלמנטים</button>
        <button role="tab" :aria-selected="tab === 'fonts'" :class="{ on: tab === 'fonts' }" @click="tab = 'fonts'" data-test="tab-fonts">פונטים</button>
      </div>
      <select v-model="scope" style="width:auto" aria-label="מקור" data-test="lib-scope">
        <option value="all">של הארגון + ציבוריים</option><option value="org">של הארגון בלבד</option><option value="public">ציבוריים מארגונים אחרים</option>
      </select>
      <input v-model="q" type="search" placeholder="חיפוש לפי שם" style="max-width:240px" aria-label="חיפוש" />
    </div>

    <template v-if="tab === 'fonts'">
      <div class="panel">
        <h2>הוספת פונט</h2>
        <form class="grid2" @submit.prevent="uploadFont">
          <label class="field"><span>קובץ <small>(TTF, OTF, WOFF, WOFF2 עד 10MB)</small></span><input id="font-file" type="file" accept=".ttf,.otf,.woff,.woff2" @change="pick" data-test="font-file" /></label>
          <label class="field"><span>שם המשפחה</span><input v-model="up.family" required data-test="font-family" /></label>
          <label class="field"><span>משקל</span>
            <select v-model.number="up.weight" data-test="font-weight"><option v-for="w in [100,200,300,400,500,600,700,800,900]" :key="w" :value="w">{{ w }}</option></select></label>
          <label class="field"><span>סגנון</span><select v-model="up.style"><option value="normal">רגיל</option><option value="italic">נטוי</option></select></label>
          <label class="field"><span>זמין ל</span>
            <select v-model="up.visibility" data-test="font-visibility"><option value="org">חברי {{ org?.name }}</option><option value="public">כולם (כל הארגונים)</option></select></label>
          <div class="field" style="align-self:end"><button class="primary" :disabled="busy" data-test="upload-font">הוספה לספרייה</button></div>
        </form>
        <p class="muted small">יש לוודא שרישיון הפונט מתיר שימוש בארגון, ובוודאי לפני שמסמנים אותו "כולם".</p>
      </div>
      <table v-if="fonts.length" class="panel" data-test="fonts-table">
        <thead><tr><th>דוגמה</th><th>משפחה</th><th>משקל</th><th>שייך ל</th><th>זמין ל</th><th></th></tr></thead>
        <tbody>
          <tr v-for="f in fonts" :key="f.id" :data-test="`font-${f.family}`">
            <td :style="{ fontFamily: `uf${f.id}`, fontWeight: f.weight, fontStyle: f.style, fontSize: '22px' }">אבגד Aa 123</td>
            <td>{{ f.family }}</td><td>{{ f.weight }}</td>
            <td>{{ f.own ? "הארגון" : f.orgName }}</td>
            <td>
              <select v-if="f.canManage" :value="f.visibility" @change="setVis(f, $event.target.value)" style="width:auto" :data-test="`vis-font-${f.id}`">
                <option value="org">הארגון</option><option value="public">כולם</option></select>
              <span v-else class="chip" :class="f.visibility">{{ VIS[f.visibility] }}</span>
            </td>
            <td><button v-if="f.canManage" class="danger" @click="del(f)">מחיקה</button></td>
          </tr>
        </tbody>
      </table>
      <p v-else-if="!loading" class="muted">אין פונטים בתצוגה הזו. אפשר להעלות את פונט המותג למעלה.</p>
    </template>

    <template v-else>
      <p class="muted small">כל אלמנט שמאושר בפרויקט נשמר כאן אוטומטית, עם עותק משלו, כך שהוא נשמר גם אם הפרויקט נמחק. משתמשים בו מתוך שלב "יצירת אלמנטים" בכל מודעה.</p>
      <ul v-if="elements.length" class="grid" data-test="elements-grid">
        <li v-for="e in elements" :key="e.id" class="item" :data-test="`lib-${e.id}`">
          <div class="thumb" :class="{ checker: e.kind === 'object' }"><img :src="`/api/library/elements/${e.id}/file`" :alt="e.name" loading="lazy" /></div>
          <input v-if="e.canManage" class="name" :value="e.name" @change="rename(e, $event)" :aria-label="`שם של ${e.name}`" />
          <strong v-else class="name">{{ e.name }}</strong>
          <span class="muted small">{{ e.kind === "background" ? "רקע" : "אובייקט" }} · {{ e.own ? e.creatorName : e.orgName }}</span>
          <div class="row">
            <label v-if="e.canManage" class="small" :for="`vis-${e.id}`">זמין ל:</label>
            <select v-if="e.canManage" :id="`vis-${e.id}`" :value="e.visibility" @change="setVis(e, $event.target.value)" style="width:auto" :data-test="`vis-el-${e.id}`">
              <option value="org">הארגון</option><option value="public">כולם</option></select>
            <span v-else class="chip" :class="e.visibility">{{ VIS[e.visibility] }}</span>
            <button v-if="e.canManage" class="danger" @click="del(e)">מחיקה</button>
          </div>
        </li>
      </ul>
      <p v-else-if="!loading" class="muted">עוד אין אלמנטים. אשרו אלמנט במודעה והוא יישמר כאן.</p>
    </template>
  </section>
</template>

<style scoped>
.bar { margin: 12px 0 18px; }
.tabs { display: flex; border: 1px solid var(--ink); }
.tabs button { background: transparent; color: var(--ink); border: 0; border-radius: 0; }
.tabs button.on { background: var(--ink); color: #fff; }
.small { font-size: 14px; }
table.panel { padding: 0; }
.grid { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 16px; }
.item { background: #fff; border: 1px solid var(--line); padding: 10px; display: flex; flex-direction: column; gap: 6px; }
.thumb { aspect-ratio: 1; display: grid; place-items: center; overflow: hidden; background: #eef0f2; }
.thumb img { max-width: 100%; max-height: 100%; }
.checker { background: repeating-conic-gradient(#e6e8eb 0 25%, #fff 0 50%) 0 0 / 16px 16px; }
.name { font-weight: 600; }
input.name { padding: 4px 6px; }
.chip { font-size: 13px; border: 1px solid var(--line); padding: 1px 8px; }
.chip.public { border-color: var(--cyan); color: var(--cyan); }
</style>
