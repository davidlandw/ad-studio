<script setup>
// Editable view of a composition plan (used for the plan step and to preview the revised plan).
defineProps({ plan: Object, readonly: Boolean });
const COMP = [["frame", "מה רואים בפריים"], ["product_placement", "מיקום המוצר"], ["camera_angle", "זווית צילום"], ["background", "רקע"],
  ["lighting", "תאורה"], ["colors", "צבעים וגוונים"], ["depth_of_field", "עומק שדה"], ["logo_position", "מיקום הלוגו"],
  ["text_position", "מיקום הטקסט"], ["hierarchy", "היררכיה"], ["mood", "אווירה כללית"]];
const STYLE = [["lighting", "Lighting"], ["palette", "Palette"], ["lens", "Lens"], ["mood", "Mood"]];
</script>

<template>
  <div>
    <h3>הקומפוזיציה</h3>
    <div class="grid2">
      <label v-for="[k, l] in COMP" :key="k" class="field"><span>{{ l }}</span>
        <textarea v-model="plan.composition[k]" :readonly="readonly" rows="2"></textarea></label>
    </div>
    <h3>סגנון צילום משותף <small class="muted">(באנגלית, נכנס לכל פרומפט של תמונה)</small></h3>
    <div class="grid2" dir="ltr">
      <label v-for="[k, l] in STYLE" :key="k" class="field"><span>{{ l }}</span><input v-model="plan.style[k]" :readonly="readonly" /></label>
    </div>
    <h3>האלמנטים שייווצרו בנפרד</h3>
    <table class="els">
      <thead><tr><th>אלמנט</th><th>סוג</th><th>פרומפט (אנגלית)</th><th>מיקום (x, y, רוחב, גובה)</th></tr></thead>
      <tbody>
        <tr v-for="e in plan.elements" :key="e.key">
          <td><input v-model="e.name" :readonly="readonly" /></td>
          <td>{{ e.kind === "background" ? "רקע" : "אובייקט" }}</td>
          <td><textarea v-model="e.prompt" :readonly="readonly" dir="ltr" rows="3"></textarea></td>
          <td class="nums" dir="ltr"><template v-if="e.kind === 'object'">
            <input v-for="d in ['x','y','w','h']" :key="d" v-model.number="e.layout[d]" type="number" min="0" max="1" step="0.01" :readonly="readonly" :aria-label="d" /></template>
            <span v-else class="muted">מלא</span></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.els td { vertical-align: top; }
.els td:nth-child(3) { width: 50%; }
.nums { display: grid; grid-template-columns: repeat(2, 70px); gap: 4px; }
.nums input { padding: 4px; }
</style>
