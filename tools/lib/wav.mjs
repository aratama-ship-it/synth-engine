import fs from "node:fs";

export function readFloat32Wav(path) {
  const wav = fs.readFileSync(path);
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let pos = 12;
  let fmt = null;
  let data = null;
  while (pos + 8 <= wav.length) {
    const id = wav.toString("ascii", pos, pos + 4);
    const size = view.getUint32(pos + 4, true);
    if (id === "fmt ") {
      fmt = {
        format: view.getUint16(pos + 8, true),
        ch: view.getUint16(pos + 10, true),
        sr: view.getUint32(pos + 12, true),
        bits: view.getUint16(pos + 22, true),
      };
    }
    if (id === "data") data = { off: pos + 8, size };
    pos += 8 + size + (size & 1);
  }

  if (!fmt || !data) throw new Error("WAV must contain fmt and data chunks");
  if (fmt.format !== 3 || fmt.bits !== 32) throw new Error(`expected 32-bit float WAV, got format=${fmt.format} bits=${fmt.bits}`);
  if (!Number.isInteger(fmt.ch) || fmt.ch < 1) throw new Error("WAV channel count must be positive");
  const samples = new Float32Array(data.size / 4);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getFloat32(data.off + i * 4, true);
  }
  return { wav, view, fmt, data, samples, frames: samples.length / fmt.ch };
}

export function deinterleaveWav(wav) {
  const channels = Array.from({ length:wav.fmt.ch }, () => new Float32Array(wav.frames));
  for (let frame = 0; frame < wav.frames; frame += 1) {
    for (let channel = 0; channel < channels.length; channel += 1) channels[channel][frame] = wav.samples[frame * channels.length + channel];
  }
  return channels;
}
