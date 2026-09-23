<script setup>
import { ref } from "vue";
import { useRouter, useRoute } from "vue-router";
import { api } from "../lib/api";
import { loadMe } from "../lib/store";

const router = useRouter(), route = useRoute();
const mode = ref(route.query.mode === "register" ? "register" : "login");
const form = ref({ email: String(route.query.email || ""), name: "", password: "" });
const error = ref(""), busy = ref(false);

async function submit() {
  error.value = ""; busy.value = true;
  try {
    await api.post(mode.value === "login" ? "/auth/login" : "/auth/register", form.value);
    await loadMe();
    router.push(route.query.next || "/");
  } catch (e) { error.value = e.message; } finally { busy.value = false; }
}
</script>

<template>
  <section class="login">
    <div class="proof"><span class="cm"></span>
      <form class="panel" @submit.prevent="submit">
        <h1>סטודיו מודעות</h1>
        <p class="muted">מבריף ועד מודעה מוכנה: ניתוח, קונספטים, קומפוזיציה, ביקורת, ואז כל אלמנט נוצר ומאושר בנפרד לפני שמחברים.</p>
        <label v-if="mode === 'register'" class="field"><span>שם</span><input v-model="form.name" required autocomplete="name" data-test="name" /></label>
        <label class="field"><span>אימייל</span><input v-model="form.email" type="email" required autocomplete="email" dir="ltr" data-test="email" /></label>
        <label class="field"><span>סיסמה <small v-if="mode === 'register'">(8 תווים לפחות)</small></span>
          <input v-model="form.password" type="password" required :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" dir="ltr" data-test="password" /></label>
        <p v-if="error" class="error-text" role="alert">{{ error }}</p>
        <p v-if="mode === 'login'" class="forgot"><router-link :to="{ path: '/forgot', query: { email: form.email || undefined } }" data-test="forgot-link">שכחתי סיסמה</router-link></p>
        <div class="row">
          <button class="primary" :disabled="busy" data-test="submit">{{ mode === "login" ? "התחברות" : "יצירת חשבון" }}</button>
          <button type="button" class="link" @click="mode = mode === 'login' ? 'register' : 'login'" data-test="toggle-mode">
            {{ mode === "login" ? "אין לך חשבון? הרשמה" : "יש לך חשבון? התחברות" }}</button>
        </div>
      </form>
    </div>
  </section>
</template>

<style scoped>
.login { display: grid; place-items: center; min-height: 80vh; }
form { width: min(420px, 90vw); margin: 0; }
.forgot { font-size: 15px; }
</style>
