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
Always answer with a single valid JSON object that matches the requested schema — no markdown, no commentary.
The user may give you an ADDITIONAL DIRECTION in their own words at any stage (e.g. "take the background from concept 3 and
the message from concept 7", "make it feel more urgent", "upgrade the bottom-right area toward X"). Treat it as a real,
specific instruction from the creative director you report to — follow it precisely, don't just acknowledge it.`;

// ---------- hierarchy: client -> product -> campaign -> ad ----------
const CLIENT_FIELDS = { description: "על הלקוח / העסק", industry: "תחום", audience: "קהל יעד כללי", tone: "טון וקול המותג", notes: "הערות נוספות" };
const PRODUCT_FIELDS = { description: "על המוצר", features: "תכונות עיקריות", differentiators: "מה מייחד את המוצר הזה", notes: "הערות נוספות" };
const CAMPAIGN_FIELDS = { goal: "מטרת הקמפיין", audience: "קהל יעד לקמפיין הזה", tone: "טון לקמפיין הזה", timeframe: "משך / תזמון", notes: "הערות נוספות" };

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
// Free-form extra text lines (mandatory.lines[]) for graphic/typographic ads — a price list, a bullet checklist, etc.
// Learned from real newspaper ads: most classified/graphic ads are MANY short literal lines, not one photographic scene.
const LINE_ROLES = {
  headline: { size: 0.075, weight: 700, align: "right" },
  subheadline: { size: 0.045, weight: 700, align: "right" },
  bullet: { size: 0.032, weight: 400, align: "right", prefix: "✓ " },
  price: { size: 0.036, weight: 700, align: "right" },
  contact: { size: 0.032, weight: 700, align: "right" },
  disclaimer: { size: 0.02, weight: 400, align: "right" },
};

const ASPECTS = {
  "1:1": [1080, 1080],
  "4:5": [1080, 1350],
  "9:16": [1080, 1920],
  "16:9": [1920, 1080],
};

const fmt = (obj, labels) =>
  Object.entries(labels).map(([k, l]) => `${l}: ${obj?.[k]?.toString().trim() || "(לא סופק)"}`).join("\n");

/** Hebrew summary of the ad's place in the hierarchy — given to every AI call so it stays consistent top to bottom (client -> product -> campaign -> this ad). */
function hierarchyBlock({ client, product, campaign, otherProducts } = {}) {
  const parts = [];
  if (client) parts.push(`הלקוח: ${client.name}\n${fmt(client.brief, CLIENT_FIELDS)}`);
  if (campaign) parts.push(`הקמפיין: ${campaign.name}\n${fmt(campaign.brief, CAMPAIGN_FIELDS)}`);
  if (product) parts.push(`המוצר הספציפי למודעה הזו: ${product.name}\n${fmt(product.brief, PRODUCT_FIELDS)}`);
  if (otherProducts?.length) parts.push(`מוצרים נוספים באותו קמפיין (לא במרכז המודעה הזו, אך יכולים להיות רלוונטיים להקשר): ${otherProducts.map((p) => p.name).join(", ")}`);
  return parts.length ? `הקשר היררכי (לקוח → מוצר → קמפיין → המודעה הזו):\n${parts.join("\n\n")}` : "";
}

/** Appends the user's free-text steering note, if any, as an explicit instruction block. */
function withDirection(prompt, direction) {
  const d = String(direction || "").trim();
  return d ? `${prompt}\n\nADDITIONAL DIRECTION FROM THE USER — follow this precisely:\n${d}` : prompt;
}

// ---------- Step 1: analysis ----------
async function analyze({ apiKey, brief, hierarchy, direction }) {
  const prompt = withDirection(`Analyse this business and the goal of the ad before any visual work.
${hierarchy ? hierarchy + "\n" : ""}BRIEF:
${fmt(brief, BRIEF_FIELDS)}

Return JSON:
{"summary": string, "positioning": string, "audience_insight": string, "tone_direction": string,
 "goal_strategy": string, "risks": string[], "recommendations": string[]}`, direction);
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
async function suggestMandatory({ apiKey, brief, analysis, hierarchy, direction }) {
  const prompt = withDirection(`Based on the brief and the analysis, suggest values for two of the ad's mandatory fields.
Only suggest fields that are creative choices. Never invent business facts (phone, address, price, offers) — those are not part of this request.
${hierarchy ? hierarchy + "\n" : ""}BRIEF:\n${fmt(brief, BRIEF_FIELDS)}
ANALYSIS: ${JSON.stringify(analysis)}

Return JSON: {"centerProduct": string, "slogan": string}
centerProduct: short precise Hebrew phrase (up to 6 words) naming the specific product/service that should be the visual center of the ad, grounded in the brief's offering — not generic.
slogan: one short punchy Hebrew slogan (up to 8 words) that matches the tone and positioning from the analysis.`, direction);
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
async function concepts({ apiKey, brief, mandatory, analysis, hierarchy, direction, previousConcepts }) {
  const prev = arr(previousConcepts);
  const prompt = withDirection(`Based on the brief, the mandatory items and the analysis, propose 10 ORIGINAL ad concepts.
Not "a nice photo of the product". Think like an agency. Avoid ideas that look like typical AI images.
${brief?.adStyle === "graphic" ? "This ad is a GRAPHIC/TYPOGRAPHIC ad (bold headline, color panels, short text lines) rather than a photographic scene — concepts should describe layout, message and typographic hierarchy, not camera framing.\n" : ""}${hierarchy ? hierarchy + "\n" : ""}BRIEF:\n${fmt(brief, BRIEF_FIELDS)}
MANDATORY:\n${fmt(mandatory, MANDATORY_FIELDS)}
ANALYSIS:\n${JSON.stringify(analysis)}
${prev.length ? `PREVIOUS CONCEPTS (numbered 1-${prev.length}) — the user's direction above may ask to keep, combine or riff on specific numbers from this list:\n${prev.map((c, i) => `${i + 1}. ${c.title}: ${c.idea}`).join("\n")}\n` : ""}
Return JSON: {"concepts": [{"title": string, "what_we_see": string, "idea": string, "message": string, "stopping_power": string}]}
Exactly 10 items. All values in Hebrew.`, direction);
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

// ---------- Step 4: composition plan (split into separately generated elements + optional graphic panels) ----------
// Element taxonomy learned from real print/newspaper ads, not just "hero product on a background":
// hero product, secondary/supporting products, props (x N), surface/table, background scene, atmosphere/light effect
// (steam, glow, splash), texture/shadow layer, brand accent. Photographic ads split into MANY more of these than a
// single background+product pair — see DECISIONS.md D35.
const PLAN_SCHEMA = `{
 "concept_title": string,
 "composition": {"frame": string, "product_placement": string, "camera_angle": string, "background": string,
   "lighting": string, "colors": string, "depth_of_field": string, "logo_position": string,
   "text_position": string, "hierarchy": string, "mood": string},          // Hebrew prose
 "style": {"lighting": string, "palette": string, "lens": string, "mood": string},   // short ENGLISH, reused in every image prompt
 "elements": [{"key": string (snake_case), "name": string (Hebrew), "kind": "background"|"object",
   "prompt": string (ENGLISH, describes ONLY this element), "layout": {"x":0-1,"y":0-1,"w":0-1,"h":0-1}, "z": integer}],
 "panels": [{"shape": "rect"|"ellipse", "color": "#rrggbb", "radius": 0-1, "label": string|null,
   "layout": {"x":0-1,"y":0-1,"w":0-1,"h":0-1}, "z": integer}],
 "text_layout": {"<role>": {"x":0-1,"y":0-1,"w":0-1,"align":"right"|"center"|"left","size":0.02-0.12}},
 "logo": {"x":0-1,"y":0-1,"w":0-1,"h":0-1}
}
elements: AI-GENERATED PHOTOGRAPHY, one Gemini image call per element, later composited. Use this for anything that must look
like a real photographed object. At most ONE element with kind "background" (layout 0,0,1,1, z 0). Every physical object
(hero product, secondary product, prop, surface/table, atmosphere effect) is its own "object" element with a layout box.
Split generously — a real print ad usually has many small parts, not just "background + product": e.g. surface, hero product,
2-3 supporting props, a secondary product, an atmosphere/light layer. Up to 12 elements total for a photographic ad.
panels: FLAT-COLOR GRAPHIC SHAPES drawn directly (no AI image call, instant, free) — colored background fills, ribbons,
badges/stamps ("מבצע!"), rounded card backgrounds behind a block of text. Use these heavily for a graphic/typographic ad,
and to add polish (a colored strip behind a headline, a badge) even on a photographic one. Up to 12 panels.
Rules: keep the product/message the visual center of the hierarchy. If the ad style is "graphic", elements MAY be empty —
the background can be a full-frame panel instead — and panels + text_layout should carry almost all of the composition.
If the ad style is "photo", use elements for the scene and panels only as light accents (a badge, a footer strip).
text_layout roles allowed: ${TEXT_ROLES.join(", ")} — include only roles that have a value in MANDATORY, plus "line0".."lineN"
for each item in MANDATORY.lines (in order) if present.`;

async function plan({ apiKey, brief, mandatory, analysis, concept, concepts: allConcepts, aspect, hierarchy, direction }) {
  const prev = arr(allConcepts);
  const prompt = withDirection(`Develop the chosen concept into a professional campaign composition, split into elements that will be generated SEPARATELY and approved one by one, then assembled.
FORMAT: ${aspect}. AD STYLE: ${brief?.adStyle || "photo"} (photo = photorealistic scene via generated elements; graphic = typographic/panel-driven; hybrid = both).
${hierarchy ? hierarchy + "\n" : ""}BRIEF:\n${fmt(brief, BRIEF_FIELDS)}
MANDATORY (texts must be used exactly as given, do not rewrite them):\n${fmt(mandatory, MANDATORY_FIELDS)}${mandatory?.lines?.length ? `\nEXTRA TEXT LINES (verbatim, in order):\n${mandatory.lines.map((l, i) => `line${i} [${l.role}]: ${l.text}`).join("\n")}` : ""}
ANALYSIS: ${JSON.stringify(analysis)}
CHOSEN CONCEPT: ${JSON.stringify(concept)}
${prev.length ? `ALL 10 CONCEPTS FROM STEP 3 (numbered 1-${prev.length}), in case the user's direction above references combining ideas from a specific number:\n${prev.map((c, i) => `${i + 1}. ${c.title}: ${c.what_we_see} — ${c.idea}`).join("\n")}\n` : ""}
Return JSON: ${PLAN_SCHEMA}`, direction);
  const out = await generateJSON({ apiKey, system: SYSTEM, prompt, mock: () => mockPlan(concept, mandatory, brief?.adStyle) });
  return normalizePlan(out, mandatory, brief?.adStyle);
}

// ---------- Step 5: critique + revised plan ----------
async function critique({ apiKey, brief, mandatory, plan: current, hierarchy, direction }) {
  const prompt = withDirection(`Act as the agency's toughest creative reviewer. Review this plan as if it landed on your desk for production.
Check: what is not good enough, what could look generic or "AI", is the message clear, is the product really the center,
is there clutter, does the composition pull the eye. Then give concrete improvements and a revised plan.
${hierarchy ? hierarchy + "\n" : ""}BRIEF:\n${fmt(brief, BRIEF_FIELDS)}
MANDATORY:\n${fmt(mandatory, MANDATORY_FIELDS)}
PLAN: ${JSON.stringify(current)}

Return JSON: {"checks": {"generic_risk": string, "message_clarity": string, "product_centered": string,
 "clutter": string, "eye_flow": string}, "issues": string[], "improvements": string[], "revised_plan": ${PLAN_SCHEMA}}
checks/issues/improvements in Hebrew.`, direction);
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
    revised_plan: normalizePlan(out.revised_plan || current, mandatory, brief?.adStyle),
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
  const fixed = TEXT_ROLES.filter((r) => mandatory[r]?.toString().trim()).map((role) => {
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
  // mandatory.lines[]: dynamic extra lines (price lists, bullet checklists, …). Auto-stacked top-to-bottom
  // unless the plan gave an explicit box for "line<i>" in text_layout.
  const lines = arr(mandatory.lines);
  let autoY = 0.3;
  const extra = lines.map((ln, i) => {
    const role = LINE_ROLES[ln.role] ? ln.role : "bullet";
    const preset = LINE_ROLES[role];
    const l = { x: 0.07, y: autoY, w: 0.86, align: preset.align, size: preset.size, ...(layout[`line${i}`] || {}) };
    autoY = clamp(l.y) + Number(preset.size) * 1.4;
    const text = String(ln.text || "").trim();
    return text ? {
      id: `line${i}`, role,
      text: (preset.prefix || "") + text,
      x: clamp(l.x) * W, y: clamp(l.y) * H, w: Math.max(40, clamp(l.w) * W),
      align: ["right", "center", "left"].includes(l.align) ? l.align : "right",
      size: Math.round(Math.min(0.14, Math.max(0.015, Number(l.size) || preset.size)) * H),
      color: "#ffffff", fontId: null, weight: preset.weight, shadow: true,
    } : null;
  }).filter(Boolean);
  return [...fixed, ...extra];
}

// ---------- validation ----------
function normalizePlan(p, mandatory, adStyle = "photo") {
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
  // A pure graphic/typographic ad can do without any AI-generated background — a full-frame panel covers it instead.
  if (bgs.length === 0 && !(adStyle === "graphic" && elements.length === 0)) {
    elements.unshift({ key: "background", kind: "background", name: "רקע", layout: { x: 0, y: 0, w: 1, h: 1 }, z: 0,
      prompt: `Background scene for an ad of ${mandatory.centerProduct || "the product"}, empty.` });
  } else if (bgs.length > 1) {
    bgs.slice(1).forEach((b) => { b.kind = "object"; b.layout = box({ x: 0.2, y: 0.2, w: 0.6, h: 0.6 }); });
  }
  elements = elements.slice(0, 12).map((e) => (e.kind === "background" ? { ...e, z: 0 } : { ...e, z: Math.max(1, e.z) }));
  const HEX = /^#[0-9a-f]{6}$/i;
  const panels = arr(p.panels).slice(0, 12).map((pn, i) => ({
    shape: pn.shape === "ellipse" ? "ellipse" : "rect",
    color: HEX.test(pn.color) ? pn.color : "#00000080",
    radius: Math.min(1, Math.max(0, Number(pn.radius) || 0)),
    label: pn.label ? String(pn.label).slice(0, 60) : null,
    layout: box(pn.layout),
    z: Number.isFinite(+pn.z) ? +pn.z : i,
  }));
  const text_layout = {};
  for (const r of TEXT_ROLES) if (p.text_layout?.[r]) text_layout[r] = p.text_layout[r];
  for (const k of Object.keys(p.text_layout || {})) if (/^line\d+$/.test(k)) text_layout[k] = p.text_layout[k];
  return {
    concept_title: String(p.concept_title || ""),
    composition: p.composition && typeof p.composition === "object" ? p.composition : {},
    style: { lighting: "", palette: "", lens: "", mood: "", ...(p.style || {}) },
    elements, panels, text_layout,
    logo: p.logo ? box(p.logo) : { x: 0.4, y: 0.9, w: 0.2, h: 0.07 },
  };
}

function mockPlan(concept, mandatory, adStyle = "photo") {
  const product = mandatory.centerProduct || "product";
  if (adStyle === "graphic") {
    return {
      concept_title: concept?.title || "",
      composition: { frame: "אנכי", product_placement: "—", camera_angle: "—", background: "פאנל צבע",
        lighting: "—", colors: "מותג הלקוח", depth_of_field: "—", logo_position: "תחתון",
        text_position: "כותרת עליונה, פרטים באמצע", hierarchy: "כותרת ← פרטים ← יצירת קשר", mood: "ברור ומיידי" },
      style: { lighting: "", palette: "brand colors", lens: "", mood: "clear and direct" },
      elements: [],
      panels: [
        { shape: "rect", color: "#1c2a4a", radius: 0, label: null, layout: { x: 0, y: 0, w: 1, h: 1 }, z: 0 },
        { shape: "rect", color: "#ffffff", radius: 0.08, label: null, layout: { x: 0.06, y: 0.38, w: 0.88, h: 0.3 }, z: 1 },
      ],
      text_layout: {},
      logo: { x: 0.4, y: 0.9, w: 0.2, h: 0.07 },
    };
  }
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
    panels: [],
    text_layout: {},
    logo: { x: 0.4, y: 0.9, w: 0.2, h: 0.07 },
  };
}

// ---------- Reference-ad decomposition (vision): learn from a real ad photo/scan ----------
// Splits a real ad image into the same vocabulary the app builds with (elements/panels/text lines), so it can be
// (a) explained as an MD "how this was built" writeup, and (b) used to seed a new ad's plan. See DECISIONS.md D35/D36.
async function decomposeReferenceAd({ apiKey, image }) {
  const prompt = `You are looking at a real advertisement (a photo or scan of a printed ad). Reverse-engineer how it was built.
Identify its archetype, then break it into the same building blocks this ad-creation tool uses:
- "elements": photographed/illustrated objects that would need to be generated or photographed separately (hero product, props, background scene). Empty if the ad is purely typographic/graphic.
- "panels": flat-color shapes (background fills, colored cards, ribbons, badges/stamps).
- "textLines": EVERY distinct piece of text in the ad, in reading order, each with a role (headline/subheadline/bullet/price/contact/disclaimer) and its EXACT text (transcribe verbatim, in the original language — do not translate or fix typos).

Return JSON:
{"archetype": "photo"|"graphic"|"hybrid",
 "summary_he": string (2-3 Hebrew sentences: what this ad is and why it works),
 "elements": [{"name_he": string, "kind": "background"|"object", "description_en": string}],
 "panels": [{"shape": "rect"|"ellipse", "color_hex": string, "role_he": string}],
 "textLines": [{"role": "headline"|"subheadline"|"bullet"|"price"|"contact"|"disclaimer", "text": string}],
 "concept_md": string (a Markdown recipe, IN HEBREW, titled with the business/offer name, that explains step by step how to
   recreate this ad in an ad-creation tool that works in layers: background/panels, then elements, then text lines, then logo —
   concrete enough that someone could follow it as instructions)}`;
  return generateJSON({
    apiKey, system: SYSTEM, prompt, images: [image],
    mock: () => ({
      archetype: "graphic",
      summary_he: "מודעה גרפית-טיפוגרפית: כותרת בולטת על פאנל צבע, רשימת פרטים, ופרטי יצירת קשר בתחתית.",
      elements: [],
      panels: [{ shape: "rect", color_hex: "#1c2a4a", role_he: "רקע מלא" }, { shape: "rect", color_hex: "#ffffff", role_he: "כרטיס טקסט מרכזי" }],
      textLines: [{ role: "headline", text: "(מוק) כותרת ראשית" }, { role: "contact", text: "(מוק) 050-0000000" }],
      concept_md: "# (מוק) שחזור מודעה\n\n1. רקע: פאנל בצבע כהה בכל הפריים.\n2. כרטיס לבן מעוגל במרכז.\n3. כותרת מודגשת למעלה.\n4. שורת יצירת קשר בתחתית.",
    }),
  });
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
  normalizePlan, decomposeReferenceAd, hierarchyBlock,
  BRIEF_FIELDS, MANDATORY_FIELDS, CLIENT_FIELDS, PRODUCT_FIELDS, CAMPAIGN_FIELDS, LINE_ROLES, ASPECTS, TEXT_ROLES,
};
