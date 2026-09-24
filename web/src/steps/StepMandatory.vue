<script setup>
import { inject, ref, onMounted } from "vue";
import { api } from "../lib/api";

const { project, run, go, busy } = inject("ctx");
const FIELDS = [
  ["centerProduct", "המוצר / השירות שצריך להיות במרכז", true],
  ["businessName", "שם העסק", true],
  ["slogan", "סלוגן", false, "לדוגמה: הקפה שמעיר אותך באמת"],
  ["phone", "טלפון", false, "לדוגמה: 050-1234567"],
  ["addressOrSite", "כתובת / אתר", false, "לדוגמה: רחוב הרצל 1, תל אביב, או www.example.com"],
  ["offer", "מבצע / מחיר", false, "לדוגמה: 20% הנחה עד סוף החודש (השאירו ריק אם אין מבצע)"],
  ["extra", "פרטים נוספים שחייבים להופיע", false, "לדוגמה: משלוח חינם, אחריות שנתיים"],
];
const LINE_ROLES = [["headline", "כותרת"], ["subheadline", "כותרת משנה"], ["bullet", "בולט (✓)"], ["price", "שורת מחיר"], ["contact", "יצירת קשר"], ["disclaimer", "הערת קטנה"]];
const m = ref({ businessName: project.value.brief.businessName || "", ...project.value.mandatory, lines: [...(project.value.mandatory.lines || [])] });
const suggestion = ref(null);
const suggestDirection = ref("");
const skipConcepts = project.value.flow?.include?.concepts === false;

async function loadSuggestion() {
  try { suggestion.value = await run("מכין הצעות לפי הניתוח", () => api.post(`/projects/${project.value.id}/suggest-mandatory`, { direction: suggestDirection.value })); suggestDirection.value = ""; }
  catch { /* run() already reports the error via toast */ }
}
onMounted(() => { if (project.value.analysis && !m.value.centerProduct && !m.value.slogan) loadSuggestion(); });

function useSuggestion(key) { if (suggestion.value?.[key]) m.value[key] = suggestion.value[key]; }
function addLine() { m.value.lines.push({ text: "", role: "bullet" }); }
function removeLine(i) { m.value.lines.splice(i, 1); }

async function next() {
  await run("שומר", () => api.patch(`/projects/${project.value.id}`, { mandatory: m.value }), "פרטי החובה נשמרו");
  if (skipConcepts) {
    if (!project.value.plan) {
      await run("מפתח קונספט", () => api.post(`/projects/${project.value.id}/concepts`));
      await run("בונה קומפוזיציה", () => api.post(`/projects/${project.value.id}/choose`, { index: 0 }));
    }
    go(4);
    return;
  }
  if (!project.value.concepts) await run("מפתח עשרה קונספטים", () => api.post(`/projects/${project.value.id}/concepts`));
  go(3);
}
</script>

<template>
  <div class="panel">
    <h2>מה חייב להופיע במודעה</h2>
    <p>כל מה שכתוב כאן יופיע במודעה <strong>בדיוק כפי שנכתב</strong>. המערכת לא משנה, לא משלימה ולא ממציאה טקסטים, טלפונים או מחירים. שדה ריק לא יופיע.</p>
    <p v-if="project.analysis" class="muted">
      ל-"המוצר שבמרכז" ול"סלוגן" יש למטה הצעה שנבנתה מהניתוח מהשלב הקודם — אפשר להשתמש בה, לערוך אותה, או להתעלם ולכתוב לבד.
      <button type="button" class="link" :disabled="!!busy" @click="loadSuggestion" data-test="refresh-suggestions">הצעות חדשות</button>
    </p>
    <label v-if="project.analysis" class="field"><span>כיוון להצעות <small>(לא חובה)</small></span><input v-model="suggestDirection" data-test="direction-suggest" /></label>
    <div class="grid2">
      <label v-for="[k, l, req, ph] in FIELDS" :key="k" class="field">
        <span>{{ l }} <small v-if="req">(חובה)</small></span>
        <input v-model="m[k]" :required="req" :placeholder="ph" :dir="k === 'phone' || k === 'addressOrSite' ? 'auto' : null" :data-test="`m-${k}`" />
        <p v-if="suggestion?.[k]" class="hint" :data-test="`suggestion-${k}`">
          הצעה: {{ suggestion[k] }}
          <button type="button" class="link" @click="useSuggestion(k)" :data-test="`use-suggestion-${k}`">השתמשו בהצעה</button>
        </p>
      </label>
    </div>

    <h3>שורות טקסט נוספות <small class="muted">(מחירון, רשימת בולטים, כל מה שיש הרבה ממנו — כל שורה תופיע בדיוק כפי שנכתבה)</small></h3>
    <ul class="lines">
      <li v-for="(ln, i) in m.lines" :key="i" class="row">
        <select v-model="ln.role" :aria-label="`תפקיד שורה ${i + 1}`">
          <option v-for="[v, l] in LINE_ROLES" :key="v" :value="v">{{ l }}</option>
        </select>
        <input v-model="ln.text" :placeholder="'טקסט השורה'" :data-test="`line-text-${i}`" />
        <button type="button" class="link danger" @click="removeLine(i)" :aria-label="`מחיקת שורה ${i + 1}`" :data-test="`line-remove-${i}`">הסרה</button>
      </li>
    </ul>
    <button type="button" class="ghost" @click="addLine" data-test="add-line">הוספת שורה</button>

    <div class="row" style="margin-top:16px">
      <button class="primary" :disabled="!!busy || !m.centerProduct || !m.businessName" @click="next" data-test="save-mandatory">
        {{ skipConcepts ? "שמירה והמשך (מצב מהיר)" : (project.concepts ? "שמירה והמשך" : "שמירה ויצירת קונספטים") }}</button>
    </div>
    <p v-if="project.concepts && !skipConcepts" class="muted" style="margin-top:8px">שינוי כאן לא יוצר קונספטים מחדש. אפשר ליצור אותם מחדש בשלב 3.</p>
  </div>
</template>

<style scoped>
.hint { margin: 4px 0 0; font-size: 14px; color: var(--muted); }
.hint .link { font-size: 14px; padding: 0; margin-inline-start: 4px; }
.lines { list-style: none; padding: 0; margin: 8px 0; display: flex; flex-direction: column; gap: 8px; }
.lines li { align-items: center; }
.lines select { width: 160px; flex: none; }
.lines input { flex: 1; }
.danger { color: var(--danger); }
</style>
