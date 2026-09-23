<script setup>
import { ref, onMounted, computed } from "vue";
import { useRouter } from "vue-router";
import { api } from "../lib/api";
import { store, loadMe, setOrg, toast } from "../lib/store";

const props = defineProps({ token: String });
const router = useRouter();
const inv = ref(null), error = ref(""), busy = ref(false);
const ROLE = { owner: "בעלים", admin: "מנהל/ת", member: "חבר/ה" };
const STATUS = { revoked: "ההזמנה בוטלה על ידי הארגון.", accepted: "ההזמנה כבר מומשה.", expired: "פג תוקף ההזמנה. בקשו מהארגון הזמנה חדשה." };
const next = computed(() => `/invite/${props.token}`);
const sameUser = computed(() => store.me && inv.value && store.me.user.email.toLowerCase() === inv.value.email.toLowerCase());

onMounted(async () => {
  try { inv.value = await api.get(`/invitations/${props.token}`); } catch (e) { error.value = e.message; }
});
async function accept() {
  busy.value = true;
  try {
    const r = await api.post(`/invitations/${props.token}/accept`);
    await loadMe(); setOrg(r.orgId);
    toast(`הצטרפת ל-${r.orgName}`);
    router.push("/");
  } catch (e) { error.value = e.message; } finally { busy.value = false; }
}
async function switchAccount() {
  await api.post("/auth/logout"); store.me = null;
  router.push({ path: "/login", query: { next: next.value, email: inv.value.email } });
}
</script>

<template>
  <section class="center">
    <div class="panel box">
      <h1>הזמנה לארגון</h1>
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      <template v-if="inv">
        <p><strong>{{ inv.inviter }}</strong> הזמין/ה את <bdi dir="ltr">{{ inv.email }}</bdi> להצטרף לארגון <strong>{{ inv.orgName }}</strong> בתפקיד {{ ROLE[inv.role] }}.</p>
        <p v-if="inv.status !== 'pending'" class="error-text">{{ STATUS[inv.status] }}</p>
        <template v-else-if="sameUser">
          <button class="primary" :disabled="busy" @click="accept" data-test="accept-invite">הצטרפות לארגון</button>
        </template>
        <template v-else-if="store.me">
          <p>את/ה מחובר/ת כ-<bdi dir="ltr">{{ store.me.user.email }}</bdi>. ההזמנה אישית לכתובת שאליה נשלחה.</p>
          <button @click="switchAccount">התחברות עם {{ inv.email }}</button>
        </template>
        <div v-else class="row">
          <router-link class="btn primary" :to="{ path: '/login', query: { next, email: inv.email } }" data-test="invite-login">התחברות</router-link>
          <router-link class="btn ghost" :to="{ path: '/login', query: { next, email: inv.email, mode: 'register' } }" data-test="invite-register">אין לי חשבון, הרשמה</router-link>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.center { display: grid; place-items: center; min-height: 70vh; }
.box { width: min(520px, 92vw); }
.btn.primary { background: var(--magenta); border-color: var(--magenta); color: #fff; }
.btn.ghost { background: transparent; color: var(--ink); }
</style>
