import { createSynthNode, getParams, parsePreset } from "./synth-node.js";
import { REVERB_MATERIALS, SPACE_DEFAULTS, createSpaceEffects } from "./space-effects.js";
import { MOD_DEST_BY_PARAM, MOD_DESTINATIONS, MOD_SOURCES, findAssignmentSlot, modulationAmountLabel, modulationSlotIds } from "./mod-matrix.js";
import { FX_CORE_PARAM_IDS, FX_DEFAULTS, FX_IDS, fxCoreParams } from "./fx-rack.js";
import { MAX_USER_PATCHES, createPatchHistory, createPatchSnapshot, parsePatch, serializePatch, validatePatch } from "./patch-state.js";
import { analyzeSound } from "./sound-analysis.js";
import { MATCH_TARGET_RMS_DBFS, candidateRenderPlan, compareSoundAnalyses, levelMatchGain } from "./match-audio.js";
import { suggestAmpEnvelope } from "./envelope-match.js";
import { estimateFilterCutoff, planFilterCutoffProbe } from "./filter-match.js";
import { createNoteRegistry } from "./note-registry.js";
import { parseWavetableWav } from "./wavetable-import.js";

const paths = { wasm: "../../build/synth_engine.wasm?m4r=1", presets: "../../presets/" };
const presets = Object.freeze({
  epiano: { label:"EPiano", file:"rsk_epiano.txt", description:"やわらかい電気鍵盤", space:{ reverbDecay:1.8 } },
  saw: { label:"Saw", file:"rsk_saw.txt", description:"ユニゾンのある鋸歯波", space:{ reverbDecay:1.6 } },
  pluck: { label:"Pluck", file:"rsk_pluck.txt", description:"短いノイズを含むプラック", space:{ reverbDecay:1 } },
  bell: { label:"Bell", file:"rsk_bell.txt", description:"FM由来のベル", space:{ reverbDecay:2.2 } },
  widePad: { label:"Wide Pad", file:"studio_wide_pad.txt", description:"広がりを持つ持続和音", space:{ delayOn:false, delayMix:.08, delayTime:.48, reverbOn:true, reverbMix:.42, reverbMaterial:"warm", reverbDecay:3.2, reverbPreDelay:.018 } },
  warmBass: { label:"Warm Bass", file:"studio_warm_bass.txt", description:"低域を支える短いベース", space:{ delayOn:false, delayMix:.08, delayTime:.24, reverbOn:true, reverbMix:.08, reverbMaterial:"warm", reverbDecay:.9, reverbLowCut:260 } },
  glassBell: { label:"Glass Bell", file:"studio_glass_bell.txt", description:"硬質で長く残るベル", space:{ delayOn:true, delayFeedback:.28, delayMix:.16, delayTime:.42, reverbOn:true, reverbMix:.34, reverbMaterial:"clear", reverbDecay:3.4, reverbPreDelay:.012 } },
  brightPluck: { label:"Bright Pluck", file:"studio_bright_pluck.txt", description:"明るく減衰するプラック", space:{ delayOn:true, delayFeedback:.22, delayMix:.12, delayTime:.3, reverbOn:true, reverbMix:.18, reverbMaterial:"grain", reverbDecay:1.3 } },
  motionLead: { label:"Motion Lead", file:"studio_motion_lead.txt", description:"ゆっくり表情が動くリード", space:{ delayOn:true, delayFeedback:.36, delayMix:.12, delayTime:.32, reverbOn:true, reverbMix:.2, reverbMaterial:"grain", reverbDecay:1.5 } },
  airKeys: { label:"Air Keys", file:"studio_air_keys.txt", description:"空気感を残す鍵盤音", space:{ delayOn:false, delayMix:.08, delayTime:.36, reverbOn:true, reverbMix:.3, reverbMaterial:"warm", reverbDecay:2, reverbHighCut:7200 } },
});
const presetCategories = Object.freeze({ epiano:"Keys", saw:"Lead", pluck:"Pluck", bell:"Bell", widePad:"Pad", warmBass:"Bass", glassBell:"Bell", brightPluck:"Pluck", motionLead:"Lead", airKeys:"Keys" });
const CUSTOM_WAVETABLE_SLOT = 4;
const wavetableNames = Object.freeze(["Basic Shapes", "Analog Sweep", "Digital Edge", "Hollow Formant", "Custom · Session"]);
const groups = Object.freeze({
  "global-controls": [{ id: 7, label: "MASTER" }],
  "voice-controls": [{ id: 8, label: "VOICES" }],
  "osc-a": [{ id: 0, label: "WAVE", type: "select", options: wavetableNames }, { id: 1, label: "POS" }, { id: 2, label: "LEVEL" }, { id: 9, label: "UNISON" }, { id: 10, label: "DETUNE" }, { id: 11, label: "WIDTH" }, { id: 12, label: "OCT" }, { id: 13, label: "SEMI" }, { id: 14, label: "FINE" }],
  "osc-b": [{ id: 17, label: "WAVE", type: "select", options: wavetableNames }, { id: 18, label: "POS" }, { id: 19, label: "LEVEL" }, { id: 20, label: "UNISON" }, { id: 21, label: "DETUNE" }, { id: 22, label: "WIDTH" }, { id: 23, label: "OCT" }, { id: 24, label: "SEMI" }, { id: 25, label: "FINE" }],
  mix: [{ id: 28, label: "FM B → A" }, { id: 29, label: "SUB" }, { id: 30, label: "SUB WAVE", type: "select", options: ["Sine", "Square", "Triangle"] }, { id: 31, label: "SUB OCT" }, { id: 32, label: "NOISE" }, { id: 33, label: "NOISE COLOR", type: "select", options: ["White", "Pink"] }, { id: 34, label: "NOISE DECAY" }],
  filter: [{ id: 35, label: "ON", type: "toggle" }, { id: 36, label: "MODE", type: "select", options: ["LP12", "LP24", "BP12", "BP24", "HP12", "NOTCH"] }, { id: 37, label: "CUTOFF", scale: "log" }, { id: 38, label: "RESONANCE" }, { id: 39, label: "KEY TRACK" }, { id: 40, label: "ENV AMOUNT" }],
  amp: [{ id: 3, label: "ATTACK" }, { id: 4, label: "DECAY" }, { id: 5, label: "SUSTAIN" }, { id: 6, label: "RELEASE" }, { id: 53, label: "CURVE" }],
  "filter-eg": [{ id: 41, label: "ATTACK" }, { id: 42, label: "DECAY" }, { id: 43, label: "SUSTAIN" }, { id: 44, label: "RELEASE" }, { id: 54, label: "CURVE" }],
  mod: [{ id: 46, label: "RATE", scale: "log" }, { id: 47, label: "SHAPE", type: "select", options: ["Sine", "Triangle", "Saw Up", "Saw Down", "Square", "S&H"] }, { id: 48, label: "RETRIGGER", type: "toggle", toggleLabel: "RETRIG" }, { id: 49, label: "TO FILTER" }, { id: 50, label: "TO PITCH" }, { id: 51, label: "TO AMP" }, { id: 52, label: "PHASE" }],
  "mod-2": [{ id: 79, label: "RATE", scale: "log" }, { id: 80, label: "SHAPE", type: "select", options: ["Sine", "Triangle", "Saw Up", "Saw Down", "Square", "S&H"] }, { id: 81, label: "RETRIGGER", type: "toggle", toggleLabel: "RETRIG" }, { id: 82, label: "PHASE" }],
  "mod-env": [{ id: 85, label: "ATTACK" }, { id: 86, label: "DECAY" }, { id: 87, label: "SUSTAIN" }, { id: 88, label: "RELEASE" }, { id: 89, label: "CURVE" }],
  "performance-macros": [{ id: 73, label: "MACRO 1" }, { id: 74, label: "MACRO 2" }, { id: 83, label: "MACRO 3" }, { id: 84, label: "MACRO 4" }],
});
const primaryIds = new Set(Object.values(groups).flat().map((control) => control.id));
const qualityParamIds = new Set([76, 77, 78]);
const insertFxParamIds = new Set([
  ...FX_IDS.flatMap((id) => Object.values(FX_CORE_PARAM_IDS[id])),
  ...FX_CORE_PARAM_IDS.order,
]);
const keyboardMap = Object.freeze({ KeyA:60, KeyW:61, KeyS:62, KeyE:63, KeyD:64, KeyF:65, KeyT:66, KeyG:67, KeyY:68, KeyH:69, KeyU:70, KeyJ:71, KeyK:72 });
const keyboardKeyMap = Object.freeze({ a:60, w:61, s:62, e:63, d:64, f:65, t:66, g:67, y:68, h:69, u:70, j:71, k:72 });
const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));
const urlParams = new URLSearchParams(window.location.search);
elements["quality-lab"].hidden = urlParams.get("quality") !== "1";
const parameterInfo = new Map();
const values = new Map();
const controlsById = new Map();
const noteRegistry = createNoteRegistry();
const pointerNoteTokens = new Map();
const audioSessionId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const audioSessionChannel = typeof BroadcastChannel === "function" ? new BroadcastChannel("synth-engine.audio-session.v1") : undefined;
let wasmBytes;
let context;
let synth;
let audioReady;
let outputGate;
let spaceEffects;
const customWavetable = { frames:null, frameCount:0, sampleRate:0, name:"" };
const spaceValues = { ...SPACE_DEFAULTS };
const fxValues = structuredClone(FX_DEFAULTS);
const storageKeys = Object.freeze({ autosave:"synth-engine.studio.autosave.v1", patches:"synth-engine.studio.user-patches.v1" });
let userPatches = [];
let patchHistory;
let captureTimer;
let applyingPatch = false;
let activePatchIdentity = { name:"EPiano", category:"Keys" };
let saveReplacePending = false;
let saveReturnFocus;
const tabOrder = ["osc", "fx", "matrix", "match"];
const matrixParamIds = new Set(Array.from({ length:6 }, (_, index) => Object.values(modulationSlotIds(index))).flat());
let selectedModSource = 1;
let editingModDestination = 0;
const effectRanges = Object.freeze({ delayTime:[.03,1.5], delayFeedback:[0,.85], delayTone:[800,18000], delayMix:[0,.65], reverbSize:[0,1], reverbDecay:[.3,8], reverbDamping:[0,1], reverbPreDelay:[0,.1], reverbLowCut:[20,1000], reverbHighCut:[1000,18000], reverbWidth:[0,1], reverbMix:[0,.65] });
const matchWarningLabels = Object.freeze({
  "too-short":"0.25秒未満です。立ち上がりと音高の測定が不安定です。",
  "too-long":"30秒を超えています。単音だけを短く切り出すと比較しやすくなります。",
  clipped:"ピークが0 dBFS付近です。歪む前の素材を推奨します。",
  "too-quiet":"音量が小さすぎます。無音部分を減らすか入力レベルを確認してください。",
  "mostly-silent":"無音部分が大半です。発音部分を短く切り出すと精度が上がります。",
  "pitch-uncertain":"単音ピッチの信頼度が低い素材です。和音・ノイズ・残響を減らしてください。",
});
let matchAudioUrl;
let matchReferenceBuffer;
let matchReferenceAnalysis;
let matchCandidateBuffer;
let matchCandidateAnalysis;
let matchPlayback;
let matchCoreRevision = 0;
let matchAmpSuggestion;
let matchFilterSuggestion;
let applyingMatchFilterSuggestion = false;

function setStatus(message, error = false) { elements.status.textContent = message; elements.status.classList.toggle("error", error); }
function formatValue(parameter, value) {
  const lfoShapes = ["Sine", "Triangle", "Saw Up", "Saw Down", "Square", "S&H"];
  const discrete = { 0:wavetableNames, 17:wavetableNames, 30:["Sine", "Square", "Triangle"], 33:["White", "Pink"], 36:["LP12", "LP24", "BP12", "BP24", "HP12", "Notch"], 47:lfoShapes, 80:lfoShapes };
  if (discrete[parameter.id]) return discrete[parameter.id][Math.round(value)];
  if ([35, 48, 81].includes(parameter.id)) return value >= .5 ? "ON" : "OFF";
  if (parameter.id === 37) return `${Math.round(value).toLocaleString()} Hz`;
  if ([46, 79].includes(parameter.id)) return `${Number(value.toFixed(value < 1 ? 2 : 1))} Hz`;
  if ((parameter.flags & 2) !== 0) return `${Number(value.toFixed(2))} s`;
  if ([10, 14, 21, 25, 50].includes(parameter.id)) return `${Math.round(value)} ct`;
  if ([13, 24].includes(parameter.id)) return `${Math.round(value)} st`;
  if ([12, 23, 31, 40, 49].includes(parameter.id)) return `${Math.round(value)} oct`;
  if (matrixParamIds.has(parameter.id)) {
    const offset = (parameter.id - 55) % 3;
    if (offset === 0) return MOD_SOURCES[Math.round(value)] ?? "None";
    if (offset === 1) return MOD_DESTINATIONS[Math.round(value)] ?? "None";
    return modulationAmountLabel(value);
  }
  return Number(value.toFixed(3)).toString();
}
function rangeStep(parameter) { if ((parameter.flags & 1) !== 0) return 1; if (parameter.id === 37) return 0.001; return Math.max((parameter.max - parameter.min) / 500, 0.001); }
function normalized(parameter, value) { return (value - parameter.min) / Math.max(parameter.max - parameter.min, Number.EPSILON); }
function valueForInput(parameter, control, inputValue) { if (control.scale !== "log") return Number(inputValue); const low = Math.log(parameter.min); const high = Math.log(parameter.max); return Math.exp(low + Number(inputValue) * (high - low)); }
function inputForValue(parameter, control, value) { if (control.scale !== "log") return value; return (Math.log(value) - Math.log(parameter.min)) / (Math.log(parameter.max) - Math.log(parameter.min)); }

function updateControl(id) {
  const parameter = parameterInfo.get(id); const value = values.get(id); const stored = controlsById.get(id) ?? [];
  for (const control of stored) {
    control.input.setAttribute("aria-valuetext", formatValue(parameter, value));
    if (control.kind === "dial") { control.input.value = String(inputForValue(parameter, control.definition, value)); control.output.value = control.output === document.activeElement ? control.output.value : formatValue(parameter, value); control.dial.style.setProperty("--turn", `${-135 + normalized(parameter, value) * 270}deg`); }
    if (control.kind === "select") control.input.value = String(Math.round(value));
    if (control.kind === "toggle") { control.input.checked = value >= 0.5; control.input.nextElementSibling.textContent = value >= .5 ? (control.definition.toggleLabel ?? "ON") : "OFF"; }
    if (control.kind === "matrix-amount") control.input.value = String(value);
    if (control.kind !== "dial") control.output.textContent = formatValue(parameter, value);
  }
  updateVisuals(id);
  if ([9, 15, 20, 26, 76, 77, 78].includes(id)) syncQualityLab();
}
function setValue(id, value) {
  const parameter = parameterInfo.get(id); const numeric = Number(value);
  if (!parameter || !Number.isFinite(numeric)) return false;
  const next = Math.min(parameter.max, Math.max(parameter.min, numeric));
  if ([0, 17].includes(id) && Math.round(next) === CUSTOM_WAVETABLE_SLOT && !customWavetable.frames) {
    updateControl(id);
    elements["wavetable-import-state"].textContent = "LOAD WAV FIRST";
    setStatus("CUSTOM WTは未読込です。先にLOAD WAVで2048サンプル単位のWAVを選んでください。", true);
    return false;
  }
  values.set(id, next); updateControl(id); synth?.setParam(id, next);
  markMatchCoreChanged(id); schedulePatchCapture(); return true;
}
function registerControl(id, control) { if (!controlsById.has(id)) controlsById.set(id, []); controlsById.get(id).push(control); }

function setQualityPressed(button, pressed) {
  button.setAttribute("aria-pressed", String(pressed));
  button.classList.toggle("is-selected", pressed);
}
function syncQualityLab() {
  if (!parameterInfo.has(78)) return;
  const fourVoices = Math.round(values.get(9)) === 4 && Math.round(values.get(20)) === 4;
  const legacyUnison = fourVoices && Math.round(values.get(15)) === 0 && Math.round(values.get(26)) === 0 &&
    Math.round(values.get(76)) === 0 && Math.round(values.get(77)) === 0;
  const focusedUnison = fourVoices && Math.round(values.get(15)) === 2 && Math.round(values.get(26)) === 2 &&
    Math.round(values.get(76)) === 1 && Math.round(values.get(77)) === 1;
  setQualityPressed(elements["unison-quality-legacy"], legacyUnison);
  setQualityPressed(elements["unison-quality-focused"], focusedUnison);
  elements["unison-quality-state"].textContent = legacyUnison
    ? "Random phase · Linear width"
    : focusedUnison ? "Balanced phase · Natural width" : "Custom phase / width combination";
  const fmHq = Math.round(values.get(78)) === 1;
  setQualityPressed(elements["fm-quality-legacy"], !fmHq);
  setQualityPressed(elements["fm-quality-hq"], fmHq);
  elements["fm-quality-state"].textContent = fmHq
    ? "Full depth below guard · reduced high folds"
    : "Full depth · legacy spectrum";
}
function applyQualityValues(updates, message) {
  stopAllNotes();
  updates.forEach(([id, value]) => setValue(id, value));
  synth?.reset(1);
  setStatus(`${message}。同じ鍵盤をもう一度弾いて比較してください。`);
}
function installQualityLab() {
  elements["unison-quality-legacy"].addEventListener("click", () => applyQualityValues(
    [[9, 4], [20, 4], [15, 0], [26, 0], [76, 0], [77, 0]],
    "4声ユニゾンをRandom phase / Linear widthへ切り替えました"));
  elements["unison-quality-focused"].addEventListener("click", () => applyQualityValues(
    [[9, 4], [20, 4], [15, 2], [26, 2], [76, 1], [77, 1]],
    "4声ユニゾンをBalanced phase / Natural widthへ切り替えました"));
  elements["fm-quality-legacy"].addEventListener("click", () => applyQualityValues(
    [[78, 0]], "FM高域処理をLegacyへ切り替えました"));
  elements["fm-quality-hq"].addEventListener("click", () => applyQualityValues(
    [[78, 1]], "FM高域処理をHQ Guardへ切り替えました"));
  syncQualityLab();
}

function capturePendingEdit() {
  if (!captureTimer) return;
  clearTimeout(captureTimer); captureTimer = undefined;
  const patch = capturePatch(); patchHistory?.push(patch); saveAutosave(patch); updateHistoryButtons();
}
function editMatrixSlot(index, source, destination, amount) {
  // An assignment (three parameters) is one undo step, including a rapid prior knob edit.
  capturePendingEdit();
  const ids = modulationSlotIds(index);
  setValue(ids.source, source); setValue(ids.destination, destination); setValue(ids.amount, amount);
  capturePendingEdit();
}
function refreshModDialog(resetAmount = false) {
  const source = Number(elements["mod-dialog-source"].value);
  const slot = findAssignmentSlot((id) => values.get(id) ?? 0, source, editingModDestination);
  const ids = slot >= 0 ? modulationSlotIds(slot) : null;
  const exists = ids && Math.round(values.get(ids.source)) === source && Math.round(values.get(ids.destination)) === editingModDestination;
  if (resetAmount) elements["mod-dialog-amount"].value = String(exists ? values.get(ids.amount) : .5);
  const amountLabel = modulationAmountLabel(elements["mod-dialog-amount"].value);
  elements["mod-dialog-amount-value"].value = amountLabel;
  elements["mod-dialog-amount"].setAttribute("aria-valuetext", amountLabel);
  elements["mod-dialog-apply"].disabled = slot < 0;
  elements["mod-dialog-apply"].textContent = exists ? "UPDATE" : "APPLY";
  elements["mod-dialog-state"].textContent = slot < 0
    ? "6枠すべて使用中です。下の接続を解除するか、MATRIXで空きを作ってください。"
    : `SLOT ${slot + 1} · ${exists ? "既存の接続を更新" : "新しい接続"}。${amountLabel}で適用します。`;
}
function renderModDialogRoutes() {
  const routes = elements["mod-dialog-routes"]; routes.replaceChildren();
  for (let index = 0; index < 6; index += 1) {
    const ids = modulationSlotIds(index); const source = Math.round(values.get(ids.source));
    if (!source || Math.round(values.get(ids.destination)) !== editingModDestination) continue;
    const row = document.createElement("div"); const label = document.createElement("span");
    label.textContent = `${MOD_SOURCES[source]} · ${modulationAmountLabel(values.get(ids.amount))}`;
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "button button-quiet"; remove.textContent = "REMOVE";
    remove.setAttribute("aria-label", `${MOD_SOURCES[source]}から${MOD_DESTINATIONS[editingModDestination]}への接続を解除`);
    remove.addEventListener("click", () => { editMatrixSlot(index, 0, 0, 0); renderModDialogRoutes(); refreshModDialog(true); elements["mod-dialog-source"].focus(); setStatus(`SLOT ${index + 1}の接続を解除しました。UNDOで戻せます。`); });
    row.append(label, remove); routes.append(row);
  }
}
function openModDialog(destination) {
  editingModDestination = destination;
  elements["mod-dialog-title"].textContent = MOD_DESTINATIONS[destination];
  elements["mod-dialog-source"].value = String(selectedModSource);
  refreshModDialog(true); renderModDialogRoutes(); elements["mod-dialog"].showModal();
  elements["mod-dialog-source"].focus();
}
function installModDialog() {
  MOD_SOURCES.forEach((source, index) => { if (index) elements["mod-dialog-source"].add(new Option(source, String(index))); });
  elements["mod-dialog-source"].addEventListener("change", () => { selectedModSource = Number(elements["mod-dialog-source"].value); refreshModDialog(true); });
  elements["mod-dialog-amount"].addEventListener("input", () => refreshModDialog());
  elements["mod-dialog-cancel"].addEventListener("click", () => elements["mod-dialog"].close());
  elements["mod-dialog-form"].addEventListener("submit", (event) => {
    event.preventDefault();
    const source = Number(elements["mod-dialog-source"].value);
    const slot = findAssignmentSlot((id) => values.get(id) ?? 0, source, editingModDestination);
    if (slot < 0) { refreshModDialog(); return; }
    editMatrixSlot(slot, source, editingModDestination, Number(elements["mod-dialog-amount"].value));
    setStatus(`${MOD_SOURCES[source]} → ${MOD_DESTINATIONS[editingModDestination]} をSLOT ${slot + 1}へ適用。UNDOで戻せます。`);
    elements["mod-dialog"].close();
  });
}

function installDialInteraction(input, output, parameter, definition) {
  let drag;
  input.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    drag = { y:event.clientY, value:values.get(parameter.id) };
    input.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  input.addEventListener("pointermove", (event) => {
    if (!drag || !input.hasPointerCapture(event.pointerId)) return;
    const range = parameter.max - parameter.min;
    const precision = event.shiftKey ? .1 : 1;
    setValue(parameter.id, drag.value + ((drag.y - event.clientY) / 160) * range * precision);
  });
  const finish = (event) => { if (drag && input.hasPointerCapture(event.pointerId)) input.releasePointerCapture(event.pointerId); drag = undefined; };
  input.addEventListener("pointerup", finish);
  input.addEventListener("pointercancel", finish);
  input.addEventListener("dblclick", (event) => { event.preventDefault(); setValue(parameter.id, parameter.default); });
  output.addEventListener("focus", () => { output.value = Number(values.get(parameter.id).toFixed(6)).toString(); output.select(); });
  output.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); output.blur(); }
    if (event.key === "Escape") { event.preventDefault(); output.value = formatValue(parameter, values.get(parameter.id)); output.blur(); }
  });
  output.addEventListener("change", () => { if (!setValue(parameter.id, Number(output.value.replaceAll(",", "").match(/-?\d*\.?\d+/)?.[0]))) output.value = formatValue(parameter, values.get(parameter.id)); });
  output.addEventListener("blur", () => { output.value = formatValue(parameter, values.get(parameter.id)); });
}

function createControl(definition, advanced = false) {
  const parameter = parameterInfo.get(definition.id); const field = document.createElement("div"); field.className = "control"; field.dataset.paramId = String(definition.id);
  const label = document.createElement("span"); label.className = "control-label"; label.textContent = definition.label ?? parameter.displayName;
  const output = document.createElement("output"); output.className = "control-value";
  if (definition.type === "select") {
    field.classList.add("control-select");
    const input = document.createElement("select"); input.setAttribute("aria-label", parameter.displayName); definition.options.forEach((name, index) => { const option = new Option(name, String(index)); input.add(option); }); input.addEventListener("change", () => setValue(parameter.id, Number(input.value))); field.append(label, input, output); registerControl(parameter.id, { kind:"select", input, output, definition });
  } else if (definition.type === "toggle") {
    field.classList.add("control-toggle");
    const toggle = document.createElement("label"); toggle.className = "toggle"; const input = document.createElement("input"); input.type = "checkbox"; input.setAttribute("aria-label", parameter.displayName); const text = document.createElement("span"); text.textContent = definition.toggleLabel ?? definition.label; input.addEventListener("change", () => setValue(parameter.id, input.checked ? 1 : 0)); toggle.append(input, text); field.append(label, toggle, output); registerControl(parameter.id, { kind:"toggle", input, output, definition });
  } else {
    const dial = document.createElement("div"); dial.className = "dial"; const input = document.createElement("input"); input.type = "range"; input.min = definition.scale === "log" ? "0" : String(parameter.min); input.max = definition.scale === "log" ? "1" : String(parameter.max); input.step = String(rangeStep(parameter)); input.setAttribute("aria-label", `${parameter.displayName}。上下ドラッグ、Shiftで微調整、ダブルクリックで初期値`); input.addEventListener("input", () => setValue(parameter.id, valueForInput(parameter, definition, input.value)));
    const valueInput = document.createElement("input"); valueInput.type = "text"; valueInput.inputMode = "decimal"; valueInput.className = "control-value-input"; valueInput.setAttribute("aria-label", `${parameter.displayName} 数値入力`);
    dial.append(input); field.append(label, dial, valueInput); const registered = { kind:"dial", input, output:valueInput, dial, definition }; registerControl(parameter.id, registered); installDialInteraction(input, valueInput, parameter, definition);
  }
  const modulationDestination = MOD_DEST_BY_PARAM[definition.id];
  if (!advanced && modulationDestination) { const assign = document.createElement("button"); assign.className = "mod-assign"; assign.type = "button"; assign.dataset.destination = String(modulationDestination); assign.setAttribute("aria-label", `${MOD_DESTINATIONS[modulationDestination]}の変調を編集`); assign.setAttribute("aria-haspopup", "dialog"); assign.textContent = "+ MOD"; assign.addEventListener("click", () => openModDialog(modulationDestination)); field.append(assign); }
  if (advanced) field.title = `${parameter.displayName} (#${parameter.id})`; updateControl(parameter.id); return field;
}

function waveformSample(shape, phase) {
  const wrapped = phase - Math.floor(phase);
  if (shape === 0) return Math.sin(wrapped * Math.PI * 2);
  if (shape === 1) return wrapped * 2 - 1;
  if (shape === 2) return wrapped < .5 ? 1 : -1;
  if (wrapped < .25) return wrapped * 4;
  if (wrapped < .75) return 2 - wrapped * 4;
  return wrapped * 4 - 4;
}
function harmonicSample(phase, coefficient, limit = 48) {
  let value = 0;
  for (let harmonic = 1; harmonic <= limit; harmonic += 1) value += coefficient(harmonic) * Math.sin(phase * Math.PI * 2 * harmonic);
  return value;
}
function rawWavetableFrameSample(slot, frame, phase) {
  const wrapped = phase - Math.floor(phase);
  if (slot === CUSTOM_WAVETABLE_SLOT) {
    if (!customWavetable.frames) return Math.sin(wrapped * Math.PI * 2);
    const safeFrame = Math.min(customWavetable.frameCount - 1, Math.max(0, frame));
    const position = wrapped * 2048;
    const first = Math.floor(position) & 2047;
    const second = (first + 1) & 2047;
    const mix = position - Math.floor(position);
    const offset = safeFrame * 2048;
    return customWavetable.frames[offset + first] * (1 - mix) +
      customWavetable.frames[offset + second] * mix;
  }
  if (slot === 0) return waveformSample(frame, wrapped);
  if (frame === 0) return waveformSample(slot, wrapped);
  if (slot === 1 && frame === 1) return harmonicSample(wrapped, (harmonic) => (-2 / (Math.PI * harmonic)) * (10 / (10 + harmonic)));
  if (slot === 1) {
    const duty = frame === 2 ? .36 : .18;
    return Math.abs(wrapped - .5) < duty * .5 ? 1 : -duty / (1 - duty);
  }
  if (slot === 2 && frame === 1) {
    const levels = [1, .62, .34, .19, .11, .06];
    return harmonicSample(wrapped, (harmonic) => levels[harmonic - 1] ?? 0, levels.length);
  }
  if (slot === 2 && frame === 2) return harmonicSample(wrapped, (harmonic) => {
    const band = harmonic <= 4 ? 1 : harmonic <= 12 ? .7 : .24;
    return (((harmonic - 1) >> 1) % 2 ? -1 : 1) * band / harmonic;
  });
  if (slot === 2) return harmonicSample(wrapped, (harmonic) => harmonic % 2 ? ((((harmonic - 1) >> 1) % 2 ? -1 : 1) * 4 / (Math.PI * harmonic)) : 0);
  if (frame === 1) {
    const levels = [1, .5, .25, .125, .06];
    return harmonicSample(wrapped, (harmonic) => levels[harmonic - 1] ?? 0, levels.length);
  }
  if (frame === 2) {
    const levels = new Map([[1, 1], [3, .58], [5, .26], [7, -.11]]);
    return harmonicSample(wrapped, (harmonic) => levels.get(harmonic) ?? 0, 7);
  }
  return harmonicSample(wrapped, (harmonic) => {
    const weight = harmonic === 1 ? .3 : harmonic === 2 ? .18 : harmonic <= 5 ? 1 : harmonic <= 8 ? .15 : harmonic <= 12 ? .7 : 0;
    return weight / harmonic;
  }, 12);
}
const visualFrameGain = new Map();
function wavetableFrameSample(slot, frame, phase) {
  const key = `${slot}:${frame}`;
  if (!visualFrameGain.has(key)) {
    let target = 0; let peak = 0;
    for (let index = 0; index < 256; index += 1) {
      target = Math.max(target, Math.abs(rawWavetableFrameSample(slot, 0, index / 256)));
      peak = Math.max(peak, Math.abs(rawWavetableFrameSample(slot, frame, index / 256)));
    }
    visualFrameGain.set(key, peak > 0 ? target / peak : 1);
  }
  return rawWavetableFrameSample(slot, frame, phase) * visualFrameGain.get(key);
}
function oscillatorSample(slot, position, phase) {
  const frameCount = slot === CUSTOM_WAVETABLE_SLOT && customWavetable.frames
    ? customWavetable.frameCount : 4;
  const lastFrame = frameCount - 1;
  const framePosition = Math.min(1, Math.max(0, position)) * lastFrame;
  const first = Math.floor(framePosition);
  const second = Math.min(lastFrame, first + 1);
  const mix = framePosition - first;
  return wavetableFrameSample(slot, first, phase) * (1 - mix) + wavetableFrameSample(slot, second, phase) * mix;
}
function graphPath(width, height, sample, count = 180) {
  const points = [];
  for (let index = 0; index <= count; index += 1) {
    const x = index / count;
    const y = Math.min(1, Math.max(-1, sample(x)));
    points.push(`${index ? "L" : "M"}${(x * width).toFixed(2)} ${(height * .5 - y * height * .4).toFixed(2)}`);
  }
  return points.join(" ");
}
function renderWaveform(svgId, slotId, positionId) {
  const svg = elements[svgId];
  if (!svg || !values.has(slotId)) return;
  const slot = Math.round(values.get(slotId));
  const position = values.get(positionId) ?? 0;
  svg.querySelector(".wave-line").setAttribute("d", graphPath(520, 152, (x) => oscillatorSample(slot, position, x * 2)));
  svg.setAttribute("aria-label", `${wavetableNames[slot]}、position ${Math.round(position * 100)}% の設定波形`);
}
function envelopeRemaining(progress, curve) {
  const exponential = (2 ** (-8 * progress) - 2 ** -8) / (1 - 2 ** -8);
  return (1 - curve) * exponential + curve * (1 - progress);
}
function renderEnvelope(svgId, ids) {
  const svg = elements[svgId];
  if (!svg || ids.some((id) => !values.has(id))) return;
  const [attackId, decayId, sustainId, releaseId, curveId] = ids;
  const attack = values.get(attackId); const decay = values.get(decayId); const sustain = values.get(sustainId); const release = values.get(releaseId); const curve = values.get(curveId);
  const span = Math.log1p(attack) + Math.log1p(decay) + Math.log1p(release) + 1;
  const attackEnd = .04 + .34 * Math.log1p(attack) / span;
  const decayEnd = attackEnd + .34 * Math.log1p(decay) / span;
  const releaseStart = Math.max(decayEnd + .16, .72);
  const points = [];
  for (let index = 0; index <= 180; index += 1) {
    const x = index / 180; let y;
    if (x <= attackEnd) y = x / Math.max(attackEnd, .001);
    else if (x <= decayEnd) y = sustain + (1 - sustain) * envelopeRemaining((x - attackEnd) / Math.max(decayEnd - attackEnd, .001), curve);
    else if (x < releaseStart) y = sustain;
    else y = sustain * envelopeRemaining((x - releaseStart) / Math.max(1 - releaseStart, .001), curve);
    points.push(`${index ? "L" : "M"}${(x * 360).toFixed(2)} ${(104 - y * 96).toFixed(2)}`);
  }
  svg.querySelector("path").setAttribute("d", points.join(" "));
  svg.setAttribute("aria-label", `Attack ${formatValue(parameterInfo.get(attackId), attack)}、Decay ${formatValue(parameterInfo.get(decayId), decay)}、Sustain ${formatValue(parameterInfo.get(sustainId), sustain)}、Release ${formatValue(parameterInfo.get(releaseId), release)} の設定形状`);
}
function lfoSample(shape, phase) {
  if (shape === 0) return Math.sin(phase * Math.PI * 2);
  if (shape === 1) return 1 - 4 * Math.abs(phase - .5);
  if (shape === 2) return phase * 2 - 1;
  if (shape === 3) return 1 - phase * 2;
  if (shape === 4) return phase < .5 ? 1 : -1;
  return [-.54, .76, -.16, .42, -.82, .18, .64, -.34][Math.min(7, Math.floor(phase * 8))];
}
function renderLfo(svgId, shapeId, phaseId, label) {
  const svg = elements[svgId];
  if (!svg || !values.has(shapeId)) return;
  const shape = Math.round(values.get(shapeId)); const phase = values.get(phaseId) ?? 0;
  svg.querySelector("path").setAttribute("d", graphPath(360, 112, (x) => lfoSample(shape, (x + phase) % 1), shape === 5 ? 160 : 180));
  svg.setAttribute("aria-label", `${label} · ${["Sine", "Triangle", "Saw Up", "Saw Down", "Square", "Sample and Hold"][shape]}の設定形状`);
}
function updateVisuals(id) {
  if ([0, 1].includes(id)) renderWaveform("wave-a", 0, 1);
  if ([17, 18].includes(id)) renderWaveform("wave-b", 17, 18);
  if ([3, 4, 5, 6, 53].includes(id)) renderEnvelope("env-amp-graph", [3, 4, 5, 6, 53]);
  if ([41, 42, 43, 44, 54].includes(id)) renderEnvelope("env-filter-graph", [41, 42, 43, 44, 54]);
  if ([47, 52].includes(id)) renderLfo("lfo-graph", 47, 52, "LFO 1");
  if ([80, 82].includes(id)) renderLfo("lfo2-graph", 80, 82, "LFO 2");
  if ([85, 86, 87, 88, 89].includes(id)) renderEnvelope("env-mod-graph", [85, 86, 87, 88, 89]);
  if (matrixParamIds.has(id)) renderMatrixSummary();
}

function selectTab(id, focus = false) {
  for (const name of tabOrder) {
    const selected = name === id;
    const tab = elements[`tab-${name}`]; const panel = elements[`panel-${name}`];
    tab.classList.toggle("is-selected", selected); tab.setAttribute("aria-selected", String(selected)); tab.tabIndex = selected ? 0 : -1;
    panel.hidden = !selected; panel.classList.toggle("is-active", selected);
  }
  if (focus) elements[`tab-${id}`].focus();
}
function installTabs() {
  tabOrder.forEach((name, index) => {
    const tab = elements[`tab-${name}`];
    tab.addEventListener("click", () => selectTab(name));
    tab.addEventListener("keydown", (event) => {
      let next = index;
      if (event.key === "ArrowRight") next = (index + 1) % tabOrder.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + tabOrder.length) % tabOrder.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabOrder.length - 1;
      else return;
      event.preventDefault(); selectTab(tabOrder[next], true);
    });
  });
}

function selectEditor(name, focus = false) {
  const selected = elements[`editor-tab-${name}`];
  const bank = selected.closest(".editor-bank");
  bank.querySelectorAll('[role="tab"]').forEach((tab) => {
    const active = tab === selected; tab.setAttribute("aria-selected", String(active)); tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.getAttribute("aria-controls")).hidden = !active;
  });
  if (focus) selected.focus();
}
function installEditorBanks() {
  document.querySelectorAll(".waveform,.mod-graph").forEach((svg) => svg.setAttribute("preserveAspectRatio", "none"));
  elements["wave-picker-a"].append(elements["osc-a"].querySelector('[data-param-id="0"]'));
  elements["wave-picker-b"].append(elements["osc-b"].querySelector('[data-param-id="17"]'));
  const sends = document.createElement("details"); sends.className = "lfo-sends";
  const summary = document.createElement("summary"); summary.textContent = "DIRECT SENDS · Filter / Pitch / Amp";
  const controls = document.createElement("div"); controls.className = "control-grid";
  [49, 50, 51].forEach((id) => controls.append(elements.mod.querySelector(`[data-param-id="${id}"]`)));
  sends.append(summary, controls); elements.mod.after(sends);
  document.querySelectorAll(".editor-bank").forEach((bank) => {
    const tabs = [...bank.querySelectorAll('[role="tab"]')];
    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => selectEditor(tab.id.replace("editor-tab-", "")));
      tab.addEventListener("keydown", (event) => {
        let next;
        if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
        else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = tabs.length - 1;
        else return;
        event.preventDefault(); selectEditor(tabs[next].id.replace("editor-tab-", ""), true);
      });
    });
  });
  elements["edit-mod-envelope"].addEventListener("click", () => { selectTab("osc"); selectEditor("modenv", true); });
  elements["patch-tools-toggle"].addEventListener("click", () => {
    const expanded = elements["patch-tools"].hidden;
    elements["patch-tools"].hidden = !expanded; elements["patch-tools-toggle"].setAttribute("aria-expanded", String(expanded));
  });
}

function formatMatchTime(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  return seconds < 1 ? `${Math.round(seconds * 1000)} ms` : `${seconds.toFixed(2)} s`;
}
function formatMatchDb(value) { return Number.isFinite(value) ? `${value.toFixed(1)} dB` : "−∞ dB"; }
function formatMatchSigned(value, unit, digits = 0) { return Number.isFinite(value) ? `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)} ${unit}` : "—"; }
function midiNoteName(midi) {
  const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  return `${names[(midi % 12 + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}
function pitchNote(hz) {
  if (!(hz > 0)) return "pitch not detected";
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  return `${midiNoteName(midi)} · nearest note`;
}
function updateMatchFlow(currentIndex) {
  ["match-step-measure", "match-step-candidate", "match-step-ab", "match-step-refine"].forEach((id, index) => {
    elements[id].classList.toggle("is-current", index === currentIndex);
    elements[id].classList.toggle("is-complete", index < currentIndex);
  });
}
function setMatchPlaybackButtons(active) {
  elements["match-play-a"].setAttribute("aria-pressed", String(active === "reference"));
  elements["match-play-b"].setAttribute("aria-pressed", String(active === "candidate"));
}
function stopMatchPlayback() {
  const playing = matchPlayback; matchPlayback = undefined; setMatchPlaybackButtons();
  if (!playing) return;
  try { playing.source.stop(); } catch {}
  playing.source.disconnect(); playing.gain.disconnect();
}
function refreshMatchRenderAvailability() {
  const plan = candidateRenderPlan(matchReferenceAnalysis, values.get(6));
  elements["match-render"].disabled = !plan.ready;
  elements["match-render"].textContent = matchCandidateBuffer ? "RE-RENDER CURRENT" : "RENDER CURRENT";
  if (!plan.ready) { elements["match-render-note"].textContent = plan.reason; return plan; }
  const detune = formatMatchSigned(plan.detuneCents, "ct", 1);
  const cap = plan.truncated ? " · 先頭12秒で比較" : "";
  elements["match-render-note"].textContent = `${midiNoteName(plan.midi)}（参照との差 ${detune}）· ${plan.durationSeconds.toFixed(2)}秒${cap}`;
  return plan;
}
function discardMatchCandidate(reason) {
  stopMatchPlayback(); matchCandidateBuffer = undefined; matchCandidateAnalysis = undefined; elements["match-ab"].hidden = true;
  const plan = refreshMatchRenderAvailability();
  if (reason && plan.ready) elements["match-render-note"].textContent = `${reason} ${elements["match-render-note"].textContent}`;
  updateMatchFlow(matchReferenceAnalysis ? 1 : 0);
}
function markMatchCoreChanged(id) {
  matchCoreRevision += 1;
  if (matchCandidateBuffer) discardMatchCandidate("パッチが変わりました。再描画してください。");
  if (matchReferenceAnalysis && !applyingMatchFilterSuggestion) resetMatchFilterSuggestion("パッチが変わりました。RENDER CURRENTで再較正してください。");
  if (matchReferenceAnalysis) {
    if (id === 53 || id === undefined) renderMatchAmpSuggestion(matchReferenceAnalysis);
    else refreshMatchAmpCurrent();
  }
}
function renderMatchEnvelope(analysis) {
  const values = analysis.envelope.values;
  const maximum = values.reduce((result, value) => Math.max(result, value), 0);
  if (!values.length || maximum <= 0) { elements["match-envelope"].querySelector(".match-envelope-line").setAttribute("d", ""); return; }
  const points = values.map((value, index) => {
    const x = values.length === 1 ? 0 : index / (values.length - 1) * 1000;
    const y = 120 - Math.min(1, value / maximum) * 112;
    return `${index ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  elements["match-envelope"].querySelector(".match-envelope-line").setAttribute("d", points.join(" "));
  elements["match-envelope"].setAttribute("aria-label", `${analysis.durationSeconds.toFixed(2)}秒の参照音から20ミリ秒窓で測定した振幅包絡`);
}
function renderMatchWarnings(warnings) {
  elements["match-warnings"].replaceChildren();
  const items = warnings.length ? warnings.map((warning) => matchWarningLabels[warning] ?? warning) : ["単音比較に使える測定状態です。現在のcoreパッチを描画してA/Bできます。"];
  for (const item of items) { const message = document.createElement("span"); message.classList.toggle("is-clear", warnings.length === 0); message.textContent = item; elements["match-warnings"].append(message); }
}
const ampFields = Object.freeze([
  { key:"attack", id:3 }, { key:"decay", id:4 }, { key:"sustain", id:5 }, { key:"release", id:6 },
]);
function formatAmpMatchValue(key, value) {
  if (!Number.isFinite(value)) return "—";
  if (key === "sustain") return `${Math.round(value * 100)}%`;
  return formatMatchTime(value);
}
function refreshMatchAmpCurrent() {
  if (!elements["match-amp-state"]) return;
  for (const field of ampFields) elements[`match-amp-current-${field.key}`].textContent = formatAmpMatchValue(field.key, values.get(field.id));
  if (!matchAmpSuggestion?.available) return;
  const detected = ampFields.filter((field) => Number.isFinite(matchAmpSuggestion.suggestions[field.key]?.value));
  const matches = detected.length > 0 && detected.every((field) => Math.abs(values.get(field.id) - matchAmpSuggestion.suggestions[field.key].value) <= .0005);
  const state = matches ? "applied" : matchAmpSuggestion.state;
  elements["match-amp-state"].dataset.state = state;
  elements["match-amp-state"].textContent = matches ? "APPLIED" : state.toUpperCase();
  elements["match-amp-apply"].disabled = matches || !detected.length;
  elements["match-amp-note"].textContent = matches
    ? `${detected.length}/4値を適用済みです。Undoで戻せます。次にRENDER CURRENTで比較してください。`
    : `${detected.length}/4値を検出。${matchAmpSuggestion.suggestions.release ? "Releaseを含みます。" : "Releaseは判別できないため現在値を保持します。"}`;
}
function renderMatchAmpSuggestion(analysis) {
  matchAmpSuggestion = suggestAmpEnvelope(analysis, { curve:values.get(53) });
  for (const field of ampFields) {
    const candidate = matchAmpSuggestion.suggestions[field.key];
    elements[`match-amp-suggested-${field.key}`].textContent = candidate ? formatAmpMatchValue(field.key, candidate.value) : "KEEP CURRENT";
    elements[`match-amp-evidence-${field.key}`].textContent = candidate ? `${candidate.confidence} · ${candidate.evidence}` : field.key === "release" ? "UNRESOLVED · note-off not separable" : "UNRESOLVED · landmark not separable";
  }
  elements["match-amp-state"].dataset.state = matchAmpSuggestion.state;
  elements["match-amp-state"].textContent = matchAmpSuggestion.state.toUpperCase();
  elements["match-amp-apply"].disabled = !matchAmpSuggestion.available;
  if (!matchAmpSuggestion.available) elements["match-amp-note"].textContent = `AMP ENV候補を作れません: ${matchAmpSuggestion.reason}`;
  refreshMatchAmpCurrent();
}
function applyMatchAmpSuggestion() {
  if (!matchAmpSuggestion?.available) return;
  let applied = 0;
  for (const field of ampFields) {
    const candidate = matchAmpSuggestion.suggestions[field.key];
    if (Number.isFinite(candidate?.value) && setValue(field.id, candidate.value)) applied += 1;
  }
  refreshMatchAmpCurrent();
  setStatus(`AMP ENV仮説の${applied}/4値を適用しました。Undoで戻せます。RENDER CURRENTで参照音と比較してください。`);
}
function formatMatchHz(value) { return Number.isFinite(value) && value > 0 ? `${Math.round(value).toLocaleString()} Hz` : "—"; }
function resetMatchFilterSuggestion(note = "RENDER CURRENTでCutoff反応を較正します。") {
  matchFilterSuggestion = undefined;
  elements["match-filter-state"].dataset.state = "waiting";
  elements["match-filter-state"].textContent = "WAITING";
  elements["match-filter-current"].textContent = formatMatchHz(values.get(37));
  elements["match-filter-suggested"].textContent = "—";
  elements["match-filter-reference-brightness"].textContent = formatMatchHz(matchReferenceAnalysis?.brightnessHz);
  elements["match-filter-current-brightness"].textContent = "—";
  elements["match-filter-probe-brightness"].textContent = "—";
  elements["match-filter-probe-note"].textContent = "analysis only";
  elements["match-filter-evidence"].textContent = "Cutoffだけを1回試験描画します。";
  elements["match-filter-note"].textContent = note;
  elements["match-filter-apply"].disabled = true;
}
function renderMatchFilterSuggestion(result) {
  matchFilterSuggestion = result;
  const state = result.state ?? "unavailable";
  elements["match-filter-state"].dataset.state = state;
  elements["match-filter-state"].textContent = state.toUpperCase();
  elements["match-filter-current"].textContent = formatMatchHz(result.currentCutoff ?? values.get(37));
  elements["match-filter-reference-brightness"].textContent = formatMatchHz(result.referenceBrightness ?? matchReferenceAnalysis?.brightnessHz);
  elements["match-filter-current-brightness"].textContent = formatMatchHz(result.currentBrightness);
  elements["match-filter-probe-brightness"].textContent = formatMatchHz(result.probeBrightness);
  elements["match-filter-probe-note"].textContent = result.probeCutoff ? `${formatMatchHz(result.probeCutoff)} · analysis only` : "analysis only";
  if (state === "calibrating") {
    elements["match-filter-suggested"].textContent = "CALIBRATING…";
    elements["match-filter-evidence"].textContent = `${formatMatchHz(result.probeCutoff)}でcore反応を測定中です。`;
    elements["match-filter-note"].textContent = "ライブパッチとA/B候補は変更しません。";
    elements["match-filter-apply"].disabled = true;
    return;
  }
  if (state === "aligned") {
    elements["match-filter-suggested"].textContent = "KEEP CURRENT";
    elements["match-filter-evidence"].textContent = "HIGH · brightness difference ≤ 5%";
    elements["match-filter-note"].textContent = "Brightnessは許容差内です。Cutoffを変更しません。";
    elements["match-filter-apply"].disabled = true;
    return;
  }
  if (!result.available) {
    elements["match-filter-suggested"].textContent = "KEEP CURRENT";
    elements["match-filter-evidence"].textContent = `UNRESOLVED · ${result.reason}`;
    elements["match-filter-note"].textContent = "Filter ON / Mode / Resonance / EGは現在値を保持します。";
    elements["match-filter-apply"].disabled = true;
    return;
  }
  elements["match-filter-suggested"].textContent = formatMatchHz(result.suggestedCutoff);
  elements["match-filter-evidence"].textContent = `${result.confidence} · ${result.evidence}${result.limited ? " · one-step limit" : ""}`;
  elements["match-filter-note"].textContent = "Cutoffだけを適用します。他のFilter値は保持し、Undoで戻せます。";
  elements["match-filter-apply"].disabled = Math.abs(values.get(37) - result.suggestedCutoff) <= .5;
}
function refreshMatchFilterCurrent() {
  elements["match-filter-current"].textContent = formatMatchHz(values.get(37));
  if (!matchFilterSuggestion?.available) return;
  const matches = Math.abs(values.get(37) - matchFilterSuggestion.suggestedCutoff) <= .5;
  if (!matches) return;
  elements["match-filter-state"].dataset.state = "applied";
  elements["match-filter-state"].textContent = "APPLIED";
  elements["match-filter-apply"].disabled = true;
  elements["match-filter-note"].textContent = "Cutoffを適用済みです。Undoで戻せます。次にRENDER CURRENTで比較してください。";
}
function applyMatchFilterSuggestion() {
  if (!matchFilterSuggestion?.available || !Number.isFinite(matchFilterSuggestion.suggestedCutoff)) return;
  applyingMatchFilterSuggestion = true;
  try { setValue(37, matchFilterSuggestion.suggestedCutoff); }
  finally { applyingMatchFilterSuggestion = false; }
  refreshMatchFilterCurrent();
  setStatus("FILTER CUTOFF仮説を適用しました。Undoで戻せます。RENDER CURRENTで参照音と比較してください。");
}
function renderMatchAnalysis(file, analysis) {
  elements["match-file-name"].textContent = file.name;
  elements["match-duration"].textContent = formatMatchTime(analysis.durationSeconds);
  elements["match-pitch"].textContent = analysis.pitchHz ? `${analysis.pitchHz.toFixed(1)} Hz` : "—";
  elements["match-pitch-note"].textContent = pitchNote(analysis.pitchHz);
  elements["match-confidence"].textContent = `${Math.round(analysis.pitchConfidence * 100)}%`;
  elements["match-attack"].textContent = formatMatchTime(analysis.attackSeconds);
  elements["match-brightness"].textContent = analysis.brightnessHz > 0 ? `${Math.round(analysis.brightnessHz).toLocaleString()} Hz` : "—";
  elements["match-width"].textContent = `${Math.round(analysis.stereoWidth * 100)}%`;
  elements["match-peak"].textContent = formatMatchDb(analysis.peakDbfs);
  elements["match-rms"].textContent = formatMatchDb(analysis.rmsDbfs);
  renderMatchEnvelope(analysis); renderMatchWarnings(analysis.warnings); renderMatchAmpSuggestion(analysis); resetMatchFilterSuggestion();
}
function renderMatchDifferences(reference, candidate) {
  const difference = compareSoundAnalyses(reference, candidate);
  elements["match-diff-envelope"].textContent = Number.isFinite(difference.envelopeCorrelation) ? difference.envelopeCorrelation.toFixed(3) : "—";
  elements["match-diff-pitch"].textContent = formatMatchSigned(difference.pitchDeltaCents, "ct", 1);
  elements["match-diff-attack"].textContent = formatMatchSigned(difference.attackDeltaMs, "ms");
  elements["match-diff-brightness"].textContent = formatMatchSigned(difference.brightnessDeltaPercent, "%", 1);
  const referenceGain = levelMatchGain(reference); const candidateGain = levelMatchGain(candidate);
  const gainDb = ({ gain }) => gain > 0 ? 20 * Math.log10(gain) : null;
  elements["match-level-note"].textContent = `ACTIVE RMS ${MATCH_TARGET_RMS_DBFS} dBFS · A ${formatMatchSigned(gainDb(referenceGain), "dB", 1)} · B ${formatMatchSigned(gainDb(candidateGain), "dB", 1)} · PEAK ≤ −1 dBFS`;
}
async function renderMatchCoreDry(plan, patch, override = []) {
  const sampleRate = matchReferenceBuffer.sampleRate;
  const frames = Math.max(1, Math.ceil(plan.durationSeconds * sampleRate));
  const offline = new OfflineAudioContext(2, frames, sampleRate);
  const candidateSynth = await createSynthNode(offline, wasmBytes.slice(0));
  candidateSynth.connect(offline.destination);
  const replacements = new Map(override);
  const core = patch.core.map(([id, value]) => [id, replacements.has(id) ? replacements.get(id) : value]);
  const noteId = 9401;
  const events = [
    { frame:Math.min(frames - 1, Math.round(plan.noteOnSeconds * sampleRate)), kind:1, id:noteId, a:plan.midi, b:.82 },
    { frame:Math.min(frames - 1, Math.round(plan.noteOffSeconds * sampleRate)), kind:2, id:noteId, a:0, b:0 },
  ];
  await candidateSynth.batch(core, events);
  const buffer = await offline.startRendering();
  const channels = Array.from({ length:buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  return { buffer, analysis:analyzeSound({ channels, sampleRate:buffer.sampleRate }) };
}
async function calibrateMatchFilter(plan, patch, currentAnalysis, revision) {
  const probePlan = planFilterCutoffProbe({ filterEnabled:values.get(35), filterMode:values.get(36), currentCutoff:values.get(37), referenceBrightness:matchReferenceAnalysis?.brightnessHz, currentBrightness:currentAnalysis?.brightnessHz });
  renderMatchFilterSuggestion(probePlan);
  if (!probePlan.ready) return probePlan;
  try {
    const probe = await renderMatchCoreDry(plan, patch, [[37, probePlan.probeCutoff]]);
    if (revision !== matchCoreRevision) { resetMatchFilterSuggestion("パッチが変わりました。RENDER CURRENTで再較正してください。"); return null; }
    const result = estimateFilterCutoff(probePlan, probe.analysis.brightnessHz);
    renderMatchFilterSuggestion(result);
    return result;
  } catch (error) {
    const result = { ...probePlan, ready:false, available:false, state:"unavailable", reason:`Probe render failed: ${error.message}` };
    renderMatchFilterSuggestion(result);
    return result;
  }
}
async function renderMatchCandidate() {
  const plan = candidateRenderPlan(matchReferenceAnalysis, values.get(6));
  if (!plan.ready || !matchReferenceBuffer) { refreshMatchRenderAvailability(); return; }
  const revision = matchCoreRevision; const patch = capturePatch();
  resetMatchFilterSuggestion("CORE DRYを描画後にCutoff反応を較正します。");
  elements["match-render"].disabled = true; elements["match-render"].textContent = "RENDERING…";
  elements["match-render-note"].textContent = `${patch.name} · CORE DRYをオフライン描画しています。`;
  try {
    const rendered = await renderMatchCoreDry(plan, patch);
    if (revision !== matchCoreRevision) throw new Error("描画中にパッチが変わりました。もう一度描画してください。");
    matchCandidateBuffer = rendered.buffer; matchCandidateAnalysis = rendered.analysis;
    renderMatchDifferences(matchReferenceAnalysis, rendered.analysis); elements["match-ab"].hidden = false; updateMatchFlow(2);
    const filterResult = await calibrateMatchFilter(plan, patch, rendered.analysis, revision);
    if (revision !== matchCoreRevision) throw new Error("描画中にパッチが変わりました。もう一度描画してください。");
    elements["match-render-note"].textContent = `${patch.name} · ${midiNoteName(plan.midi)} · CORE DRYを描画済み。パッチ本体は変更していません。`;
    const filterStatus = filterResult?.state === "ready" ? " FILTER CUTOFF候補も較正しました。" : filterResult?.state === "aligned" ? " FILTER CUTOFFは許容差内です。" : " FILTER CUTOFFは現在値を保持します。";
    setStatus(`${patch.name}のCORE DRY候補を描画しました。${filterStatus} A/Bはactive RMSを揃えて再生します。`);
  } catch (error) {
    discardMatchCandidate(); elements["match-render-note"].textContent = `候補音を描画できません: ${error.message}`; setStatus(`候補音を描画できません: ${error.message}`, true);
  } finally {
    elements["match-render"].disabled = !candidateRenderPlan(matchReferenceAnalysis, values.get(6)).ready;
    elements["match-render"].textContent = matchCandidateBuffer ? "RE-RENDER CURRENT" : "RENDER CURRENT";
  }
}
async function playMatchedSource(kind) {
  const buffer = kind === "reference" ? matchReferenceBuffer : matchCandidateBuffer;
  const analysis = kind === "reference" ? matchReferenceAnalysis : matchCandidateAnalysis;
  if (!buffer || !analysis) return;
  try {
    await ensureAudio(); const level = levelMatchGain(analysis); if (!(level.gain > 0)) throw new Error("比較できる音量がありません");
    elements["match-audio"].pause(); stopMatchPlayback();
    const source = context.createBufferSource(); const gain = context.createGain(); source.buffer = buffer; gain.gain.value = level.gain; source.connect(gain); gain.connect(context.destination);
    matchPlayback = { source, gain, kind }; setMatchPlaybackButtons(kind); source.onended = () => { if (matchPlayback?.source === source) { matchPlayback = undefined; source.disconnect(); gain.disconnect(); setMatchPlaybackButtons(); } };
    source.start(); setStatus(`${kind === "reference" ? "A REFERENCE" : "B CURRENT"}を音量補正して再生しています。`);
  } catch (error) { stopMatchPlayback(); setStatus(`A/B再生できません: ${error.message}`, true); }
}
async function analyzeReferenceFile(file) {
  if (!file) return;
  discardMatchCandidate(); matchReferenceBuffer = undefined; matchReferenceAnalysis = undefined; matchAmpSuggestion = undefined; matchFilterSuggestion = undefined; elements["match-render"].disabled = true; updateMatchFlow(0);
  elements["match-empty"].hidden = false; elements["match-empty"].classList.remove("is-error"); elements["match-results"].hidden = true;
  elements["match-empty-title"].textContent = `${file.name}を解析しています…`; elements["match-empty-detail"].textContent = "現在のパッチは変更しません。";
  try {
    if (file.size > 64 * 1024 * 1024) throw new Error("64 MB以下の短い参照音を選んでください");
    await prepareAudio();
    const decoded = await context.decodeAudioData((await file.arrayBuffer()).slice(0));
    const channels = Array.from({ length:decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
    const analysis = analyzeSound({ channels, sampleRate:decoded.sampleRate });
    matchReferenceBuffer = decoded; matchReferenceAnalysis = analysis;
    if (matchAudioUrl) URL.revokeObjectURL(matchAudioUrl);
    matchAudioUrl = URL.createObjectURL(file); elements["match-audio"].src = matchAudioUrl;
    renderMatchAnalysis(file, analysis); elements["match-empty"].hidden = true; elements["match-results"].hidden = false; refreshMatchRenderAvailability(); updateMatchFlow(1);
    setStatus(`${file.name}をローカル解析しました。現在のパッチは変更していません。`);
  } catch (error) {
    if (matchAudioUrl) { URL.revokeObjectURL(matchAudioUrl); matchAudioUrl = undefined; }
    matchReferenceBuffer = undefined; matchReferenceAnalysis = undefined; discardMatchCandidate();
    elements["match-audio"].removeAttribute("src"); elements["match-empty"].classList.add("is-error");
    elements["match-empty-title"].textContent = "参照音を解析できませんでした。"; elements["match-empty-detail"].textContent = error.message;
    setStatus(`参照音を解析できません: ${error.message}`, true);
  } finally { elements["match-file"].value = ""; }
}
function installSoundMatch() {
  elements["match-file"].addEventListener("change", () => analyzeReferenceFile(elements["match-file"].files?.[0]));
  elements["match-render"].addEventListener("click", renderMatchCandidate);
  elements["match-amp-apply"].addEventListener("click", applyMatchAmpSuggestion);
  elements["match-filter-apply"].addEventListener("click", applyMatchFilterSuggestion);
  elements["match-play-a"].addEventListener("click", () => playMatchedSource("reference"));
  elements["match-play-b"].addEventListener("click", () => playMatchedSource("candidate"));
  elements["match-stop"].addEventListener("click", () => { stopMatchPlayback(); setStatus("A/B再生を停止しました。"); });
  elements["match-audio"].addEventListener("play", stopMatchPlayback);
}

function createMatrixSelect(id, label, options) {
  const cell = document.createElement("label"); cell.className = "matrix-cell";
  const caption = document.createElement("span"); caption.textContent = label;
  const input = document.createElement("select"); input.setAttribute("aria-label", `${label} ${Math.floor((id - 55) / 3) + 1}`);
  options.forEach((name, index) => input.add(new Option(name, String(index))));
  const output = document.createElement("output"); output.className = "matrix-readable";
  input.addEventListener("change", () => { setValue(id, Number(input.value)); input.blur(); });
  cell.append(caption, input, output); registerControl(id, { kind:"select", input, output, definition:{} }); updateControl(id); return cell;
}
function createMatrixAmount(id, rowNumber) {
  const cell = document.createElement("label"); cell.className = "matrix-cell matrix-amount";
  const caption = document.createElement("span"); caption.textContent = "AMOUNT";
  const input = document.createElement("input"); input.type = "range"; input.min = "-1"; input.max = "1"; input.step = ".001"; input.setAttribute("aria-label", `Amount ${rowNumber}`);
  const output = document.createElement("output"); output.className = "matrix-amount-value";
  input.addEventListener("input", () => setValue(id, Number(input.value)));
  input.addEventListener("dblclick", () => setValue(id, 0));
  cell.append(caption, input, output); registerControl(id, { kind:"matrix-amount", input, output, definition:{} }); updateControl(id); return cell;
}
function renderMatrixSummary() {
  const summary = document.getElementById("matrix-summary");
  if (!summary) return;
  summary.replaceChildren();
  for (let index = 0; index < 6; index += 1) {
    const ids = modulationSlotIds(index); const source = Math.round(values.get(ids.source) ?? 0); const destination = Math.round(values.get(ids.destination) ?? 0); const amount = values.get(ids.amount) ?? 0;
    if (!source || !destination) continue;
    const chip = document.createElement("span"); chip.textContent = `${MOD_SOURCES[source]} → ${MOD_DESTINATIONS[destination]} ${modulationAmountLabel(amount)}`; summary.append(chip);
  }
  if (!summary.childElementCount) { const empty = document.createElement("span"); empty.className = "is-empty"; empty.textContent = "No matrix assignments"; summary.append(empty); }
  document.querySelectorAll(".mod-assign").forEach((button) => {
    const destination = Number(button.dataset.destination); const connections = [];
    for (let index = 0; index < 6; index += 1) {
      const ids = modulationSlotIds(index); const source = Math.round(values.get(ids.source));
      if (source && Math.round(values.get(ids.destination)) === destination) connections.push(`${MOD_SOURCES[source]} ${modulationAmountLabel(values.get(ids.amount))}`);
    }
    button.textContent = connections.length ? `MOD · ${connections.length}` : "+ MOD";
    button.classList.toggle("has-routes", connections.length > 0);
    button.title = connections.length ? connections.join(" / ") : "変調元と深さを選んで接続";
    button.setAttribute("aria-label", `${MOD_DESTINATIONS[destination]}の変調を編集${connections.length ? ` · ${connections.length}接続` : ""}`);
  });
}
function renderMatrix() {
  const intro = document.createElement("p"); intro.className = "matrix-intro";
  intro.textContent = "6つの共有スロット。ここで直接編集するか、OSCのMODボタンから対象ごとに接続できます。深さ0%では変化しません。";
  const summary = document.createElement("div"); summary.id = "matrix-summary"; summary.className = "matrix-summary"; summary.setAttribute("aria-label", "現在のモジュレーション接続");
  const table = document.createElement("div"); table.className = "matrix-rows";
  for (let index = 0; index < 6; index += 1) {
    const ids = modulationSlotIds(index); const row = document.createElement("div"); row.className = "matrix-row";
    const number = document.createElement("strong"); number.textContent = String(index + 1).padStart(2, "0");
    const clear = document.createElement("button"); clear.type = "button"; clear.className = "matrix-clear"; clear.textContent = "CLEAR"; clear.setAttribute("aria-label", `MATRIX ${index + 1}を解除`); clear.addEventListener("click", () => { editMatrixSlot(index, 0, 0, 0); setStatus(`MATRIX ${index + 1}を解除しました。`); });
    row.append(number, createMatrixSelect(ids.source, "SOURCE", MOD_SOURCES), createMatrixSelect(ids.destination, "DESTINATION", MOD_DESTINATIONS), createMatrixAmount(ids.amount, index + 1), clear); table.append(row);
  }
  elements.matrix.replaceChildren(intro, summary, table); renderMatrixSummary();
}
function formatEffectValue(id, value) {
  if (id === "reverbMaterial") return REVERB_MATERIALS[value].label;
  if (id === "delayOn" || id === "reverbOn") return value ? "ON" : "BYPASS";
  if (id === "delayTime" || id === "reverbPreDelay") return `${Math.round(value * 1000)} ms`;
  if (id === "reverbDecay") return `${Number(value.toFixed(2))} s`;
  if (id === "delayTone" || id === "reverbLowCut" || id === "reverbHighCut") return `${Math.round(value).toLocaleString()} Hz`;
  return `${Math.round(value * 100)}%`;
}
function updateEffectControl(id) {
  const control = document.getElementById(`effect-${id}`);
  if (!control) return;
  const value = spaceValues[id];
  const input = control.querySelector("input,select");
  if (input.type === "checkbox") { input.checked = Boolean(value); input.nextElementSibling.textContent = value ? "ON" : "BYPASS"; } else input.value = String(value);
  control.querySelector("output").textContent = formatEffectValue(id, value);
  const range = effectRanges[id]; const amount = range ? (value - range[0]) / (range[1] - range[0]) : Number(value);
  control.querySelector(".dial")?.style.setProperty("--turn", `${-135 + amount * 270}deg`);
}
function setEffectValue(id, value) {
  if (id === "reverbMaterial") spaceValues[id] = Object.hasOwn(REVERB_MATERIALS, value) ? value : SPACE_DEFAULTS.reverbMaterial;
  else if (id === "delayOn" || id === "reverbOn") spaceValues[id] = Boolean(value);
  else { const range = effectRanges[id]; const number = Number(value); if (!range || !Number.isFinite(number)) return; spaceValues[id] = Math.min(range[1], Math.max(range[0], number)); }
  try { const next = spaceEffects?.setValues({ [id]:spaceValues[id] }); if (next) Object.assign(spaceValues, next); Object.keys(spaceValues).forEach(updateEffectControl); }
  catch (error) { setStatus(error.message, true); }
  schedulePatchCapture();
}
function createEffectToggle(id, label) {
  const field = document.createElement("div"); field.className = "control effect-toggle control-toggle"; field.id = `effect-${id}`;
  const labelElement = document.createElement("span"); labelElement.className = "control-label"; labelElement.textContent = label;
  const toggle = document.createElement("label"); toggle.className = "toggle"; const input = document.createElement("input"); input.type = "checkbox"; const text = document.createElement("span"); text.textContent = "ON / BYPASS"; input.addEventListener("change", () => setEffectValue(id, input.checked)); toggle.append(input, text);
  input.setAttribute("aria-label", `${id === "delayOn" ? "Delay" : "Reverb"} 有効`);
  const output = document.createElement("output"); output.className = "control-value"; field.append(labelElement, toggle, output); updateEffectControl(id); return field;
}
function createEffectControl(id, label, minimum, maximum) {
  const field = document.createElement("div"); field.className = "control"; field.id = `effect-${id}`;
  const labelElement = document.createElement("span"); labelElement.className = "control-label"; labelElement.textContent = label;
  const dial = document.createElement("div"); dial.className = "dial";
  const input = document.createElement("input"); input.type = "range"; input.min = String(minimum); input.max = String(maximum); input.step = "0.001"; input.setAttribute("aria-label", label); input.addEventListener("input", () => setEffectValue(id, input.value));
  const output = document.createElement("output"); output.className = "control-value";
  dial.append(input); field.append(labelElement, dial, output); updateEffectControl(id); return field;
}
function createEffectSelect(id, label, options) {
  const field = document.createElement("div"); field.className = "control control-select"; field.id = `effect-${id}`;
  const labelElement = document.createElement("span"); labelElement.className = "control-label"; labelElement.textContent = label;
  const input = document.createElement("select"); input.setAttribute("aria-label", label); options.forEach(([value, name]) => input.add(new Option(name, value))); input.addEventListener("change", () => { input.blur(); setEffectValue(id, input.value); });
  const output = document.createElement("output"); output.className = "control-value"; field.append(labelElement, input, output); updateEffectControl(id); return field;
}

const insertDefinitions = Object.freeze({
  distortion:{ label:"DISTORTION", color:"#F2A26B", controls:[{id:"drive",label:"DRIVE",min:0,max:1},{id:"tone",label:"TONE",min:800,max:18000},{id:"mix",label:"MIX",min:0,max:1}] },
  chorus:{ label:"CHORUS", color:"#68C7BB", controls:[{id:"rate",label:"RATE",min:.05,max:5},{id:"depth",label:"DEPTH",min:0,max:1},{id:"width",label:"WIDTH",min:0,max:1},{id:"mix",label:"MIX",min:0,max:.65}] },
  eq:{ label:"3-BAND EQ", color:"#DCE95A", controls:[{id:"low",label:"LOW",min:-18,max:18},{id:"mid",label:"MID",min:-18,max:18},{id:"high",label:"HIGH",min:-18,max:18}] },
  compressor:{ label:"COMPRESSOR", color:"#F5F0E8", controls:[{id:"threshold",label:"THRESH",min:-60,max:0},{id:"ratio",label:"RATIO",min:1,max:20},{id:"attack",label:"ATTACK",min:.001,max:.2},{id:"release",label:"RELEASE",min:.03,max:1},{id:"makeup",label:"MAKEUP",min:0,max:12}] },
});
function formatInsertValue(effect, id, value) {
  if (["mix", "drive", "depth", "width"].includes(id)) return `${Math.round(value * 100)}%`;
  if (id === "tone") return `${Math.round(value).toLocaleString()} Hz`;
  if (["low", "mid", "high", "threshold", "makeup"].includes(id)) return `${value > 0 ? "+" : ""}${Number(value.toFixed(1))} dB`;
  if (id === "ratio") return `${Number(value.toFixed(1))}:1`;
  if (id === "rate") return `${Number(value.toFixed(2))} Hz`;
  if (id === "attack" || id === "release") return `${Math.round(value * 1000)} ms`;
  return Number(value.toFixed(3)).toString();
}
function applyInsertPatch(id, patch) {
  try { Object.assign(fxValues.modules[id], patch); syncInsertFxCore(); }
  catch (error) { setStatus(error.message, true); }
  schedulePatchCapture();
}
function syncInsertFxCore() {
  for (const [paramId, value] of fxCoreParams(fxValues)) {
    if (!parameterInfo.has(paramId)) continue;
    values.set(paramId, value);
    synth?.setParam(paramId, value);
  }
}
function moveInsert(id, direction) {
  const index = fxValues.order.indexOf(id); const nextIndex = index + direction; if (nextIndex < 0 || nextIndex >= fxValues.order.length) return;
  const order = [...fxValues.order]; [order[index], order[nextIndex]] = [order[nextIndex], order[index]]; fxValues.order = order; syncInsertFxCore(); renderInsertRack(); setStatus(`Insert順序: ${order.map((item) => insertDefinitions[item].label).join(" → ")}`);
  const card = elements["insert-rack"].querySelector(`[data-effect="${id}"]`);
  const target = card?.querySelector(`[data-direction="${direction}"]`);
  (target && !target.disabled ? target : card?.querySelector(".insert-toggle"))?.focus();
  schedulePatchCapture();
}
function renderInsertRack() {
  elements["insert-rack"].replaceChildren();
  fxValues.order.forEach((id, index) => {
    const definition = insertDefinitions[id]; const module = fxValues.modules[id]; const card = document.createElement("section"); card.className = "insert-card"; card.style.setProperty("--insert-color", definition.color); card.dataset.effect = id;
    const header = document.createElement("div"); header.className = "insert-heading"; const title = document.createElement("h3"); title.textContent = `${String(index + 1).padStart(2, "0")} ${definition.label}`;
    const actions = document.createElement("div"); const toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "insert-toggle"; toggle.setAttribute("aria-pressed", String(module.on)); toggle.textContent = module.on ? "ON" : "BYPASS"; toggle.addEventListener("click", () => { module.on = !module.on; applyInsertPatch(id, { on:module.on }); toggle.textContent = module.on ? "ON" : "BYPASS"; toggle.setAttribute("aria-pressed", String(module.on)); card.classList.toggle("is-on", module.on); });
    toggle.setAttribute("aria-label", `${definition.label} 有効`);
    const up = document.createElement("button"); up.type = "button"; up.className = "insert-move"; up.dataset.direction = "-1"; up.textContent = "↑"; up.disabled = index === 0; up.setAttribute("aria-label", `${definition.label}を前へ`); up.addEventListener("click", () => moveInsert(id, -1));
    const down = document.createElement("button"); down.type = "button"; down.className = "insert-move"; down.dataset.direction = "1"; down.textContent = "↓"; down.disabled = index === fxValues.order.length - 1; down.setAttribute("aria-label", `${definition.label}を後へ`); down.addEventListener("click", () => moveInsert(id, 1)); actions.append(toggle, up, down); header.append(title, actions);
    const controls = document.createElement("div"); controls.className = "insert-controls";
    definition.controls.forEach((control) => { const field = document.createElement("label"); field.className = "insert-control"; const caption = document.createElement("span"); caption.textContent = control.label; const input = document.createElement("input"); input.type = "range"; input.min = String(control.min); input.max = String(control.max); input.step = String(Math.max((control.max - control.min) / 500, .001)); input.value = String(module[control.id]); input.setAttribute("aria-label", `${definition.label} ${control.label}`); const output = document.createElement("output"); output.textContent = formatInsertValue(id, control.id, module[control.id]); input.addEventListener("input", () => { const value = Number(input.value); module[control.id] = value; output.textContent = formatInsertValue(id, control.id, value); applyInsertPatch(id, { [control.id]:value }); }); input.addEventListener("dblclick", () => { const value = FX_DEFAULTS.modules[id][control.id]; input.value = String(value); module[control.id] = value; output.textContent = formatInsertValue(id, control.id, value); applyInsertPatch(id, { [control.id]:value }); }); field.append(caption, input, output); controls.append(field); });
    card.append(header, controls); card.classList.toggle("is-on", module.on); elements["insert-rack"].append(card);
  });
}
function renderControls() { Object.entries(groups).forEach(([target, definitions]) => { const container = elements[target]; definitions.filter((definition) => parameterInfo.has(definition.id)).forEach((definition) => container.append(createControl(definition))); }); renderInsertRack(); elements.delay.append(createEffectToggle("delayOn", "MODULE"), createEffectControl("delayTime", "TIME", .03, 1.5), createEffectControl("delayFeedback", "FEEDBACK", 0, .85), createEffectControl("delayTone", "TONE", 800, 18000), createEffectControl("delayMix", "MIX", 0, .65)); elements.reverb.append(createEffectToggle("reverbOn", "MODULE"), createEffectSelect("reverbMaterial", "MATERIAL", Object.entries(REVERB_MATERIALS).map(([id, material]) => [id, material.label])), createEffectControl("reverbSize", "SIZE", 0, 1), createEffectControl("reverbDecay", "DECAY", .3, 8), createEffectControl("reverbDamping", "DAMPING", 0, 1), createEffectControl("reverbPreDelay", "PRE-DELAY", 0, .1), createEffectControl("reverbLowCut", "LOW CUT", 20, 1000), createEffectControl("reverbHighCut", "HIGH CUT", 1000, 18000), createEffectControl("reverbWidth", "WIDTH", 0, 1), createEffectControl("reverbMix", "MIX", 0, .65)); renderMatrix(); const advanced = [...parameterInfo.values()].filter((parameter) => !primaryIds.has(parameter.id) && !matrixParamIds.has(parameter.id) && !qualityParamIds.has(parameter.id) && !insertFxParamIds.has(parameter.id)); advanced.forEach((parameter) => elements["advanced-controls"].append(createControl({ id:parameter.id, label:parameter.displayName }, true))); }
function loadUserPatches() {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKeys.patches) ?? "[]");
    if (!Array.isArray(parsed)) throw new TypeError("saved patch list must be an array");
    userPatches = parsed.slice(0, MAX_USER_PATCHES).map((item, index) => ({ id:String(item.id ?? `custom-${index}`), patch:validatePatch(item.patch) }));
  } catch { userPatches = []; }
}
function storeUserPatches(patches = userPatches) { localStorage.setItem(storageKeys.patches, JSON.stringify(patches)); }
function renderPresets(selectedId = elements.preset.value || "epiano") {
  const search = elements["preset-search"].value.trim().toLocaleLowerCase(); const category = elements["preset-category"].value;
  const options = [
    ...Object.entries(presets).map(([id, preset]) => ({ id, label:preset.label, category:presetCategories[id] })),
    ...userPatches.map((item) => ({ id:item.id, label:item.patch.name, category:item.patch.category })),
  ].filter((item) => (category === "All" || item.category === category) && (!search || `${item.label} ${item.category}`.toLocaleLowerCase().includes(search)));
  elements.preset.replaceChildren();
  for (const item of options) { const option = new Option(`${item.label} · ${item.category}`, item.id); elements.preset.add(option); }
  if (!options.some((item) => item.id === selectedId)) {
    const suffix = options.length ? "CURRENT" : "CURRENT · 該当なし";
    const option = new Option(`${currentPatchName()} · ${suffix}`, selectedId); option.disabled = true; elements.preset.prepend(option);
  }
  // Filtering is not loading: never advertise another patch before it has been selected.
  elements.preset.value = selectedId;
}
function syncPresetIdentity(name, category) {
  const custom = userPatches.find((item) => item.patch.name === name && item.patch.category === category);
  const builtin = Object.entries(presets).find(([id, preset]) => preset.label === name && presetCategories[id] === category);
  const id = custom?.id ?? builtin?.[0];
  renderPresets(id ?? "current");
}

function currentPatchName() {
  return activePatchIdentity.name;
}
function currentPatchCategory() {
  return activePatchIdentity.category;
}
function capturePatch(name = currentPatchName(), category = currentPatchCategory()) {
  return createPatchSnapshot({ name, category, core:[...values.entries()].filter(([id]) => !insertFxParamIds.has(id)), space:{ ...spaceValues }, fx:structuredClone(fxValues) });
}
function updateHistoryButtons() { const state = patchHistory?.state() ?? { canUndo:false, canRedo:false }; elements.undo.disabled = !state.canUndo; elements.redo.disabled = !state.canRedo; }
function saveAutosave(patch = capturePatch()) { try { localStorage.setItem(storageKeys.autosave, serializePatch(patch)); } catch (error) { setStatus(`自動保存できません: ${error.message}`, true); } }
function schedulePatchCapture() {
  if (applyingPatch || !patchHistory) return;
  clearTimeout(captureTimer);
  captureTimer = setTimeout(() => { captureTimer = undefined; const patch = capturePatch(); patchHistory.push(patch); saveAutosave(patch); updateHistoryButtons(); }, 180);
}
function applyPatch(candidate, { resetHistory = false, message } = {}) {
  const patch = validatePatch(candidate); applyingPatch = true; clearTimeout(captureTimer); captureTimer = undefined; stopAllNotes();
  try {
    activePatchIdentity = { name:patch.name, category:patch.category };
    syncPresetIdentity(patch.name, patch.category);
    restoreDefaults();
    for (const [id, value] of patch.core) { const parameter = parameterInfo.get(id); if (parameter) values.set(id, Math.min(parameter.max, Math.max(parameter.min, value))); }
    let customFallback = false;
    for (const id of [0, 17]) {
      if (Math.round(values.get(id)) === CUSTOM_WAVETABLE_SLOT && !customWavetable.frames) {
        values.set(id, 0); customFallback = true;
      }
    }
    [...values.keys()].forEach(updateControl);
    Object.assign(spaceValues, SPACE_DEFAULTS, patch.space);
    for (const [id, range] of Object.entries(effectRanges)) spaceValues[id] = Math.min(range[1], Math.max(range[0], spaceValues[id]));
    const appliedSpace = spaceEffects?.setValues(spaceValues); if (appliedSpace) Object.assign(spaceValues, appliedSpace); Object.keys(spaceValues).forEach(updateEffectControl);
    fxValues.order = [...patch.fx.order]; FX_IDS.forEach((id) => Object.assign(fxValues.modules[id], patch.fx.modules[id])); syncInsertFxCore(); renderInsertRack();
    if (synth) { synth.reset(1); [...values.entries()].forEach(([id, value]) => synth.setParam(id, value)); }
    markMatchCoreChanged();
    if (resetHistory) patchHistory?.reset(capturePatch(patch.name, patch.category));
    saveAutosave(capturePatch(patch.name, patch.category)); updateHistoryButtons();
    const restored = message ?? `${patch.name}を復元しました。音源・変調・FX・順序を適用済みです。`;
    setStatus(customFallback ? `${restored} CUSTOM WTの音声は保存されないためBasic Shapesへ戻しました。` : restored);
  } finally { applyingPatch = false; }
}

function closeSavePanel() {
  elements["patch-save-overlay"].hidden = true; saveReplacePending = false; elements["patch-save-warning"].textContent = ""; elements["patch-save-confirm"].textContent = "SAVE"; saveReturnFocus?.focus(); saveReturnFocus = undefined;
}
function openSavePanel() {
  saveReturnFocus = document.activeElement; saveReplacePending = false; elements["patch-name"].value = currentPatchName(); elements["patch-save-category"].value = currentPatchCategory();
  if (![...elements["patch-save-category"].options].some((option) => option.value === currentPatchCategory())) elements["patch-save-category"].value = "Custom";
  elements["patch-save-warning"].textContent = `このブラウザへ最大${MAX_USER_PATCHES}件保存できます。`; elements["patch-save-confirm"].textContent = "SAVE"; elements["patch-save-overlay"].hidden = false; elements["patch-name"].focus(); elements["patch-name"].select();
}
function saveNamedPatch() {
  const trimmed = elements["patch-name"].value.trim();
  if (!trimmed) { elements["patch-save-warning"].textContent = "パッチ名を入力してください。"; elements["patch-name"].focus(); return; }
  const existing = userPatches.find((item) => item.patch.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase());
  if (existing && !saveReplacePending) { saveReplacePending = true; elements["patch-save-warning"].textContent = `「${existing.patch.name}」は保存済みです。置き換える場合はREPLACEを押してください。`; elements["patch-save-confirm"].textContent = "REPLACE"; return; }
  if (!existing && userPatches.length >= MAX_USER_PATCHES) { elements["patch-save-warning"].textContent = `最大${MAX_USER_PATCHES}件です。既存名を指定して置き換えるか、先にJSONへ書き出してください。`; return; }
  const patch = capturePatch(trimmed, elements["patch-save-category"].value); const id = existing?.id ?? `custom-${Date.now()}`;
  const nextPatches = existing ? userPatches.map((item) => item === existing ? { id, patch } : item) : [...userPatches, { id, patch }];
  try { storeUserPatches(nextPatches); userPatches = nextPatches; activePatchIdentity = { name:patch.name, category:patch.category }; renderPresets(id); patchHistory.reset(patch); updateHistoryButtons(); closeSavePanel(); setStatus(`${trimmed}を名前付き保存しました（${userPatches.length}/${MAX_USER_PATCHES}）。`); }
  catch (error) { elements["patch-save-warning"].textContent = `保存できません: ${error.message}`; setStatus(`名前付き保存できません: ${error.message}`, true); }
}
function exportCurrentPatch() {
  const patch = capturePatch(); const blob = new Blob([serializePatch(patch)], { type:"application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `${patch.name.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "") || "synth-patch"}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0); setStatus(`${patch.name}をJSON書き出ししました。`);
}
async function importPatchFile(file) {
  if (!file) return; const before = capturePatch();
  try { const patch = parsePatch(await file.text()); applyPatch(patch, { resetHistory:true, message:`${patch.name}をJSONから読み込みました。名前付き保存はまだ行っていません。` }); }
  catch (error) { applyPatch(before, { message:`JSONを読み込めません: ${error.message}。元のパッチを保持しました。` }); setStatus(`JSONを読み込めません: ${error.message}。元のパッチを保持しました。`, true); }
  finally { elements["patch-file"].value = ""; }
}

async function fetchChecked(url, type = "arrayBuffer") { const response = await fetch(url); if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`); return response[type](); }
function restoreDefaults() { for (const parameter of parameterInfo.values()) values.set(parameter.id, parameter.default); [...values.keys()].forEach(updateControl); }
async function loadPreset(id) {
  const custom = userPatches.find((item) => item.id === id); if (custom) { applyPatch(custom.patch, { resetHistory:true }); return; }
  const preset = presets[id]; if (!preset) throw new Error(`unknown preset: ${id}`); const text = await fetchChecked(`${paths.presets}${preset.file}`, "text"); const updates = parsePreset(text); applyingPatch = true; activePatchIdentity = { name:preset.label, category:presetCategories[id] }; stopAllNotes(); restoreDefaults(); updates.forEach(([paramId, value]) => { if (parameterInfo.has(paramId)) values.set(paramId, value); }); [...values.keys()].forEach(updateControl); Object.assign(spaceValues, SPACE_DEFAULTS, preset.space); const applied = spaceEffects?.setValues(spaceValues); if (applied) Object.assign(spaceValues, applied); Object.keys(spaceValues).forEach(updateEffectControl); fxValues.order = [...FX_DEFAULTS.order]; FX_IDS.forEach((effectId) => Object.assign(fxValues.modules[effectId], FX_DEFAULTS.modules[effectId])); syncInsertFxCore(); renderInsertRack(); if (synth) { synth.reset(1); synth.loadPreset(text); syncInsertFxCore(); } applyingPatch = false; markMatchCoreChanged(); const patch = capturePatch(preset.label, presetCategories[id]); patchHistory?.reset(patch); saveAutosave(patch); updateHistoryButtons(); setStatus(`${preset.label} — ${preset.description}`);
}
function initPatch() { applyingPatch = true; activePatchIdentity = { name:"INIT", category:"Custom" }; stopAllNotes(); restoreDefaults(); Object.assign(spaceValues, SPACE_DEFAULTS); const applied = spaceEffects?.setValues(spaceValues); if (applied) Object.assign(spaceValues, applied); Object.keys(spaceValues).forEach(updateEffectControl); fxValues.order = [...FX_DEFAULTS.order]; FX_IDS.forEach((id) => Object.assign(fxValues.modules[id], FX_DEFAULTS.modules[id])); syncInsertFxCore(); renderInsertRack(); synth?.reset(1); syncInsertFxCore(); applyingPatch = false; markMatchCoreChanged(); const patch = capturePatch("INIT", "Custom"); patchHistory?.reset(patch); saveAutosave(patch); updateHistoryButtons(); setStatus("INITへ戻しました。DelayとInsertはBYPASS、ReverbはONです。"); }
function prepareAudio() {
  if (audioReady) return audioReady;
  const preparedContext = new AudioContext();
  const preparedOutputGate = preparedContext.createGain();
  preparedOutputGate.gain.value = 0;
  preparedOutputGate.connect(preparedContext.destination);
  context = preparedContext;
  outputGate = preparedOutputGate;
  audioReady = (async () => {
    try {
      const node = await createSynthNode(preparedContext, wasmBytes.slice(0));
      node.connect(preparedOutputGate);
      spaceEffects = createSpaceEffects(preparedContext, node, preparedOutputGate);
      spaceEffects.setValues(spaceValues);
      synth = node;
      [...values.entries()].forEach(([id, value]) => synth.setParam(id, value));
      return node;
    } catch (error) {
      if (context === preparedContext) { context = undefined; synth = undefined; audioReady = undefined; outputGate = undefined; }
      await preparedContext.close().catch(() => {});
      throw error;
    }
  })();
  return audioReady;
}
function openOutputGate() {
  if (!context || !outputGate) return;
  const gain = outputGate.gain; const at = Number.isFinite(context.currentTime) ? context.currentTime : 0;
  gain.cancelScheduledValues?.(at);
  const current = Math.min(1, Math.max(0, Number(gain.value) || 0));
  if (typeof gain.setValueAtTime === "function" && typeof gain.linearRampToValueAtTime === "function") {
    gain.setValueAtTime(current, at);
    gain.linearRampToValueAtTime(1, at + .025);
  } else gain.value = 1;
}
function closeOutputGate() {
  if (!context || !outputGate) return;
  const at = Number.isFinite(context.currentTime) ? context.currentTime : 0;
  outputGate.gain.cancelScheduledValues?.(at);
  outputGate.gain.value = 0;
}
async function ensureAudio(shouldOpen = () => true) {
  const ready = prepareAudio();
  const wasSuspended = context.state !== "running";
  const resumed = context.resume();
  const node = await ready;
  await resumed;
  if (shouldOpen()) {
    openOutputGate();
    if (wasSuspended) setStatus("音源を開始しました。鍵盤またはPCキーで演奏できます。");
  }
  return node;
}
async function startNote(note, token, keyElement) {
  const ticket = noteRegistry.begin(token, keyElement);
  if (!ticket) return;
  audioSessionChannel?.postMessage({ type:"claim", owner:audioSessionId });
  try {
    const node = await ensureAudio(() => noteRegistry.isPending(ticket));
    if (!noteRegistry.isPending(ticket)) return;
    const handle = node.noteOn(note, .82);
    if (!noteRegistry.activate(ticket, node, handle)) node.noteOff(handle);
  } catch (error) {
    if (noteRegistry.cancel(ticket)) setStatus(error.message, true);
  }
}
function stopNote(token) {
  const active = noteRegistry.release(token);
  if (!active) return;
  try { active.node.noteOff(active.handle); }
  catch (error) { setStatus(`ノート停止を再試行しました: ${error.message}`, true); active.node.reset?.(1); }
}
function stopAllNotes() {
  const active = noteRegistry.drain();
  for (const note of active) {
    try { note.node.noteOff(note.handle); }
    catch { /* The reset below is the authoritative recovery path. */ }
  }
  pointerNoteTokens.clear();
  return active.length;
}
function panicAudio({ broadcast = false } = {}) {
  stopAllNotes();
  try { synth?.reset(1); }
  finally { closeOutputGate(); }
  if (broadcast) audioSessionChannel?.postMessage({ type:"panic", owner:audioSessionId });
}
function installWavetableImport() {
  const input = elements["wavetable-file"];
  elements["load-wavetable"].addEventListener("click", () => input.click());
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const parsed = parseWavetableWav(await file.arrayBuffer());
      elements["wavetable-import-state"].textContent = "LOADING · OUTPUT MUTED";
      stopAllNotes(); closeOutputGate();
      const node = await ensureAudio(() => false);
      closeOutputGate(); node.reset(0);
      const loaded = await node.loadWavetable(CUSTOM_WAVETABLE_SLOT, parsed.frames);
      customWavetable.frames = parsed.frames.slice();
      customWavetable.frameCount = parsed.frameCount;
      customWavetable.sampleRate = parsed.sampleRate;
      customWavetable.name = file.name;
      visualFrameGain.clear();
      renderWaveform("wave-a", 0, 1); renderWaveform("wave-b", 17, 18);
      elements["wavetable-import-state"].textContent =
        `READY · ${parsed.frameCount}F · ${parsed.sampleRate.toLocaleString()} Hz`;
      setStatus(`${file.name}をCUSTOM WTへ読み込みました（${parsed.frameCount}フレーム、${loaded.loadMs.toFixed(1)} ms）。出力はミュート中です。WAVEでCustom · Sessionを選び、鍵盤を押すと再開します。`);
    } catch (error) {
      elements["wavetable-import-state"].textContent = customWavetable.frames
        ? `READY · PREVIOUS KEPT` : "ERROR · NOT LOADED";
      setStatus(`CUSTOM WTを読み込めません: ${error.message}。${customWavetable.frames ? "直前の波形を保持しました。" : "既定波形を保持しました。"}`, true);
    } finally { input.value = ""; }
  });
}
function installAudioSession() {
  audioSessionChannel?.addEventListener("message", (event) => {
    const message = event.data;
    if (message?.owner === audioSessionId || !["claim", "panic"].includes(message?.type)) return;
    panicAudio();
  });
}
function finishPointerNote(pointerId) {
  const token = pointerNoteTokens.get(pointerId);
  if (!token) return;
  pointerNoteTokens.delete(pointerId);
  stopNote(token);
}
function renderPiano() { const black = new Set([1,3,6,8,10]); const whiteNotes = []; for (let note = 60; note <= 84; note += 1) if (!black.has(note % 12)) whiteNotes.push(note); whiteNotes.forEach((note) => { const key = document.createElement("button"); key.type="button"; key.className="piano-key white"; key.dataset.note=String(note); key.innerHTML=`<span>${note % 12 === 0 ? `C${Math.floor(note / 12) - 1}` : ""}</span>`; bindKey(key, note); elements.piano.append(key); }); for (let note = 60; note <= 83; note += 1) { if (!black.has(note % 12)) continue; const whiteBefore = whiteNotes.filter((white) => white < note).length; const key = document.createElement("button"); key.type="button"; key.className="piano-key black"; key.style.left=`calc(${whiteBefore} / 15 * 100% - (100% / 15 * .36))`; key.dataset.note=String(note); key.innerHTML="<span></span>"; bindKey(key, note); elements.piano.append(key); } }
function bindKey(element, note) {
  element.setAttribute("aria-label", `${midiNoteName(note)}を演奏`);
  element.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    event.preventDefault(); if (!event.repeat) startNote(note, `accessible-${note}`, element);
  });
  element.addEventListener("keyup", (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); stopNote(`accessible-${note}`); } });
  element.addEventListener("blur", () => stopNote(`accessible-${note}`));
  const finish = (event) => finishPointerNote(event.pointerId);
  element.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || pointerNoteTokens.has(event.pointerId)) return;
    event.preventDefault();
    const token = `pointer-${event.pointerId}-${note}`;
    pointerNoteTokens.set(event.pointerId, token);
    try { element.setPointerCapture(event.pointerId); }
    catch { /* Window-level pointerup remains the fallback. */ }
    startNote(note, token, element);
  });
  element.addEventListener("pointerup", finish);
  element.addEventListener("pointercancel", finish);
  element.addEventListener("lostpointercapture", finish);
  element.addEventListener("pointerleave", (event) => { if (!element.hasPointerCapture?.(event.pointerId)) finish(event); });
}
function installKeyboard() {
  window.addEventListener("keydown", (event) => { if (event.key === "Escape") { panicAudio({ broadcast:true }); return; } if (event.repeat || elements["mod-dialog"].open || !elements["patch-save-overlay"].hidden || event.target.matches('input:not([type="range"]),select,textarea')) return; const note = keyboardMap[event.code] ?? keyboardKeyMap[event.key?.toLowerCase()]; if (note === undefined) return; event.preventDefault(); startNote(note, `keyboard-${note}`, elements.piano.querySelector(`[data-note="${note}"]`)); }, true);
  window.addEventListener("keyup", (event) => { const note = keyboardMap[event.code] ?? keyboardKeyMap[event.key?.toLowerCase()]; if (note !== undefined) stopNote(`keyboard-${note}`); }, true);
  window.addEventListener("pointerup", (event) => finishPointerNote(event.pointerId), true);
  window.addEventListener("pointercancel", (event) => finishPointerNote(event.pointerId), true);
  window.addEventListener("mouseup", () => { for (const pointerId of [...pointerNoteTokens.keys()]) finishPointerNote(pointerId); }, true);
  window.addEventListener("blur", panicAudio);
  window.addEventListener("pagehide", panicAudio);
  document.addEventListener("visibilitychange", () => { if (document.hidden) panicAudio(); });
}

elements.init.addEventListener("click", () => { initPatch(); syncPresetIdentity("INIT", "Custom"); });
elements.preset.addEventListener("change", () => { const id = elements.preset.value; elements.preset.blur(); loadPreset(id).catch((error) => setStatus(error.message, true)); });
elements["preset-search"].addEventListener("input", () => renderPresets()); elements["preset-category"].addEventListener("change", () => renderPresets());
elements["save-patch"].addEventListener("click", openSavePanel);
elements["patch-save-panel"].addEventListener("submit", (event) => { event.preventDefault(); saveNamedPatch(); });
elements["patch-save-cancel"].addEventListener("click", closeSavePanel);
elements["patch-name"].addEventListener("input", () => { saveReplacePending = false; elements["patch-save-confirm"].textContent = "SAVE"; elements["patch-save-warning"].textContent = `このブラウザへ最大${MAX_USER_PATCHES}件保存できます。`; });
elements["patch-save-overlay"].addEventListener("click", (event) => { if (event.target === elements["patch-save-overlay"]) closeSavePanel(); });
elements["patch-save-overlay"].addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault(); closeSavePanel(); } });
elements.undo.addEventListener("click", () => { capturePendingEdit(); const patch = patchHistory?.undo(); if (patch) applyPatch(patch, { message:`UNDO — ${patch.name}` }); updateHistoryButtons(); });
elements.redo.addEventListener("click", () => { capturePendingEdit(); const patch = patchHistory?.redo(); if (patch) applyPatch(patch, { message:`REDO — ${patch.name}` }); updateHistoryButtons(); });
elements["export-patch"].addEventListener("click", exportCurrentPatch); elements["import-patch"].addEventListener("click", () => elements["patch-file"].click()); elements["patch-file"].addEventListener("change", () => importPatchFile(elements["patch-file"].files?.[0]));

try {
  wasmBytes = await fetchChecked(paths.wasm); const parameters = await getParams(wasmBytes); parameters.forEach((parameter) => { parameterInfo.set(parameter.id, parameter); values.set(parameter.id, parameter.default); });
  const savedAutosave = localStorage.getItem(storageKeys.autosave); loadUserPatches(); renderPresets(); renderControls(); renderPiano(); installTabs(); installEditorBanks(); installModDialog(); installQualityLab(); installWavetableImport(); installSoundMatch();
  const requestedTab = urlParams.get("tab");
  if (tabOrder.includes(requestedTab)) selectTab(requestedTab);
  installAudioSession(); installKeyboard(); await loadPreset(elements.preset.value); patchHistory = createPatchHistory(capturePatch());
  if (savedAutosave) { try { const restored = parsePatch(savedAutosave); applyPatch(restored, { resetHistory:true, message:`前回の自動保存「${restored.name}」を復元しました。` }); } catch (error) { setStatus(`自動保存は復元せず、EPianoを保持しました: ${error.message}`, true); } }
  await prepareAudio(); updateHistoryButtons(); if (!elements.status.classList.contains("error") && !savedAutosave) setStatus("準備完了。鍵盤またはPCキーを押すと音源を開始します。");
} catch (error) { setStatus(error.message, true); }
