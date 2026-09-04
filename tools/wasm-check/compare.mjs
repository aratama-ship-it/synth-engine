// native(CLI WAV) vs wasm(node) の差分測定。M0 合否基準3の先行確認。
// 使い方: node tools/wasm-check/compare.mjs build/synth_engine.wasm presets/m0_saw.txt fixtures/m0_events_chord.txt build/out.wav 48000 128 96000
import fs from "node:fs";
import { readFloat32Wav } from "../lib/wav.mjs";
const [wasmPath, presetPath, eventsPath, wavPath, srArg, blockArg, framesArg] = process.argv.slice(2);
const sr = Number(srArg), block = Number(blockArg), totalFrames = Number(framesArg);
const bytes = fs.readFileSync(wasmPath);
const mod = await WebAssembly.compile(bytes);
console.log("imports:", WebAssembly.Module.imports(mod).length);
const instance = await WebAssembly.instantiate(mod, {});
const ex = instance.exports;
const mem = ex.memory;
const stateSize = Number(ex.synth_state_size());
const evBytes = 20; // uint32 x3 + float x2
const need = ex.__heap_base.value + stateSize + 4096 * evBytes + block * 4 * 2 + 65536;
const pagesNow = mem.buffer.byteLength / 65536;
if (need > mem.buffer.byteLength) mem.grow(Math.ceil((need - mem.buffer.byteLength) / 65536) + 1);
let base = ex.__heap_base.value; base = (base + 15) & ~15;
const statePtr = base; const evPtr = statePtr + ((stateSize + 15) & ~15);
const outLPtr = evPtr + 4096 * evBytes; const outRPtr = outLPtr + block * 4;
const engine = ex.synth_create(statePtr, stateSize, sr, block);
if (!engine) throw new Error("synth_create failed");
console.log("state_size:", stateSize, "version:", ex.synth_engine_version(), "pages:", mem.buffer.byteLength / 65536);
for (const line of fs.readFileSync(presetPath, "utf8").split("\n")) {
  const t = line.trim(); if (!t || t.startsWith("#")) continue;
  const [id, v] = t.split("="); const rc = ex.synth_set_param(engine, Number(id), Number(v));
  if (rc < 0) throw new Error("set_param failed " + t);
}
ex.synth_reset(engine, 0, 1n);
const events = [];
for (const line of fs.readFileSync(eventsPath, "utf8").split("\n")) {
  const t = line.trim(); if (!t || t.startsWith("#")) continue;
  const [f, k, id, a, b] = t.split(/\s+/).map(Number); events.push({ f, k, id, a, b });
}
events.sort((x, y) => x.f - y.f);
const outL = new Float32Array(totalFrames), outR = new Float32Array(totalFrames);
let ei = 0;
for (let start = 0; start < totalFrames; start += block) {
  const n = Math.min(block, totalFrames - start);
  const dv = new DataView(mem.buffer); let ne = 0;
  while (ei < events.length && events[ei].f < start + n) {
    const e = events[ei++]; const p = evPtr + ne * evBytes;
    dv.setUint32(p, e.f - start, true); dv.setUint32(p + 4, e.k, true); dv.setUint32(p + 8, e.id, true);
    dv.setFloat32(p + 12, e.a, true); dv.setFloat32(p + 16, e.b, true); ne++;
  }
  const rc = ex.synth_process(engine, evPtr, ne, outLPtr, outRPtr, n);
  if (rc < 0) throw new Error("process failed rc=" + rc);
  outL.set(new Float32Array(mem.buffer, outLPtr, n), start);
  outR.set(new Float32Array(mem.buffer, outRPtr, n), start);
}
// WAV parse (RIFF, float32 stereo)
const { fmt, samples: nat, frames: natFrames } = readFloat32Wav(wavPath);
console.log("wav fmt:", JSON.stringify(fmt));
console.log("native frames:", natFrames, "wasm frames:", totalFrames);
let maxDiff = 0, sumSq = 0, sumSqSig = 0, nanCount = 0, peakW = 0;
const N = Math.min(natFrames, totalFrames);
for (let i = 0; i < N; i++) {
  const w = outL[i], nv = nat[i * fmt.ch]; if (!Number.isFinite(w)) nanCount++;
  const d = Math.abs(w - nv); if (d > maxDiff) maxDiff = d; sumSq += d * d; sumSqSig += nv * nv; peakW = Math.max(peakW, Math.abs(w));
}
const db = (x) => x > 0 ? (20 * Math.log10(x)).toFixed(2) : "-inf";
console.log(`wasm peak_dbfs=${db(peakW)} nan=${nanCount}`);
console.log(`diff max=${db(maxDiff)} dBFS rms=${db(Math.sqrt(sumSq / N))} dBFS (native rms=${db(Math.sqrt(sumSqSig / N))} dBFS) bit_identical=${maxDiff === 0}`);
