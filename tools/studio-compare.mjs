#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createReverbImpulse, SPACE_DEFAULTS } from "../shells/web/space-effects.js";
import { readFloat32Wav } from "./lib/wav.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runDir = path.join(root, "design/overnight-runs/2026-09-07-serum-until-08");
const audioDir = path.join(runDir, "audio");
const evidenceDir = path.join(runDir, "evidence");
const sampleRate = 48000;
const sourceSeconds = 8;
const outputSeconds = 12;
const renderCli = path.join(root, "build/render-cli");
const ffmpeg = process.env.FFMPEG_BIN || "ffmpeg";

fs.mkdirSync(audioDir, { recursive:true });
fs.mkdirSync(evidenceDir, { recursive:true });

function writeFloat32Wav(file, channels, rate) {
  const frames = channels[0].length;
  if (!channels.length || channels.some((channel) => channel.length !== frames)) throw new Error("channel length mismatch");
  const channelCount = channels.length;
  const dataBytes = frames * channelCount * 4;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(3, 20); buffer.writeUInt16LE(channelCount, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * channelCount * 4, 28);
  buffer.writeUInt16LE(channelCount * 4, 32); buffer.writeUInt16LE(32, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(dataBytes, 40);
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      buffer.writeFloatLE(channels[channel][frame], offset); offset += 4;
    }
  }
  fs.writeFileSync(file, buffer);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd:root, encoding:"utf8" });
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed\n${result.stderr || result.stdout}`);
  return `${result.stdout || ""}${result.stderr || ""}`.trim();
}

const sourcePreset = fs.readFileSync(path.join(root, "presets/studio_wide_pad.txt"), "utf8");
const comparisonPreset = sourcePreset.replace(/^7=.*$/m, "7=0.18");
const presetPath = path.join(evidenceDir, "comparison-preset.txt");
const eventsPath = path.join(evidenceDir, "comparison-events.txt");
fs.writeFileSync(presetPath, `# Studio comparison; source is studio_wide_pad with matched output headroom\n${comparisonPreset}`);

const notes = [
  [0.00, 1.55, [48, 55, 60, 64]],
  [1.70, 3.25, [45, 52, 57, 60]],
  [3.40, 4.95, [41, 48, 53, 57]],
  [5.10, 6.95, [43, 50, 55, 59]],
];
let token = 1000;
const events = [];
for (const [start, end, pitches] of notes) {
  for (const pitch of pitches) {
    const id = token++; events.push(`${Math.round(start * sampleRate)} 1 ${id} ${pitch} 0.62`);
    events.push(`${Math.round(end * sampleRate)} 2 ${id} 0 0`);
  }
}
events.sort((a, b) => Number(a.split(" ")[0]) - Number(b.split(" ")[0]));
fs.writeFileSync(eventsPath, `# frame kind id a b\n${events.join("\n")}\n`);

const rawPath = path.join(evidenceDir, "comparison-raw.wav");
const renderLog = run(renderCli, ["--preset", presetPath, "--events", eventsPath, "--out", rawPath, "--sr", String(sampleRate), "--block", "128", "--frames", String(sampleRate * sourceSeconds)]);

const fakeContext = {
  sampleRate,
  createBuffer(channelCount, frames) {
    const channels = Array.from({ length:channelCount }, () => new Float32Array(frames));
    return { numberOfChannels:channelCount, length:frames, sampleRate, getChannelData:(channel) => channels[channel], channels };
  },
};
const impulse = createReverbImpulse(fakeContext, SPACE_DEFAULTS);
const impulsePath = path.join(evidenceDir, "reverb-clear-ir.wav");
writeFloat32Wav(impulsePath, impulse.channels, sampleRate);

const common = ["-hide_banner", "-loglevel", "error", "-y"];
const codec = ["-ar", String(sampleRate), "-ac", "2", "-c:a", "pcm_f32le", "-t", String(outputSeconds)];
const dryPath = path.join(audioDir, "01-dry.wav");
run(ffmpeg, [...common, "-i", rawPath, "-af", "apad=pad_dur=4,volume=6,alimiter=limit=0.86", ...codec, dryPath]);

const reverbPath = path.join(audioDir, "02-reverb.wav");
const reverbGraph = "[0:a]apad=pad_dur=4,asplit=2[dry][rv];[rv]highpass=f=120,lowpass=f=12000,adelay=8|8[pre];[pre][1:a]afir=dry=0:wet=1:gtype=peak:irfmt=input[wet];[dry]volume=0.78[d];[wet]volume=0.22[w];[d][w]amix=inputs=2:normalize=0,volume=6,alimiter=limit=0.86[out]";
run(ffmpeg, [...common, "-i", rawPath, "-i", impulsePath, "-filter_complex", reverbGraph, "-map", "[out]", ...codec, reverbPath]);

const delayPath = path.join(audioDir, "03-delay.wav");
const delayGraph = "apad=pad_dur=4,asplit=2[dry][echo];[echo]lowpass=f=5200,aecho=in_gain=1:out_gain=1:delays=360|720:decays=0.34|0.16[wet];[dry]volume=0.82[d];[wet]volume=0.18[w];[d][w]amix=inputs=2:normalize=0,volume=6,alimiter=limit=0.86";
run(ffmpeg, [...common, "-i", rawPath, "-filter_complex", delayGraph, ...codec, delayPath]);

const fullPath = path.join(audioDir, "04-full-fx.wav");
const fullGraph = "[0:a]apad=pad_dur=4,asoftclip=type=tanh:threshold=0.8:output=0.92,chorus=0.74:0.88:11|17:0.22|0.18:0.30|0.37:2.0|2.6,equalizer=f=260:t=q:w=0.9:g=1.5,equalizer=f=1800:t=q:w=1.1:g=-1.2,equalizer=f=6800:t=q:w=0.8:g=1.4,acompressor=threshold=0.18:ratio=2.2:attack=20:release=180:makeup=1.7,asplit=3[core][dl][rv];[dl]lowpass=f=5000,aecho=in_gain=1:out_gain=1:delays=360|720:decays=0.31|0.14[delay];[rv]highpass=f=150,lowpass=f=9200,adelay=12|12[pre];[pre][1:a]afir=dry=0:wet=1:gtype=peak:irfmt=input[room];[core]volume=0.72[c];[delay]volume=0.12[dw];[room]volume=0.20[rw];[c][dw][rw]amix=inputs=3:normalize=0,volume=6,alimiter=limit=0.86[out]";
run(ffmpeg, [...common, "-i", rawPath, "-i", impulsePath, "-filter_complex", fullGraph, "-map", "[out]", ...codec, fullPath]);

function metrics(file) {
  const wav = readFloat32Wav(file);
  let peak = 0; let sumSquares = 0; let nonFinite = 0;
  for (const sample of wav.samples) {
    if (!Number.isFinite(sample)) { nonFinite += 1; continue; }
    peak = Math.max(peak, Math.abs(sample)); sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / wav.samples.length);
  return {
    file:path.relative(runDir, file), sampleRate:wav.fmt.sr, channels:wav.fmt.ch,
    frames:wav.frames, seconds:Number((wav.frames / wav.fmt.sr).toFixed(3)),
    peakDbfs:Number((20 * Math.log10(Math.max(peak, Number.MIN_VALUE))).toFixed(3)),
    rmsDbfs:Number((20 * Math.log10(Math.max(rms, Number.MIN_VALUE))).toFixed(3)),
    nonFinite,
  };
}

const result = {
  generatedAt:new Date().toISOString(), source:"SynthEngine build/render-cli + deterministic Studio Wide Pad phrase",
  note:"Reverb uses the browser UI impulse generator; insert/delay processing is an offline audition approximation using the same displayed settings, not a bit-exact Web Audio render.",
  renderLog,
  files:[dryPath, reverbPath, delayPath, fullPath].map(metrics),
};
fs.writeFileSync(path.join(evidenceDir, "audio-metrics.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
