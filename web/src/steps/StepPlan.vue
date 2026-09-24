<script setup>
import { inject, ref } from "vue";
import { api } from "../lib/api";
import PlanEditor from "./PlanEditor.vue";

const { project, run, go, busy } = inject("ctx");
const plan = ref(JSON.parse(JSON.stringify(project.value.plan)));
if (!plan.value.panels) plan.value.panels = [];
const concept = project.value.concepts?.[project.value.chosenConcept];
const direction = ref("");
const skipCritique = project.value.flow?.include?.critique === false;
const save = () => run("שומר", () => api.put(`/projects/${project.value.id}/plan`, { plan: plan.value }), "התוכנית נשמרה");
async function critique() {
  await run("שומר", () => api.put(`/projects/${project.value.id}/plan`, { plan: plan.value }));
  await run("המבקר בודק את הרעיון", () => api.post(`/projects/${project.value.id}/critique`, { direction: direction.value }));
  go(5);
}
// Quick-create mode without a critique step: lock the plan as-is and jump straight to elements (or export, for a
// graphic ad with no elements).
async function skipToLock() {
  await run("שומר", () => api.put(`/projects/${project.value.id}/plan`, { plan: plan.value }));
  const p = await run("נועל את התוכנית", () => api.post(`/projects/${project.value.id}/lock-plan`, {}));
  go(p.elements.length ? 6 : 8);
}
</script>

<template>
  <div class="panel">
    <h2>קומפוזיציה: {{ concept?.title }}</h2>
    <p class="muted">הסצנה מפורקת לאלמנטים ולפאנלים גרפיים. כל אלמנט ייווצר ויאושר בנפרד, ורק בסוף הם יחוברו. אפשר לערוך הכול לפני הביקורת.</p>
    <PlanEditor :plan="plan" />
    <label v-if="!skipCritique" class="field"><span>כיוון נוסף לביקורת <small>(לא חובה)</small></span>
      <input v-model="direction" data-test="direction-plan-critique" /></label>
    <div class="row">
      <button v-if="!skipCritique" class="primary" :disabled="!!busy" @click="critique" data-test="run-critique">שמירה ושליחה לביקורת</button>
      <button v-else class="primary" :disabled="!!busy" @click="skipToLock" data-test="skip-critique">שמירה והמשך (מצב מהיר — בלי ביקורת)</button>
      <button class="ghost" :disabled="!!busy" @click="save">שמירה בלבד</button>
    </div>
  </div>
</template>
