import { readFloat32Wav } from "../lib/wav.mjs";

const [aPath, bPath] = process.argv.slice(2);
if (!aPath || !bPath) {
  console.error("usage: node tools/au-render/compare.mjs <a.wav> <b.wav>");
  process.exit(2);
}

const a = readFloat32Wav(aPath);
const b = readFloat32Wav(bPath);
console.log("a wav fmt:", JSON.stringify(a.fmt));
console.log("b wav fmt:", JSON.stringify(b.fmt));
console.log("a frames:", a.frames, "b frames:", b.frames);

const count = Math.min(a.samples.length, b.samples.length);
let maxDiff = 0;
let sumSq = 0;
let sumSqSig = 0;
let nanA = 0;
let nanB = 0;
for (const sample of a.samples) if (!Number.isFinite(sample)) nanA++;
for (const sample of b.samples) if (!Number.isFinite(sample)) nanB++;
for (let i = 0; i < count; i++) {
  const av = a.samples[i];
  const bv = b.samples[i];
  if (!Number.isFinite(av) || !Number.isFinite(bv)) continue;
  const diff = Math.abs(av - bv);
  if (diff > maxDiff) maxDiff = diff;
  sumSq += diff * diff;
  sumSqSig += av * av;
}

const db = (x) => x > 0 ? (20 * Math.log10(x)).toFixed(2) : "-inf";
const sameFormat = a.fmt.format === b.fmt.format && a.fmt.ch === b.fmt.ch &&
  a.fmt.sr === b.fmt.sr && a.fmt.bits === b.fmt.bits;
const sameLength = a.samples.length === b.samples.length;
const aBytes = a.wav.subarray(a.data.off, a.data.off + a.data.size);
const bBytes = b.wav.subarray(b.data.off, b.data.off + b.data.size);
const bitIdentical = sameFormat && sameLength && aBytes.equals(bBytes);
const rmsDiff = count > 0 ? Math.sqrt(sumSq / count) : Number.NaN;
const rmsA = count > 0 ? Math.sqrt(sumSqSig / count) : Number.NaN;
console.log(`diff max=${db(maxDiff)} dBFS rms=${db(rmsDiff)} dBFS (a rms=${db(rmsA)} dBFS) bit_identical=${bitIdentical}`);
console.log(`nan a=${nanA} b=${nanB}`);

const pass = sameFormat && sameLength && nanA === 0 && nanB === 0 &&
  maxDiff <= 1e-5 && rmsDiff <= 1e-6;
console.log(`result=${pass ? "PASS" : "FAIL"}`);
process.exitCode = pass ? 0 : 1;
