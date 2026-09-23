<script setup>
import { inject, ref } from "vue";
import { api } from "../lib/api";

const { project, run, go, busy } = inject("ctx");
const FIELDS = [
  ["centerProduct", "המוצר / השירות שצריך להיות במרכז", true], ["businessName", "שם העסק", true], ["slogan", "סלוגן"],
  ["phone", "טלפון"], ["addressOrSite", "כתובת / אתר"], ["offer", "מבצע / מחיר"], ["extra", "פרטים נוספים שחייבים להופיע"],
];
const m = ref({ businessName: project.value.brief.businessName || "", ...project.value.mandatory });
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
    <div class="grid2">
      <label v-for="[k, l, req] in FIELDS" :key="k" class="field">
        <span>{{ l }} <small v-if="req">(חובה)</small></span>
        <input v-model="m[k]" :required="req" :dir="k === 'phone' || k === 'addressOrSite' ? 'auto' : null" :data-test="`m-${k}`" />
      </label>
    </div>
    <button class="primary" :disabled="!!busy || !m.centerProduct || !m.businessName" @click="next" data-test="save-mandatory">
      {{ project.concepts ? "שמירה והמשך" : "שמירה ויצירת קונספטים" }}</button>
    <p v-if="project.concepts" class="muted" style="margin-top:8px">שינוי כאן לא יוצר קונספטים מחדש. אפשר ליצור אותם מחדש בשלב 3.</p>
  </div>
</template>
