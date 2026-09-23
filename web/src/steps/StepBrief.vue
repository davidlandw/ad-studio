<script setup>
import { inject, ref } from "vue";
import { api } from "../lib/api";

const { project, run, go, busy } = inject("ctx");
const FIELDS = [
  ["businessName", "שם העסק", false], ["offering", "מה העסק מציע", true], ["audience", "מי קהל היעד", true],
  ["differentiators", "מה מיוחד בעסק", true], ["tone", "מה הפרסומת צריכה לשדר", false, "יוקרה, אמינות, חדשנות, חמימות, מקצועיות..."],
  ["goal", "מטרת הפרסומת", false, "להביא לקוחות, לפרסם מוצר, מבצע, מיתוג..."],
];
const brief = ref({ format: "4:5", ...project.value.brief });
const save = () => run("שומר", () => api.patch(`/projects/${project.value.id}`, { brief: brief.value }), "נשמר");
async function analyze() {
  await run("שומר", () => api.patch(`/projects/${project.value.id}`, { brief: brief.value }));
  await run("מנתח את העסק ואת מטרת הפרסומת", () => api.post(`/projects/${project.value.id}/analyze`));
}
const A = [["summary", "תמצית"], ["positioning", "מיצוב"], ["audience_insight", "תובנת קהל"], ["tone_direction", "כיוון טון"], ["goal_strategy", "אסטרטגיה למטרה"]];
</script>

<template>
  <div class="panel">
    <h2>ספרו על העסק</h2>
    <p class="muted">בשלב הזה לא נוצרת תמונה. קודם מנתחים את העסק ואת מטרת הפרסומת.</p>
    <div class="grid2">
      <label v-for="[k, l, long, hint] in FIELDS" :key="k" class="field">
        <span>{{ l }} <small v-if="hint">{{ hint }}</small></span>
        <textarea v-if="long" v-model="brief[k]" :data-test="`brief-${k}`"></textarea>
        <input v-else v-model="brief[k]" :data-test="`brief-${k}`" />
      </label>
      <label class="field"><span>פורמט המודעה</span>
        <select v-model="brief.format" data-test="brief-format">
          <option value="4:5">4:5 פיד (1080×1350)</option><option value="1:1">1:1 ריבוע (1080×1080)</option>
          <option value="9:16">9:16 סטורי (1080×1920)</option><option value="16:9">16:9 באנר (1920×1080)</option>
        </select>
        <small class="muted">שינוי פורמט אחרי יצירת הרקע ידרוש ליצור אותו מחדש.</small>
      </label>
    </div>
    <div class="row">
      <button class="primary" :disabled="!!busy" @click="analyze" data-test="analyze">{{ project.analysis ? "ניתוח מחדש" : "ניתוח העסק" }}</button>
      <button class="ghost" :disabled="!!busy" @click="save">שמירה בלבד</button>
    </div>
  </div>
  <div v-if="project.analysis" class="panel" data-test="analysis">
    <h2>הניתוח</h2>
    <div v-for="[k, l] in A" :key="k"><h3>{{ l }}</h3><p>{{ project.analysis[k] }}</p></div>
    <div class="grid2">
      <div><h3>סיכונים</h3><ul><li v-for="r in project.analysis.risks" :key="r">{{ r }}</li></ul></div>
      <div><h3>המלצות</h3><ul><li v-for="r in project.analysis.recommendations" :key="r">{{ r }}</li></ul></div>
    </div>
    <button class="primary" @click="go(2)" data-test="next">המשך לפרטי החובה</button>
  </div>
</template>
