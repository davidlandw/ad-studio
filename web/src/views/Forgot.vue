<script setup>
import { ref } from "vue";
import { useRoute } from "vue-router";
import { api } from "../lib/api";

const route = useRoute();
const email = ref(String(route.query.email || "")), sent = ref(""), error = ref(""), busy = ref(false);
async function submit() {
  error.value = ""; busy.value = true;
  try { sent.value = (await api.post("/auth/forgot", { email: email.value })).message; }
  catch (e) { error.value = e.message; } finally { busy.value = false; }
}
</script>

<template>
  <section class="center">
    <form class="panel" @submit.prevent="submit">
      <h1>איפוס סיסמה</h1>
      <template v-if="!sent">
        <p class="muted">נשלח קישור לבחירת סיסמה חדשה לכתובת שאיתה נרשמת.</p>
        <label class="field"><span>אימייל</span><input v-model="email" type="email" required dir="ltr" autocomplete="email" data-test="forgot-email" /></label>
        <p v-if="error" class="error-text" role="alert">{{ error }}</p>
        <button class="primary" :disabled="busy" data-test="forgot-submit">שליחת קישור</button>
      </template>
      <p v-else role="status" data-test="forgot-sent">{{ sent }}</p>
      <p style="margin-top:14px"><router-link to="/login">חזרה להתחברות</router-link></p>
    </form>
  </section>
</template>

<style scoped>
.center { display: grid; place-items: center; min-height: 70vh; }
form { width: min(420px, 90vw); }
</style>
