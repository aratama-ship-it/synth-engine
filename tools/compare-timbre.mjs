// 旧音源の参照WAVと synth-engine の出力を比べる（M2 の当てはめ用）。
// 使い方: node tools/compare-timbre.mjs build/ref/rsk_epiano.wav build/cand_epiano.wav
import fs from "node:fs";

function readWav(file) {
  const data = fs.readFileSync(file);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 12, fmt = null, chunk = null;
  while (pos + 8 <= data.length) {
    const id = data.toString("ascii", pos, pos + 4);
    const size = view.getUint32(pos + 4, true);
    if (id === "fmt ") fmt = { format: view.getUint16(pos + 8, true), ch: view.getUint16(pos + 10, true), sr: view.getUint32(pos + 12, true) };
    if (id === "data") chunk = { off: pos + 8, size };
    pos += 8 + size + (size & 1);
  }
  const n = chunk.size / 4;
  const all = new Float32Array(n);
  for (let i = 0; i < n; i++) all[i] = view.getFloat32(chunk.off + i * 4, true);
  const left = new Float32Array(n / fmt.ch);
  for (let i = 0; i < left.length; i++) left[i] = all[i * fmt.ch];
  return { left, sr: fmt.sr };
}

// 20ms窓ごとの RMS 列（振幅包絡）
function envelope(x, sr, windowSeconds = 0.02) {
  const w = Math.round(sr * windowSeconds), out = [];
  for (let start = 0; start + w <= x.length; start += w) {
    let sum = 0;
    for (let i = start; i < start + w; i++) sum += x[i] * x[i];
    out.push(Math.sqrt(sum / w));
  }
  return out;
}

// 微分ベースのスペクトル重心（零交差率と違い波形の形に強い）
function centroid(x, sr, from, to) {
  let num = 0, den = 0;
  for (let i = Math.max(1, from); i < Math.min(x.length, to); i++) {
    const d = x[i] - x[i - 1];
    num += d * d; den += x[i] * x[i];
  }
  return den > 0 ? (sr / (2 * Math.PI)) * Math.sqrt(num / den) : 0;
}

function correlation(a, b) {
  const n = Math.min(a.length, b.length);
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, dbv = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; dbv += y * y; }
  return da > 0 && dbv > 0 ? num / Math.sqrt(da * dbv) : 0;
}

const [refPath, candPath] = process.argv.slice(2);
const ref = readWav(refPath), cand = readWav(candPath);
const refEnv = envelope(ref.left, ref.sr), candEnv = envelope(cand.left, cand.sr);
const corr = correlation(refEnv, candEnv);

// 音色は「鳴っている区間」で比べる。無音を含めると重心が壊れるため
const segments = [[0.05, 0.2], [0.2, 0.6], [0.6, 1.2]];
const rows = segments.map(([a, b]) => {
  const rc = centroid(ref.left, ref.sr, a * ref.sr, b * ref.sr);
  const cc = centroid(cand.left, cand.sr, a * cand.sr, b * cand.sr);
  return { range: `${a}-${b}s`, ref: rc, cand: cc, diff: rc > 0 ? (cc - rc) / rc * 100 : 0 };
});
const meanAbsDiff = rows.reduce((sum, r) => sum + Math.abs(r.diff), 0) / rows.length;

const db = (x) => (x > 0 ? (20 * Math.log10(x)).toFixed(1) : "-inf");
console.log(`参照 ${refPath}`);
console.log(`候補 ${candPath}`);
console.log(`振幅包絡の相関 : ${corr.toFixed(4)}  （目標 0.95 以上）`);
for (const r of rows) console.log(`  重心 ${r.range.padEnd(9)} 参照 ${r.ref.toFixed(0).padStart(5)} Hz / 候補 ${r.cand.toFixed(0).padStart(5)} Hz / 差 ${r.diff >= 0 ? "+" : ""}${r.diff.toFixed(1)}%`);
console.log(`重心の平均絶対差 : ${meanAbsDiff.toFixed(1)}%  （目標 15% 以内）`);
const peakOf = (x) => { let m = 0; for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > m) m = v; } return m; };
console.log(`ピーク           : 参照 ${db(peakOf(ref.left))} / 候補 ${db(peakOf(cand.left))}`);
if (process.argv.includes("--dump")) {
  console.log("時刻    参照RMS   候補RMS");
  for (let i = 0; i < Math.min(refEnv.length, candEnv.length, 90); i += 5) {
    console.log(`  ${(i * 0.02).toFixed(2)}s  ${db(refEnv[i]).padStart(7)}  ${db(candEnv[i]).padStart(7)}`);
  }
}
console.log(`判定             : ${corr >= 0.95 && meanAbsDiff <= 15 ? "OK" : "未達"}`);
