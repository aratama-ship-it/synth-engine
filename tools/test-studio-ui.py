"""Local UI regression checks. Uses an isolated Playwright context; never the user's storage.
Run with a Python environment containing Playwright and a running tools/serve.mjs.
"""
import argparse
import importlib.util
import json
import math
import struct
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://127.0.0.1:8963/shells/web/synth.html?m4r=1")
parser.add_argument("--out", type=Path, default=Path("design/verify/m4r-custom-wavetable-20260908"))
parser.add_argument("--design-lint", type=Path)
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)
checks = []


def passed(name):
    checks.append(name)
    print(f"PASS {name}", flush=True)


def wavetable_wav():
    samples = [round(math.sin(index / 2048 * math.tau) * 0.75 * 32767) for index in range(2048)]
    payload = struct.pack("<" + "h" * len(samples), *samples)
    return (
        b"RIFF" + struct.pack("<I", 36 + len(payload)) + b"WAVE"
        + b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, 48000, 96000, 2, 16)
        + b"data" + struct.pack("<I", len(payload)) + payload
    )


with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={"width": 1440, "height": 900}, service_workers="block")
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(args.url, wait_until="networkidle")
    expect(page.locator("#status")).not_to_have_class("status error")
    expect(page.locator("#wave-picker-a select")).to_have_value("0")
    expect(page.locator("#quality-lab")).to_be_hidden()
    expect(page.locator("#patch-tools")).to_be_hidden()
    passed("Ready, wave picker, secondary tools initially hidden")

    expect(page.locator("#wavetable-import-state")).to_have_text("NOT LOADED")
    page.locator("#wave-picker-a select").select_option("4")
    expect(page.locator("#wave-picker-a select")).to_have_value("0")
    expect(page.locator("#wavetable-import-state")).to_have_text("LOAD WAV FIRST")
    page.locator("#wavetable-file").set_input_files({
        "name": "m4r-test.wav", "mimeType": "audio/wav", "buffer": wavetable_wav()
    })
    expect(page.locator("#wavetable-import-state")).to_contain_text("READY", timeout=10000)
    expect(page.locator("#status")).to_contain_text("出力はミュート中")
    page.locator("#wave-picker-a select").select_option("4")
    expect(page.locator("#wave-picker-a select")).to_have_value("4")
    page.screenshot(path=str(args.out / "custom-wavetable.png"))
    page.locator("#wave-picker-a select").select_option("0")
    passed("Custom WAV import is guarded, acknowledged, session-only, and remains muted")

    def patch():
        return page.evaluate("JSON.parse(localStorage.getItem('synth-engine.studio.autosave.v1'))")

    def open_position():
        page.locator("#tab-osc").click()
        page.locator('#osc-a [data-param-id="1"] .mod-assign').click()
        expect(page.locator("#mod-dialog")).to_be_visible()

    baseline = patch()
    page.locator("#patch-tools-toggle").click()
    page.locator("#preset-search").fill("Bell")
    expect(page.locator("#preset")).to_have_value("epiano")
    assert patch() == baseline
    page.locator("#preset-search").fill("unmatched-name")
    expect(page.locator("#preset option:checked")).to_contain_text("EPiano")
    assert patch() == baseline
    page.locator("#preset-search").fill("")
    page.locator("#patch-tools-toggle").click()
    passed("Preset search filters choices without mislabeling or changing the current sound")
    open_position()
    page.locator("#mod-dialog-source").select_option("9")
    page.locator("#mod-dialog-cancel").click()
    assert patch() == baseline
    expect(page.locator('#osc-a [data-param-id="1"] .mod-assign')).to_be_focused()
    passed("Cancel makes no patch change and restores destination focus")

    open_position()
    page.locator("#mod-dialog-source").select_option("9")
    amount = page.locator("#mod-dialog-amount")
    amount.press("Home")
    for _ in range(25):
        amount.press("ArrowRight")
    expect(page.locator("#mod-dialog-amount-value")).to_have_text("-75%")
    page.screenshot(path=str(args.out / "mod-dialog.png"))
    page.locator("#mod-dialog-apply").click()
    assigned = patch()
    assert assigned != baseline
    expect(page.locator('#osc-a [data-param-id="1"] .mod-assign')).to_have_text("MOD · 1")
    page.locator("#undo").click()
    assert patch() == baseline
    page.locator("#redo").click()
    assert patch() == assigned
    passed("Signed assignment is one Undo/Redo step")

    open_position()
    expect(amount).to_have_value("-0.75")
    expect(page.locator("#mod-dialog-apply")).to_have_text("UPDATE")
    page.locator("#mod-dialog-routes button").click()
    expect(page.locator("#mod-dialog-routes button")).to_have_count(0)
    page.locator("#mod-dialog-source").press("Escape")
    expect(page.locator("#mod-dialog")).to_be_hidden()
    assert patch() == baseline
    page.locator("#undo").click()
    assert patch() == assigned
    passed("Existing connection, remove, Escape, Undo")

    page.locator("#editor-tab-amp").press("End")
    expect(page.locator("#editor-modenv")).to_be_visible()
    expect(page.locator("#editor-amp")).to_be_hidden()
    page.locator("#editor-tab-modenv").press("Home")
    expect(page.locator("#editor-amp")).to_be_visible()
    page.locator("#tab-matrix").click()
    page.locator("#edit-mod-envelope").click()
    expect(page.locator("#editor-tab-modenv")).to_be_focused()
    expect(page.locator("#editor-modenv")).to_be_visible()
    passed("ENV tab keyboard navigation and Matrix → ENV 3 edit link")

    page.locator("#tab-fx").click()
    page.get_by_role("button", name="DISTORTION 有効", exact=True).click()
    expect(page.get_by_role("button", name="DISTORTION 有効", exact=True)).to_have_attribute("aria-pressed", "true")
    page.get_by_role("button", name="DISTORTIONを後へ", exact=True).click()
    expect(page.get_by_role("button", name="DISTORTIONを後へ", exact=True)).to_be_focused()
    assert page.locator(".insert-card").nth(1).get_attribute("data-effect") == "distortion"
    page.wait_for_timeout(250)  # App autosave debounce (180 ms), not an interaction wait.
    fx_patch = patch()
    page.reload(wait_until="networkidle")
    assert patch() == fx_patch
    page.locator("#tab-fx").click()
    expect(page.get_by_role("button", name="DISTORTION 有効", exact=True)).to_have_attribute("aria-pressed", "true")
    assert page.locator(".insert-card").nth(1).get_attribute("data-effect") == "distortion"
    passed("FX toggle, reorder focus, and exact autosave reload")
    page.get_by_label("Delay 有効", exact=True).check()
    expect(page.locator("#effect-delayOn .toggle span")).to_have_text("ON")
    page.get_by_label("Delay 有効", exact=True).uncheck()
    expect(page.locator("#effect-delayOn .toggle span")).to_have_text("BYPASS")
    passed("Delay state is explicit and operable")

    # Fill the six shared slots, then prove a seventh new route cannot overwrite them.
    page.locator("#tab-matrix").click()
    for index in range(6):
        page.get_by_label(f"SOURCE {index + 1}", exact=True).select_option("1")
        page.get_by_label(f"DESTINATION {index + 1}", exact=True).select_option(str(index + 1))
    page.wait_for_timeout(250)
    full = patch()
    open_position()
    page.locator("#mod-dialog-source").select_option("10")
    expect(page.locator("#mod-dialog-apply")).to_be_disabled()
    expect(page.locator("#mod-dialog-state")).to_contain_text("6枠すべて使用中")
    page.locator("#mod-dialog-cancel").click()
    assert patch() == full
    passed("Full matrix rejects new assignment without overwriting any slot")

    dimensions = []
    for width in [390, 768, 1024, 1172, 1440]:
        page.set_viewport_size({"width": width, "height": 900})
        for tab in ["osc", "fx", "matrix", "match"]:
            page.locator(f"#tab-{tab}").click()
            size = page.evaluate("({width:innerWidth, scroll:document.documentElement.scrollWidth, height:document.documentElement.scrollHeight})")
            assert size["scroll"] <= width, (width, tab, size)
            dimensions.append({"tab": tab, **size})
    passed("No horizontal page overflow: four tabs at five viewport widths")
    page.set_viewport_size({"width": 390, "height": 844})
    open_position()
    assert page.locator("#mod-dialog").bounding_box()["width"] <= 358
    page.screenshot(path=str(args.out / "mod-dialog-mobile.png"))
    page.locator("#mod-dialog-cancel").click()
    page.locator("#patch-tools-toggle").click()
    assert page.evaluate("document.documentElement.scrollWidth") == 390
    passed("Narrow-screen dialog and expanded patch tools stay within viewport")

    assert not errors, errors
    passed("No browser JavaScript errors")
    context.close()

    if args.design_lint:
        spec = importlib.util.spec_from_file_location("studio_design_lint", args.design_lint)
        lint = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(lint)
        for tab in ["osc", "fx", "matrix", "match"]:
            target = {"name": f"SynthEngine M4r {tab.upper()}", "url": args.url + f"&tab={tab}", "note": "Custom wavetable UI; fresh context, no listening claim"}
            out = args.out / tab
            results = lint.run_target(browser, target, out, [(390, 844), (1440, 900)])
            lint.write_report(target, results, out)
            assert lint.finding_count(results, "NG") == 0, f"{tab}: design-lint NG"
        passed("design-lint: four tabs × mobile/desktop, no NG")
    browser.close()

(args.out / "interaction-results.json").write_text(json.dumps({"time": datetime.now().isoformat(), "checks": checks, "dimensions": dimensions, "errors": errors}, ensure_ascii=False, indent=2) + "\n")
print(f"{len(checks)} groups passed; artifacts: {args.out}")
