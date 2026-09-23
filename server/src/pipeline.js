/**
 * The creative pipeline — one function per step of the agency workflow.
 * Text steps return Hebrew prose for the user; image prompts stay in English (models follow them better).
 * Rule enforced here (not left to the model): the ad's texts come verbatim from the user's mandatory fields.
 */
const { generateJSON } = require("./gemini");
const { bad } = require("./errors");

const SYSTEM = `You are the creative director of a top advertising agency.
You think in real campaigns, not "AI images". You avoid generic, clichéd, stock-photo ideas.
Write all user-facing prose in Hebrew. Write every image-generation prompt in English.
Never invent business facts (phone numbers, prices, addresses, claims, awards) that the user did not provide.
Always answer with a single valid JSON object that matches the requested schema — no markdown, no commentary.`;

const BRIEF_FIELDS = {
  businessName: "שם העסק",
  offering: "מה העסק מציע",
  audience: "קהל היעד",
  differentiators: "מה מיוחד בעסק",
  tone: "מה הפרסומת צריכה לשדר",
  goal: "מטרת הפרסומת",
};
const MANDATORY_FIELDS = {
  centerProduct: "המוצר / השירות שבמרכז",
  businessName: "שם העסק",
  slogan: "סלוגן",
  phone: "טלפון",
  addressOrSite: "כתובת / אתר",
  offer: "מבצע / מחיר",
  extra: "פרטים נוספים",
};
// Text roles rendered on the ad, in hierarchy order. Values come ONLY from mandatory fields.
const TEXT_ROLES = ["slogan", "businessName", "offer", "extra", "phone", "addressOrSite"];

const ASPECTS = {
  "1:1": [1080, 1080],
  "4:5": [1080, 1350],
  "9:16": [1080, 1920],
  "16:9": [1920, 1080],
};

const fmt = (obj, labels) =>
  Object.entries(labels).map(([k, l]) => `${l}: ${obj?.[k]?.toString().trim() || "(לא סופק)"}`).join("\n");

// ---------- Step 1: analysis ----------
async function analyze({ apiKey, brief }) {
  const prompt = `Analyse this business and the goal of the ad before any visual work.
BRIEF:
${fmt(brief, BRIEF_FIELDS)}

Return JSON:
{"summary": string, "positioning": string, "audience_insight": string, "tone_direction": string,
 "goal_strategy": string, "risks": string[], "recommendations": string[]}`;
  const out = await generateJSON({
    apiKey, system: SYSTEM, prompt,
    mock: {
      summary: `${brief.businessName || "העסק"} — ${brief.offering || "הצעה"} לקהל ${brief.audience || "רחב"}.`,
      positioning: `בידול: ${brief.differentiators || "לא הוגדר"}.`,
      audience_insight: "הקהל מחפש רגע אמיתי ומוכר, לא הבטחה שיווקית.",
      tone_direction: brief.tone || "חמימות ומקצועיות",
      goal_strategy: `מטרה: ${brief.goal || "מיתוג"} — מסר אחד ברור ונקודת מוקד אחת.`,
      risks: ["דימוי סטוק גנרי", "עומס טקסט"],
      recommendations: ["נקודת מוקד אחת", "מרחב שלילי לכותרת"],
    },
  });
  return pick(out, ["summary", "positioning", "audience_insight", "tone_direction", "goal_strategy", "risks", "recommendations"]);
}

// ---------- Step 2: suggestions for the mandatory fields (creative fields only — never invents facts) ----------
async function suggestMandatory({ apiKey, brief, analysis }) {
  const prompt = `Based on the brief and the analysis, suggest values for two of the ad's mandatory fields.
Only suggest fields that are creative choices. Never invent business facts (phone, address, price, offers) — those are not part of this request.
BRIEF:\n${fmt(brief, BRIEF_FIELDS)}
ANALYSIS: ${JSON.stringify(analysis)}

Return JSON: {"centerProduct": string, "slogan": string}
centerProduct: short precise Hebrew phrase (up to 6 words) naming the specific product/service that should be the visual center of the ad, grounded in the brief's offering — not generic.
slogan: one short punchy Hebrew slogan (up to 8 words) that matches the tone and positioning from the analysis.`;
  const out = await generateJSON({
    apiKey, system: SYSTEM, prompt,
    mock: {
      centerProduct: brief.offering ? brief.offering.split(" ").slice(0, 5).join(" ") : "המוצר המרכזי",
      slogan: `${brief.businessName || "המותג"} — ${brief.differentiators || "האיכות שאתם מחפשים"}`,
    },
  });
  return { centerProduct: String(out.centerProduct || "").slice(0, 200), slogan: String(out.slogan || "").slice(0, 200) };
}

// ---------- Step 3: ten concepts ----------
async function concepts({ apiKey, brief, mandatory, analysis }) {
  const prompt = `Based on the brief, the mandatory items and the analysis, propose 10 ORIGINAL ad concepts.
Not "a nice photo of the product". Think like an agency. Avoid ideas that look like typical AI images.
BRIEF:\n${fmt(brief, BRIEF_FIELDS)}
MANDATORY:\n${fmt(mandatory, MANDATORY_FIELDS)}
ANALYSIS:\n${JSON.stringify(analysis)}

Return JSON: {"concepts": [{"title": string, "what_we_see": string, "idea": string, "message": string, "stopping_power": string}]}
Exactly 10 items. All values in Hebrew.`;
  const out = await generateJSON({
    apiKey, system: SYSTEM, prompt,
    mock: () => ({
      concepts: Array.from({ length: 10 }, (_, i) => ({
        title: `קונספט ${i + 1}`,
        what_we_see: `${mandatory.centerProduct || "המוצר"} בסיטואציה יומיומית #${i + 1}`,
        idea: "רגע אמיתי שכולם מכירים",
        message: "המוצר הוא חלק מהרגע",
        stopping_power: "מתח ויזואלי של רגע לפני",
      })),
    }),
  });
  const list = Array.isArray(out.concepts) ? out.concepts : [];
  if (list.length < 3) throw bad("המודל החזיר פחות מ-3 קונספטים — נסו שוב");
  return list.slice(0, 10).map((c) => pick(c, ["title", "what_we_see", "idea", "message", "stopping_power"]));
}

// ---------- Step 4: composition plan (split into separately generated elements) ----------
const PLAN_SCHEMA = `{
 "concept_title": string,
 "composition": {"frame": string, "product_placement": string, "camera_angle": string, "background": string,
   "lighting": string, "colors": string, "depth_of_field": string, "logo_position": string,
   "text_position": string, "hierarchy": string, "mood": string},          // Hebrew prose
 "style": {"lighting": string, "palette": string, "lens": string, "mood": string},   // short ENGLISH, reused in every image prompt
 "elements": [{"key": string (snake_case), "name": string (Hebrew), "kind": "background"|"object",
   "prompt": string (ENGLISH, describes ONLY this element), "layout": {"x":0-1,"y":0-1,"w":0-1,"h":0-1}, "z": integer}],
 "text_layout": {"<role>": {"x":0-1,"y":0-1,"w":0-1,"align":"right"|"center"|"left","size":0.02-0.12}},
 "logo": {"x":0-1,"y":0-1,"w":0-1,"h":0-1}
}
Rules: exactly ONE element with kind "background" (the empty scene: room, surface, backdrop — layout 0,0,1,1, z 0).
Every physical object (product, table, cup, props) is its own "object" element with a layout box as a fraction of the frame (x,y = top-left).
2 to 6 elements total. Keep the product the visual center of the hierarchy.
text_layout roles allowed: ${TEXT_ROLES.join(", ")} — include only roles that have a value in MANDATORY.`;

async function plan({ apiKey, brief, mandatory, analysis, concept, aspect }) {
  const prompt = `Develop the chosen concept into a professional campaign composition, split into elements that will be generated SEPARATELY and approved one by one, then assembled.
FORMAT: ${aspect}
BRIEF:\n${fmt(brief, BRIEF_FIELDS)}
MANDATORY (texts must be used exactly as given, do not rewrite them):\n${fmt(mandatory, MANDATORY_FIELDS)}
ANALYSIS: ${JSON.stringify(analysis)}
CHOSEN CONCEPT: ${JSON.stringify(concept)}

Return JSON: ${PLAN_SCHEMA}`;
  const out = await generateJSON({ apiKey, system: SYSTEM, prompt, mock: () => mockPlan(concept, mandatory) });
  return normalizePlan(out, mandatory);
}

// ---------- Step 5: critique + revised plan ----------
async function critique({ apiKey, brief, mandatory, plan: current }) {
  const prompt = `Act as the agency's toughest creative reviewer. Review this plan as if it landed on your desk for production.
Check: what is not good enough, what could look generic or "AI", is the message clear, is the product really the center,
is there clutter, does the composition pull the eye. Then give concrete improvements and a revised plan.
BRIEF:\n${fmt(brief, BRIEF_FIELDS)}
MANDATORY:\n${fmt(mandatory, MANDATORY_FIELDS)}
PLAN: ${JSON.stringify(current)}

Return JSON: {"checks": {"generic_risk": string, "message_clarity": string, "product_centered": string,
 "clutter": string, "eye_flow": string}, "issues": string[], "improvements": string[], "revised_plan": ${PLAN_SCHEMA}}
checks/issues/improvements in Hebrew.`;
  const out = await generateJSON({
    apiKey, system: SYSTEM, prompt,
    mock: () => ({
      checks: { generic_risk: "בינוני — צריך פרטים ספציפיים", message_clarity: "ברור", product_centered: "כן",
        clutter: "נמוך", eye_flow: "טוב, להגדיל ניגודיות סביב המוצר" },
      issues: ["התאורה כללית מדי", "האביזרים מתחרים במוצר"],
      improvements: ["תאורת חלון צדדית חמה", "להקטין את האביזר המשני"],
      revised_plan: { ...current, style: { ...current.style, lighting: "warm low morning window light from camera left" } },
    }),
  });
  return {
    checks: out.checks || {},
    issues: arr(out.issues),
    improvements: arr(out.improvements),
    revised_plan: normalizePlan(out.revised_plan || current, mandatory),
  };
}

// ---------- Image prompts ----------
function elementPrompt(el, plan) {
  const s = plan.style || {};
  const common = `Photorealistic advertising photography, real camera, not CGI. Lighting: ${s.lighting}. Palette: ${s.palette}. Lens: ${s.lens}. Mood: ${s.mood}.
No text, letters, numbers, logos, labels or watermarks.`;
  if (el.kind === "background") {
    return `${el.prompt}
This is ONLY the empty background scene for an ad composition — leave the areas where objects will be placed clear and uncluttered. No people.
${common}`;
  }
  return `${el.prompt}
Show ONLY this single object, whole and uncropped, centered, filling about 80% of the frame, isolated on a perfectly flat, uniform, pure ${el.key_color} chroma-key background.
The background must be one solid color with no gradient, no floor, no horizon and no cast shadow. Keep the object free of ${el.key_color} tones and reflections.
Light the object exactly as it will be lit in the final scene. ${common}`;
}

function refinePrompt(basePrompt, feedback) {
  return `Edit the attached image. Keep everything that already works; apply ONLY this change: ${feedback}
Original brief for this image:
${basePrompt}`;
}

function fusionPrompt(plan, elements) {
  const c = plan.composition || {};
  const s = plan.style || {};
  const list = elements.map((e, i) => `Image ${i + 2}: approved reference for "${e.name}" (${e.kind}).`).join("\n");
  return `Image 1 is a rough layout collage of an advertisement. Re-render it as ONE seamless, photorealistic campaign photograph.
Keep the exact placement, scale and framing of every element from Image 1. Keep the design of each element faithful to its approved reference:
${list}
Unify perspective, contact shadows, reflections, color grade and lighting so everything was clearly shot together in one frame.
Lighting: ${s.lighting}. Palette: ${s.palette}. Lens: ${s.lens}. Mood: ${s.mood}.
Camera: ${c.camera_angle || ""}. Depth of field: ${c.depth_of_field || ""}.
Keep the empty areas reserved for text and logo empty. Remove any leftover chroma-key fringes.
Do NOT add any text, letters, numbers, logos, labels or watermarks. Do NOT add new objects or people.`;
}

// ---------- Text layers (verbatim from mandatory fields) ----------
function buildTextLayers(plan, mandatory, aspect) {
  const [W, H] = ASPECTS[aspect] || ASPECTS["4:5"];
  const layout = plan.text_layout || {};
  const defaults = {
    slogan: { x: 0.07, y: 0.07, w: 0.86, align: "right", size: 0.065 },
    businessName: { x: 0.07, y: 0.2, w: 0.86, align: "right", size: 0.04 },
    offer: { x: 0.07, y: 0.72, w: 0.5, align: "right", size: 0.045 },
    extra: { x: 0.07, y: 0.8, w: 0.86, align: "right", size: 0.025 },
    phone: { x: 0.07, y: 0.88, w: 0.43, align: "right", size: 0.03 },
    addressOrSite: { x: 0.5, y: 0.88, w: 0.43, align: "left", size: 0.03 },
  };
  return TEXT_ROLES.filter((r) => mandatory[r]?.toString().trim()).map((role) => {
    const l = { ...defaults[role], ...(layout[role] || {}) };
    return {
      id: role, role,
      text: mandatory[role].toString().trim(),
      x: clamp(l.x) * W, y: clamp(l.y) * H, w: Math.max(40, clamp(l.w) * W),
      align: ["right", "center", "left"].includes(l.align) ? l.align : "right",
      size: Math.round(Math.min(0.14, Math.max(0.015, Number(l.size) || 0.04)) * H),
      color: "#ffffff", fontId: null, weight: role === "slogan" ? 700 : 400, shadow: true,
    };
  });
}

// ---------- validation ----------
function normalizePlan(p, mandatory) {
  if (!p || typeof p !== "object") throw bad("תוכנית קומפוזיציה לא תקינה מהמודל");
  const seen = new Set();
  let elements = arr(p.elements).map((e, i) => {
    let key = String(e.key || `element_${i + 1}`).toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40) || `element_${i + 1}`;
    while (seen.has(key)) key += "_x";
    seen.add(key);
    const kind = e.kind === "background" ? "background" : "object";
    return {
      key, kind,
      name: String(e.name || key).slice(0, 80),
      prompt: String(e.prompt || "").slice(0, 2000),
      layout: kind === "background" ? { x: 0, y: 0, w: 1, h: 1 } : box(e.layout),
      z: Number.isFinite(+e.z) ? +e.z : i,
    };
  }).filter((e) => e.prompt);
  const bgs = elements.filter((e) => e.kind === "background");
  if (bgs.length === 0) {
    elements.unshift({ key: "background", kind: "background", name: "רקע", layout: { x: 0, y: 0, w: 1, h: 1 }, z: 0,
      prompt: `Background scene for an ad of ${mandatory.centerProduct || "the product"}, empty.` });
  } else if (bgs.length > 1) {
    bgs.slice(1).forEach((b) => { b.kind = "object"; b.layout = box({ x: 0.2, y: 0.2, w: 0.6, h: 0.6 }); });
  }
  elements = elements.slice(0, 8).map((e) => (e.kind === "background" ? { ...e, z: 0 } : { ...e, z: Math.max(1, e.z) }));
  const text_layout = {};
  for (const r of TEXT_ROLES) if (p.text_layout?.[r]) text_layout[r] = p.text_layout[r];
  return {
    concept_title: String(p.concept_title || ""),
    composition: p.composition && typeof p.composition === "object" ? p.composition : {},
    style: { lighting: "", palette: "", lens: "", mood: "", ...(p.style || {}) },
    elements, text_layout,
    logo: p.logo ? box(p.logo) : { x: 0.4, y: 0.9, w: 0.2, h: 0.07 },
  };
}

function mockPlan(concept, mandatory) {
  const product = mandatory.centerProduct || "product";
  return {
    concept_title: concept?.title || "",
    composition: { frame: "אנכי", product_placement: "מרכז-ימין", camera_angle: "גובה עיניים", background: "חדר מטושטש",
      lighting: "אור חלון חם", colors: "חום, נחושת, קרם", depth_of_field: "רדוד", logo_position: "מרכז תחתון",
      text_position: "שליש עליון", hierarchy: "מוצר ← כותרת ← לוגו", mood: "ציפייה שקטה" },
    style: { lighting: "warm window light", palette: "espresso brown, copper, cream", lens: "85mm f/2.8", mood: "quiet anticipation" },
    elements: [
      { key: "room", name: "חדר", kind: "background", prompt: "A softly lit home kitchen, blurred", z: 0 },
      { key: "table", name: "שולחן", kind: "object", prompt: "A wooden table top, front view", layout: { x: 0, y: 0.6, w: 1, h: 0.4 }, z: 1 },
      { key: "product", name: product, kind: "object", prompt: `The hero product: ${product}`, layout: { x: 0.35, y: 0.4, w: 0.35, h: 0.3 }, z: 2 },
    ],
    text_layout: {},
    logo: { x: 0.4, y: 0.9, w: 0.2, h: 0.07 },
  };
}

const clamp = (v) => Math.min(1, Math.max(0, Number(v) || 0));
const box = (b = {}) => {
  const x = clamp(b.x), y = clamp(b.y);
  return { x, y, w: Math.max(0.02, Math.min(1 - x, clamp(b.w) || 0.3)), h: Math.max(0.02, Math.min(1 - y, clamp(b.h) || 0.3)) };
};
const arr = (a) => (Array.isArray(a) ? a : []);
function pick(o, keys) { const r = {}; for (const k of keys) r[k] = o?.[k] ?? (k === "risks" || k === "recommendations" ? [] : ""); return r; }

module.exports = {
  analyze, suggestMandatory, concepts, plan, critique, elementPrompt, refinePrompt, fusionPrompt, buildTextLayers,
  normalizePlan, BRIEF_FIELDS, MANDATORY_FIELDS, ASPECTS, TEXT_ROLES,
};
