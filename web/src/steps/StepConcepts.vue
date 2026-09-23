<script setup>
import { inject } from "vue";
import { api } from "../lib/api";

const { project, run, go, busy } = inject("ctx");
const gen = () => run("מפתח עשרה קונספטים", () => api.post(`/projects/${project.value.id}/concepts`));
async function choose(i) {
  if (project.value.plan && !confirm("בחירה מחדש תבנה קומפוזיציה חדשה ותחליף את התוכנית הקיימת. להמשיך?")) return;
  await run("בונה קומפוזיציה מפורטת לקונספט", () => api.post(`/projects/${project.value.id}/choose`, { index: i }));
  go(4);
}
const ROWS = [["what_we_see", "מה רואים"], ["idea", "הרעיון"], ["message", "המסר"], ["stopping_power", "למה עוצרים"]];
</script>

<template>
  <div class="panel row" style="justify-content:space-between">
    <div><h2>עשרה קונספטים</h2><p class="muted" style="margin:0">לא תמונה יפה של המוצר, אלא רעיון. בחרו אחד כדי לפתח אותו.</p></div>
    <button :class="project.concepts ? 'ghost' : 'primary'" :disabled="!!busy" @click="gen" data-test="gen-concepts">{{ project.concepts ? "קונספטים חדשים" : "יצירת קונספטים" }}</button>
  </div>
  <ol v-if="project.concepts" class="concepts">
    <li v-for="(c, i) in project.concepts" :key="i" :class="{ chosen: project.chosenConcept === i }" :data-test="`concept-${i}`">
      <h3>{{ i + 1 }}. {{ c.title }}</h3>
      <dl><template v-for="[k, l] in ROWS" :key="k"><dt>{{ l }}</dt><dd>{{ c[k] }}</dd></template></dl>
      <span v-if="project.chosenConcept === i" class="stamp">נבחר</span>
      <button v-else class="ghost" :disabled="!!busy" @click="choose(i)" :data-test="`choose-${i}`">פיתוח הרעיון הזה</button>
    </li>
  </ol>
  <button v-if="project.plan" class="primary" @click="go(4)">המשך לקומפוזיציה</button>
</template>

<style scoped>
.concepts { list-style: none; padding: 0; margin: 0 0 20px; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
.concepts li { background: #fff; border: 1px solid var(--line); padding: 16px; display: flex; flex-direction: column; }
.concepts li.chosen { border: 2px solid var(--ok); }
dl { margin: 0 0 12px; flex: 1; } dt { font-weight: 700; font-size: 14px; color: var(--muted); } dd { margin: 0 0 8px; }
li button, li .stamp { align-self: flex-start; }
</style>
