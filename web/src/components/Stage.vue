<script setup>
// Scaled stage: the parent's full-resolution canvas goes in the slot; draggable boxes are overlaid in ad coordinates.
import { ref, computed, onMounted, onBeforeUnmount } from "vue";

const props = defineProps({ W: Number, H: Number, boxes: Array, selected: [String, Number], maxH: { type: Number, default: 640 } });
const emit = defineEmits(["select", "change", "commit"]);
const wrap = ref(null), avail = ref(600);
let ro;
// Observe the container around the proof frame (not the frame itself, which sizes to the stage).
onMounted(() => {
  const host = wrap.value.parentElement.parentElement;
  ro = new ResizeObserver(([e]) => (avail.value = Math.max(200, e.contentRect.width - 36)));
  ro.observe(host);
});
onBeforeUnmount(() => ro?.disconnect());

const scale = computed(() => Math.min(avail.value / props.W, props.maxH / props.H, 1));
const px = (v) => `${v * scale.value}px`;

let drag = null;
function down(ev, b, mode) {
  ev.preventDefault(); ev.stopPropagation();
  emit("select", b.id);
  drag = { id: b.id, mode, sx: ev.clientX, sy: ev.clientY, start: { x: b.x, y: b.y, w: b.w, h: b.h }, lock: b.lockAspect };
  window.addEventListener("pointermove", move); window.addEventListener("pointerup", up, { once: true });
}
function move(ev) {
  if (!drag) return;
  const dx = (ev.clientX - drag.sx) / scale.value, dy = (ev.clientY - drag.sy) / scale.value, s = drag.start;
  if (drag.mode === "move") emit("change", drag.id, { x: Math.round(s.x + dx), y: Math.round(s.y + dy) });
  else {
    // handle sits on the bottom-left corner: dragging left grows width, anchored at the right edge
    const w = Math.max(20, Math.round(s.w - dx));
    const h = drag.lock ? Math.round((w * s.h) / s.w) : Math.max(20, Math.round(s.h + dy));
    emit("change", drag.id, { x: s.x + s.w - w, w, h });
  }
}
function up() { window.removeEventListener("pointermove", move); if (drag) emit("commit", drag.id); drag = null; }
function key(ev, b) {
  const step = ev.shiftKey ? 10 : 1;
  const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
  if (!d) return;
  ev.preventDefault();
  emit("change", b.id, { x: b.x + d[0], y: b.y + d[1] }); emit("commit", b.id);
}
</script>

<template>
  <div class="proof stage-proof"><span class="cm"></span>
    <div ref="wrap" class="stage" :style="{ width: px(W), height: px(H) }" @pointerdown="emit('select', null)">
      <slot />
      <div v-for="b in boxes" :key="b.id" class="box" :class="{ sel: b.id === selected }" tabindex="0" :aria-label="b.label"
        :style="{ left: px(b.x), top: px(b.y), width: px(b.w), height: px(b.h) }" :data-test="`box-${b.id}`"
        @pointerdown="down($event, b, 'move')" @keydown="key($event, b)" @focus="emit('select', b.id)">
        <span class="label">{{ b.label }}</span>
        <span v-if="b.resizable !== false" class="handle" @pointerdown="down($event, b, 'resize')" aria-hidden="true"></span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stage-proof { width: fit-content; justify-self: center; }
.stage { position: relative; background: #808080; touch-action: none; }
.stage :slotted(canvas) { width: 100%; height: 100%; display: block; }
.box { position: absolute; border: 1px dashed rgba(255,255,255,.7); cursor: move; outline: none; }
.box:hover { border-color: #fff; }
.box.sel { border: 2px solid var(--magenta); }
.box.sel:focus-visible { outline: 3px solid var(--cyan); }
.label { position: absolute; top: -22px; right: -2px; font-size: 12px; background: var(--ink); color: #fff; padding: 1px 6px; white-space: nowrap; display: none; }
.box.sel .label, .box:hover .label { display: block; }
.handle { position: absolute; left: -7px; bottom: -7px; width: 14px; height: 14px; background: var(--magenta); border: 2px solid #fff; cursor: nesw-resize; }
</style>
