<script setup>
import { ref, computed, provide, watch, defineAsyncComponent } from "vue";
import { api } from "../lib/api";
import { toast } from "../lib/store";

const props = defineProps({ id: Number });
const project = ref(null), busy = ref(""), step = ref(1), error = ref("");

const STEPS = [
  { n: 1, title: "העסק וניתוח", c: defineAsyncComponent(() => import("../steps/StepBrief.vue")) },
  { n: 2, title: "פרטי חובה", c: defineAsyncComponent(() => import("../steps/StepMandatory.vue")) },
  { n: 3, title: "עשרה קונספטים", c: defineAsyncComponent(() => import("../steps/StepConcepts.vue")) },
  { n: 4, title: "קומפוזיציה", c: defineAsyncComponent(() => import("../steps/StepPlan.vue")) },
  { n: 5, title: "ביקורת ושיפור", c: defineAsyncComponent(() => import("../steps/StepCritique.vue")) },
  { n: 6, title: "יצירת אלמנטים", c: defineAsyncComponent(() => import("../steps/StepElements.vue")) },
  { n: 7, title: "הרכבה ואיחוד", c: defineAsyncComponent(() => import("../steps/StepCompose.vue")) },
  { n: 8, title: "טקסט וייצוא", c: defineAsyncComponent(() => import("../steps/StepType.vue")) },
];

// A step opens only when everything it depends on exists.
// A "graphic" ad (typographic — panels + text, no photographed elements) can legitimately lock a plan with zero
// elements: p.step >= 6 (set by lock-plan) is what tells us the plan was actually locked, not p.elements.length.
const reachable = computed(() => {
  const p = project.value; if (!p) return 1;
  const m = p.mandatory || {};
  if (!p.analysis) return 1;
  if (!(m.centerProduct && m.businessName)) return 2;
  if (!p.plan) return 3;
  if (p.step < 6) return 5;
  if (p.elements.length && !p.elements.every((e) => e.status === "approved")) return 6;
  if (p.elements.length && !p.plateAssetId) return 7;
  return 8;
});

async function load() {
  try {
    project.value = await api.get(`/projects/${props.id}`);
    step.value = Math.min(project.value.step, reachable.value);
  } catch (e) { error.value = e.message; }
}
watch(() => props.id, load, { immediate: true });

/** Runs an API call with a busy label, stores the returned project, reports errors in Hebrew. */
async function run(label, fn, okMsg) {
  busy.value = label;
  try {
    const out = await fn();
    if (out && out.id === props.id && out.elements) project.value = out;
    if (okMsg) toast(okMsg);
    return out;
  } catch (e) { toast(e.message, "error"); throw e; } finally { busy.value = ""; }
}
function go(n) {
  if (n > reachable.value) return;
  step.value = n;
  if (n > project.value.step) api.patch(`/projects/${props.id}`, { step: n }).then((p) => (project.value = p)).catch(() => {});
  window.scrollTo({ top: 0 });
}
provide("ctx", { project, busy, run, go, reload: load });

async function rename(e) {
  const name = e.target.value.trim();
  if (name && name !== project.value.name) await run("", () => api.patch(`/projects/${props.id}`, { name }), "השם נשמר");
}

const DIRECTION_LABELS = { analyze: "ניתוח העסק", suggestMandatory: "הצעות לפרטי חובה", concepts: "קונספטים", plan: "קומפוזיציה", critique: "ביקורת" };
const contextOpen = ref(false);
</script>

<template>
  <p v-if="error" class="panel error-text">{{ error }} <router-link to="/">חזרה לרשימה</router-link></p>
  <div v-else-if="project" class="layout">
    <aside>
      <nav v-if="project.hierarchy.client" class="crumbs muted small" aria-label="היררכיה">
        <router-link :to="`/clients/${project.clientId}`">{{ project.hierarchy.client }}</router-link>
        <template v-if="project.hierarchy.campaign"> › <router-link :to="`/campaigns/${project.campaignId}`">{{ project.hierarchy.campaign }}</router-link></template>
        <template v-if="project.hierarchy.product"> › {{ project.hierarchy.product }}</template>
      </nav>
      <input class="title" :value="project.name" @change="rename" aria-label="שם המודעה" />
      <ol class="steps">
        <li v-for="s in STEPS" :key="s.n" :class="{ on: s.n === step, done: s.n < reachable, locked: s.n > reachable }">
          <button class="link" :disabled="s.n > reachable" @click="go(s.n)" :data-test="`step-${s.n}`">
            <span class="num">{{ s.n }}</span>{{ s.title }}</button>
        </li>
      </ol>
      <p class="muted small">{{ project.aspect }} · {{ project.size[0] }}×{{ project.size[1] }} · {{ project.adStyle === "graphic" ? "מודעה גרפית" : project.adStyle === "hybrid" ? "מודעה משולבת" : "מודעת צילום" }}</p>

      <button type="button" class="link" @click="contextOpen = !contextOpen" data-test="toggle-context">{{ contextOpen ? "סגירת" : "מה ה-AI יודע" }}</button>
      <div v-if="contextOpen" class="context panel" data-test="ai-context">
        <p v-if="project.hierarchy.client"><strong>לקוח:</strong> {{ project.hierarchy.client }}</p>
        <p v-if="project.hierarchy.campaign"><strong>קמפיין:</strong> {{ project.hierarchy.campaign }}</p>
        <p v-if="project.hierarchy.product"><strong>מוצר:</strong> {{ project.hierarchy.product }}</p>
        <template v-if="Object.keys(project.directions).length">
          <p class="muted small" style="margin-top:8px">כיווני התערבות שנשמרו לאורך הדרך:</p>
          <ul class="dirs">
            <li v-for="(txt, key) in project.directions" :key="key"><strong>{{ DIRECTION_LABELS[key] || key }}:</strong> {{ txt }}</li>
          </ul>
        </template>
        <p v-else class="muted small">עוד לא נכתב כיוון חופשי בשום שלב.</p>
      </div>
    </aside>
    <section class="work">
      <div v-if="busy" class="busy" role="status" data-test="busy">{{ busy }}</div>
      <component :is="STEPS[step - 1].c" :key="step" />
    </section>
  </div>
</template>

<style scoped>
.layout { display: grid; grid-template-columns: 230px 1fr; gap: 24px; align-items: start; }
aside { position: sticky; top: 16px; }
.title { font-family: var(--display); font-size: 1.25rem; background: transparent; border-color: transparent; padding: 4px 6px; margin-bottom: 12px; }
.title:hover, .title:focus { border-color: var(--line); background: #fff; }
.steps { list-style: none; padding: 0; margin: 0; border-inline-start: 2px solid var(--line); }
.steps li { margin: 0; }
.steps button { display: flex; gap: 10px; align-items: center; width: 100%; padding: 8px 12px; color: var(--ink); font-weight: 400; text-align: right; }
.steps .num { width: 26px; height: 26px; border: 1px solid var(--ink); border-radius: 50%; display: grid; place-items: center; font-size: 14px; flex: none; }
.steps .done .num { background: var(--ink); color: #fff; }
.steps .on { border-inline-start: 4px solid var(--magenta); margin-inline-start: -3px; }
.steps .on button { font-weight: 700; }
.steps .locked button { color: var(--muted); }
.small { font-size: 14px; margin-top: 12px; }
.crumbs { margin-bottom: 4px; display: block; }
.crumbs a { color: inherit; }
.context { margin-top: 10px; padding: 10px; font-size: 14px; }
.context p { margin: 0 0 4px; }
.dirs { margin: 4px 0 0; padding-inline-start: 18px; }
.dirs li { margin-bottom: 4px; }
.busy { position: sticky; top: 0; z-index: 10; background: var(--ink); color: #fff; padding: 8px 14px; margin-bottom: 12px; }
.busy::after { content: ""; display: inline-block; width: 1.2em; animation: dots 1.2s steps(4) infinite; overflow: hidden; vertical-align: bottom; }
@keyframes dots { from { width: 0; } to { width: 1.2em; } }
.busy::after { content: "..."; }
@media (max-width: 860px) { .layout { grid-template-columns: 1fr; } aside { position: static; } }
</style>
