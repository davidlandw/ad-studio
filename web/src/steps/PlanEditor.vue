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
    <h3>האלמנטים שייווצרו בנפרד <small class="muted">(צילום AI, לכל אחד קריאה נפרדת)</small></h3>
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
        <tr v-if="!plan.elements.length"><td colspan="4" class="muted">אין אלמנטים — מודעה גרפית יכולה להסתמך רק על פאנלים וטקסט.</td></tr>
      </tbody>
    </table>

    <h3>פאנלים גרפיים <small class="muted">(צורות צבע שטוח — נצבעות ישירות, בלי קריאה ל-AI)</small></h3>
    <table class="els" v-if="plan.panels">
      <thead><tr><th>צורה</th><th>צבע</th><th>עיגול פינות</th><th>תווית</th><th>מיקום (x, y, רוחב, גובה)</th></tr></thead>
      <tbody>
        <tr v-for="(pn, i) in plan.panels" :key="i">
          <td><select v-model="pn.shape" :disabled="readonly"><option value="rect">מלבן</option><option value="ellipse">אליפסה</option></select></td>
          <td><input v-model="pn.color" type="color" :disabled="readonly" /></td>
          <td><input v-model.number="pn.radius" type="number" min="0" max="1" step="0.05" :readonly="readonly" /></td>
          <td><input v-model="pn.label" :readonly="readonly" placeholder="(אין)" /></td>
          <td class="nums" dir="ltr">
            <input v-for="d in ['x','y','w','h']" :key="d" v-model.number="pn.layout[d]" type="number" min="0" max="1" step="0.01" :readonly="readonly" :aria-label="d" />
          </td>
        </tr>
        <tr v-if="!plan.panels.length"><td colspan="5" class="muted">אין פאנלים.</td></tr>
      </tbody>
    </table>
    <button v-if="!readonly" type="button" class="ghost" @click="plan.panels.push({ shape: 'rect', color: '#00000080', radius: 0, label: '', layout: { x: 0.1, y: 0.1, w: 0.3, h: 0.1 }, z: (plan.panels.length || 0) })">הוספת פאנל</button>
  </div>
</template>

<style scoped>
.els td { vertical-align: top; }
.els td:nth-child(3) { width: 50%; }
.nums { display: grid; grid-template-columns: repeat(2, 70px); gap: 4px; }
.nums input { padding: 4px; }
</style>
