// 旧音源の参照WAVと synth-engine の出力を比べる（M2 の当てはめ用）。
// 使い方: node tools/compare-timbre.mjs design/verify/ref/rsk_epiano.wav build/cand_epiano.wav
import { correlation, derivativeCentroid, rmsEnvelope } from "../shells/web/sound-analysis.js";
import { deinterleaveWav, readFloat32Wav } from "./lib/wav.mjs";

function readWav(file) {
  const wav = readFloat32Wav(file);
  return { left:deinterleaveWav(wav)[0], sr:wav.fmt.sr };
}

const [refPath, candPath] = process.argv.slice(2);
const ref = readWav(refPath), cand = readWav(candPath);
const refEnv = rmsEnvelope(ref.left, ref.sr).values, candEnv = rmsEnvelope(cand.left, cand.sr).values;
const corr = correlation(refEnv, candEnv);

// 音色は「鳴っている区間」で比べる。無音を含めると重心が壊れるため
const segments = [[0.05, 0.2], [0.2, 0.6], [0.6, 1.2]];
const rows = segments.map(([a, b]) => {
  const rc = derivativeCentroid(ref.left, ref.sr, a * ref.sr, b * ref.sr);
  const cc = derivativeCentroid(cand.left, cand.sr, a * cand.sr, b * cand.sr);
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
