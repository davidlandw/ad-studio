<script setup>
import { ref, watch, computed } from "vue";
import { api } from "../lib/api";
import { store, currentOrg, loadMe, setOrg, toast } from "../lib/store";

const members = ref([]), invites = ref([]), usage = ref(null);
const invite = ref({ email: "", role: "member" }), orgName = ref(""), newOrg = ref("");
const quota = ref({ text: "", image: "" });
const org = computed(currentOrg);
const canManage = computed(() => ["owner", "admin"].includes(org.value?.role));
const ROLE = { owner: "בעלים", admin: "מנהל", member: "חבר" };
const date = (s) => new Date(s).toLocaleDateString("he-IL");
const pct = (u) => (u.limit ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 100);

async function load() {
  if (!store.orgId) return;
  orgName.value = org.value?.name || "";
  try {
    const [m, u, i] = await Promise.all([
      api.get(`/orgs/${store.orgId}/members`), api.get(`/orgs/${store.orgId}/usage`),
      canManage.value ? api.get(`/orgs/${store.orgId}/invitations`) : Promise.resolve([]),
    ]);
    members.value = m; usage.value = u; invites.value = i;
    quota.value = { text: u.text.custom ? u.text.limit : "", image: u.image.custom ? u.image.limit : "" };
  } catch (e) { toast(e.message, "error"); }
}
watch(() => store.orgId, load, { immediate: true });

const run = async (fn, ok) => { try { await fn(); if (ok) toast(ok); await loadMe(); await load(); } catch (e) { toast(e.message, "error"); } };
const rename = () => run(() => api.patch(`/orgs/${store.orgId}`, { name: orgName.value }), "השם עודכן");
const send = () => run(async () => { await api.post(`/orgs/${store.orgId}/invitations`, invite.value); invite.value.email = ""; }, "ההזמנה נשלחה במייל");
const revoke = (i) => run(() => api.del(`/orgs/${store.orgId}/invitations/${i.id}`), "ההזמנה בוטלה");
const resend = (i) => run(() => api.post(`/orgs/${store.orgId}/invitations`, { email: i.email, role: i.role }), "נשלחה הזמנה חדשה");
const setRole = (m, role) => run(() => api.patch(`/orgs/${store.orgId}/members/${m.id}`, { role }), "התפקיד עודכן");
const remove = (m) => confirm(`להסיר את ${m.name} מהארגון?`) && run(() => api.del(`/orgs/${store.orgId}/members/${m.id}`), "הוסר");
const create = () => run(async () => { const o = await api.post("/orgs", { name: newOrg.value }); newOrg.value = ""; setOrg(o.id); }, "הארגון נוצר");
const saveQuota = () => run(() => api.put(`/admin/orgs/${store.orgId}/quota`, {
  text: quota.value.text === "" ? null : quota.value.text, image: quota.value.image === "" ? null : quota.value.image }), "המכסות עודכנו");
</script>

<template>
  <section>
    <h1>{{ org?.name }}</h1>

    <div v-if="usage" class="panel" data-test="usage">
      <h2>שימוש החודש</h2>
      <div class="usage">
        <div v-for="[k, l] in [['text', 'יצירות טקסט'], ['image', 'תמונות']]" :key="k">
          <div class="row" style="justify-content:space-between"><strong>{{ l }}</strong><span>{{ usage[k].used }} / {{ usage[k].limit }}</span></div>
          <div class="bar" role="progressbar" :aria-valuenow="usage[k].used" :aria-valuemax="usage[k].limit" :aria-label="l">
            <i :style="{ width: pct(usage[k]) + '%' }" :class="{ full: pct(usage[k]) >= 90 }"></i></div>
        </div>
      </div>
      <p class="muted small">המכסה משותפת לכל חברי הארגון ומתחדשת ב-{{ date(usage.resetsAt) }}. כל יצירה מחויבת על מפתח ה-Gemini של מי שיצר.</p>
      <form v-if="store.me.isPlatformAdmin" class="row admin" @submit.prevent="saveQuota" data-test="quota-form">
        <span>מנהל מערכת, מכסה לארגון:</span>
        <label>טקסט <input v-model="quota.text" type="number" min="0" placeholder="ברירת מחדל" data-test="quota-text" /></label>
        <label>תמונות <input v-model="quota.image" type="number" min="0" placeholder="ברירת מחדל" data-test="quota-image" /></label>
        <button>שמירת מכסות</button>
      </form>
    </div>

    <div class="panel" v-if="canManage">
      <h2>שם הארגון</h2>
      <form class="row" @submit.prevent="rename"><input v-model="orgName" style="max-width:360px" aria-label="שם הארגון" /><button>שמירת שם</button></form>
    </div>

    <div class="panel">
      <h2>חברים</h2>
      <table>
        <thead><tr><th>שם</th><th>אימייל</th><th>תפקיד</th><th></th></tr></thead>
        <tbody>
          <tr v-for="m in members" :key="m.id" :data-test="`member-${m.email}`">
            <td>{{ m.name }}</td><td dir="ltr" style="text-align:right">{{ m.email }}</td>
            <td>
              <select v-if="canManage && m.id !== store.me.user.id" :value="m.role" @change="setRole(m, $event.target.value)" style="width:auto">
                <option v-for="(l, r) in ROLE" :key="r" :value="r">{{ l }}</option>
              </select>
              <span v-else>{{ ROLE[m.role] }}</span>
            </td>
            <td><button v-if="canManage || m.id === store.me.user.id" class="danger" @click="remove(m)">{{ m.id === store.me.user.id ? "עזיבה" : "הסרה" }}</button></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="panel" v-if="canManage">
      <h2>הזמנת חברים</h2>
      <form class="row" @submit.prevent="send">
        <input v-model="invite.email" type="email" required placeholder="name@example.com" dir="ltr" style="max-width:320px" data-test="invite-email" />
        <select v-model="invite.role" style="width:auto"><option value="member">חבר</option><option value="admin">מנהל</option><option v-if="org?.role === 'owner'" value="owner">בעלים</option></select>
        <button class="primary" data-test="invite">שליחת הזמנה במייל</button>
      </form>
      <p class="muted small">ההזמנה אישית לכתובת ותקפה לשבוע. מי שאין לו חשבון יוכל להירשם מהקישור.</p>
      <table v-if="invites.length" data-test="pending-invites">
        <thead><tr><th>אימייל</th><th>תפקיד</th><th>הוזמן ע"י</th><th>בתוקף עד</th><th></th></tr></thead>
        <tbody>
          <tr v-for="i in invites" :key="i.id">
            <td dir="ltr" style="text-align:right">{{ i.email }}</td><td>{{ ROLE[i.role] }}</td><td>{{ i.invited_by_name }}</td><td>{{ date(i.expires_at) }}</td>
            <td><div class="row"><button class="link" @click="resend(i)">שליחה מחדש</button><button class="danger" @click="revoke(i)">ביטול</button></div></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="panel">
      <h2>ארגון חדש</h2>
      <form class="row" @submit.prevent="create"><input v-model="newOrg" required placeholder="שם הארגון" style="max-width:360px" data-test="new-org" /><button>יצירת ארגון</button></form>
    </div>
  </section>
</template>

<style scoped>
.usage { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; margin-bottom: 8px; }
.bar { height: 10px; background: #e3e6e9; margin-top: 6px; }
.bar i { display: block; height: 100%; background: var(--cyan); }
.bar i.full { background: var(--danger); }
.small { font-size: 14px; }
.admin { border-top: 1px dashed var(--line); padding-top: 12px; margin-top: 8px; }
.admin input { width: 120px; }
</style>
