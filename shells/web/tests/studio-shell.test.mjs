import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("studio shell exposes four accessible work areas and real visual editors", async () => {
  const html = await readFile(new URL("synth.html", root), "utf8");
  const source = await readFile(new URL("synth-ui.js", root), "utf8");
  const css = await readFile(new URL("synth-ui.css", root), "utf8");
  assert.match(html, /role="tablist"/);
  for (const name of ["osc", "fx", "matrix", "match"]) {
    assert.match(html, new RegExp(`id="tab-${name}"[^>]*role="tab"`));
    assert.match(html, new RegExp(`id="panel-${name}"[^>]*role="tabpanel"`));
  }
  for (const graph of ["wave-a", "wave-b", "env-amp-graph", "env-filter-graph", "env-mod-graph", "lfo-graph", "lfo2-graph"]) {
    assert.match(html, new RegExp(`id="${graph}"`));
  }
  assert.match(source, /"mod-2": \[\{ id: 79/);
  assert.match(source, /80:lfoShapes/);
  assert.match(source, /\[46, 79\]\.includes\(parameter\.id\)/);
  assert.match(source, /"mod-env": \[\{ id: 85/);
  assert.match(source, /"performance-macros": \[\{ id: 73[\s\S]*id: 84/);
  assert.match(html, /3 ENV · 2 LFO · 4 Macro · 6 matrix slots/);
  assert.match(html, /id="mod-env"/);
  assert.match(source, /fxCoreParams/);
  assert.match(source, /node\.connect\(preparedOutputGate\)/);
  assert.match(source, /createSpaceEffects\(preparedContext, node, preparedOutputGate\)/);
  assert.doesNotMatch(source, /createInsertFxRack/);
  assert.match(css, /\.modulator-row \{ grid-template-columns:1fr 1fr; align-items:start;/);
  for (const name of ["amp", "filter", "modenv", "lfo1", "lfo2"]) {
    assert.match(html, new RegExp(`id="editor-tab-${name}"[^>]*role="tab"`));
    assert.match(html, new RegExp(`id="editor-${name}"[^>]*role="tabpanel"`));
  }
  assert.match(css, /@media \(max-width:760px\)[\s\S]*?\.oscillator-pair,.tone-row,.modulator-row,.time-effects \{ grid-template-columns:1fr; \}/);
  assert.match(source, /installEditorBanks/);
});

test("quality lab stays out of the normal surface and remains available by explicit query", async () => {
  const html = await readFile(new URL("synth.html", root), "utf8");
  const source = await readFile(new URL("synth-ui.js", root), "utf8");
  assert.match(html, /id="quality-lab"[^>]*hidden/);
  assert.match(source, /elements\["quality-lab"\]\.hidden = urlParams\.get\("quality"\) !== "1"/);
  for (const id of ["unison-quality-legacy", "unison-quality-focused", "fm-quality-legacy", "fm-quality-hq"])
    assert.match(html, new RegExp(`id="${id}"[^>]*aria-pressed`));
  assert.match(source, /\[\[9, 4\], \[20, 4\], \[15, 2\], \[26, 2\], \[76, 1\], \[77, 1\]\]/);
  assert.match(source, /\[\[78, 1\]\]/);
  assert.match(source, /stopAllNotes\(\)/);
});

test("reference match stays local and does not claim automatic patch generation", async () => {
  const html = await readFile(new URL("synth.html", root), "utf8");
  const source = await readFile(new URL("synth-ui.js", root), "utf8");
  assert.match(html, /id="match-file"[^>]*type="file"/);
  assert.match(html, /LOCAL ONLY/);
  assert.match(html, /現在のパッチを変更しません/);
  assert.match(html, /CANDIDATE · CORE DRY/);
  assert.match(html, /CANDIDATE PARAMETERS · MEASURED HYPOTHESIS/);
  assert.match(html, /id="match-amp-apply"[^>]*>APPLY DETECTED/);
  assert.match(html, /KEEP CURRENT/);
  assert.match(html, /CALIBRATED PARAMETER · CORE RESPONSE/);
  assert.match(html, /id="match-filter-apply"[^>]*>APPLY CUTOFF/);
  assert.match(html, /id="match-play-a"[^>]*>A REFERENCE/);
  assert.match(html, /id="match-play-b"[^>]*>B CURRENT/);
  assert.match(source, /analyzeSound/);
  assert.match(source, /OfflineAudioContext/);
  assert.match(source, /levelMatchGain/);
  assert.match(source, /suggestAmpEnvelope/);
  assert.match(source, /planFilterCutoffProbe/);
  assert.match(source, /estimateFilterCutoff/);
  assert.match(source, /decodeAudioData/);
  assert.doesNotMatch(source, /match[^\n]*(upload|sendBeacon)/i);
});

test("studio dials support vertical drag, fine control, reset, and direct entry", async () => {
  const source = await readFile(new URL("synth-ui.js", root), "utf8");
  assert.match(source, /pointermove/);
  assert.match(source, /event\.shiftKey \? \.1 : 1/);
  assert.match(source, /dblclick/);
  assert.match(source, /control-value-input/);
  assert.match(source, /input:not\(\[type="range"\]\)/);
  assert.match(source, /createEffectControl\("reverbDamping", "DAMPING", 0, 1\)/);
});

test("live output starts behind a safety gate and lost input focus kills held notes", async () => {
  const html = await readFile(new URL("synth.html", root), "utf8");
  const source = await readFile(new URL("synth-ui.js", root), "utf8");
  assert.match(source, /preparedOutputGate\.gain\.value = 0/);
  assert.match(source, /gain\.linearRampToValueAtTime\(1, at \+ \.025\)/);
  assert.match(source, /lostpointercapture/);
  assert.match(source, /pointerleave/);
  assert.match(source, /window\.addEventListener\("pointerup"[^\n]*true\)/);
  assert.match(source, /event\.key === "Escape"[^\n]*panicAudio\(\{ broadcast:true \}\)/);
  assert.match(source, /window\.addEventListener\("keyup"[\s\S]*?\}, true\);/);
  assert.match(html, /Z OCT− \/ X OCT\+/);
  assert.match(html, /id="keyboard-octave-state"[^>]*aria-live="polite"/);
  assert.match(source, /octaveDeltaForKeyboardEvent\(event\)/);
  assert.match(source, /panicAudio\(\);[\s\S]*keyboardOctave = next;[\s\S]*renderPiano\(\)/);
  assert.match(source, /activeKeyboardTokens\.get\(inputId\)/);
  assert.match(source, /ensureAudio\(\(\) => noteRegistry\.isPending\(ticket\)\)/);
  assert.match(source, /new BroadcastChannel\("synth-engine\.audio-session\.v1"\)/);
  assert.match(source, /postMessage\(\{ type:"claim", owner:audioSessionId \}\)/);
  assert.match(source, /window\.addEventListener\("blur", panicAudio\)/);
  assert.match(source, /document\.addEventListener\("visibilitychange"/);
});

test("each oscillator exposes four built-ins plus one session-only custom wavetable", async () => {
  const html = await readFile(new URL("synth.html", root), "utf8");
  const source = await readFile(new URL("synth-ui.js", root), "utf8");
  for (const name of ["Basic Shapes", "Analog Sweep", "Digital Edge", "Hollow Formant"])
    assert.match(source, new RegExp(name));
  assert.match(source, /Custom · Session/);
  assert.match(source, /CUSTOM_WAVETABLE_SLOT = 4/);
  assert.match(source, /customWavetable\.frameCount/);
  assert.match(source, /wavetableFrameSample\(slot, first/);
  assert.match(html, /4 BUILTIN WT \+ 1 SESSION/);
  assert.match(html, /id="load-wavetable"/);
  assert.match(html, /id="clear-wavetable"[^>]*disabled/);
  assert.match(html, /id="wavetable-frame-positions"/);
  assert.match(html, /id="wavetable-frame-position-a"/);
  assert.match(html, /id="wavetable-frame-position-b"/);
  assert.match(html, /LOCAL WAV · SESSION ONLY/);
  assert.match(source, /parseWavetableWav/);
  assert.match(source, /createSafeWavetableFrame\(\)/);
  assert.match(source, /REPLACE WAV/);
  assert.match(source, /clearCustomWavetable/);
  assert.match(source, /renderCustomWavetableFramePositions/);
  assert.match(source, /wavetableFramePosition/);
  assert.match(source, /F\$\{position\.firstFrame\} → F\$\{position\.secondFrame\}/);
  assert.match(source, /CLEARING · OUTPUT MUTED/);
  assert.match(source, /closeOutputGate\(\); node\.reset\(0\)/);
});

test("named patch save uses an in-page confirmation flow", async () => {
  const html = await readFile(new URL("synth.html", root), "utf8");
  const source = await readFile(new URL("synth-ui.js", root), "utf8");
  assert.match(html, /id="patch-save-panel"[^>]*role="dialog"/);
  assert.match(source, /saveReplacePending/);
  assert.doesNotMatch(source, /window\.(prompt|confirm|alert)\s*\(/);
});

test("autosave restoration keeps the visible preset identity aligned with the restored sound", async () => {
  const source = await readFile(new URL("synth-ui.js", root), "utf8");
  assert.match(source, /function syncPresetIdentity\(name, category\)/);
  assert.match(source, /syncPresetIdentity\(patch\.name, patch\.category\)/);
});
