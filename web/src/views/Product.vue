<script setup>
import { ref } from "vue";
import { api } from "../lib/api";
import { toast } from "../lib/store";

const props = defineProps({ id: Number });
const product = ref(null), error = ref(""), brief = ref({});
const FIELDS = [["description", "על המוצר", true], ["features", "תכונות עיקריות", true], ["differentiators", "מה מייחד את המוצר הזה", true], ["notes", "הערות נוספות", false]];
const docFile = ref(null), docName = ref("");

async function load() {
  try { product.value = await api.get(`/products/${props.id}`); brief.value = { ...product.value.brief }; }
  catch (e) { error.value = e.message; }
}
load();

async function rename(e) {
  const name = e.target.value.trim();
  if (name && name !== product.value.name) { try { product.value = { ...product.value, ...(await api.patch(`/products/${props.id}`, { name })) }; } catch (e2) { toast(e2.message, "error"); } }
}
async function save() {
  try { product.value = { ...product.value, ...(await api.patch(`/products/${props.id}`, { brief: brief.value })) }; toast("הבריף נשמר"); }
  catch (e) { toast(e.message, "error"); }
}
async function upload() {
  if (!docFile.value) return toast("יש לבחור קובץ", "error");
  const fd = new FormData(); fd.append("file", docFile.value); if (docName.value) fd.append("name", docName.value);
  try { await api.post(`/products/${props.id}/documents`, fd); docFile.value = null; docName.value = ""; await load(); }
  catch (e) { toast(e.message, "error"); }
}
async function remove(id) { try { await api.del(`/documents/${id}`); await load(); } catch (e) { toast(e.message, "error"); } }
</script>

<template>
  <p v-if="error" class="panel error-text">{{ error }}</p>
  <section v-else-if="product">
    <router-link :to="`/clients/${product.clientId}`" class="muted">חזרה ללקוח</router-link>
    <input class="title" :value="product.name" @change="rename" aria-label="שם המוצר" data-test="product-name" />
    <div class="panel">
      <div class="grid2">
        <label v-for="[k, l, long] in FIELDS" :key="k" class="field"><span>{{ l }}</span>
          <textarea v-if="long" v-model="brief[k]" :data-test="`product-brief-${k}`"></textarea>
          <input v-else v-model="brief[k]" :data-test="`product-brief-${k}`" />
        </label>
      </div>
      <button class="primary" @click="save" data-test="save-product-brief">שמירת הבריף</button>
    </div>
    <div class="panel">
      <h2>תיקיית מסמכים <small class="muted">(תמונות מוצר, מפרטים)</small></h2>
      <ul class="docs">
        <li v-for="d in product.documents" :key="d.id">
          <a :href="`/api/documents/${d.id}/file`" target="_blank" rel="noopener">{{ d.name }}</a>
          <button class="link danger" @click="remove(d.id)">מחיקה</button>
        </li>
      </ul>
      <form class="row" @submit.prevent="upload">
        <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" @change="(e) => (docFile = e.target.files[0])" />
        <input v-model="docName" placeholder="שם (לא חובה)" style="max-width:200px" />
        <button class="primary" data-test="upload-product-doc">העלאה</button>
      </form>
    </div>
  </section>
</template>

<style scoped>
.title { font-family: var(--display); font-size: 1.6rem; background: transparent; border-color: transparent; display: block; margin: 8px 0 16px; }
.docs { list-style: none; padding: 0; margin: 0 0 16px; }
.docs li { padding: 6px 0; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; }
</style>
