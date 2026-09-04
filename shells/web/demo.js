import { createSynthNode, parsePreset } from "./synth-node.js";

const paths = {
  wasm: "../../build/synth_engine.wasm",
  preset: "../../presets/m0_saw.txt",
  events: "../../fixtures/m0_events_chord.txt",
  nativeWav: "../../build/out.wav",
};
const sampleRate = 48000;
const durationSeconds = 10;
const elements = Object.fromEntries(
  [...document.querySelectorAll("[id]")].map((element) => [element.id, element]),
);

let wasmBytes;
let liveContext;
let liveSynth;
const heldKeys = new Set();

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
    await liveContext.resume();
    setStatus(`開始しました（${liveContext.sampleRate.toLocaleString()} Hz）。A〜Z キーで発音できます。`);
  } catch (error) {
    liveContext = undefined;
    liveSynth = undefined;
    elements["start-button"].disabled = false;
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
  heldKeys.add(event.code);
  liveSynth.noteOn(note, 0.8);
  event.preventDefault();
});

window.addEventListener("keyup", (event) => {
  const note = keyNote(event);
  if (note === null || !heldKeys.delete(event.code) || !liveSynth) return;
  liveSynth.noteOff(note);
  event.preventDefault();
});

window.addEventListener("blur", () => {
  if (!liveSynth) return;
  for (const code of heldKeys) {
    const match = /^Key([A-Z])$/.exec(code);
    if (match) liveSynth.noteOff(60 + match[1].charCodeAt(0) - 65);
  }
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
elements["render-button"].addEventListener("click", renderOffline);
elements["render-button"].disabled = true;

try {
  wasmBytes = await fetchChecked(paths.wasm);
  elements["wasm-raw"].textContent = formatBytes(wasmBytes.byteLength);
  const compressed = await gzipSize(wasmBytes);
  elements["wasm-gzip"].textContent = compressed === null ? "未対応" : formatBytes(compressed);
  elements["render-button"].disabled = false;
  setStatus("準備完了。「開始」または「オフライン10秒レンダー」を選んでください。");
} catch (error) {
  elements["start-button"].disabled = true;
  setStatus(error.message, true);
}
