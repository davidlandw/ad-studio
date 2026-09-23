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
const m = ref({ businessName: project.value.brief.businessName || "", ...project.value.mandatory });
const suggestion = ref(null);

async function loadSuggestion() {
  try { suggestion.value = await run("מכין הצעות לפי הניתוח", () => api.post(`/projects/${project.value.id}/suggest-mandatory`)); }
  catch { /* run() already reports the error via toast */ }
}
onMounted(() => { if (project.value.analysis && !m.value.centerProduct && !m.value.slogan) loadSuggestion(); });

function useSuggestion(key) { if (suggestion.value?.[key]) m.value[key] = suggestion.value[key]; }

async function next() {
  await run("שומר", () => api.patch(`/projects/${project.value.id}`, { mandatory: m.value }), "פרטי החובה נשמרו");
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
    <button class="primary" :disabled="!!busy || !m.centerProduct || !m.businessName" @click="next" data-test="save-mandatory">
      {{ project.concepts ? "שמירה והמשך" : "שמירה ויצירת קונספטים" }}</button>
    <p v-if="project.concepts" class="muted" style="margin-top:8px">שינוי כאן לא יוצר קונספטים מחדש. אפשר ליצור אותם מחדש בשלב 3.</p>
  </div>
</template>

<style scoped>
.hint { margin: 4px 0 0; font-size: 14px; color: var(--muted); }
.hint .link { font-size: 14px; padding: 0; margin-inline-start: 4px; }
</style>
