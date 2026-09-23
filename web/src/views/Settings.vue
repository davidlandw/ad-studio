<script setup>
import { ref } from "vue";
import { api } from "../lib/api";
import { store, loadMe, toast } from "../lib/store";

const key = ref(""), busy = ref(false);

async function saveKey() {
  busy.value = true;
  try { await api.put("/me/gemini-key", { key: key.value }); key.value = ""; await loadMe(); toast("המפתח נשמר ואומת"); }
  catch (e) { toast(e.message, "error"); } finally { busy.value = false; }
}
async function removeKey() {
  if (!confirm("למחוק את מפתח ה-Gemini?")) return;
  await api.del("/me/gemini-key"); await loadMe(); toast("המפתח נמחק");
}
</script>

<template>
  <section>
    <h1>הגדרות</h1>
    <div class="panel">
      <h2>מפתח Gemini</h2>
      <p>כל יצירה במערכת (ניתוח, קונספטים ותמונות) רצה על המפתח האישי שלך מ-Google AI Studio ונספרת לחשבון שלך. המפתח נשמר מוצפן, ואף פעם לא מוצג שוב במלואו.</p>
      <p v-if="store.me.gemini.hasKey">מפתח שמור: <bdi dir="ltr">{{ store.me.gemini.masked }}</bdi> <button class="danger" @click="removeKey">מחיקת מפתח</button></p>
      <form class="row" @submit.prevent="saveKey">
        <input v-model="key" type="password" autocomplete="off" dir="ltr" :placeholder="store.me.gemini.hasKey ? 'הדבקת מפתח חדש להחלפה' : 'AIza...'" style="max-width:420px" data-test="gemini-key" />
        <button class="primary" :disabled="busy || key.length < 8" data-test="save-key">שמירה ואימות</button>
      </form>
    </div>

    <div class="panel">
      <h2>פונטים ואלמנטים</h2>
      <p>פונטים ואלמנטים שמורים נמצאים ב<router-link to="/library">ספרייה של הארגון</router-link>, וזמינים לכל חברי הארגון.</p>
    </div>
  </section>
</template>
