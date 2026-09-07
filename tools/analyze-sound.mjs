#!/usr/bin/env node

import path from "node:path";
import { analyzeSound } from "../shells/web/sound-analysis.js";
import { deinterleaveWav, readFloat32Wav } from "./lib/wav.mjs";

const file = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
if (!file) {
  console.error("usage: node tools/analyze-sound.mjs <float32-wav>");
  process.exit(2);
}

try {
  const wav = readFloat32Wav(file);
  const analysis = analyzeSound({ channels:deinterleaveWav(wav), sampleRate:wav.fmt.sr });
  console.log(JSON.stringify({ file:path.resolve(file), ...analysis }, null, 2));
} catch (error) {
  console.error(`analysis failed: ${error.message}`);
  process.exit(1);
}
