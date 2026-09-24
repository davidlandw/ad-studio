<script setup>
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import { api, assetUrl } from "../lib/api";
import { toast } from "../lib/store";

const props = defineProps({ id: Number });
const router = useRouter();
const campaign = ref(null), error = ref(""), brief = ref({}), selectedProducts = ref([]);
const FIELDS = [["goal", "מטרת הקמפיין", true], ["audience", "קהל יעד לקמפיין הזה", false], ["tone", "טון לקמפיין הזה", false], ["timeframe", "משך / תזמון", false], ["notes", "הערות נוספות", false]];
const STEP_NAMES = ["", "ניתוח העסק", "פרטי חובה", "קונספטים", "קומפוזיציה", "ביקורת", "אלמנטים", "הרכבה", "טקסט וייצוא"];

const adName = ref(""), adProductId = ref(""), adMode = ref("full"), adStyle = ref("photo");
const INCLUDE_STEPS = [["concepts", "בחירה מתוך 10 קונספטים (אחרת: AI בוחר קונספט אחד לבד)"], ["critique", "שלב ביקורת ושיפור"]];
const adInclude = ref({ concepts: true, critique: true });

async function load() {
  try { campaign.value = await api.get(`/campaigns/${props.id}`); brief.value = { ...campaign.value.brief }; selectedProducts.value = [...campaign.value.productIds]; }
  catch (e) { error.value = e.message; }
}
load();

const docFile = ref(null), docName = ref("");
async function rename(e) {
  const name = e.target.value.trim();
  if (name && name !== campaign.value.name) { try { Object.assign(campaign.value, await api.patch(`/campaigns/${props.id}`, { name })); } catch (e2) { toast(e2.message, "error"); } }
}
async function save() {
  try { Object.assign(campaign.value, await api.patch(`/campaigns/${props.id}`, { brief: brief.value, productIds: selectedProducts.value })); toast("נשמר"); }
  catch (e) { toast(e.message, "error"); }
}
async function upload() {
  if (!docFile.value) return toast("יש לבחור קובץ", "error");
  const fd = new FormData(); fd.append("file", docFile.value); if (docName.value) fd.append("name", docName.value);
  try { await api.post(`/campaigns/${props.id}/documents`, fd); docFile.value = null; docName.value = ""; await load(); }
  catch (e) { toast(e.message, "error"); }
}
async function removeDoc(id) { try { await api.del(`/documents/${id}`); await load(); } catch (e) { toast(e.message, "error"); } }

async function createAd() {
  const flow = { mode: adMode.value, include: adMode.value === "quick" ? adInclude.value : undefined, adStyle: adStyle.value };
  try {
    const p = await api.post(`/campaigns/${props.id}/projects`, { name: adName.value, productId: adProductId.value || undefined, flow });
    router.push(`/p/${p.id}`);
  } catch (e) { toast(e.message, "error"); }
}
const productName = (id) => campaign.value?.products.find((p) => p.id === id)?.name || "";
</script>

<template>
  <p v-if="error" class="panel error-text">{{ error }}</p>
  <section v-else-if="campaign">
    <router-link :to="`/clients/${campaign.clientId}`" class="muted">חזרה ללקוח</router-link>
    <input class="title" :value="campaign.name" @change="rename" aria-label="שם הקמפיין" data-test="campaign-name" />

    <div class="panel">
      <h2>בריף הקמפיין</h2>
      <div class="grid2">
        <label v-for="[k, l, long] in FIELDS" :key="k" class="field"><span>{{ l }}</span>
          <textarea v-if="long" v-model="brief[k]" :data-test="`campaign-brief-${k}`"></textarea>
          <input v-else v-model="brief[k]" :data-test="`campaign-brief-${k}`" />
        </label>
      </div>
      <h3>מוצרים בקמפיין <small class="muted">(אפשר יותר ממוצר אחד)</small></h3>
      <div class="row">
        <label v-for="p in campaign.products" :key="p.id" class="chk">
          <input type="checkbox" :value="p.id" v-model="selectedProducts" :data-test="`campaign-product-${p.id}`" /> {{ p.name }}
        </label>
        <span v-if="!campaign.products.length" class="muted">אין עדיין מוצרים ללקוח הזה.</span>
      </div>
      <button class="primary" @click="save" data-test="save-campaign">שמירה</button>
    </div>

    <div class="panel">
      <h2>מסמכי הקמפיין</h2>
      <ul class="docs">
        <li v-for="d in campaign.documents" :key="d.id"><a :href="`/api/documents/${d.id}/file`" target="_blank" rel="noopener">{{ d.name }}</a>
          <button class="link danger" @click="removeDoc(d.id)">מחיקה</button></li>
      </ul>
      <form class="row" @submit.prevent="upload">
        <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" @change="(e) => (docFile = e.target.files[0])" />
        <input v-model="docName" placeholder="שם (לא חובה)" style="max-width:200px" />
        <button class="primary" data-test="upload-campaign-doc">העלאה</button>
      </form>
    </div>

    <div class="panel">
      <h2>מודעה חדשה</h2>
      <div class="grid2">
        <label class="field"><span>שם המודעה</span><input v-model="adName" data-test="ad-name" /></label>
        <label class="field"><span>מוצר (לא חובה)</span>
          <select v-model="adProductId" data-test="ad-product"><option value="">—</option><option v-for="p in campaign.products" :key="p.id" :value="p.id">{{ p.name }}</option></select>
        </label>
        <label class="field"><span>סוג מודעה</span>
          <select v-model="adStyle" data-test="ad-style">
            <option value="photo">מודעת צילום (סצנה פוטוריאליסטית)</option>
            <option value="graphic">מודעה גרפית (פאנלים וטקסט — מחירון, מודעה טיפוגרפית)</option>
            <option value="hybrid">משולבת (צילום + פאנלים)</option>
          </select>
        </label>
        <label class="field"><span>תהליך</span>
          <select v-model="adMode" data-test="ad-mode"><option value="full">מלא — כל שמונת השלבים</option><option value="quick">מהיר — לבחור אילו שלבים לדלג</option></select>
        </label>
      </div>
      <div v-if="adMode === 'quick'" class="quick">
        <label v-for="[k, l] in INCLUDE_STEPS" :key="k" class="row"><input type="checkbox" v-model="adInclude[k]" :data-test="`include-${k}`" /> {{ l }}</label>
      </div>
      <button class="primary" :disabled="!adName.trim()" @click="createAd" data-test="create-ad">יצירת מודעה</button>
    </div>

    <div class="panel">
      <h2>מודעות בקמפיין</h2>
      <ul v-if="campaign.ads.length" class="ads">
        <li v-for="a in campaign.ads" :key="a.id">
          <router-link :to="`/p/${a.id}`" class="card" :data-test="`ad-${a.id}`">
            <div class="thumb"><img v-if="a.export_asset_id || a.plate_asset_id" :src="assetUrl(a.export_asset_id || a.plate_asset_id)" alt="" loading="lazy" /></div>
            <strong>{{ a.name }}</strong>
            <span class="muted small">שלב {{ a.step }}: {{ STEP_NAMES[a.step] }}{{ a.product_id ? ` · ${productName(a.product_id)}` : "" }}</span>
          </router-link>
        </li>
      </ul>
      <p v-else class="muted">אין עדיין מודעות בקמפיין הזה.</p>
    </div>
  </section>
</template>

<style scoped>
.title { font-family: var(--display); font-size: 1.6rem; background: transparent; border-color: transparent; display: block; margin: 8px 0 16px; }
.docs { list-style: none; padding: 0; margin: 0 0 16px; }
.docs li { padding: 6px 0; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; }
.chk { display: flex; align-items: center; gap: 6px; width: auto; }
.chk input { width: auto; }
.quick { background: #fff; border: 1px solid var(--line); padding: 10px; margin-bottom: 14px; display: flex; flex-direction: column; gap: 6px; }
.quick input { width: auto; }
.ads { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px; }
.card { display: flex; flex-direction: column; gap: 4px; text-decoration: none; color: inherit; background: #fff; padding: 10px; border: 1px solid var(--line); }
.card:hover { border-color: var(--ink); }
.thumb { aspect-ratio: 4 / 5; background: repeating-linear-gradient(45deg, #eceef0 0 10px, #e3e6e9 10px 20px); display: grid; place-items: center; overflow: hidden; }
.thumb img { width: 100%; height: 100%; object-fit: cover; }
.small { font-size: 13px; }
</style>
