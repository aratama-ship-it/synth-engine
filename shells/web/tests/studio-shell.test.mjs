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
  assert.match(source, /"voice-controls": \[\{ id: 8, label: "VOICES" \}, \{ id: 113, label: "MODE", type: "select", options: \["POLY", "MONO", "LEGATO"\], releaseKeyboardFocus:true \}, \{ id: 114, label: "GLIDE" \}\]/);
  assert.match(html, /class="performance-voice" aria-label="発音モードとグライド"/);
  assert.match(html, /id="voice-controls" class="global-controls" aria-label="発音モードとグライド"/);
  assert.match(css, /\.performance-controls \{ min-width:0; display:grid; grid-template-columns:minmax\(248px,1fr\) auto;/);
  assert.match(css, /\.performance-voice \.global-controls \{ display:grid; grid-template-columns:repeat\(3,minmax\(0,1fr\)\);/);
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

test("shared EQ exposes frequency, Q, and a DSP-derived response curve", async () => {
  const source = await readFile(new URL("synth-ui.js", root), "utf8");
  const css = await readFile(new URL("synth-ui.css", root), "utf8");
  assert.match(source, /id:"lowFrequency",label:"LOW FREQ",min:40,max:600,scale:"log"/);
  assert.match(source, /id:"midFrequency",label:"MID FREQ",min:200,max:8000,scale:"log"/);
  assert.match(source, /id:"midQ",label:"MID Q",min:\.25,max:8/);
  assert.match(source, /id:"highFrequency",label:"HIGH FREQ",min:1500,max:18000,scale:"log"/);
  assert.match(source, /eqResponsePath\(module\)/);
  assert.match(source, /FILTER RESPONSE · SETTING/);
  assert.match(css, /\.eq-response-plot \{[^}]*height:var\(--eq-plot-height\)/);
  assert.match(css, /\.insert-card\[data-effect="eq"\] \.insert-controls \{ grid-template-columns:repeat\(4,minmax\(100px,1fr\)\); \}/);
});

test("quality lab stays out of the normal surface and remains available by explicit query", async () => {
  const html = await readFile(new URL("synth.html", root), "utf8");
  const source = await readFile(new URL("synth-ui.js", root), "utf8");
  assert.match(html, /id="quality-lab"[^>]*hidden/);
  assert.match(source, /elements\["quality-lab"\]\.hidden = urlParams\.get\("quality"\) !== "1"/);
  for (const id of ["unison-quality-legacy", "unison-quality-focused", "fm-quality-legacy", "fm-quality-hq", "unison-density-focus", "unison-density-balanced", "unison-density-full", "unison-density-wide", "osc-warp-bend-negative", "osc-warp-off", "osc-warp-bend-positive"])
    assert.match(html, new RegExp(`id="${id}"[^>]*aria-pressed`));
  assert.match(source, /\[\[9, 4\], \[20, 4\], \[15, 2\], \[26, 2\], \[76, 1\], \[77, 1\]\]/);
  assert.match(source, /\[\[78, 1\]\]/);
  assert.match(html, /id="unison-density-focus"[^>]*>2\.0 FOCUS/);
  assert.match(html, /id="unison-density-balanced"[^>]*>3\.0 BALANCED/);
  assert.match(html, /id="unison-density-full"[^>]*aria-pressed="true"[^>]*>4\.0 FULL/);
  assert.match(html, /id="unison-density-wide"[^>]*>5\.0 WIDE\+/);
  assert.doesNotMatch(html, /id="unison-density"[^>]*type="range"/);
  assert.match(source, /qualityParamIds = new Set\(\[76, 77, 78, 115, 116, 117, 118, 119, 120\]\)/);
  assert.match(source, /2 \+ 2 \* density \* density/);
  assert.match(source, /density:Math\.sqrt\(1\.5\)/);
  assert.match(source, /function applyUnisonDensityMode\(mode\)[\s\S]*setValue\(115, mode\.density\);[\s\S]*setValue\(116, mode\.density\)/);
  assert.doesNotMatch(source, /function applyUnisonDensityMode\(mode\)[\s\S]{0,240}stopAllNotes/);
  assert.match(html, /id="osc-warp-off"[^>]*aria-pressed="true"[^>]*>OFF/);
  assert.match(source, /amount:-\.75[\s\S]*amount:0[\s\S]*amount:\.75/);
  assert.match(source, /function applyOscWarpMode\(mode\)[\s\S]*setValue\(119, 0\);[\s\S]*setValue\(120, 0\);[\s\S]*setValue\(117, mode\.amount\);[\s\S]*setValue\(118, mode\.amount\)/);
  assert.doesNotMatch(source, /function applyOscWarpMode\(mode\)[\s\S]{0,260}(stopAllNotes|\.reset\()/);
  assert.match(source, /oscillatorWarpPhase\(x \* 2, warp, warpMode\)/);
  assert.match(source, /stopAllNotes\(\)/);
});

test("normal oscillator surface exposes independent Warp mode and signed amount without resetting notes", async () => {
  const html = await readFile(new URL("synth.html", root), "utf8");
  const source = await readFile(new URL("synth-ui.js", root), "utf8");
  const css = await readFile(new URL("synth-ui.css", root), "utf8");
  for (const slot of ["a", "b"]) {
    assert.match(html, new RegExp(`id="osc-warp-mode-${slot}"[^>]*aria-label`));
    assert.match(html, new RegExp(`id="osc-warp-amount-${slot}"`));
    assert.match(html, new RegExp(`id="osc-warp-state-${slot}"`));
  }
  assert.match(html, /<option value="off">OFF<\/option><option value="bend">BEND<\/option><option value="asym">ASYM<\/option><option value="sync">SYNC<\/option>/);
  assert.match(source, /\{ slot:"a", label:"A", paramId:117, modeParamId:119 \}/);
  assert.match(source, /\{ slot:"b", label:"B", paramId:118, modeParamId:120 \}/);
  assert.match(source, /lastNonZeroWarp = new Map/);
  assert.match(source, /selectedMode === "off" \? 0 : lastNonZeroWarp\.get\(surface\.paramId\) \?\? \.75/);
  assert.match(source, /setValue\(surface\.modeParamId, oscWarpModeNames\.indexOf\(selectedMode\)\)/);
  assert.match(source, /Math\.pow\(2, 2 \* amount\)/);
  assert.match(source, /mode === 2[\s\S]*localPhase \* ratio/);
  assert.match(source, /oscWarpSurfaces\.forEach\(\(\{ slot, paramId \}\) => elements\[`osc-warp-amount-\$\{slot\}`\]\.append\(createControl\(\{ id:paramId, label:"AMOUNT" \}\)\)\)/);
  assert.doesNotMatch(source, /function installOscWarpSurface\(\)[\s\S]{0,900}(stopAllNotes|\.reset\(|ensureAudio\()/);
  assert.match(css, /\.osc-warp-mode select \{[^}]*min-height:44px/);
  assert.match(css, /\.osc-warp-amount \.dial \{ --dial-size:44px; \}/);
});

test("Patch Tools exposes the preset bridge only on localhost without claiming compatible playback", async () => {
  const html = await readFile(new URL("synth.html", root), "utf8");
  const source = await readFile(new URL("synth-ui.js", root), "utf8");
  const css = await readFile(new URL("synth-ui.css", root), "utf8");
  assert.match(html, /id="preset-bridge"[^>]*href="\.\.\/\.\.\/design\/preset-bridge-20260909\/index\.html"[^>]*hidden[^>]*>PRESET BRIDGE<\/a>/);
  assert.match(source, /isLocalPreview = \["127\.0\.0\.1", "localhost", "\[::1\]"\]\.includes\(window\.location\.hostname\)/);
  assert.match(source, /elements\["preset-bridge"\]\.hidden = !isLocalPreview/);
  assert.match(css, /\.patch-tools \.button-link \{[^}]*display:inline-flex;[^}]*min-height:44px/);
  assert.doesNotMatch(html, /IMPORT (SERUM|MASSIVE|AVENGER)/i);
});

test("local preset bridge loader keeps three allowlisted audition patch IDs", async () => {
  const html = await readFile(new URL("synth.html", root), "utf8");
  const source = await readFile(new URL("synth-ui.js", root), "utf8");
  const candidates = [
    ["pianofy", "pianofy.synthengine.json"],
    ["morpheus", "morpheus-bass.synthengine.json"],
    ["neon-drive", "neon-drive-sync.synthengine.json"],
  ];
  for (const [id, file] of candidates) {
    assert.match(source, new RegExp(`(?:"${id}"|${id}):"/design/preset-bridge-20260909/audition-mod-fx-v2/${file.replaceAll(".", "\\.")}"`));
  }
  assert.match(source, /if \(!isLocalPreview\) throw new Error\("Preset Bridgeはlocalhost専用です"\)/);
  assert.match(source, /Object\.hasOwn\(bridgeAuditionPresets, id\)/);
  assert.match(source, /parsePatch\(await fetchChecked\(bridgeAuditionPresets\[id\], "text"\)\)/);
  assert.match(source, /requestedBridgePreset !== null[\s\S]*loadBridgeAuditionPreset\(requestedBridgePreset\)[\s\S]*else if \(savedAutosave\)/);
  assert.match(source, /cleanUrl\.searchParams\.delete\("bridgePreset"\)[\s\S]*history\.replaceState/);
  assert.match(html, /synth-ui\.js\?m4ax=1/);
  const loader = source.match(/async function loadBridgeAuditionPreset\(id\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.doesNotMatch(loader, /ensureAudio|startNote|openOutputGate/);
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
  assert.match(source, /filterModeNames = Object\.freeze\(\["LP12", "BP12", "HP12", "NOTCH", "LP24", "HP24"\]\)/);
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
  assert.match(source, /definition\.releaseKeyboardFocus\) input\.blur\(\)/);
  assert.match(source, /normalizedParameterValue\(parameter, numeric\)/);
  assert.match(source, /\(parameter\.flags & 1\) !== 0 \? Math\.round\(bounded\) : bounded/);
  assert.match(source, /values\.set\(id, normalizedParameterValue\(parameter, value\)\)/);
  assert.match(source, /ensureAudio\(\(\) => noteRegistry\.isPending\(ticket\)\)/);
  assert.match(source, /new BroadcastChannel\("synth-engine\.audio-session\.v1"\)/);
  assert.match(source, /postMessage\(\{ type:"claim", owner:audioSessionId \}\)/);
  assert.match(source, /window\.addEventListener\("blur", panicAudio\)/);
  assert.match(source, /document\.addEventListener\("visibilitychange"/);
});

test("visible emergency stop fixes the output gate at zero and suspends live audio", async () => {
  const html = await readFile(new URL("synth.html", root), "utf8");
  const source = await readFile(new URL("synth-ui.js", root), "utf8");
  const css = await readFile(new URL("synth-ui.css", root), "utf8");
  assert.match(html, /id="panic-audio"[^>]*aria-label="音をただちに停止"[^>]*>STOP SOUND/);
  assert.match(css, /\.button-emergency \{ border-color:var\(--color-filter\); color:var\(--color-bg\); background:var\(--color-filter\); font-weight:700; \}/);
  assert.match(source, /function closeOutputGate\(\) \{[\s\S]*?gain\.cancelScheduledValues\?\.\(at\);[\s\S]*?gain\.setValueAtTime\(0, at\)/);
  assert.match(source, /function suspendAudioContext\(\) \{[\s\S]*?context\.suspend\(\)\.catch/);
  assert.match(source, /function panicAudio\(\{ broadcast = false \} = \{\}\) \{[\s\S]*?closeOutputGate\(\); suspendAudioContext\(\);/);
  assert.match(source, /const pendingSuspension = audioSuspension;[\s\S]*?if \(pendingSuspension\) await pendingSuspension;/);
  assert.match(source, /function emergencyStop\(\) \{[\s\S]*?panicAudio\(\{ broadcast:true \}\);[\s\S]*?setStatus\("STOP SOUND/);
  assert.match(source, /elements\["panic-audio"\]\.addEventListener\("pointerdown", emergencyStop\)/);
  assert.match(source, /elements\["panic-audio"\]\.addEventListener\("click", \(event\) => \{ if \(event\.detail === 0\) emergencyStop\(\); \}\)/);
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
