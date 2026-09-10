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
from urllib.parse import urlsplit, urlunsplit
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://127.0.0.1:8963/shells/web/synth.html?m4t=1")
parser.add_argument("--out", type=Path, default=Path("design/verify/m4t-wavetable-frame-position-20260908"))
parser.add_argument("--design-lint", type=Path)
parser.add_argument("--bridge-only", action="store_true")
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)
checks = []


def passed(name):
    checks.append(name)
    print(f"PASS {name}", flush=True)


def wavetable_wav(frame_count=1):
    samples = [
        round(math.sin(index / 2048 * math.tau) * (0.45 + frame * 0.1) * 32767)
        for frame in range(frame_count)
        for index in range(2048)
    ]
    payload = struct.pack("<" + "h" * len(samples), *samples)
    return (
        b"RIFF" + struct.pack("<I", 36 + len(payload)) + b"WAVE"
        + b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, 48000, 96000, 2, 16)
        + b"data" + struct.pack("<I", len(payload)) + payload
    )


with sync_playwright() as p:
    browser = p.chromium.launch()
    target = urlsplit(args.url)
    bridge_base = urlunsplit((target.scheme, target.netloc, target.path, "", ""))
    bridge_candidates = {
        "pianofy": "Serum 2 · LD - Pianofy",
        "morpheus": "Serum 2 · BA - Morpheus",
        "neon-drive": "Serum 2 · BA - Neon Drive",
    }
    for bridge_id, patch_name in bridge_candidates.items():
        bridge_context = browser.new_context(viewport={"width": 1440, "height": 900}, service_workers="block")
        bridge_page = bridge_context.new_page()
        bridge_errors = []
        bridge_page.on("pageerror", lambda error: bridge_errors.append(str(error)))
        if bridge_id == "pianofy":
            bridge_page.goto(f"{bridge_base}?m4av=1", wait_until="networkidle")
            bridge_page.evaluate("""() => {
                const key = "synth-engine.studio.autosave.v1";
                const patch = JSON.parse(localStorage.getItem(key));
                patch.name = "STALE AUTOSAVE";
                localStorage.setItem(key, JSON.stringify(patch));
            }""")
        bridge_page.goto(
            f"{bridge_base}?m4av=1&tab=osc&bridgePreset={bridge_id}",
            wait_until="networkidle",
        )
        expect(bridge_page.locator("#status")).to_contain_text(f"{patch_name}をPreset Bridgeから読み込みました")
        expect(bridge_page.locator("#status")).to_contain_text("出力はミュート中")
        expect(bridge_page.locator("#preset option:checked")).to_contain_text(patch_name)
        assert "bridgePreset" not in bridge_page.url
        loaded_patch = bridge_page.evaluate("JSON.parse(localStorage.getItem('synth-engine.studio.autosave.v1'))")
        assert loaded_patch["name"] == patch_name
        loaded_core = dict(loaded_patch["core"])
        assert loaded_core[7] <= 0.2
        assert loaded_patch["space"]["delayOn"] is False
        assert loaded_patch["space"]["reverbOn"] is False
        assert loaded_patch["fx"]["modules"]["distortion"]["on"] is True
        assert loaded_patch["fx"]["modules"]["distortion"]["drive"] <= 0.24
        assert loaded_patch["fx"]["modules"]["distortion"]["mix"] <= 0.2
        if bridge_id == "pianofy":
            assert [(loaded_core[base], loaded_core[base + 1]) for base in range(55, 73, 3)] == [
                (11, 8), (3, 7), (3, 1), (3, 2), (7, 14), (6, 8)
            ]
        assert not bridge_errors, bridge_errors
        if bridge_id == "pianofy":
            bridge_page.screenshot(path=str(args.out / "bridge-pianofy-1440.png"), full_page=True)
            bridge_page.set_viewport_size({"width": 390, "height": 844})
            assert bridge_page.evaluate("document.documentElement.scrollWidth") == 390
            bridge_page.screenshot(path=str(args.out / "bridge-pianofy-390.png"), full_page=True)
        bridge_context.close()
    passed("Preset Bridge: three candidates override autosave, load in one action, stay muted, and clear the one-shot query")

    unknown_context = browser.new_context(viewport={"width": 1440, "height": 900}, service_workers="block")
    unknown_page = unknown_context.new_page()
    unknown_requests = []
    unknown_page.on("request", lambda request: unknown_requests.append(request.url))
    unknown_page.goto(f"{bridge_base}?m4av=1&tab=osc&bridgePreset=unknown", wait_until="networkidle")
    expect(unknown_page.locator("#status")).to_have_class("status error")
    expect(unknown_page.locator("#status")).to_contain_text("未知のPreset Bridge候補")
    expect(unknown_page.locator("#preset option:checked")).to_contain_text("EPiano")
    assert "bridgePreset=unknown" in unknown_page.url
    assert not any("audition-mod-fx-v2/unknown" in request for request in unknown_requests)
    unknown_context.close()
    passed("Preset Bridge: unknown IDs make no arbitrary preset request and keep EPiano")

    safety_context = browser.new_context(service_workers="block")
    safety_page = safety_context.new_page()
    safety_url = urlunsplit((target.scheme, target.netloc, "/shells/web/tests/preset-bridge-fx-safety.html", "", ""))
    safety_page.goto(safety_url, wait_until="networkidle")
    expect(safety_page.locator("body")).to_have_attribute("data-status", "pass", timeout=30000)
    safety_result = safety_page.evaluate("window.__PRESET_BRIDGE_FX_SAFETY_RESULT__")
    assert safety_result["physicalOutput"].startswith("not connected")
    assert all(item["all"]["peak"] <= 0.25 for item in safety_result["results"])
    assert all(item["tail"]["peak"] <= 1e-7 for item in safety_result["results"])
    safety_context.close()
    passed("Preset Bridge: three safe distortion candidates render offline within peak and release-tail ceilings")

    if args.bridge_only:
        browser.close()
        (args.out / "interaction-results.json").write_text(json.dumps({
            "time": datetime.now().isoformat(),
            "checks": checks,
            "errors": [],
        }, ensure_ascii=False, indent=2) + "\n")
        print(f"{len(checks)} groups passed; artifacts: {args.out}")
        raise SystemExit(0)

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
        "name": "m4t-four-frame-test.wav", "mimeType": "audio/wav", "buffer": wavetable_wav(4)
    })
    expect(page.locator("#wavetable-import-state")).to_contain_text("READY", timeout=10000)
    expect(page.locator("#status")).to_contain_text("出力はミュート中")
    expect(page.locator("#load-wavetable")).to_have_text("REPLACE WAV")
    expect(page.locator("#clear-wavetable")).to_be_enabled()
    page.locator("#wave-picker-a select").select_option("4")
    expect(page.locator("#wave-picker-a select")).to_have_value("4")
    expect(page.locator("#wavetable-frame-positions")).to_be_visible()
    expect(page.locator("#wavetable-frame-position-a")).to_contain_text("F1")
    expect(page.locator("#wavetable-frame-position-b")).to_contain_text("OTHER WT")
    page.locator('#osc-a [data-param-id="1"] input[type="range"]').evaluate(
        "element => { element.value = '0.5'; element.dispatchEvent(new Event('input', { bubbles:true })); }")
    expect(page.locator("#wavetable-frame-position-a")).to_contain_text("F2 → F3 · 50%")
    page.locator("#wave-picker-b select").select_option("4")
    page.locator('#osc-b [data-param-id="18"] input[type="range"]').evaluate(
        "element => { element.value = '1'; element.dispatchEvent(new Event('input', { bubbles:true })); }")
    expect(page.locator("#wavetable-frame-position-b")).to_contain_text("F4")
    page.screenshot(path=str(args.out / "custom-wavetable-frame-position.png"))
    page.set_viewport_size({"width": 390, "height": 844})
    assert page.evaluate("document.documentElement.scrollWidth") == 390
    page.screenshot(path=str(args.out / "custom-wavetable-frame-position-mobile.png"))
    page.set_viewport_size({"width": 1440, "height": 900})
    page.screenshot(path=str(args.out / "custom-wavetable.png"))
    page.locator("#clear-wavetable").click()
    expect(page.locator("#wavetable-import-state")).to_have_text("NOT LOADED")
    expect(page.locator("#wave-picker-a select")).to_have_value("0")
    expect(page.locator("#load-wavetable")).to_have_text("LOAD WAV")
    expect(page.locator("#clear-wavetable")).to_be_disabled()
    expect(page.locator("#wavetable-frame-positions")).to_be_hidden()
    passed("Custom WAV frame position fits desktop/mobile; replace state, clear fallback, and muted output are guarded")

    def patch():
        return page.evaluate("JSON.parse(localStorage.getItem('synth-engine.studio.autosave.v1'))")

    def open_position():
        page.locator("#tab-osc").click()
        page.locator('#osc-a [data-param-id="1"] .mod-assign').click()
        expect(page.locator("#mod-dialog")).to_be_visible()

    page.wait_for_timeout(250)  # CLEAR returns OSC selectors to Basic Shapes through the 180 ms autosave debounce.
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
            target = {"name": f"SynthEngine M4t {tab.upper()}", "url": args.url + f"&tab={tab}", "note": "Custom WT frame position UI; fresh context, no listening claim"}
            out = args.out / tab
            results = lint.run_target(browser, target, out, [(390, 844), (1440, 900)])
            lint.write_report(target, results, out)
            assert lint.finding_count(results, "NG") == 0, f"{tab}: design-lint NG"
        passed("design-lint: four tabs × mobile/desktop, no NG")
    browser.close()

(args.out / "interaction-results.json").write_text(json.dumps({"time": datetime.now().isoformat(), "checks": checks, "dimensions": dimensions, "errors": errors}, ensure_ascii=False, indent=2) + "\n")
print(f"{len(checks)} groups passed; artifacts: {args.out}")
