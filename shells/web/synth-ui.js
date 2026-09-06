import { createSynthNode, getParams, parsePreset } from "./synth-node.js";
import { REVERB_MATERIALS, SPACE_DEFAULTS, createSpaceEffects } from "./space-effects.js";

const paths = { wasm: "../../build/synth_engine.wasm", presets: "../../presets/" };
const presets = Object.freeze({
  epiano: { label:"EPiano", file:"rsk_epiano.txt", description:"やわらかい電気鍵盤" },
  saw: { label:"Saw", file:"rsk_saw.txt", description:"ユニゾンのある鋸歯波" },
  pluck: { label:"Pluck", file:"rsk_pluck.txt", description:"短いノイズを含むプラック" },
  bell: { label:"Bell", file:"rsk_bell.txt", description:"FM由来のベル" },
  widePad: { label:"Wide Pad", file:"studio_wide_pad.txt", description:"広がりを持つ持続和音", space:{ delaySend:.06, delayMix:.08, delayTime:.48, reverbSend:1, reverbMix:.42, reverbMaterial:"warm" } },
  warmBass: { label:"Warm Bass", file:"studio_warm_bass.txt", description:"低域を支える短いベース", space:{ delaySend:0, delayMix:.08, delayTime:.24, reverbSend:.42, reverbMix:.08, reverbMaterial:"warm" } },
  glassBell: { label:"Glass Bell", file:"studio_glass_bell.txt", description:"硬質で長く残るベル", space:{ delaySend:.12, delayMix:.16, delayTime:.42, reverbSend:1, reverbMix:.34, reverbMaterial:"clear" } },
  brightPluck: { label:"Bright Pluck", file:"studio_bright_pluck.txt", description:"明るく減衰するプラック", space:{ delaySend:.08, delayMix:.12, delayTime:.3, reverbSend:.75, reverbMix:.18, reverbMaterial:"grain" } },
  motionLead: { label:"Motion Lead", file:"studio_motion_lead.txt", description:"ゆっくり表情が動くリード", space:{ delaySend:.1, delayMix:.12, delayTime:.32, reverbSend:.8, reverbMix:.2, reverbMaterial:"grain" } },
  airKeys: { label:"Air Keys", file:"studio_air_keys.txt", description:"空気感を残す鍵盤音", space:{ delaySend:.02, delayMix:.08, delayTime:.36, reverbSend:1, reverbMix:.3, reverbMaterial:"warm" } },
});
const groups = Object.freeze({
  "global-controls": [{ id: 7, label: "VOLUME" }, { id: 8, label: "VOICES" }, { id: 75, label: "FX BUS" }],
  "osc-a": [{ id: 0, label: "WAVE", type: "select", options: ["Morph", "Saw", "Square", "Triangle"] }, { id: 1, label: "MORPH" }, { id: 2, label: "LEVEL" }, { id: 9, label: "UNISON" }, { id: 10, label: "DETUNE" }, { id: 12, label: "OCTAVE" }],
  "osc-b": [{ id: 17, label: "WAVE", type: "select", options: ["Morph", "Saw", "Square", "Triangle"] }, { id: 19, label: "LEVEL" }, { id: 28, label: "FM → A" }, { id: 29, label: "SUB" }, { id: 32, label: "NOISE" }, { id: 31, label: "SUB OCT" }],
  filter: [{ id: 35, label: "ON", type: "toggle" }, { id: 36, label: "MODE", type: "select", options: ["LP12", "LP24", "BP12", "BP24", "HP12", "NOTCH"] }, { id: 37, label: "CUTOFF", scale: "log" }, { id: 38, label: "RESONANCE" }, { id: 39, label: "KEY TRACK" }, { id: 40, label: "ENV AMOUNT" }],
  amp: [{ id: 3, label: "ATTACK" }, { id: 4, label: "DECAY" }, { id: 5, label: "SUSTAIN" }, { id: 6, label: "RELEASE" }],
  mod: [{ id: 46, label: "RATE" }, { id: 47, label: "SHAPE", type: "select", options: ["Sine", "Triangle", "Saw Up", "Saw Down", "Square", "S&H"] }, { id: 49, label: "TO FILTER" }, { id: 50, label: "TO PITCH" }, { id: 73, label: "MACRO 1" }, { id: 74, label: "MACRO 2" }],
});
const primaryIds = new Set(Object.values(groups).flat().map((control) => control.id));
const keyboardMap = Object.freeze({ KeyA:60, KeyW:61, KeyS:62, KeyE:63, KeyD:64, KeyF:65, KeyT:66, KeyG:67, KeyY:68, KeyH:69, KeyU:70, KeyJ:71, KeyK:72 });
const elements = Object.fromEntries([...document.querySelectorAll("[id]")].map((element) => [element.id, element]));
const parameterInfo = new Map();
const values = new Map();
const controlsById = new Map();
const activeNotes = new Map();
const pendingNotes = new Map();
let wasmBytes;
let context;
let synth;
let audioReady;
let spaceEffects;
const spaceValues = { ...SPACE_DEFAULTS };

function setStatus(message, error = false) { elements.status.textContent = message; elements.status.classList.toggle("error", error); }
function formatValue(parameter, value) {
  const discrete = { 0:["Morph", "Saw", "Square", "Triangle"], 17:["Morph", "Saw", "Square", "Triangle"], 36:["LP12", "LP24", "BP12", "BP24", "HP12", "Notch"], 47:["Sine", "Triangle", "Saw Up", "Saw Down", "Square", "S&H"] };
  if (discrete[parameter.id]) return discrete[parameter.id][Math.round(value)];
  if (parameter.id === 35) return value >= .5 ? "ON" : "OFF";
  if (parameter.id === 37) return `${Math.round(value).toLocaleString()} Hz`;
  if ((parameter.flags & 2) !== 0) return `${Number(value.toFixed(2))} s`;
  if ([10, 14, 21, 25, 50].includes(parameter.id)) return `${Math.round(value)} ct`;
  if ([13, 24].includes(parameter.id)) return `${Math.round(value)} st`;
  if ([12, 23, 31, 40, 49].includes(parameter.id)) return `${Math.round(value)} oct`;
  return Number(value.toFixed(3)).toString();
}
function rangeStep(parameter) { if ((parameter.flags & 1) !== 0) return 1; if (parameter.id === 37) return 0.001; return Math.max((parameter.max - parameter.min) / 500, 0.001); }
function normalized(parameter, value) { return (value - parameter.min) / (parameter.max - parameter.min); }
function valueForInput(parameter, control, inputValue) { if (control.scale !== "log") return Number(inputValue); const low = Math.log(parameter.min); const high = Math.log(parameter.max); return Math.exp(low + Number(inputValue) * (high - low)); }
function inputForValue(parameter, control, value) { if (control.scale !== "log") return value; return (Math.log(value) - Math.log(parameter.min)) / (Math.log(parameter.max) - Math.log(parameter.min)); }

function updateControl(id) {
  const parameter = parameterInfo.get(id); const value = values.get(id); const stored = controlsById.get(id) ?? [];
  for (const control of stored) {
    if (control.kind === "dial") { control.input.value = String(inputForValue(parameter, control.definition, value)); control.dial.style.setProperty("--turn", `${-135 + normalized(parameter, value) * 270}deg`); }
    if (control.kind === "select") control.input.value = String(Math.round(value));
    if (control.kind === "toggle") control.input.checked = value >= 0.5;
    control.output.textContent = formatValue(parameter, value);
  }
}
function setValue(id, value) { const parameter = parameterInfo.get(id); const next = Math.min(parameter.max, Math.max(parameter.min, value)); values.set(id, next); updateControl(id); synth?.setParam(id, next); }
function registerControl(id, control) { if (!controlsById.has(id)) controlsById.set(id, []); controlsById.get(id).push(control); }

function createControl(definition, advanced = false) {
  const parameter = parameterInfo.get(definition.id); const field = document.createElement("div"); field.className = "control";
  const label = document.createElement("span"); label.className = "control-label"; label.textContent = definition.label ?? parameter.displayName;
  const output = document.createElement("output"); output.className = "control-value";
  if (definition.type === "select") {
    const input = document.createElement("select"); definition.options.forEach((name, index) => { const option = new Option(name, String(index)); input.add(option); }); input.addEventListener("change", () => setValue(parameter.id, Number(input.value))); field.append(label, input, output); registerControl(parameter.id, { kind:"select", input, output, definition });
  } else if (definition.type === "toggle") {
    const toggle = document.createElement("label"); toggle.className = "toggle"; const input = document.createElement("input"); input.type = "checkbox"; const text = document.createElement("span"); text.textContent = "FILTER"; input.addEventListener("change", () => setValue(parameter.id, input.checked ? 1 : 0)); toggle.append(input, text); field.append(label, toggle, output); registerControl(parameter.id, { kind:"toggle", input, output, definition });
  } else {
    const dial = document.createElement("div"); dial.className = "dial"; const input = document.createElement("input"); input.type = "range"; input.min = definition.scale === "log" ? "0" : String(parameter.min); input.max = definition.scale === "log" ? "1" : String(parameter.max); input.step = String(rangeStep(parameter)); input.setAttribute("aria-label", parameter.displayName); input.addEventListener("input", () => setValue(parameter.id, valueForInput(parameter, definition, input.value))); dial.append(input); field.append(label, dial, output); registerControl(parameter.id, { kind:"dial", input, output, dial, definition });
  }
  if (advanced) field.title = `${parameter.displayName} (#${parameter.id})`; updateControl(parameter.id); return field;
}
function formatEffectValue(id, value) { if (id === "reverbMaterial") return REVERB_MATERIALS[value].label; return id === "delayTime" ? `${Math.round(value * 1000)} ms` : `${Math.round(value * 100)}%`; }
function updateEffectControl(id) {
  const control = document.getElementById(`effect-${id}`);
  if (!control) return;
  const value = spaceValues[id];
  control.querySelector("input,select").value = String(value);
  control.querySelector("output").textContent = formatEffectValue(id, value);
  control.querySelector(".dial")?.style.setProperty("--turn", `${-135 + value * 270}deg`);
}
function setEffectValue(id, value) {
  if (id === "reverbMaterial") spaceValues[id] = Object.hasOwn(REVERB_MATERIALS, value) ? value : SPACE_DEFAULTS.reverbMaterial;
  else { const range = id === "delayTime" ? [.08, .72] : id.endsWith("Send") ? [0, 1] : [0, .65]; spaceValues[id] = Math.min(range[1], Math.max(range[0], Number(value))); }
  spaceEffects?.setValues({ [id]: spaceValues[id] });
  updateEffectControl(id);
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
  const field = document.createElement("div"); field.className = "control"; field.id = `effect-${id}`;
  const labelElement = document.createElement("span"); labelElement.className = "control-label"; labelElement.textContent = label;
  const input = document.createElement("select"); input.setAttribute("aria-label", label); options.forEach(([value, name]) => input.add(new Option(name, value))); input.addEventListener("change", () => { input.blur(); setEffectValue(id, input.value); });
  const output = document.createElement("output"); output.className = "control-value"; field.append(labelElement, input, output); updateEffectControl(id); return field;
}
function renderControls() { Object.entries(groups).forEach(([target, definitions]) => { const container = elements[target]; definitions.forEach((definition) => container.append(createControl(definition))); }); elements.delay.append(createEffectControl("delaySend", "SEND", 0, 1), createEffectControl("delayMix", "MIX", 0, .65), createEffectControl("delayTime", "TIME", .08, .72)); elements.reverb.append(createEffectControl("reverbSend", "SEND", 0, 1), createEffectSelect("reverbMaterial", "MATERIAL", Object.entries(REVERB_MATERIALS).map(([id, material]) => [id, material.label])), createEffectControl("reverbMix", "MIX", 0, .65)); const advanced = [...parameterInfo.values()].filter((parameter) => !primaryIds.has(parameter.id)); advanced.forEach((parameter) => elements["advanced-controls"].append(createControl({ id:parameter.id, label:parameter.displayName }, true))); }
function renderPresets() { Object.entries(presets).forEach(([id, preset]) => elements.preset.add(new Option(preset.label, id))); elements.preset.value = "epiano"; }

async function fetchChecked(url, type = "arrayBuffer") { const response = await fetch(url); if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`); return response[type](); }
function restoreDefaults() { for (const parameter of parameterInfo.values()) values.set(parameter.id, parameter.default); [...values.keys()].forEach(updateControl); }
async function loadPreset(id) { const preset = presets[id]; if (!preset) throw new Error(`unknown preset: ${id}`); const text = await fetchChecked(`${paths.presets}${preset.file}`, "text"); const updates = parsePreset(text); stopAllNotes(); restoreDefaults(); updates.forEach(([paramId, value]) => { if (parameterInfo.has(paramId)) values.set(paramId, value); }); [...values.keys()].forEach(updateControl); Object.assign(spaceValues, SPACE_DEFAULTS, preset.space); spaceEffects?.setValues(spaceValues); ["delaySend", "delayMix", "delayTime", "reverbSend", "reverbMaterial", "reverbMix"].forEach(updateEffectControl); if (synth) { synth.reset(1); synth.loadPreset(text); } setStatus(`${preset.label} — ${preset.description}`); }
function initPatch() { stopAllNotes(); restoreDefaults(); Object.assign(spaceValues, SPACE_DEFAULTS); spaceEffects?.setValues(spaceValues); ["delaySend", "delayMix", "delayTime", "reverbSend", "reverbMaterial", "reverbMix"].forEach(updateEffectControl); synth?.reset(1); setStatus("INITへ戻しました。リバーブだけを単独で調整できます。"); }
function prepareAudio() {
  if (audioReady) return audioReady;
  const preparedContext = new AudioContext();
  context = preparedContext;
  audioReady = (async () => {
    try {
      const node = await createSynthNode(preparedContext, wasmBytes.slice(0));
      node.connect(preparedContext.destination);
      spaceEffects = createSpaceEffects(preparedContext, node);
      spaceEffects.setValues(spaceValues);
      synth = node;
      [...values.entries()].forEach(([id, value]) => synth.setParam(id, value));
      return node;
    } catch (error) {
      if (context === preparedContext) { context = undefined; synth = undefined; audioReady = undefined; }
      await preparedContext.close().catch(() => {});
      throw error;
    }
  })();
  return audioReady;
}
async function ensureAudio() {
  const ready = prepareAudio();
  const wasSuspended = context.state !== "running";
  const resumed = context.resume();
  const node = await ready;
  await resumed;
  if (wasSuspended) setStatus("音源を開始しました。鍵盤またはPCキーで演奏できます。");
  return node;
}
async function startNote(note, token, keyElement) {
  if (activeNotes.has(token) || pendingNotes.has(token)) return;
  const pending = { keyElement };
  pendingNotes.set(token, pending);
  keyElement?.classList.add("is-active");
  try {
    const node = await ensureAudio();
    if (pendingNotes.get(token) !== pending) return;
    activeNotes.set(token, { handle:node.noteOn(note, .82), keyElement });
  } catch (error) {
    if (pendingNotes.get(token) === pending) setStatus(error.message, true);
  } finally {
    if (pendingNotes.get(token) === pending) {
      pendingNotes.delete(token);
      if (!activeNotes.has(token)) keyElement?.classList.remove("is-active");
    }
  }
}
function stopNote(token) {
  const pending = pendingNotes.get(token);
  if (pending) { pendingNotes.delete(token); pending.keyElement?.classList.remove("is-active"); }
  const active = activeNotes.get(token);
  if (!active) return;
  synth?.noteOff(active.handle);
  active.keyElement?.classList.remove("is-active");
  activeNotes.delete(token);
}
function stopAllNotes() { new Set([...pendingNotes.keys(), ...activeNotes.keys()]).forEach(stopNote); }
function renderPiano() { const black = new Set([1,3,6,8,10]); const whiteNotes = []; for (let note = 60; note <= 84; note += 1) if (!black.has(note % 12)) whiteNotes.push(note); whiteNotes.forEach((note) => { const key = document.createElement("button"); key.type="button"; key.className="piano-key white"; key.dataset.note=String(note); key.innerHTML=`<span>${note % 12 === 0 ? `C${Math.floor(note / 12) - 1}` : ""}</span>`; bindKey(key, note, `pointer-${note}`); elements.piano.append(key); }); for (let note = 60; note <= 83; note += 1) { if (!black.has(note % 12)) continue; const whiteBefore = whiteNotes.filter((white) => white < note).length; const key = document.createElement("button"); key.type="button"; key.className="piano-key black"; key.style.left=`calc(${whiteBefore} / 15 * 100% - (100% / 15 * .36))`; key.dataset.note=String(note); key.innerHTML="<span></span>"; bindKey(key, note, `pointer-${note}`); elements.piano.append(key); } }
function bindKey(element, note, token) { element.addEventListener("pointerdown", (event) => { event.preventDefault(); element.setPointerCapture(event.pointerId); startNote(note, token, element); }); element.addEventListener("pointerup", () => stopNote(token)); element.addEventListener("pointercancel", () => stopNote(token)); }
function installKeyboard() { window.addEventListener("keydown", (event) => { if (event.repeat || event.target.matches("select,textarea")) return; const note = keyboardMap[event.code]; if (note === undefined) return; event.preventDefault(); startNote(note, event.code, elements.piano.querySelector(`[data-note="${note}"]`)); }); window.addEventListener("keyup", (event) => stopNote(event.code)); window.addEventListener("blur", () => new Set([...pendingNotes.keys(), ...activeNotes.keys()]).forEach(stopNote)); }

elements.init.addEventListener("click", initPatch); elements.preset.addEventListener("change", () => { elements.preset.blur(); loadPreset(elements.preset.value).catch((error) => setStatus(error.message, true)); });
try { wasmBytes = await fetchChecked(paths.wasm); const parameters = await getParams(wasmBytes); parameters.forEach((parameter) => { parameterInfo.set(parameter.id, parameter); values.set(parameter.id, parameter.default); }); renderPresets(); renderControls(); renderPiano(); installKeyboard(); await loadPreset(elements.preset.value); await prepareAudio(); setStatus("準備完了。鍵盤またはPCキーを押すと音源を開始します。"); } catch (error) { setStatus(error.message, true); }
