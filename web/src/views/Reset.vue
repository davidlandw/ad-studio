<script setup>
import { ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "../lib/api";
import { loadMe, toast } from "../lib/store";

const props = defineProps({ token: String });
const router = useRouter();
const pw = ref(""), pw2 = ref(""), error = ref(""), busy = ref(false);
async function submit() {
  error.value = "";
  if (pw.value !== pw2.value) { error.value = "הסיסמאות לא זהות"; return; }
  busy.value = true;
  try {
    await api.post("/auth/reset", { token: props.token, password: pw.value });
    await loadMe();
    toast("הסיסמה עודכנה. התנתקת מכל שאר המכשירים.");
    router.push("/");
  } catch (e) { error.value = e.message; } finally { busy.value = false; }
}
</script>

<template>
  <section class="center">
    <form class="panel" @submit.prevent="submit">
      <h1>סיסמה חדשה</h1>
      <label class="field"><span>סיסמה חדשה <small>(8 תווים לפחות)</small></span><input v-model="pw" type="password" minlength="8" required dir="ltr" autocomplete="new-password" data-test="reset-pw" /></label>
      <label class="field"><span>שוב, לאימות</span><input v-model="pw2" type="password" minlength="8" required dir="ltr" autocomplete="new-password" data-test="reset-pw2" /></label>
      <p v-if="error" class="error-text" role="alert">{{ error }} <router-link v-if="error.includes('קישור')" to="/forgot">בקשת קישור חדש</router-link></p>
      <button class="primary" :disabled="busy" data-test="reset-submit">שמירת סיסמה</button>
    </form>
  </section>
</template>

<style scoped>
.center { display: grid; place-items: center; min-height: 70vh; }
form { width: min(420px, 90vw); }
</style>
