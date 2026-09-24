<script setup>
import { inject, ref, computed, onMounted, watch } from "vue";
import { api, assetUrl } from "../lib/api";
import { toast } from "../lib/store";
import { renderAd, textBlockHeight, canvasToBlob, ensureFonts } from "../lib/render";
import { BUILTIN_FONTS, listFonts, registerAll } from "../lib/fonts";
import Stage from "../components/Stage.vue";

const { project, run, busy } = inject("ctx");
const [W, H] = project.value.size;
const canvas = ref(null);
const texts = ref([]);
const logo = ref(null);
const fonts = ref([]);
const selected = ref(null);
const ROLE = { slogan: "סלוגן", businessName: "שם העסק", offer: "מבצע / מחיר", extra: "פרטים נוספים", phone: "טלפון", addressOrSite: "כתובת / אתר",
  headline: "כותרת", subheadline: "כותרת משנה", bullet: "בולט", price: "מחיר", contact: "יצירת קשר", disclaimer: "הערה" };
const roleLabel = (t) => ROLE[t.role] || t.role;

const measure = document.createElement("canvas").getContext("2d");
const boxes = computed(() => {
  const b = texts.value.filter((t) => !t.hidden).map((t) => ({ id: t.id, x: t.x, y: t.y, w: t.w, h: Math.max(t.size, textBlockHeight(measure, t)), label: ROLE[t.role] || t.role }));
  if (logo.value && !logo.value.hidden) b.push({ id: "logo", ...pickBox(logo.value), label: "לוגו", lockAspect: true });
  return b;
});
const pickBox = (o) => ({ x: o.x, y: o.y, w: o.w, h: o.h });
const sel = computed(() => (selected.value === "logo" ? null : texts.value.find((t) => t.id === selected.value)));
const fontOptions = computed(() => [
  ...fonts.value.map((f) => ({ id: f.id, label: `${f.family} · ${f.weight}${f.own ? "" : ` (${f.orgName})`}`, weight: f.weight })),
  ...BUILTIN_FONTS,
]);

async function syncTextsFromMandatory(keepStyle) {
  const fresh = await api.get(`/projects/${project.value.id}/text-layers`);
  const old = Object.fromEntries(texts.value.map((t) => [t.role, t]));
  texts.value = fresh.map((t) => (keepStyle && old[t.role] ? { ...old[t.role], text: t.text } : t));
}

onMounted(async () => {
  canvas.value.width = W; canvas.value.height = H;
  fonts.value = await listFonts(project.value.orgId).catch(() => []);
  await registerAll(fonts.value);
  const c = project.value.compose || {};
  if (c.texts?.length) { texts.value = c.texts; await syncTextsFromMandatory(true); } else await syncTextsFromMandatory(false);
  logo.value = c.logo || null;
  draw();
});

let renderId = 0;
async function draw() {
  if (!canvas.value) return;
  const id = ++renderId;
  const off = document.createElement("canvas"); off.width = W; off.height = H;
  await renderAd(off.getContext("2d"), W, H, {
    plateSrc: assetUrl(project.value.plateAssetId), panels: project.value.plan?.panels || [], texts: texts.value,
    logo: logo.value ? { ...logo.value, src: assetUrl(logo.value.assetId) } : null,
  });
  if (id !== renderId) return;
  canvas.value.getContext("2d").drawImage(off, 0, 0);
}
watch([texts, logo], draw, { deep: true });

function change(id, patch) {
  if (id === "logo") return Object.assign(logo.value, patch);
  const t = texts.value.find((x) => x.id === id);
  const { h, ...rest } = patch; // text height follows the content
  Object.assign(t, rest);
}
function onFontChange(t) {
  const f = fonts.value.find((x) => x.id === t.fontId);
  if (f) t.weight = f.weight;
  ensureFonts([t]).then(draw);
}

async function uploadLogo(ev) {
  const f = ev.target.files[0]; if (!f) return;
  const fd = new FormData(); fd.append("file", f);
  const a = await run("מעלה לוגו", () => api.post(`/projects/${project.value.id}/logo`, fd), "הלוגו הועלה");
  const lb = project.value.plan?.logo || { x: 0.4, y: 0.9, w: 0.2, h: 0.07 };
  logo.value = { assetId: a.id, x: Math.round(lb.x * W), y: Math.round(lb.y * H), w: Math.round(lb.w * W), h: Math.round(lb.h * H), hidden: false };
  ev.target.value = "";
}

const save = (msg = "העיצוב נשמר") =>
  run("שומר", () => api.put(`/projects/${project.value.id}/compose`, { compose: { ...(project.value.compose || {}), texts: texts.value, logo: logo.value }, step: 8 }), msg);

async function exportPng() {
  await save("");
  await draw();
  const blob = await canvasToBlob(canvas.value);
  const fd = new FormData(); fd.append("file", blob, "ad.png");
  await run("מייצא", () => api.post(`/projects/${project.value.id}/export`, fd));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${project.value.name.replace(/[\\/:*?"<>|]/g, "_")}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast("המודעה יוצאה ונשמרה בפרויקט");
}
</script>

<template>
  <div class="panel">
    <h2>טקסט, לוגו וייצוא</h2>
    <p class="muted">הטקסטים מגיעים משדות החובה בדיוק כפי שנכתבו. לשינוי נוסח חוזרים לשלב 2 ולוחצים "רענון טקסטים".</p>
    <div class="type">
      <Stage :W="W" :H="H" :boxes="boxes" :selected="selected" @select="selected = $event" @change="change" @commit="() => {}">
        <canvas ref="canvas" data-test="type-canvas"></canvas>
      </Stage>
      <div class="side">
        <ul class="texts">
          <li v-for="t in texts" :key="t.id" :class="{ sel: t.id === selected }" @click="selected = t.id">
            <label><input type="checkbox" :checked="!t.hidden" @change="t.hidden = !$event.target.checked" @click.stop /> {{ roleLabel(t) }}</label>
            <span class="muted clip">{{ t.text }}</span>
          </li>
        </ul>
        <button class="link" @click="syncTextsFromMandatory(true)">רענון טקסטים משדות החובה</button>

        <div v-if="sel" class="props" data-test="text-props">
          <h3>{{ roleLabel(sel) }}</h3>
          <label class="field"><span>פונט</span>
            <select v-model="sel.fontId" @change="onFontChange(sel)" data-test="font-select">
              <option :value="null">ברירת מחדל</option>
              <option v-for="f in fontOptions" :key="f.id" :value="f.id">{{ f.label }}</option>
            </select></label>
          <div class="grid-mini">
            <label class="field"><span>גודל</span><input type="number" min="8" max="400" v-model.number="sel.size" /></label>
            <label class="field"><span>משקל</span>
              <select v-model.number="sel.weight"><option v-for="w in [300,400,500,600,700,800,900]" :key="w" :value="w">{{ w }}</option></select></label>
            <label class="field"><span>צבע</span><input type="color" v-model="sel.color" /></label>
            <label class="field"><span>יישור</span>
              <select v-model="sel.align"><option value="right">ימין</option><option value="center">מרכז</option><option value="left">שמאל</option></select></label>
            <label class="field"><span>ריווח שורות</span><input type="number" min="0.8" max="2.5" step="0.05" :value="sel.lineHeight || 1.15" @input="sel.lineHeight = +$event.target.value" /></label>
          </div>
          <label class="row"><input type="checkbox" v-model="sel.shadow" style="width:auto" /> צל עדין לקריאוּת</label>
        </div>

        <h3 style="margin-top:14px">לוגו</h3>
        <label class="btn ghost upload">{{ logo ? "החלפת לוגו" : "העלאת לוגו" }}<input type="file" accept="image/png,image/webp,image/jpeg" class="sr" @change="uploadLogo" data-test="logo-file" /></label>
        <label v-if="logo" class="row" style="margin-top:8px"><input type="checkbox" :checked="!logo.hidden" @change="logo.hidden = !$event.target.checked" style="width:auto" /> הצגת לוגו</label>
        <p class="muted tiny">עדיף PNG עם רקע שקוף, בדיוק כפי שהמותג מספק אותו.</p>

        <div class="row" style="margin-top:14px">
          <button class="ghost" :disabled="!!busy" @click="save()">שמירה</button>
          <button class="primary" :disabled="!!busy" @click="exportPng" data-test="export">ייצוא PNG</button>
        </div>
        <p class="muted tiny">{{ W }}×{{ H }} פיקסלים</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.type { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 20px; align-items: start; }
.side { background: #fff; border: 1px solid var(--line); padding: 12px; }
.texts { list-style: none; margin: 0 0 8px; padding: 0; }
.texts li { padding: 6px; border-bottom: 1px solid var(--line); cursor: pointer; display: flex; flex-direction: column; }
.texts li.sel { background: #f9e6f0; }
.texts label { display: flex; gap: 6px; align-items: center; font-weight: 600; }
.texts input { width: auto; }
.clip { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.props { margin-top: 12px; }
.grid-mini { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10px; }
.grid-mini .field { margin-bottom: 8px; }
input[type="color"] { height: 38px; padding: 2px; }
.upload { position: relative; cursor: pointer; }
.tiny { font-size: 13px; }
@media (max-width: 900px) { .type { grid-template-columns: 1fr; } }
</style>
