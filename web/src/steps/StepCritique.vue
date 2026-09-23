<script setup>
import { inject } from "vue";
import { api } from "../lib/api";
import PlanEditor from "./PlanEditor.vue";

const { project, run, go, busy } = inject("ctx");
const CHECKS = [["generic_risk", "סיכון לגנרי או \"AI\""], ["message_clarity", "בהירות המסר"], ["product_centered", "המוצר במרכז?"], ["clutter", "עומס"], ["eye_flow", "משיכת העין"]];
const again = () => run("המבקר בודק שוב", () => api.post(`/projects/${project.value.id}/critique`));
async function lock(useRevised) {
  if (project.value.elements.some((e) => e.status !== "pending") &&
      !confirm("אלמנטים שהפרומפט שלהם השתנה יאבדו את האישור. להמשיך?")) return;
  await run("נועל את התוכנית ויוצר רשימת אלמנטים", () => api.post(`/projects/${project.value.id}/lock-plan`, { useRevised }));
  go(6);
}
</script>

<template>
  <div class="panel">
    <div class="row" style="justify-content:space-between">
      <h2>ביקורת המשרד</h2>
      <button class="ghost" :disabled="!!busy" @click="again">{{ project.critique ? "ביקורת נוספת" : "הרצת ביקורת" }}</button>
    </div>
    <template v-if="project.critique">
      <dl class="checks"><template v-for="[k, l] in CHECKS" :key="k"><dt>{{ l }}</dt><dd>{{ project.critique.checks[k] }}</dd></template></dl>
      <div class="grid2">
        <div><h3>מה לא מספיק טוב</h3><ul><li v-for="x in project.critique.issues" :key="x">{{ x }}</li></ul></div>
        <div><h3>שיפורים קונקרטיים</h3><ul data-test="improvements"><li v-for="x in project.critique.improvements" :key="x">{{ x }}</li></ul></div>
      </div>
    </template>
  </div>
  <div v-if="project.critique" class="panel">
    <h2>התוכנית המשופרת</h2>
    <PlanEditor :plan="project.critique.revised_plan" readonly />
    <div class="row">
      <button class="primary" :disabled="!!busy" @click="lock(true)" data-test="accept-revised">אימוץ התוכנית המשופרת</button>
      <button class="ghost" :disabled="!!busy" @click="lock(false)" data-test="keep-original">המשך עם התוכנית המקורית</button>
    </div>
  </div>
</template>

<style scoped>
.checks { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; }
dt { font-weight: 700; } dd { margin: 0; }
</style>
