"""Browser E2E: drives the real UI against a real server (GEMINI_MOCK=1, temp DB).
Usage: python3 e2e/run_e2e.py   (from repo root; builds nothing, expects web/dist)"""
import os, subprocess, tempfile, time, sys, struct, urllib.request, shutil
from playwright.sync_api import sync_playwright, expect

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get("E2E_PORT", "3100"))
BASE = f"http://127.0.0.1:{PORT}"
SHOTS = os.environ.get("E2E_SHOTS", os.path.join(ROOT, "e2e", "screenshots"))
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
os.makedirs(SHOTS, exist_ok=True)

data = tempfile.mkdtemp(prefix="adstudio-e2e-")
env = dict(os.environ, PORT=str(PORT), DATA_DIR=data, GEMINI_MOCK="1", APP_URL=f"http://localhost:{PORT}")
srv = subprocess.Popen(["node", "src/index.js"], cwd=os.path.join(ROOT, "server"), env=env,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
for _ in range(50):
    try: urllib.request.urlopen(BASE + "/api/health"); break
    except Exception: time.sleep(0.2)
else: print(srv.stdout.read().decode()); sys.exit("server did not start")

errors = []
def png_size(path):
    with open(path, "rb") as f: head = f.read(24)
    assert head[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    return struct.unpack(">II", head[16:24])

def step(name): print("•", name, flush=True)

import json, glob
def last_link(to):
    for f in sorted(glob.glob(os.path.join(data, "outbox", "*.json")), reverse=True):
        m = json.load(open(f, encoding="utf-8"))
        if m["to"] == to: return m["link"].replace("http://localhost:%d" % PORT, BASE)
    raise AssertionError(f"no mail to {to}")

try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True, locale="he-IL")
        # Google Fonts are unreachable from the sandbox — fail them fast instead of waiting.
        ctx.route("**/fonts.googleapis.com/**", lambda r: r.abort())
        ctx.route("**/fonts.gstatic.com/**", lambda r: r.abort())
        page = ctx.new_page()
        page.on("console", lambda m: m.type == "error" and "fonts.g" not in m.text and "ERR_FAILED" not in m.text and errors.append(m.text))
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.set_default_timeout(15000)

        step("register")
        page.goto(BASE + "/")
        expect(page).to_have_url(BASE + "/login?next=/")
        page.click("[data-test=toggle-mode]")
        page.fill("[data-test=name]", "דודי")
        page.fill("[data-test=email]", "dudi@example.com")
        page.fill("[data-test=password]", "password123")
        page.screenshot(path=f"{SHOTS}/01-register.png")
        page.click("[data-test=submit]")
        expect(page.locator("h1")).to_contain_text("הסטודיו של דודי")

        step("gemini key + font upload")
        page.click("text=הגדרות")
        page.fill("[data-test=gemini-key]", "mock-key-12345678")
        page.click("[data-test=save-key]")
        expect(page.locator("bdi")).to_have_text("••••5678")
        page.screenshot(path=f"{SHOTS}/02-settings.png", full_page=True)
        page.click("text=ספרייה")
        page.click("[data-test=tab-fonts]")
        page.set_input_files("[data-test=font-file]", FONT)
        page.fill("[data-test=font-family]", "Brand Bold")
        page.select_option("[data-test=font-weight]", "700")
        page.click("[data-test=upload-font]")
        expect(page.locator("[data-test='font-Brand Bold']")).to_be_visible()

        step("create project")
        page.click("text=מודעות")
        page.fill("[data-test=new-project-name]", "קפה עלית — בוקר")
        page.click("[data-test=new-project]")
        expect(page.locator("[data-test=brief-businessName]")).to_be_visible()

        step("step 1: brief + analysis")
        for k, v in {"businessName": "קפה עלית", "offering": "קפה שחור טחון", "audience": "משקי בית", "differentiators": "מסורת של דורות",
                     "tone": "חמימות", "goal": "מיתוג"}.items():
            page.fill(f"[data-test=brief-{k}]", v)
        page.click("[data-test=analyze]")
        expect(page.locator("[data-test=analysis]")).to_be_visible()
        page.screenshot(path=f"{SHOTS}/03-analysis.png", full_page=True)
        page.click("[data-test=next]")

        step("step 2: mandatory -> concepts")
        page.fill("[data-test=m-centerProduct]", "פינג'אן קפה שחור")
        page.fill("[data-test=m-slogan]", "הרגע ששווה לחכות לו")
        page.fill("[data-test=m-phone]", "03-1234567")
        page.click("[data-test=save-mandatory]")
        expect(page.locator("[data-test=concept-9]")).to_be_visible()
        page.screenshot(path=f"{SHOTS}/04-concepts.png", full_page=True)

        step("step 3-4: choose concept -> plan")
        page.click("[data-test=choose-0]")
        expect(page.locator("[data-test=run-critique]")).to_be_visible()
        page.screenshot(path=f"{SHOTS}/05-plan.png", full_page=True)

        step("step 5: critique -> accept revised")
        page.click("[data-test=run-critique]")
        expect(page.locator("[data-test=improvements] li").first).to_be_visible()
        page.screenshot(path=f"{SHOTS}/06-critique.png", full_page=True)
        page.click("[data-test=accept-revised]")

        step("step 6: generate/approve each element")
        expect(page.locator("[data-test=approved-count]")).to_have_text("0 / 3 אושרו")
        page.click("[data-test=gen-room]"); expect(page.locator("[data-test=approve-room]")).to_be_visible()
        page.fill("[data-test=feedback-room]", "יותר חם")
        page.click("[data-test=element-room] >> text=תיקון הגרסה הנבחרת")
        expect(page.locator("[data-test=element-room] .versions button")).to_have_count(2)
        page.click("[data-test=approve-room]")
        page.click("[data-test=gen-table]"); page.click("[data-test=approve-table]")
        # library picker for objects shows the just-approved table (auto-saved), not the background
        page.click("[data-test=library-product]")
        expect(page.locator(".modal .pick")).to_have_count(1)
        expect(page.locator(".modal .pick")).to_contain_text("שולחן")
        page.screenshot(path=f"{SHOTS}/07b-library-picker.png")
        page.click(".modal >> text=סגירה")
        # product: upload a real photo instead of generating
        upload = os.path.join(data, "pack.png"); shutil.copy(f"{SHOTS}/01-register.png", upload)
        page.set_input_files("[data-test=upload-product]", upload)
        page.click("[data-test=approve-product]")
        expect(page.locator("[data-test=approved-count]")).to_have_text("3 / 3 אושרו")
        page.screenshot(path=f"{SHOTS}/07-elements.png", full_page=True)
        page.click("[data-test=to-compose]")

        step("step 7: compose, drag, fuse, approve plate")
        box = page.locator("[data-test=box-e2]")  # table element
        expect(box).to_be_visible()
        b = box.bounding_box()
        page.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
        page.mouse.down(); page.mouse.move(b["x"] + b["width"] / 2 - 40, b["y"] + b["height"] / 2 - 30, steps=5); page.mouse.up()
        b2 = box.bounding_box()
        assert abs((b["x"] - b2["x"]) - 40) < 3, f"drag failed {b} -> {b2}"
        page.click("[data-test=save-compose]")
        page.wait_for_timeout(300)
        page.screenshot(path=f"{SHOTS}/08-compose.png", full_page=True)
        page.click("[data-test=fuse]")
        expect(page.locator(".plates figure")).to_have_count(2)  # collage + fused plate
        page.locator("[data-test^=choose-plate-]").last.click()   # oldest = collage? pick the plate
        expect(page.locator("[data-test=type-canvas]")).to_be_visible()

        step("step 8: font + logo + export")
        page.wait_for_timeout(500)
        page.locator("[data-test^=box-slogan]").click()
        expect(page.locator("[data-test=text-props]")).to_be_visible()
        opt = page.locator("[data-test=font-select] option", has_text="Brand Bold")
        page.select_option("[data-test=font-select]", opt.get_attribute("value"))
        page.set_input_files("[data-test=logo-file]", upload)
        expect(page.locator("[data-test=box-logo]")).to_be_visible()
        # font actually loaded in the document?
        assert page.evaluate("() => [...document.fonts].some(f => f.family.startsWith('uf') && f.status === 'loaded')"), "user font not loaded"
        page.wait_for_timeout(500)
        page.screenshot(path=f"{SHOTS}/09-type.png", full_page=True)
        with page.expect_download() as dl:
            page.click("[data-test=export]")
        out = os.path.join(data, "export.png"); dl.value.save_as(out)
        w, h = png_size(out)
        assert (w, h) == (1080, 1350), (w, h)
        shutil.copy(out, f"{SHOTS}/10-export.png")

        step("library shows the auto-saved elements")
        page.click("text=ספרייה")
        expect(page.locator("[data-test=elements-grid] li")).to_have_count(3)
        page.screenshot(path=f"{SHOTS}/11-library.png", full_page=True)

        step("usage + email invitation to a new user")
        page.click("text=ניהול ארגון")
        expect(page.locator("[data-test=usage]")).to_contain_text("תמונות")
        page.fill("[data-test=invite-email]", "shmuel@example.com"); page.click("[data-test=invite]")
        expect(page.locator("[data-test=pending-invites]")).to_contain_text("shmuel@example.com")
        page.screenshot(path=f"{SHOTS}/12-org.png", full_page=True)
        link = last_link("shmuel@example.com")
        page.click("text=יציאה")
        page.goto(link)
        expect(page.locator("h1")).to_have_text("הזמנה לארגון")
        page.screenshot(path=f"{SHOTS}/13-invite.png")
        page.click("[data-test=invite-register]")
        assert page.input_value("[data-test=email]") == "shmuel@example.com"
        page.fill("[data-test=name]", "שמואל"); page.fill("[data-test=password]", "password123")
        page.click("[data-test=submit]")
        page.click("[data-test=accept-invite]")
        expect(page.locator(".card", has_text="קפה עלית")).to_be_visible()
        expect(page.locator("[data-test=org-switch] option")).to_have_count(2)
        page.screenshot(path=f"{SHOTS}/14-shared-project.png", full_page=True)
        # org font is available to every member
        page.click("text=ספרייה"); page.click("[data-test=tab-fonts]")
        expect(page.locator("[data-test='font-Brand Bold']")).to_be_visible()

        step("password reset by email")
        page.click("text=יציאה")
        page.click("[data-test=forgot-link]")
        page.fill("[data-test=forgot-email]", "dudi@example.com"); page.click("[data-test=forgot-submit]")
        expect(page.locator("[data-test=forgot-sent]")).to_be_visible()
        page.goto(last_link("dudi@example.com"))
        page.fill("[data-test=reset-pw]", "brand-new-pass"); page.fill("[data-test=reset-pw2]", "brand-new-pass")
        page.click("[data-test=reset-submit]")
        expect(page.locator("h1")).to_contain_text("המודעות של")
        page.click("text=יציאה")
        page.fill("[data-test=email]", "dudi@example.com"); page.fill("[data-test=password]", "brand-new-pass"); page.click("[data-test=submit]")
        expect(page.locator("h1")).to_contain_text("המודעות של")

        browser.close()
    if errors:
        print("Console errors:", *errors, sep="\n  "); sys.exit(1)
    print("E2E PASSED")
finally:
    srv.terminate()
    shutil.rmtree(data, ignore_errors=True)
