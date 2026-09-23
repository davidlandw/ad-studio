<script setup>
import { inject, ref } from "vue";
import { api } from "../lib/api";
import PlanEditor from "./PlanEditor.vue";

const { project, run, go, busy } = inject("ctx");
const plan = ref(JSON.parse(JSON.stringify(project.value.plan)));
const concept = project.value.concepts?.[project.value.chosenConcept];
const save = () => run("שומר", () => api.put(`/projects/${project.value.id}/plan`, { plan: plan.value }), "התוכנית נשמרה");
async function critique() {
  await run("שומר", () => api.put(`/projects/${project.value.id}/plan`, { plan: plan.value }));
  await run("המבקר בודק את הרעיון", () => api.post(`/projects/${project.value.id}/critique`));
  go(5);
}
</script>

<template>
  <div class="panel">
    <h2>קומפוזיציה: {{ concept?.title }}</h2>
    <p class="muted">הסצנה מפורקת לאלמנטים. כל אלמנט ייווצר ויאושר בנפרד, ורק בסוף הם יחוברו. אפשר לערוך הכול לפני הביקורת.</p>
    <PlanEditor :plan="plan" />
    <div class="row">
      <button class="primary" :disabled="!!busy" @click="critique" data-test="run-critique">שמירה ושליחה לביקורת</button>
      <button class="ghost" :disabled="!!busy" @click="save">שמירה בלבד</button>
    </div>
  </div>
</template>
