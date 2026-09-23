<script setup>
import { inject, ref, computed, onMounted, watch } from "vue";
import { api, assetUrl } from "../lib/api";
import { toast } from "../lib/store";
import { loadImage, renderComposite, canvasToBlob } from "../lib/render";
import Stage from "../components/Stage.vue";

const { project, run, go, busy } = inject("ctx");
const [W, H] = project.value.size;
const canvas = ref(null);
const layers = ref([]);
const selected = ref(null);
const instructions = ref("");
const ready = ref(false);

const plates = computed(() => project.value.assets.filter((a) => a.kind === "plate" || a.kind === "composite"));
const sel = computed(() => layers.value.find((l) => l.id === selected.value));
const boxes = computed(() => layers.value.filter((l) => l.kind !== "background" && l.visible !== false)
  .map((l) => ({ id: l.id, x: l.x, y: l.y, w: l.w, h: l.h, label: l.name, lockAspect: true })));

/** Builds layers from approved elements, keeping saved positions where the element still exists. */
async function init() {
  const saved = Object.fromEntries((project.value.compose?.layers || []).map((l) => [l.elementId, l]));
  const out = [];
  for (const e of project.value.elements) {
    const src = assetUrl(e.approved_asset_id);
    const prev = saved[e.id];
    let l = { id: `e${e.id}`, elementId: e.id, assetId: e.approved_asset_id, src, name: e.name, kind: e.kind, z: e.z,
      keyColor: e.key_color, keyOut: e.kind === "object", tolerance: 90, flip: false, visible: true, x: 0, y: 0, w: W, h: H };
    if (prev) l = { ...l, ...prev, id: l.id, assetId: e.approved_asset_id, src, name: e.name, kind: e.kind, keyColor: e.key_color };
    if (!prev && e.kind === "object") {
      const img = await loadImage(src);
      const box = { x: e.layout.x * W, y: e.layout.y * H, w: e.layout.w * W, h: e.layout.h * H };
      const s = Math.min(box.w / img.naturalWidth, box.h / img.naturalHeight);
      l.w = Math.round(img.naturalWidth * s); l.h = Math.round(img.naturalHeight * s);
      l.x = Math.round(box.x + (box.w - l.w) / 2); l.y = Math.round(box.y + (box.h - l.h) / 2);
    }
    if (e.kind === "background") Object.assign(l, { x: 0, y: 0, w: W, h: H, z: 0 });
    out.push(l);
  }
  layers.value = out.sort((a, b) => a.z - b.z);
  ready.value = true;
}

let renderId = 0;
async function draw() {
  if (!canvas.value || !ready.value) return;
  const id = ++renderId;
  const off = document.createElement("canvas"); off.width = W; off.height = H;
  await renderComposite(off.getContext("2d"), W, H, layers.value);
  if (id !== renderId) return; // a newer render started
  canvas.value.getContext("2d").drawImage(off, 0, 0);
}
watch(layers, draw, { deep: true });
onMounted(async () => { canvas.value.width = W; canvas.value.height = H; await init(); draw(); });

const change = (id, patch) => Object.assign(layers.value.find((l) => l.id === id), patch);
function restack(l, dir) {
  const objs = layers.value.filter((x) => x.kind !== "background").sort((a, b) => a.z - b.z);
  const i = objs.indexOf(l), j = i + dir;
  if (j < 0 || j >= objs.length) return;
  [objs[i].z, objs[j].z] = [objs[j].z, objs[i].z];
  if (objs[i].z === objs[j].z) objs[j].z += dir;
  layers.value = [...layers.value].sort((a, b) => a.z - b.z);
}

const serial = () => layers.value.map(({ src, name, ...rest }) => rest);
const save = (msg = "ההרכבה נשמרה") =>
  run("שומר הרכבה", () => api.put(`/projects/${project.value.id}/compose`, { compose: { ...(project.value.compose || {}), layers: serial() }, step: 7 }), msg);

async function uploadComposite() {
  await draw();
  const fd = new FormData(); fd.append("file", await canvasToBlob(canvas.value), "composite.png");
  return api.post(`/projects/${project.value.id}/composite`, fd);
}
async function fuse() {
  await save("");
  await run("מאחד את האלמנטים לצילום אחד", async () => {
    const comp = await uploadComposite();
    await api.post(`/projects/${project.value.id}/fuse`, { compositeAssetId: comp.id, instructions: instructions.value });
    return api.get(`/projects/${project.value.id}`);
  }, "האיחוד מוכן, בדקו ואשרו");
}
async function useCollage() {
  await save("");
  const comp = await run("שומר את הקולאז'", uploadComposite);
  await choose(comp.id);
}
async function choose(assetId) {
  await run("מאשר בסיס", () => api.post(`/projects/${project.value.id}/plate`, { assetId }), "הבסיס אושר");
  go(8);
}
function chooseChecked(a) {
  if (!a) return toast("בחרו תמונה", "error");
  choose(a);
}
</script>

<template>
  <div class="panel">
    <h2>הרכבה</h2>
    <p class="muted">גררו אובייקטים למקום. הידית בפינה משנה גודל, והחצים במקלדת מזיזים בפיקסל (עם Shift בעשרה). הקולאז' הזה הוא שרטוט המיקום: Gemini יאחד אותו לצילום אחד עם תאורה וצללים משותפים.</p>
    <div class="compose">
      <Stage :W="W" :H="H" :boxes="boxes" :selected="selected" @select="selected = $event" @change="change" @commit="() => {}">
        <canvas ref="canvas" data-test="compose-canvas"></canvas>
      </Stage>
      <div class="side">
        <h3>שכבות</h3>
        <ol class="layers">
          <li v-for="l in [...layers].reverse()" :key="l.id" :class="{ sel: l.id === selected }" @click="selected = l.id">
            <label><input type="checkbox" v-model="l.visible" @click.stop /> {{ l.name }}</label>
            <span v-if="l.kind !== 'background'" class="row tiny">
              <button class="link" @click.stop="restack(l, 1)" aria-label="העלאה שכבה">▲</button>
              <button class="link" @click.stop="restack(l, -1)" aria-label="הורדה שכבה">▼</button>
            </span>
          </li>
        </ol>
        <div v-if="sel && sel.kind === 'object'" class="props">
          <h3>{{ sel.name }}</h3>
          <label class="row"><input type="checkbox" v-model="sel.keyOut" style="width:auto" /> הסרת רקע כרומה</label>
          <label class="field"><span>סף הסרה: {{ sel.tolerance }}</span><input type="range" min="10" max="220" v-model.number="sel.tolerance" /></label>
          <label class="row"><input type="checkbox" v-model="sel.flip" style="width:auto" /> היפוך אופקי</label>
          <p class="muted tiny">{{ Math.round(sel.x) }}, {{ Math.round(sel.y) }} · {{ sel.w }}×{{ sel.h }}</p>
        </div>
        <button class="ghost" :disabled="!!busy" @click="save()" data-test="save-compose">שמירת הרכבה</button>
      </div>
    </div>
  </div>

  <div class="panel">
    <h2>איחוד לצילום אחד</h2>
    <label class="field"><span>הנחיה נוספת לאיחוד <small>(לא חובה)</small></span><input v-model="instructions" placeholder="למשל: צל רך מתחת לכוס, אור חם יותר" /></label>
    <div class="row">
      <button class="primary" :disabled="!!busy" @click="fuse" data-test="fuse">איחוד עם Gemini</button>
      <button class="ghost" :disabled="!!busy" @click="useCollage" data-test="use-collage">שימוש בקולאז' כמו שהוא</button>
    </div>
    <div v-if="plates.length" class="plates">
      <figure v-for="a in plates" :key="a.id" :class="{ chosen: project.plateAssetId === a.id }">
        <img :src="assetUrl(a.id)" :alt="a.kind === 'plate' ? 'תוצאת איחוד' : 'קולאז'" loading="lazy" />
        <figcaption class="row">
          <span class="muted">{{ a.kind === "plate" ? "איחוד" : "קולאז'" }}{{ a.feedback ? `: ${a.feedback}` : "" }}</span>
          <span v-if="project.plateAssetId === a.id" class="stamp">בסיס</span>
          <button v-else class="ghost" :disabled="!!busy" @click="chooseChecked(a.id)" :data-test="`choose-plate-${a.id}`">אישור כבסיס</button>
        </figcaption>
      </figure>
    </div>
  </div>
  <button v-if="project.plateAssetId" class="primary" @click="go(8)" data-test="to-type">המשך לטקסט וייצוא</button>
</template>

<style scoped>
.compose { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 20px; align-items: start; }
.side { background: #fff; border: 1px solid var(--line); padding: 12px; }
.layers { list-style: none; margin: 0 0 12px; padding: 0; }
.layers li { display: flex; justify-content: space-between; align-items: center; padding: 6px; cursor: pointer; border-bottom: 1px solid var(--line); }
.layers li.sel { background: #f9e6f0; }
.layers label { display: flex; gap: 6px; align-items: center; }
.layers input { width: auto; }
.props { margin-bottom: 12px; }
.tiny { font-size: 13px; gap: 4px; }
.plates { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px; margin-top: 16px; }
.plates figure { margin: 0; background: #fff; border: 1px solid var(--line); padding: 8px; }
.plates figure.chosen { border: 2px solid var(--ok); }
.plates img { width: 100%; display: block; margin-bottom: 6px; }
.plates figcaption { justify-content: space-between; font-size: 14px; }
@media (max-width: 900px) { .compose { grid-template-columns: 1fr; } }
</style>
