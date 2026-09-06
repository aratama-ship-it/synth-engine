import { createSynthNode, getParams, parsePreset } from "./synth-node.js";

const paths = {
  wasm: "../../build/synth_engine.wasm",
  preset: "../../presets/m0_saw.txt",
  events: "../../fixtures/m0_events_chord.txt",
  nativeWav: "../../build/out.wav",
};
const sampleRate = 48000;
const durationSeconds = 10;
const probePresetText = `
0=1
1=0
2=1
3=0
4=0
5=1
6=0
7=0.5
9=1
15=1
16=0.25
19=0
29=0
32=0
35=1
36=4
37=400
38=0
39=0
40=0
41=0
42=0
43=1
44=0
49=0
50=0
51=0
75=0
`;
const commonParameterIds = new Set([1, 2, 3, 4, 5, 6, 7, 37, 38, 40, 46, 49]);
const elements = Object.fromEntries(
  [...document.querySelectorAll("[id]")].map((element) => [element.id, element]),
);

let wasmBytes;
let liveContext;
let liveSynth;
let probeSynth;
let probeNodes;
const heldKeys = new Map();
const parameterValues = new Map();
const touchedParameters = new Set();

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", isError);
}

function formatBytes(value) {
  return `${value.toLocaleString()} B`;
}

function dbfs(value) {
  return value > 0 ? `${(20 * Math.log10(value)).toFixed(2)} dBFS` : "−∞ dBFS";
}

function parameterStep(parameter) {
  if ((parameter.flags & 1) !== 0) return "1";
  const range = parameter.max - parameter.min;
  if (range <= 2) return "0.001";
  if (range <= 100) return "0.01";
  return "1";
}

function formatParameterValue(value) {
  return Number(value.toPrecision(7)).toString();
}

function renderParameterList(params) {
  elements["parameter-count"].textContent = `${params.length} items`;
  elements["parameter-list"].replaceChildren();
  for (const parameter of params) {
    parameterValues.set(parameter.id, parameter.default);
    const row = document.createElement("div");
    row.className = "parameter-row";

    const label = document.createElement("div");
    label.className = "parameter-name";
    label.innerHTML = `<span class="parameter-id">#${parameter.id}</span><strong></strong><code class="parameter-key"></code><span class="parameter-range"></span>`;
    label.querySelector("strong").textContent = parameter.displayName;
    label.querySelector("code").textContent = parameter.identifier;
    label.querySelector(".parameter-range").textContent = `${formatParameterValue(parameter.min)}..${formatParameterValue(parameter.max)}`;
    row.append(label);

    const control = document.createElement("div");
    control.className = "parameter-control";
    const value = document.createElement("output");
    value.className = "parameter-value";
    value.textContent = formatParameterValue(parameter.default);
    if (commonParameterIds.has(parameter.id)) {
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = String(parameter.min);
      slider.max = String(parameter.max);
      slider.step = parameterStep(parameter);
      slider.value = String(parameter.default);
      slider.setAttribute("aria-label", parameter.displayName);
      slider.addEventListener("input", () => {
        const nextValue = Number(slider.value);
        parameterValues.set(parameter.id, nextValue);
        touchedParameters.add(parameter.id);
        value.textContent = formatParameterValue(nextValue);
        liveSynth?.setParam(parameter.id, nextValue);
      });
      control.append(slider);
    }
    control.append(value);
    row.append(control);
    elements["parameter-list"].append(row);
  }
}

async function fetchChecked(url, type = "arrayBuffer") {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response[type]();
}

async function gzipSize(buffer) {
  if (typeof CompressionStream !== "function") return null;
  const stream = new Blob([buffer]).stream().pipeThrough(new CompressionStream("gzip"));
  return (await new Response(stream).arrayBuffer()).byteLength;
}

function parseEvents(text) {
  const events = [];
  for (const [index, sourceLine] of text.split(/\r?\n/).entries()) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const fields = line.split(/\s+/).map(Number);
    if (fields.length !== 5 || fields.some((value) => !Number.isFinite(value))) {
      throw new Error(`invalid event line ${index + 1}: ${sourceLine}`);
    }
    const [frame, kind, id, a, b] = fields;
    if (!Number.isSafeInteger(frame) || frame < 0 || !Number.isInteger(kind) || !Number.isInteger(id)) {
      throw new Error(`invalid event line ${index + 1}: ${sourceLine}`);
    }
    events.push({ frame, kind, id, a, b });
  }
  return events;
}

function observeWorklet(synth) {
  return synth.onMessage((message) => {
    if (message.type === "error") setStatus(`Worklet error: ${message.message}`, true);
    if (message.type === "performance") {
      elements["process-average"].textContent = `${message.averageMs.toFixed(4)} ms`;
      elements["process-p99"].textContent = `${message.p99Ms.toFixed(4)} ms`;
      elements["process-blocks"].textContent = String(message.blocks);
    }
  });
}

async function startLive() {
  if (liveContext) {
    await liveContext.resume();
    setStatus("AudioContext は開始済みです。A〜Z キーで発音できます。");
    return;
  }
  elements["start-button"].disabled = true;
  try {
    liveContext = new AudioContext({ sampleRate });
    liveSynth = await createSynthNode(liveContext, wasmBytes.slice(0));
    observeWorklet(liveSynth);
    liveSynth.connect(liveContext.destination);
    liveSynth.loadPreset(await fetchChecked(paths.preset, "text"));
    for (const id of touchedParameters) liveSynth.setParam(id, parameterValues.get(id));
    await liveContext.resume();
    setStatus(`開始しました（${liveContext.sampleRate.toLocaleString()} Hz）。A〜Z キーで発音できます。`);
  } catch (error) {
    liveContext = undefined;
    liveSynth = undefined;
    elements["start-button"].disabled = false;
    setStatus(error.message, true);
  }
}

async function ensureProbeSynth() {
  await startLive();
  if (!liveContext || !liveSynth) throw new Error("AudioContext を開始できませんでした。");
  if (probeSynth) return probeSynth;

  probeSynth = await createSynthNode(liveContext, wasmBytes.slice(0));
  observeWorklet(probeSynth);
  probeSynth.connect(liveContext.destination);

  const delay = liveContext.createDelay(2);
  const feedback = liveContext.createGain();
  const wet = liveContext.createGain();
  delay.delayTime.value = 0.32;
  feedback.gain.value = 0.45;
  wet.gain.value = 0.8;
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(wet);
  wet.connect(liveContext.destination);
  probeSynth.connect(delay, probeSynth.sendOutput);
  probeNodes = { delay, feedback, wet };
  return probeSynth;
}

function setProbeButtonsDisabled(disabled) {
  elements["voice-param-button"].disabled = disabled;
  elements["send-button"].disabled = disabled;
}

async function playProbe(params, description) {
  setProbeButtonsDisabled(true);
  try {
    const synth = await ensureProbeSynth();
    synth.reset(1, 281);
    synth.loadPreset(probePresetText);
    synth.reset(0, 281);

    const base = Math.ceil((liveContext.currentTime + 0.2) * liveContext.sampleRate);
    const interval = Math.round(0.65 * liveContext.sampleRate);
    const duration = Math.round(0.28 * liveContext.sampleRate);
    const first = synth.noteOn(60, 1, base);
    synth.noteOff(first, base + duration);
    const second = synth.noteOnWith(60, 1, params, base + interval);
    synth.noteOff(second, base + interval + duration);
    const third = synth.noteOn(60, 1, base + interval * 2);
    synth.noteOff(third, base + interval * 2 + duration);
    setStatus(`${description} 同じ音を3回鳴らします。2音目を聴き比べてください。`);
    setTimeout(() => {
      setProbeButtonsDisabled(false);
      if (!elements.status.classList.contains("error")) setStatus(`${description} 確認音の再生が完了しました。`);
    }, 2200);
  } catch (error) {
    setProbeButtonsDisabled(false);
    setStatus(error.message, true);
  }
}

function keyNote(event) {
  const match = /^Key([A-Z])$/.exec(event.code);
  return match ? 60 + match[1].charCodeAt(0) - 65 : null;
}

window.addEventListener("keydown", (event) => {
  const note = keyNote(event);
  if (note === null || event.repeat || heldKeys.has(event.code) || !liveSynth) return;
  heldKeys.set(event.code, liveSynth.noteOn(note, 0.8));
  event.preventDefault();
});

window.addEventListener("keyup", (event) => {
  const note = keyNote(event);
  const handle = heldKeys.get(event.code);
  if (note === null || handle === undefined || !liveSynth) return;
  heldKeys.delete(event.code);
  liveSynth.noteOff(handle);
  event.preventDefault();
});

window.addEventListener("blur", () => {
  if (!liveSynth) return;
  for (const handle of heldKeys.values()) liveSynth.noteOff(handle);
  heldKeys.clear();
});

function signalStats(buffer) {
  let peak = 0;
  let sumSquares = 0;
  let samples = 0;
  let nan = 0;
  for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
    const channel = buffer.getChannelData(channelIndex);
    for (const value of channel) {
      if (!Number.isFinite(value)) {
        nan += 1;
        continue;
      }
      peak = Math.max(peak, Math.abs(value));
      sumSquares += value * value;
      samples += 1;
    }
  }
  return { peak, rms: samples ? Math.sqrt(sumSquares / samples) : 0, nan };
}

function encodeFloatWav(buffer) {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const output = new ArrayBuffer(44 + frames * channels * 4);
  const view = new DataView(output);
  const ascii = (offset, value) => [...value].forEach((character, i) => view.setUint8(offset + i, character.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, output.byteLength - 8, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 4, true);
  view.setUint16(32, channels * 4, true);
  view.setUint16(34, 32, true);
  ascii(36, "data");
  view.setUint32(40, frames * channels * 4, true);
  const channelData = Array.from({ length: channels }, (_, index) => buffer.getChannelData(index));
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      view.setFloat32(offset, channelData[channel][frame], true);
      offset += 4;
    }
  }
  return output;
}

function parseFloatWav(buffer) {
  const view = new DataView(buffer);
  const chunkId = (offset) => String.fromCharCode(...new Uint8Array(buffer, offset, 4));
  if (chunkId(0) !== "RIFF" || chunkId(8) !== "WAVE") throw new Error("native WAV is not RIFF/WAVE");
  let position = 12;
  let format;
  let data;
  while (position + 8 <= buffer.byteLength) {
    const id = chunkId(position);
    const size = view.getUint32(position + 4, true);
    if (position + 8 + size > buffer.byteLength) throw new Error("native WAV has a truncated chunk");
    if (id === "fmt ") {
      format = {
        code: view.getUint16(position + 8, true),
        channels: view.getUint16(position + 10, true),
        sampleRate: view.getUint32(position + 12, true),
        bits: view.getUint16(position + 22, true),
      };
    }
    if (id === "data") data = { offset: position + 8, size };
    position += 8 + size + (size & 1);
  }
  if (!format || !data || format.code !== 3 || format.bits !== 32) throw new Error("native WAV must be 32-bit float PCM");
  return { view, format, data, frames: data.size / 4 / format.channels };
}

function compareNative(rendered, nativeBuffer) {
  const native = parseFloatWav(nativeBuffer);
  if (native.format.sampleRate !== rendered.sampleRate) throw new Error("native and Web sample rates differ");
  const frames = Math.min(rendered.length, native.frames);
  const web = rendered.getChannelData(0);
  let maximum = 0;
  let sumSquares = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    const nativeValue = native.view.getFloat32(native.data.offset + frame * native.format.channels * 4, true);
    const difference = Math.abs(web[frame] - nativeValue);
    maximum = Math.max(maximum, difference);
    sumSquares += difference * difference;
  }
  return { frames, maximum, rms: frames ? Math.sqrt(sumSquares / frames) : 0 };
}

function downloadWav(buffer) {
  const url = URL.createObjectURL(new Blob([encodeFloatWav(buffer)], { type: "audio/wav" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "synth-engine-web-10s.wav";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function renderOffline() {
  elements["render-button"].disabled = true;
  setStatus("10秒分をオフラインレンダーしています…");
  try {
    const [presetText, eventText, nativeWav] = await Promise.all([
      fetchChecked(paths.preset, "text"),
      fetchChecked(paths.events, "text"),
      fetchChecked(paths.nativeWav),
    ]);
    const context = new OfflineAudioContext(2, durationSeconds * sampleRate, sampleRate);
    const synth = await createSynthNode(context, wasmBytes.slice(0));
    observeWorklet(synth);
    synth.connect(context.destination);
    const ready = await synth.batch(parsePreset(presetText), parseEvents(eventText));
    elements["ready-time"].textContent = `${ready.readyMs.toFixed(2)} ms`;
    const rendered = await context.startRendering();
    const stats = signalStats(rendered);
    elements["peak-value"].textContent = dbfs(stats.peak);
    elements["rms-value"].textContent = dbfs(stats.rms);
    elements["nan-value"].textContent = String(stats.nan);
    const difference = compareNative(rendered, nativeWav);
    elements["compare-frames"].textContent = difference.frames.toLocaleString();
    elements["max-diff"].textContent = dbfs(difference.maximum);
    elements["rms-diff"].textContent = dbfs(difference.rms);
    downloadWav(rendered);
    setStatus("レンダー完了。WAV を生成し、native との差を表示しました。");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    elements["render-button"].disabled = false;
  }
}

elements["start-button"].addEventListener("click", startLive);
elements["voice-param-button"].addEventListener("click", () => {
  playProbe([[37, 4000]], "音符ごとの上書き:");
});
elements["send-button"].addEventListener("click", () => {
  playProbe([[75, 1]], "センド出力:");
});
elements["render-button"].addEventListener("click", renderOffline);
elements["render-button"].disabled = true;
setProbeButtonsDisabled(true);

try {
  wasmBytes = await fetchChecked(paths.wasm);
  renderParameterList(await getParams(wasmBytes));
  elements["wasm-raw"].textContent = formatBytes(wasmBytes.byteLength);
  const compressed = await gzipSize(wasmBytes);
  elements["wasm-gzip"].textContent = compressed === null ? "未対応" : formatBytes(compressed);
  elements["render-button"].disabled = false;
  setProbeButtonsDisabled(false);
  setStatus("準備完了。開始、2つの確認音、またはオフライン10秒レンダーを選んでください。");
} catch (error) {
  elements["start-button"].disabled = true;
  setProbeButtonsDisabled(true);
  setStatus(error.message, true);
}
