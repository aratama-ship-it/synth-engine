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

  const samples = new Float32Array(data.size / 4);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getFloat32(data.off + i * 4, true);
  }
  return { wav, view, fmt, data, samples, frames: samples.length / fmt.ch };
}
