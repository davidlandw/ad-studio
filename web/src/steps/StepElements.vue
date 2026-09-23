<script setup>
import { inject, reactive, computed, watch } from "vue";
import { api, assetUrl } from "../lib/api";
import { toast } from "../lib/store";

const { project, run, go, busy } = inject("ctx");
const KEYS = [["#00FF00", "ירוק"], ["#FF00FF", "מג'נטה"], ["#0000FF", "כחול"]];
const ui = reactive({}); // per element: { sel, feedback, prompt }
const versions = (e) => project.value.assets.filter((a) => a.element_id === e.id);
const state = (e) => ui[e.id] || {};
watch(() => project.value.elements, (els) => {
  for (const e of els) {
    if (!ui[e.id]) ui[e.id] = { sel: e.approved_asset_id || versions(e)[0]?.id || null, feedback: "", prompt: e.prompt, editing: false };
    else if (!ui[e.id].editing) ui[e.id].prompt = e.prompt;
  }
}, { immediate: true, deep: true });
const approved = computed(() => project.value.elements.filter((e) => e.status === "approved").length);

async function generate(e, refine) {
  const s = state(e);
  const body = refine ? { fromAssetId: s.sel, feedback: s.feedback } : { feedback: s.feedback };
  await run(refine ? `מתקן את "${e.name}"` : `יוצר את "${e.name}"`, () => api.post(`/elements/${e.id}/generate`, body));
  s.sel = versions(project.value.elements.find((x) => x.id === e.id))[0]?.id; s.feedback = "";
}
async function upload(e, ev) {
  const f = ev.target.files[0]; if (!f) return;
  const fd = new FormData(); fd.append("file", f);
  await run("מעלה תמונה", () => api.post(`/elements/${e.id}/upload`, fd), "התמונה הועלתה");
  state(e).sel = versions(e)[0]?.id; ev.target.value = "";
}
async function savePrompt(e) {
  await run("שומר", () => api.patch(`/elements/${e.id}`, { prompt: state(e).prompt }), "הפרומפט נשמר");
  state(e).editing = false;
}
const setKey = (e, c) => run("שומר", () => api.patch(`/elements/${e.id}`, { key_color: c }));
const approve = (e) => run("מאשר", () => api.post(`/elements/${e.id}/approve`, { assetId: state(e).sel }), `"${e.name}" אושר`);
const unapprove = (e) => run("", () => api.post(`/elements/${e.id}/unapprove`));

// ---- library ----
const picker = reactive({ el: null, items: [], q: "", scope: "all", loading: false });
async function openPicker(e) {
  picker.el = e; picker.q = "";
  await loadPicker();
}
async function loadPicker() {
  picker.loading = true;
  try {
    picker.items = await api.get(`/library/elements?orgId=${project.value.orgId}&scope=${picker.scope}&kind=${picker.el.kind}&q=${encodeURIComponent(picker.q)}`);
  } catch (err) { toast(err.message, "error"); }
  picker.loading = false;
}
async function useItem(item) {
  const e = picker.el;
  picker.el = null;
  await run(`מוסיף את "${item.name}"`, () => api.post(`/elements/${e.id}/from-library`, { itemId: item.id }), "נוסף כגרסה. אשרו אותו אם הוא מתאים.");
  state(e).sel = versions(e)[0]?.id;
}
const saveToLib = (e) => run("שומר לספרייה", () => api.post(`/elements/${e.id}/save-to-library`, { assetId: state(e).sel }), "הגרסה נשמרה בספריית הארגון");
</script>

<template>
  <div class="panel row" style="justify-content:space-between">
    <div>
      <h2>יצירת אלמנטים</h2>
      <p class="muted" style="margin:0">כל אלמנט נוצר לבד. אובייקטים נוצרים על רקע כרומה בצבע אחיד, כדי שאפשר יהיה לגזור אותם בהרכבה. מאשרים גרסה אחת לכל אלמנט.</p>
    </div>
    <strong data-test="approved-count">{{ approved }} / {{ project.elements.length }} אושרו</strong>
  </div>

  <article v-for="e in project.elements" :key="e.id" class="panel el" :data-test="`element-${e.key}`">
    <header class="row">
      <h3 style="margin:0">{{ e.name }}</h3>
      <span class="muted">{{ e.kind === "background" ? "רקע (פריים מלא)" : "אובייקט" }}</span>
      <span v-if="e.status === 'approved'" class="stamp" style="margin-inline-start:auto">מאושר</span>
    </header>

    <div class="body">
      <div class="preview" :class="{ checker: e.kind === 'object' }">
        <img v-if="state(e).sel" :src="assetUrl(state(e).sel)" :alt="`גרסה של ${e.name}`" />
        <p v-else class="muted">עוד לא נוצרה תמונה</p>
      </div>
      <div class="controls">
        <div v-if="versions(e).length" class="versions" role="listbox" :aria-label="`גרסאות של ${e.name}`">
          <button v-for="(a, i) in versions(e)" :key="a.id" role="option" :aria-selected="state(e).sel === a.id"
            :class="{ sel: state(e).sel === a.id, ok: e.approved_asset_id === a.id }" @click="state(e).sel = a.id" :title="a.feedback || ''">
            <img :src="assetUrl(a.id)" :alt="`גרסה ${versions(e).length - i}`" />
          </button>
        </div>

        <label class="field"><span>פרומפט <button class="link" @click="state(e).editing = !state(e).editing">{{ state(e).editing ? "ביטול" : "עריכה" }}</button></span>
          <textarea v-if="state(e).editing" v-model="state(e).prompt" dir="ltr" rows="4"></textarea>
          <p v-else dir="ltr" class="prompt">{{ e.prompt }}</p>
        </label>
        <button v-if="state(e).editing" @click="savePrompt(e)">שמירת פרומפט</button>

        <div v-if="e.kind === 'object'" class="row keycolor">
          <span>צבע כרומה:</span>
          <label v-for="[c, l] in KEYS" :key="c"><input type="radio" :name="`k${e.id}`" :checked="e.key_color === c" @change="setKey(e, c)" /> <i :style="{ background: c }"></i>{{ l }}</label>
        </div>

        <label class="field"><span>הערה ליצירה <small>(לא חובה, למשל: "יותר מלמעלה", "בלי ידית")</small></span>
          <input v-model="state(e).feedback" :data-test="`feedback-${e.key}`" /></label>
        <div class="row">
          <button class="primary" :disabled="!!busy" @click="generate(e, false)" :data-test="`gen-${e.key}`">{{ versions(e).length ? "גרסה חדשה" : "יצירה" }}</button>
          <button v-if="state(e).sel" class="ghost" :disabled="!!busy || !state(e).feedback" @click="generate(e, true)" title="עורך את הגרסה הנבחרת לפי ההערה">תיקון הגרסה הנבחרת</button>
          <button class="ghost" :disabled="!!busy" @click="openPicker(e)" :data-test="`library-${e.key}`">מהספרייה</button>
          <label class="btn ghost upload">העלאת צילום<input type="file" accept="image/png,image/jpeg,image/webp" @change="upload(e, $event)" class="sr" :data-test="`upload-${e.key}`" /></label>
        </div>
        <div class="row approve">
          <button v-if="state(e).sel && e.approved_asset_id !== state(e).sel" class="approve-btn" :disabled="!!busy" @click="approve(e)" :data-test="`approve-${e.key}`">אישור הגרסה הזו</button>
          <button v-if="e.status === 'approved'" class="link" @click="unapprove(e)">ביטול אישור</button>
          <button v-if="state(e).sel && e.approved_asset_id !== state(e).sel" class="link" @click="saveToLib(e)">שמירת הגרסה לספרייה</button>
        </div>
      </div>
    </div>
  </article>

  <div v-if="picker.el" class="modal" role="dialog" aria-modal="true" :aria-label="`בחירה מהספרייה עבור ${picker.el.name}`" @click.self="picker.el = null" @keydown.esc="picker.el = null">
    <div class="panel sheet">
      <div class="row" style="justify-content:space-between">
        <h2 style="margin:0">מהספרייה: {{ picker.el.kind === "background" ? "רקעים" : "אובייקטים" }}</h2>
        <button class="ghost" @click="picker.el = null">סגירה</button>
      </div>
      <div class="row" style="margin:12px 0">
        <select v-model="picker.scope" @change="loadPicker" style="width:auto"><option value="all">הארגון + ציבוריים</option><option value="org">הארגון</option><option value="public">ציבוריים</option></select>
        <input v-model="picker.q" @input="loadPicker" type="search" placeholder="חיפוש" style="max-width:220px" aria-label="חיפוש בספרייה" />
      </div>
      <p v-if="!picker.loading && !picker.items.length" class="muted">אין פריטים מתאימים בספרייה.</p>
      <ul class="lib">
        <li v-for="it in picker.items" :key="it.id">
          <button class="pick" @click="useItem(it)" :data-test="`pick-${it.id}`">
            <span class="thumb" :class="{ checker: it.kind === 'object' }"><img :src="`/api/library/elements/${it.id}/file`" :alt="it.name" loading="lazy" /></span>
            <span>{{ it.name }}</span>
            <span class="muted tiny">{{ it.own ? it.creatorName : it.orgName }}{{ it.visibility === "public" ? " · ציבורי" : "" }}</span>
          </button>
        </li>
      </ul>
    </div>
  </div>

  <button class="primary" :disabled="approved < project.elements.length" @click="go(7)" data-test="to-compose">
    {{ approved < project.elements.length ? "יש לאשר את כל האלמנטים כדי להרכיב" : "המשך להרכבה" }}</button>
</template>

<style scoped>
.body { display: grid; grid-template-columns: minmax(220px, 340px) 1fr; gap: 20px; margin-top: 12px; }
.preview { background: #fff; border: 1px solid var(--line); display: grid; place-items: center; min-height: 220px; }
.preview img { max-width: 100%; max-height: 420px; display: block; }
.checker { background: repeating-conic-gradient(#e6e8eb 0 25%, #fff 0 50%) 0 0 / 20px 20px; }
.versions { display: flex; gap: 6px; overflow-x: auto; margin-bottom: 12px; }
.versions button { padding: 0; border: 2px solid transparent; background: #fff; }
.versions button.sel { border-color: var(--magenta); }
.versions button.ok { outline: 2px solid var(--ok); outline-offset: 1px; }
.versions img { width: 64px; height: 64px; object-fit: cover; display: block; }
.prompt { font-size: 14px; color: var(--muted); margin: 0; white-space: pre-wrap; }
.keycolor { margin-bottom: 12px; font-size: 15px; }
.keycolor i { display: inline-block; width: 14px; height: 14px; border: 1px solid var(--ink); vertical-align: middle; margin-inline-end: 4px; }
.upload { position: relative; cursor: pointer; }
.approve { margin-top: 12px; }
.approve-btn { background: var(--ok); border-color: var(--ok); }
.modal { position: fixed; inset: 0; background: rgba(35,39,46,.55); display: grid; place-items: center; z-index: 40; padding: 20px; }
.sheet { width: min(900px, 96vw); max-height: 86vh; overflow: auto; margin: 0; }
.lib { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
.pick { display: flex; flex-direction: column; gap: 4px; width: 100%; background: #fff; color: var(--ink); border: 1px solid var(--line); padding: 8px; text-align: right; font-weight: 400; }
.pick:hover { border-color: var(--magenta); }
.pick .thumb { aspect-ratio: 1; display: grid; place-items: center; overflow: hidden; background: #eef0f2; }
.pick img { max-width: 100%; max-height: 100%; }
.tiny { font-size: 13px; }
@media (max-width: 760px) { .body { grid-template-columns: 1fr; } }
</style>
