import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFloat32Wav } from "./lib/wav.mjs";

const SAMPLE_RATE = 48000;
const BLOCK = 128;
const TOTAL_FRAMES = 24576;
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const wasmPath = path.join(projectRoot, "build/synth_engine.wasm");
const cliPath = path.join(projectRoot, "build/render-cli");

const preset = [
  [0, 1], [1, 0], [2, 1], [3, 0], [4, 0], [5, 1], [6, 0], [7, 1],
  [9, 1], [15, 1], [16, 0.25], [19, 0], [29, 0], [32, 0], [35, 1],
  [36, 4], [37, 400], [38, 0], [39, 0], [40, 0], [41, 0], [42, 0],
  [43, 1], [44, 0], [49, 0], [50, 0], [51, 0], [75, 0],
];
const noteEvents = [
  { frame: 0, kind: 1, id: 801, a: 60, b: 1 },
  { frame: 8192, kind: 2, id: 801, a: 0, b: 0 },
  { frame: 8192, kind: 1, id: 802, a: 60, b: 1 },
  { frame: 16384, kind: 2, id: 802, a: 0, b: 0 },
  { frame: 16384, kind: 1, id: 803, a: 60, b: 1 },
];
const overrideEvents = [
  { frame: 8192, kind: 5, id: 37, a: 4000, b: 0 },
  { frame: 8192, kind: 5, id: 75, a: 1, b: 0 },
];

function moduleArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function importWorklet() {
  const sourcePath = new URL("../shells/web/synth-worklet.js", import.meta.url);
  const source = readFileSync(sourcePath, "utf8");
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

async function waitForProcessor(processor) {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    if (processor.ready) return;
    if (processor.failed) {
      const error = processor.port.messages.find((message) => message.type === "error");
      throw new Error(error?.message ?? "Worklet initialization failed");
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("Worklet initialization timed out");
}

async function renderWeb(wasmBytes) {
  const OriginalAudioWorkletProcessor = globalThis.AudioWorkletProcessor;
  const originalSampleRate = globalThis.sampleRate;
  class NodeAudioWorkletProcessor {
    constructor() {
      const messages = [];
      this.port = {
        messages,
        onmessage: null,
        postMessage(message) { messages.push(message); },
      };
    }
  }
  globalThis.AudioWorkletProcessor = NodeAudioWorkletProcessor;
  globalThis.sampleRate = SAMPLE_RATE;
  try {
    const { SynthEngineProcessor } = await importWorklet();
    const processor = new SynthEngineProcessor({
      processorOptions: { wasmBytes: moduleArrayBuffer(wasmBytes) },
    });
    await waitForProcessor(processor);
    processor.receive({ type: "preset", params: preset });
    processor.receive({ type: "events", events: noteEvents });
    processor.receive({
      type: "voiceParam",
      frame: 8192,
      params: [[37, 4000], [75, 1]],
    });

    const dryLeft = new Float32Array(TOTAL_FRAMES);
    const dryRight = new Float32Array(TOTAL_FRAMES);
    const sendLeft = new Float32Array(TOTAL_FRAMES);
    const sendRight = new Float32Array(TOTAL_FRAMES);
    for (let start = 0; start < TOTAL_FRAMES; start += BLOCK) {
      const count = Math.min(BLOCK, TOTAL_FRAMES - start);
      const dry = [new Float32Array(count), new Float32Array(count)];
      const send = [new Float32Array(count), new Float32Array(count)];
      processor.process([], [dry, send]);
      if (processor.failed) {
        const error = processor.port.messages.find((message) => message.type === "error");
        throw new Error(error?.message ?? "Worklet processing failed");
      }
      dryLeft.set(dry[0], start);
      dryRight.set(dry[1], start);
      sendLeft.set(send[0], start);
      sendRight.set(send[1], start);
    }
    return { dryLeft, dryRight, sendLeft, sendRight };
  } finally {
    globalThis.AudioWorkletProcessor = OriginalAudioWorkletProcessor;
    globalThis.sampleRate = originalSampleRate;
  }
}

function stereoBitMismatches(left, right, nativeWav) {
  if (nativeWav.fmt.format !== 3 || nativeWav.fmt.bits !== 32 || nativeWav.fmt.ch !== 2) {
    throw new Error("render-cli output must be stereo 32-bit float WAV");
  }
  if (nativeWav.frames !== left.length || left.length !== right.length) {
    throw new Error("rendered frame counts differ");
  }
  const leftBits = new Uint32Array(left.buffer, left.byteOffset, left.length);
  const rightBits = new Uint32Array(right.buffer, right.byteOffset, right.length);
  const nativeBits = new Uint32Array(
    nativeWav.samples.buffer,
    nativeWav.samples.byteOffset,
    nativeWav.samples.length,
  );
  let mismatches = 0;
  for (let frame = 0; frame < left.length; frame += 1) {
    mismatches += leftBits[frame] !== nativeBits[frame * 2];
    mismatches += rightBits[frame] !== nativeBits[frame * 2 + 1];
  }
  return mismatches;
}

if (!readFileSync(wasmPath).byteLength) throw new Error(`empty wasm: ${wasmPath}`);
execFileSync("make", ["cli"], { cwd: projectRoot, stdio: "inherit" });

const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "synth-web-voiceparam-"));
try {
  const presetPath = path.join(temporaryDirectory, "preset.txt");
  const eventsPath = path.join(temporaryDirectory, "events.txt");
  const dryPath = path.join(temporaryDirectory, "dry.wav");
  const sendPath = path.join(temporaryDirectory, "send.wav");
  writeFileSync(presetPath, `${preset.map(([id, value]) => `${id}=${value}`).join("\n")}\n`);
  writeFileSync(
    eventsPath,
    `${[...noteEvents, ...overrideEvents]
      .sort((left, right) => (left.frame - right.frame) ||
        (Number(right.kind === 5) - Number(left.kind === 5)))
      .map(({ frame, kind, id, a, b }) => `${frame} ${kind} ${id} ${a} ${b}`)
      .join("\n")}\n`,
  );

  const cliOutput = execFileSync(cliPath, [
    "--preset", presetPath,
    "--events", eventsPath,
    "--out", dryPath,
    "--send-out", sendPath,
    "--sr", String(SAMPLE_RATE),
    "--block", String(BLOCK),
    "--frames", String(TOTAL_FRAMES),
  ], { cwd: projectRoot, encoding: "utf8" }).trim();
  const web = await renderWeb(readFileSync(wasmPath));
  const dryMismatches = stereoBitMismatches(web.dryLeft, web.dryRight, readFloat32Wav(dryPath));
  const sendMismatches = stereoBitMismatches(web.sendLeft, web.sendRight, readFloat32Wav(sendPath));
  console.log(cliOutput);
  console.log(`dry bit mismatches: ${dryMismatches}`);
  console.log(`send bit mismatches: ${sendMismatches}`);
  if (dryMismatches !== 0 || sendMismatches !== 0) {
    throw new Error("Web Worklet and render-cli are not bit-identical");
  }
  console.log("ビット一致: Web Worklet と CLI の dry/send 出力が完全一致");
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
