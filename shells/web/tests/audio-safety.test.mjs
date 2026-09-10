import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { importSource } from "./load-module.mjs";

const { SynthEngineProcessor } = await importSource("../synth-worklet.js");
const { createSafeWavetableFrame } = await importSource("../wavetable-import.js");

const SAMPLE_RATE = 48_000;
const BLOCK_SIZE = 128;
const ACTIVE_FLOOR = 1e-4;
const TEST_PEAK_CEILING = 0.25;
const SILENCE_CEILING = 1e-7;

function peakAndNonFinite(outputs) {
  let peak = 0;
  let nonFinite = 0;
  for (const output of outputs) {
    for (const channel of output) {
      for (const sample of channel) {
        if (!Number.isFinite(sample)) nonFinite += 1;
        else peak = Math.max(peak, Math.abs(sample));
      }
    }
  }
  return { peak, nonFinite };
}

function renderBlock(processor) {
  const outputs = [
    [new Float32Array(BLOCK_SIZE), new Float32Array(BLOCK_SIZE)],
    [new Float32Array(BLOCK_SIZE), new Float32Array(BLOCK_SIZE)],
  ];
  assert.equal(processor.process([], outputs), true);
  return peakAndNonFinite(outputs);
}

async function waitUntilReady(processor, messages) {
  const deadline = Date.now() + 5_000;
  while (!processor.ready && !processor.failed && Date.now() < deadline) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(processor.failed, false, messages.find((message) => message.type === "error")?.message);
  assert.equal(processor.ready, true, "AudioWorklet processor did not initialize within 5 seconds");
}

test("silent safety gate: high-FM, mono/legato glide, filter, and EQ changes remain bounded", { concurrency: false }, async (context) => {
  const wasmPath = new URL("../../../build/synth_engine.wasm", import.meta.url);
  const wasmBytes = await readFile(wasmPath).catch((error) => {
    if (error?.code === "ENOENT") {
      context.skip("build/synth_engine.wasm is missing; run `make wasm WASM_CLANG=...` first");
      return null;
    }
    throw error;
  });
  if (!wasmBytes) return;

  const sampleRateDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sampleRate");
  Object.defineProperty(globalThis, "sampleRate", { configurable: true, value: SAMPLE_RATE });
  try {
    const arrayBuffer = wasmBytes.buffer.slice(
      wasmBytes.byteOffset,
      wasmBytes.byteOffset + wasmBytes.byteLength,
    );
    const processor = new SynthEngineProcessor({ processorOptions: { wasmBytes: arrayBuffer } });
    const messages = [];
    processor.port.postMessage = (message) => messages.push(message);
    await waitUntilReady(processor, messages);

    const customFrame = createSafeWavetableFrame();
    processor.receive({
      type: "wavetable", requestId: 1, slot: 4, frameCount: 1, frames: customFrame,
    });
    const loaded = messages.find((message) =>
      message.type === "wavetableLoaded" && message.requestId === 1);
    assert.equal(loaded?.result, 0, loaded?.message || "custom wavetable did not acknowledge");

    processor.receive({
      type: "preset",
      params: [
        [0, 4], [1, 0], [2, 0.2],
        [3, 0.001], [4, 0.01], [5, 0.8], [6, 0.02], [7, 0.1],
        [9, 4], [17, 0], [18, 0], [19, 0], [20, 4], [26, 1], [27, 0],
        [28, 1], [78, 1], [29, 0], [32, 0], [35, 0], [36, 4], [37, 800], [38, 0.5],
        [40, 0], [41, 0.001], [42, 0.01], [43, 0.8], [44, 0.02], [75, 0],
        [90, 0], [94, 0], [99, 0], [103, 0], [115, 1], [116, 1], [117, 0], [118, 0],
        [119, 0], [120, 0],
      ],
    });
    processor.receive({
      type: "events",
      events: [
        { frame: 0, kind: 1, id: 1, a: 108, b: 0.5 },
        { frame: 1024, kind: 3, id: 113, a: 1, b: 0 },
        { frame: 1152, kind: 3, id: 114, a: 0.08, b: 0 },
        { frame: 1280, kind: 1, id: 3, a: 100, b: 0.5 },
        { frame: 1536, kind: 3, id: 5, a: 0.2, b: 0 },
        { frame: 1664, kind: 3, id: 113, a: 2, b: 0 },
        { frame: 1792, kind: 1, id: 4, a: 103, b: 0.5 },
        { frame: 2048, kind: 3, id: 35, a: 1, b: 0 },
        { frame: 2176, kind: 3, id: 36, a: 4, b: 0 },
        { frame: 2304, kind: 3, id: 40, a: 4, b: 0 },
        { frame: 2432, kind: 3, id: 36, a: 2, b: 0 },
        { frame: 2688, kind: 3, id: 36, a: 5, b: 0 },
        { frame: 2816, kind: 3, id: 43, a: 0.2, b: 0 },
        { frame: 3072, kind: 3, id: 35, a: 0, b: 0 },
        { frame: 3200, kind: 3, id: 115, a: 0, b: 0 },
        { frame: 3200, kind: 3, id: 116, a: 0, b: 0 },
        { frame: 3584, kind: 3, id: 115, a: 0.7071068, b: 0 },
        { frame: 3584, kind: 3, id: 116, a: 0.7071068, b: 0 },
        { frame: 3840, kind: 3, id: 115, a: 1, b: 0 },
        { frame: 3840, kind: 3, id: 116, a: 1, b: 0 },
        { frame: 4096, kind: 3, id: 115, a: Math.sqrt(1.5), b: 0 },
        { frame: 4096, kind: 3, id: 116, a: Math.sqrt(1.5), b: 0 },
        { frame: 4352, kind: 3, id: 117, a: -0.75, b: 0 },
        { frame: 4352, kind: 3, id: 118, a: -0.75, b: 0 },
        { frame: 4736, kind: 3, id: 117, a: 0, b: 0 },
        { frame: 4736, kind: 3, id: 118, a: 0, b: 0 },
        { frame: 5120, kind: 3, id: 117, a: 0.75, b: 0 },
        { frame: 5120, kind: 3, id: 118, a: 0.75, b: 0 },
        { frame: 5248, kind: 3, id: 119, a: 1, b: 0 },
        { frame: 5248, kind: 3, id: 120, a: 1, b: 0 },
        { frame: 5376, kind: 3, id: 119, a: 2, b: 0 },
        { frame: 5376, kind: 3, id: 120, a: 2, b: 0 },
        { frame: 5504, kind: 3, id: 119, a: 0, b: 0 },
        { frame: 5504, kind: 3, id: 120, a: 0, b: 0 },
        { frame: 5504, kind: 3, id: 78, a: 0, b: 0 },
        { frame: 5632, kind: 3, id: 55, a: 1, b: 0 },
        { frame: 5632, kind: 3, id: 56, a: 14, b: 0 },
        { frame: 5632, kind: 3, id: 57, a: 0.25, b: 0 },
        { frame: 6144, kind: 3, id: 56, a: 15, b: 0 },
        { frame: 6656, kind: 3, id: 57, a: 0, b: 0 },
        { frame: 6784, kind: 3, id: 7, a: 0.02, b: 0 },
        { frame: 6912, kind: 3, id: 99, a: 1, b: 0 },
        { frame: 7040, kind: 3, id: 100, a: 18, b: 0 },
        { frame: 7040, kind: 3, id: 101, a: -18, b: 0 },
        { frame: 7040, kind: 3, id: 102, a: 18, b: 0 },
        { frame: 7040, kind: 3, id: 121, a: 600, b: 0 },
        { frame: 7040, kind: 3, id: 122, a: 8000, b: 0 },
        { frame: 7040, kind: 3, id: 123, a: 8, b: 0 },
        { frame: 7040, kind: 3, id: 124, a: 18000, b: 0 },
        { frame: 7168, kind: 3, id: 100, a: -18, b: 0 },
        { frame: 7168, kind: 3, id: 101, a: 18, b: 0 },
        { frame: 7168, kind: 3, id: 102, a: -18, b: 0 },
        { frame: 7168, kind: 3, id: 121, a: 40, b: 0 },
        { frame: 7168, kind: 3, id: 122, a: 200, b: 0 },
        { frame: 7168, kind: 3, id: 123, a: 0.25, b: 0 },
        { frame: 7168, kind: 3, id: 124, a: 1500, b: 0 },
        { frame: 7424, kind: 3, id: 100, a: 0, b: 0 },
        { frame: 7424, kind: 3, id: 101, a: 0, b: 0 },
        { frame: 7424, kind: 3, id: 102, a: 0, b: 0 },
        { frame: 7680, kind: 3, id: 99, a: 0, b: 0 },
        { frame: 8192, kind: 2, id: 1, a: 0, b: 0 },
        { frame: 8192, kind: 2, id: 4, a: 0, b: 0 },
        { frame: 8448, kind: 2, id: 3, a: 0, b: 0 },
      ],
    });

    let peakBeforeChange = 0;
    let peakAfterChange = 0;
    let peakAfterRelease = 0;
    let maximumPeak = 0;
    let nonFinite = 0;
    while (processor.renderFrame < 16_384) {
      const blockStart = processor.renderFrame;
      const block = renderBlock(processor);
      maximumPeak = Math.max(maximumPeak, block.peak);
      nonFinite += block.nonFinite;
      if (blockStart >= 512 && blockStart < 4096) {
        peakBeforeChange = Math.max(peakBeforeChange, block.peak);
      } else if (blockStart >= 4224 && blockStart < 8192) {
        peakAfterChange = Math.max(peakAfterChange, block.peak);
      } else if (blockStart >= 12_288) {
        peakAfterRelease = Math.max(peakAfterRelease, block.peak);
      }
    }

    assert.equal(processor.failed, false, messages.find((message) => message.type === "error")?.message);
    assert.equal(nonFinite, 0, "render produced NaN or Infinity");
    assert.ok(peakBeforeChange > ACTIVE_FLOOR, `note was not audible before parameter change: ${peakBeforeChange}`);
    assert.ok(peakAfterChange > ACTIVE_FLOOR, `note stopped during parameter change: ${peakAfterChange}`);
    assert.ok(maximumPeak <= TEST_PEAK_CEILING, `unsafe peak ${maximumPeak} exceeded ${TEST_PEAK_CEILING}`);
    assert.ok(peakAfterRelease <= SILENCE_CEILING, `note remained after release: ${peakAfterRelease}`);

    const panicFrame = processor.renderFrame;
    processor.receive({
      type: "events",
      events: [{ frame: panicFrame, kind: 1, id: 2, a: 67, b: 0.5 }],
    });
    let peakBeforePanic = 0;
    for (let block = 0; block < 8; block += 1) {
      const rendered = renderBlock(processor);
      peakBeforePanic = Math.max(peakBeforePanic, rendered.peak);
      nonFinite += rendered.nonFinite;
    }
    assert.ok(peakBeforePanic > ACTIVE_FLOOR, `panic test note was not audible: ${peakBeforePanic}`);

    processor.receive({ type: "reset", kind: 1, seed: 1 });
    let peakAfterPanic = 0;
    for (let block = 0; block < 8; block += 1) {
      const rendered = renderBlock(processor);
      peakAfterPanic = Math.max(peakAfterPanic, rendered.peak);
      nonFinite += rendered.nonFinite;
    }
    assert.equal(nonFinite, 0, "panic path produced NaN or Infinity");
    assert.ok(peakAfterPanic <= SILENCE_CEILING, `panic left residual output: ${peakAfterPanic}`);

    processor.receive({
      type: "wavetable", requestId: 2, slot: 4, frameCount: 1,
      frames: createSafeWavetableFrame(),
    });
    const cleared = messages.find((message) =>
      message.type === "wavetableLoaded" && message.requestId === 2);
    assert.equal(cleared?.result, 0, cleared?.message || "safe clear frame did not acknowledge");
    let peakAfterClearLoad = 0;
    for (let block = 0; block < 8; block += 1) {
      const rendered = renderBlock(processor);
      peakAfterClearLoad = Math.max(peakAfterClearLoad, rendered.peak);
      nonFinite += rendered.nonFinite;
    }
    assert.equal(nonFinite, 0, "custom clear path produced NaN or Infinity");
    assert.ok(peakAfterClearLoad <= SILENCE_CEILING,
      `custom clear load produced output without a note: ${peakAfterClearLoad}`);

    context.diagnostic(JSON.stringify({
      physicalOutput: "disconnected",
      customWavetable: "loaded in slot 4",
      monoLegatoFrames: [1024, 1152, 1280, 1664, 1792, 8192, 8448],
      heldEnvelopeFrames: [1536, 2304, 2816],
      filterModeFrames: [2176, 2432, 2688],
      filterBypassFrames: [2048, 3072],
      unisonDensityFrames: [3200, 3584, 3840, 4096],
      oscWarpFrames: [4352, 4736, 5120],
      oscWarpModeFrames: [5248, 5376, 5504],
      matrixWarpFrames: [5632, 6144, 6656],
      eqFrames: [6912, 7040, 7168, 7424, 7680],
      peakBeforeChange,
      peakAfterChange,
      maximumPeak,
      peakAfterRelease,
      peakBeforePanic,
      peakAfterPanic,
      peakAfterClearLoad,
      nonFinite,
    }));
  } finally {
    if (sampleRateDescriptor) Object.defineProperty(globalThis, "sampleRate", sampleRateDescriptor);
    else delete globalThis.sampleRate;
  }
});

test("silent safety gate: dense held filter and matrix automation stays bounded at 44.1/48/96 kHz", { concurrency: false }, async (context) => {
  const wasmPath = new URL("../../../build/synth_engine.wasm", import.meta.url);
  const wasmBytes = await readFile(wasmPath).catch((error) => {
    if (error?.code === "ENOENT") {
      context.skip("build/synth_engine.wasm is missing; run `make wasm WASM_CLANG=...` first");
      return null;
    }
    throw error;
  });
  if (!wasmBytes) return;

  const sampleRateDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sampleRate");
  const sampleRates = [44_100, SAMPLE_RATE, 96_000];
  const summaries = [];
  try {
    for (const sampleRate of sampleRates) {
      Object.defineProperty(globalThis, "sampleRate", { configurable: true, value: sampleRate });
    const arrayBuffer = wasmBytes.buffer.slice(
      wasmBytes.byteOffset,
      wasmBytes.byteOffset + wasmBytes.byteLength,
    );
    const processor = new SynthEngineProcessor({ processorOptions: { wasmBytes: arrayBuffer } });
    const messages = [];
    processor.port.postMessage = (message) => messages.push(message);
    await waitUntilReady(processor, messages);

    processor.receive({
      type: "preset",
      params: [
        [0, 0], [1, 0], [2, 0.2],
        [3, 0.001], [4, 0.01], [5, 0.7], [6, 0.02], [7, 0.02],
        [9, 4], [10, 40], [11, 1], [17, 2], [18, 0], [19, 0], [20, 1], [26, 1], [27, 0],
        [28, 1], [29, 0], [32, 0], [35, 1], [36, 4], [37, 800], [38, 0.65], [39, 1],
        [40, 4], [41, 0.001], [42, 0.01], [43, 0.8], [44, 0.02], [45, 1],
        [46, 25], [47, 4], [48, 1], [49, 0], [52, 0],
        [78, 1], [79, 17], [80, 4], [81, 1], [82, 0.25], [75, 0],
        [90, 0], [94, 0], [99, 0], [103, 0], [119, 0], [120, 0],
      ],
    });
    processor.receive({
      type: "events",
      events: [
        { frame: 0, kind: 1, id: 101, a: 36, b: 0.9 },
        { frame: 384, kind: 5, id: 36, a: 1, b: 0 },
        { frame: 384, kind: 5, id: 37, a: 80, b: 0 },
        { frame: 384, kind: 5, id: 38, a: 0.95, b: 0 },
        { frame: 384, kind: 5, id: 40, a: 8, b: 0 },
        { frame: 384, kind: 1, id: 102, a: 60, b: 0.7 },
        { frame: 512, kind: 3, id: 55, a: 1, b: 0 },
        { frame: 512, kind: 3, id: 56, a: 8, b: 0 },
        { frame: 512, kind: 3, id: 57, a: 1, b: 0 },
        { frame: 768, kind: 3, id: 58, a: 8, b: 0 },
        { frame: 768, kind: 3, id: 59, a: 9, b: 0 },
        { frame: 768, kind: 3, id: 60, a: 1, b: 0 },
        { frame: 1024, kind: 3, id: 36, a: 3, b: 0 },
        { frame: 1088, kind: 3, id: 37, a: 20, b: 0 },
        { frame: 1152, kind: 3, id: 38, a: 1, b: 0 },
        { frame: 1216, kind: 3, id: 40, a: -8, b: 0 },
        { frame: 1280, kind: 3, id: 41, a: 0, b: 0 },
        { frame: 1344, kind: 3, id: 42, a: 20, b: 0 },
        { frame: 1408, kind: 3, id: 43, a: 0.05, b: 0 },
        { frame: 1472, kind: 3, id: 44, a: 0.001, b: 0 },
        { frame: 1536, kind: 3, id: 36, a: 5, b: 0 },
        { frame: 1600, kind: 3, id: 37, a: 20000, b: 0 },
        { frame: 1664, kind: 3, id: 38, a: 0, b: 0 },
        { frame: 1728, kind: 3, id: 35, a: 0, b: 0 },
        { frame: 1792, kind: 3, id: 35, a: 1, b: 0 },
        { frame: 1856, kind: 3, id: 36, a: 0, b: 0 },
        { frame: 1920, kind: 3, id: 36, a: 4, b: 0 },
        { frame: 1984, kind: 3, id: 36, a: 2, b: 0 },
        { frame: 2048, kind: 3, id: 36, a: 3, b: 0 },
        { frame: 2112, kind: 3, id: 36, a: 5, b: 0 },
        { frame: 2176, kind: 3, id: 36, a: 1, b: 0 },
        { frame: 2240, kind: 3, id: 36, a: 4, b: 0 },
        { frame: 2304, kind: 3, id: 35, a: 0, b: 0 },
        { frame: 2368, kind: 3, id: 35, a: 1, b: 0 },
        { frame: 2432, kind: 5, id: 36, a: 5, b: 0 },
        { frame: 2432, kind: 5, id: 37, a: 16000, b: 0 },
        { frame: 2432, kind: 5, id: 38, a: 0.9, b: 0 },
        { frame: 2432, kind: 5, id: 40, a: -8, b: 0 },
        { frame: 2432, kind: 1, id: 103, a: 84, b: 0.55 },
        { frame: 2688, kind: 3, id: 57, a: 0, b: 0 },
        { frame: 2752, kind: 3, id: 60, a: 0, b: 0 },
        { frame: 2816, kind: 3, id: 39, a: 0, b: 0 },
        { frame: 2880, kind: 3, id: 40, a: 8, b: 0 },
        { frame: 2944, kind: 3, id: 41, a: 0.001, b: 0 },
        { frame: 3008, kind: 3, id: 42, a: 0.01, b: 0 },
        { frame: 3072, kind: 3, id: 43, a: 0.8, b: 0 },
        { frame: 3136, kind: 3, id: 44, a: 0.02, b: 0 },
        { frame: 3200, kind: 3, id: 55, a: 1, b: 0 },
        { frame: 3200, kind: 3, id: 56, a: 14, b: 0 },
        { frame: 3200, kind: 3, id: 57, a: 0.5, b: 0 },
        { frame: 3328, kind: 3, id: 58, a: 8, b: 0 },
        { frame: 3328, kind: 3, id: 59, a: 15, b: 0 },
        { frame: 3328, kind: 3, id: 60, a: -0.5, b: 0 },
        { frame: 3456, kind: 3, id: 119, a: 1, b: 0 },
        { frame: 3456, kind: 3, id: 120, a: 1, b: 0 },
        { frame: 3584, kind: 3, id: 119, a: 2, b: 0 },
        { frame: 3584, kind: 3, id: 120, a: 2, b: 0 },
        { frame: 3712, kind: 3, id: 119, a: 0, b: 0 },
        { frame: 3712, kind: 3, id: 120, a: 0, b: 0 },
        { frame: 3840, kind: 3, id: 99, a: 1, b: 0 },
        { frame: 3904, kind: 3, id: 100, a: 18, b: 0 },
        { frame: 3904, kind: 3, id: 101, a: -18, b: 0 },
        { frame: 3904, kind: 3, id: 102, a: 18, b: 0 },
        { frame: 3904, kind: 3, id: 121, a: 600, b: 0 },
        { frame: 3904, kind: 3, id: 122, a: 8000, b: 0 },
        { frame: 3904, kind: 3, id: 123, a: 8, b: 0 },
        { frame: 3904, kind: 3, id: 124, a: 18000, b: 0 },
        { frame: 4032, kind: 3, id: 100, a: -18, b: 0 },
        { frame: 4032, kind: 3, id: 101, a: 18, b: 0 },
        { frame: 4032, kind: 3, id: 102, a: -18, b: 0 },
        { frame: 4032, kind: 3, id: 121, a: 40, b: 0 },
        { frame: 4032, kind: 3, id: 122, a: 200, b: 0 },
        { frame: 4032, kind: 3, id: 123, a: 0.25, b: 0 },
        { frame: 4032, kind: 3, id: 124, a: 1500, b: 0 },
        { frame: 4160, kind: 3, id: 100, a: 0, b: 0 },
        { frame: 4160, kind: 3, id: 101, a: 0, b: 0 },
        { frame: 4160, kind: 3, id: 102, a: 0, b: 0 },
        { frame: 4288, kind: 3, id: 99, a: 0, b: 0 },
        { frame: 8192, kind: 2, id: 101, a: 0, b: 0 },
        { frame: 8192, kind: 2, id: 102, a: 0, b: 0 },
        { frame: 8192, kind: 2, id: 103, a: 0, b: 0 },
      ],
    });

    let automationPeak = 0;
    let releasePeak = 0;
    let maximumPeak = 0;
    let nonFinite = 0;
    while (processor.renderFrame < 16_384) {
      const blockStart = processor.renderFrame;
      const block = renderBlock(processor);
      maximumPeak = Math.max(maximumPeak, block.peak);
      nonFinite += block.nonFinite;
      if (blockStart >= 256 && blockStart < 8192) automationPeak = Math.max(automationPeak, block.peak);
      if (blockStart >= 10_240) releasePeak = Math.max(releasePeak, block.peak);
    }

    assert.equal(processor.failed, false, messages.find((message) => message.type === "error")?.message);
    assert.equal(nonFinite, 0, "dense filter automation produced NaN or Infinity");
    assert.ok(automationPeak > ACTIVE_FLOOR,
      `filter automation unexpectedly silenced all held notes: ${automationPeak}`);
    assert.ok(maximumPeak <= TEST_PEAK_CEILING,
      `filter automation peak ${maximumPeak} exceeded ${TEST_PEAK_CEILING}`);
    assert.ok(releasePeak <= SILENCE_CEILING,
      `filter automation left output after note-off: ${releasePeak}`);

    const panicFrame = processor.renderFrame;
    processor.receive({
      type: "events",
      events: [{ frame: panicFrame, kind: 1, id: 104, a: 72, b: 0.6 }],
    });
    let peakBeforePanic = 0;
    for (let block = 0; block < 8; block += 1) {
      const rendered = renderBlock(processor);
      peakBeforePanic = Math.max(peakBeforePanic, rendered.peak);
      nonFinite += rendered.nonFinite;
    }
    assert.ok(peakBeforePanic > ACTIVE_FLOOR,
      `filter automation panic note was not audible: ${peakBeforePanic}`);

    processor.receive({ type: "reset", kind: 0, seed: 1 });
    let peakAfterPanic = 0;
    for (let block = 0; block < 8; block += 1) {
      const rendered = renderBlock(processor);
      peakAfterPanic = Math.max(peakAfterPanic, rendered.peak);
      nonFinite += rendered.nonFinite;
    }
    assert.equal(nonFinite, 0, "dense filter panic produced NaN or Infinity");
    assert.ok(peakAfterPanic <= SILENCE_CEILING,
      `filter automation panic left residual output: ${peakAfterPanic}`);

      summaries.push({
        sampleRate,
        automationPeak,
        maximumPeak,
        releasePeak,
        peakBeforePanic,
        peakAfterPanic,
        nonFinite,
      });
    }
    context.diagnostic(JSON.stringify({
      physicalOutput: "disconnected",
      heldNotes: [101, 102, 103],
      filterControls: ["on", "mode", "cutoff", "resonance", "keyTrack", "env", "filterEG"],
      matrixRoutes: ["LFO1→Filter Cutoff", "LFO2→Filter Resonance", "LFO1→OSC A Warp", "LFO2→OSC B Warp"],
      rapidModeFrames: [1856, 1920, 1984, 2048, 2112, 2176, 2240],
      warpModeFrames: [3456, 3584, 3712],
      eqFrames: [3840, 3904, 4032, 4160, 4288],
      sampleRates: summaries,
    }));
  } finally {
    if (sampleRateDescriptor) Object.defineProperty(globalThis, "sampleRate", sampleRateDescriptor);
    else delete globalThis.sampleRate;
  }
});

test("silent safety gate: same-frame filter bundles at block boundaries stay bounded", { concurrency: false }, async (context) => {
  const wasmPath = new URL("../../../build/synth_engine.wasm", import.meta.url);
  const wasmBytes = await readFile(wasmPath).catch((error) => {
    if (error?.code === "ENOENT") {
      context.skip("build/synth_engine.wasm is missing; run `make wasm WASM_CLANG=...` first");
      return null;
    }
    throw error;
  });
  if (!wasmBytes) return;

  const sampleRateDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sampleRate");
  Object.defineProperty(globalThis, "sampleRate", { configurable: true, value: SAMPLE_RATE });
  try {
    const arrayBuffer = wasmBytes.buffer.slice(
      wasmBytes.byteOffset,
      wasmBytes.byteOffset + wasmBytes.byteLength,
    );
    const processor = new SynthEngineProcessor({ processorOptions: { wasmBytes: arrayBuffer } });
    const messages = [];
    processor.port.postMessage = (message) => messages.push(message);
    await waitUntilReady(processor, messages);

    processor.receive({
      type: "preset",
      params: [
        [0, 0], [1, 0], [2, 0.2],
        [3, 0.001], [4, 0.01], [5, 0.7], [6, 0.02], [7, 0.02],
        [9, 4], [10, 40], [11, 1], [17, 2], [18, 0], [19, 0], [20, 1], [26, 1], [27, 0],
        [28, 1], [29, 0], [32, 0], [35, 1], [36, 4], [37, 800], [38, 0.65], [39, 1],
        [40, 4], [41, 0.001], [42, 0.01], [43, 0.8], [44, 0.02], [45, 1],
        [46, 25], [47, 4], [48, 1], [49, 0], [52, 0], [75, 0], [78, 1],
        [90, 0], [94, 0], [99, 0], [103, 0],
      ],
    });
    processor.receive({
      type: "events",
      events: [
        { frame: 0, kind: 1, id: 201, a: 36, b: 0.9 },

        { frame: 127, kind: 3, id: 35, a: 0, b: 0 },
        { frame: 127, kind: 3, id: 36, a: 5, b: 0 },
        { frame: 127, kind: 3, id: 37, a: 20, b: 0 },
        { frame: 127, kind: 3, id: 38, a: 1, b: 0 },
        { frame: 128, kind: 3, id: 35, a: 1, b: 0 },
        { frame: 128, kind: 3, id: 36, a: 0, b: 0 },
        { frame: 128, kind: 3, id: 37, a: 20_000, b: 0 },
        { frame: 128, kind: 3, id: 38, a: 0, b: 0 },
        { frame: 129, kind: 5, id: 36, a: 3, b: 0 },
        { frame: 129, kind: 5, id: 37, a: 80, b: 0 },
        { frame: 129, kind: 5, id: 38, a: 0.95, b: 0 },
        { frame: 129, kind: 5, id: 40, a: 8, b: 0 },
        { frame: 129, kind: 1, id: 202, a: 60, b: 0.7 },

        { frame: 255, kind: 3, id: 35, a: 0, b: 0 },
        { frame: 255, kind: 3, id: 36, a: 2, b: 0 },
        { frame: 255, kind: 3, id: 37, a: 20, b: 0 },
        { frame: 256, kind: 3, id: 35, a: 1, b: 0 },
        { frame: 256, kind: 3, id: 36, a: 4, b: 0 },
        { frame: 256, kind: 3, id: 37, a: 18_000, b: 0 },
        { frame: 256, kind: 3, id: 38, a: 0.8, b: 0 },
        { frame: 257, kind: 5, id: 36, a: 5, b: 0 },
        { frame: 257, kind: 5, id: 37, a: 16_000, b: 0 },
        { frame: 257, kind: 5, id: 38, a: 0.9, b: 0 },
        { frame: 257, kind: 5, id: 40, a: -8, b: 0 },
        { frame: 257, kind: 1, id: 203, a: 84, b: 0.55 },

        { frame: 511, kind: 3, id: 55, a: 1, b: 0 },
        { frame: 511, kind: 3, id: 56, a: 8, b: 0 },
        { frame: 511, kind: 3, id: 57, a: 1, b: 0 },
        { frame: 512, kind: 3, id: 35, a: 0, b: 0 },
        { frame: 512, kind: 3, id: 36, a: 1, b: 0 },
        { frame: 512, kind: 3, id: 37, a: 40, b: 0 },
        { frame: 512, kind: 3, id: 38, a: 1, b: 0 },
        { frame: 513, kind: 3, id: 35, a: 1, b: 0 },
        { frame: 513, kind: 3, id: 36, a: 3, b: 0 },
        { frame: 513, kind: 3, id: 37, a: 12_000, b: 0 },
        { frame: 513, kind: 3, id: 38, a: 0.1, b: 0 },
        { frame: 640, kind: 3, id: 57, a: 0, b: 0 },

        { frame: 4096, kind: 2, id: 201, a: 0, b: 0 },
        { frame: 4096, kind: 2, id: 202, a: 0, b: 0 },
        { frame: 4096, kind: 2, id: 203, a: 0, b: 0 },
      ],
    });

    let boundaryPeak = 0;
    let releasePeak = 0;
    let nonFinite = 0;
    while (processor.renderFrame < 8192) {
      const blockStart = processor.renderFrame;
      const block = renderBlock(processor);
      boundaryPeak = Math.max(boundaryPeak, block.peak);
      nonFinite += block.nonFinite;
      if (blockStart >= 6144) releasePeak = Math.max(releasePeak, block.peak);
    }

    assert.equal(processor.failed, false, messages.find((message) => message.type === "error")?.message);
    assert.equal(nonFinite, 0, "same-frame filter bundles produced NaN or Infinity");
    assert.ok(boundaryPeak > ACTIVE_FLOOR,
      `same-frame filter bundles unexpectedly silenced the held notes: ${boundaryPeak}`);
    assert.ok(boundaryPeak <= TEST_PEAK_CEILING,
      `same-frame filter bundle peak ${boundaryPeak} exceeded ${TEST_PEAK_CEILING}`);
    assert.ok(releasePeak <= SILENCE_CEILING,
      `same-frame filter bundles left output after note-off: ${releasePeak}`);

    const panicFrame = processor.renderFrame;
    processor.receive({
      type: "events",
      events: [{ frame: panicFrame, kind: 1, id: 204, a: 72, b: 0.6 }],
    });
    let peakBeforePanic = 0;
    for (let block = 0; block < 8; block += 1) {
      const rendered = renderBlock(processor);
      peakBeforePanic = Math.max(peakBeforePanic, rendered.peak);
      nonFinite += rendered.nonFinite;
    }
    assert.ok(peakBeforePanic > ACTIVE_FLOOR,
      `same-frame filter panic note was not audible: ${peakBeforePanic}`);

    processor.receive({ type: "reset", kind: 0, seed: 1 });
    let peakAfterPanic = 0;
    for (let block = 0; block < 8; block += 1) {
      const rendered = renderBlock(processor);
      peakAfterPanic = Math.max(peakAfterPanic, rendered.peak);
      nonFinite += rendered.nonFinite;
    }
    assert.equal(nonFinite, 0, "same-frame filter panic produced NaN or Infinity");
    assert.ok(peakAfterPanic <= SILENCE_CEILING,
      `same-frame filter panic left residual output: ${peakAfterPanic}`);

    context.diagnostic(JSON.stringify({
      physicalOutput: "disconnected",
      sampleRate: SAMPLE_RATE,
      boundaryFrames: [127, 128, 129, 255, 256, 257, 511, 512, 513],
      sameFrameBundles: [127, 128, 129, 255, 256, 257, 511, 512, 513],
      heldNotes: [201, 202, 203],
      boundaryPeak,
      releasePeak,
      peakBeforePanic,
      peakAfterPanic,
      nonFinite,
    }));
  } finally {
    if (sampleRateDescriptor) Object.defineProperty(globalThis, "sampleRate", sampleRateDescriptor);
    else delete globalThis.sampleRate;
  }
});

test("silent safety gate: fresh Worklet instances at 44.1/48/96 kHz never carry held output", { concurrency: false }, async (context) => {
  const wasmPath = new URL("../../../build/synth_engine.wasm", import.meta.url);
  const wasmBytes = await readFile(wasmPath).catch((error) => {
    if (error?.code === "ENOENT") {
      context.skip("build/synth_engine.wasm is missing; run `make wasm WASM_CLANG=...` first");
      return null;
    }
    throw error;
  });
  if (!wasmBytes) return;

  const originalSampleRate = Object.getOwnPropertyDescriptor(globalThis, "sampleRate");
  const sampleRates = [44_100, 48_000, 96_000];
  const summaries = [];
  let previous = null;

  const withSampleRate = async (sampleRate, action) => {
    Object.defineProperty(globalThis, "sampleRate", {
      configurable: true,
      value: sampleRate,
    });
    try {
      return await action();
    } finally {
      if (originalSampleRate) Object.defineProperty(globalThis, "sampleRate", originalSampleRate);
      else delete globalThis.sampleRate;
    }
  };

  const renderBlocks = (processor, count) => {
    let peak = 0;
    let nonFinite = 0;
    for (let block = 0; block < count; block += 1) {
      const rendered = renderBlock(processor);
      peak = Math.max(peak, rendered.peak);
      nonFinite += rendered.nonFinite;
    }
    return { peak, nonFinite };
  };

  try {
    for (const sampleRate of sampleRates) {
      let handoffTail = 0;
      if (previous) {
        previous.processor.receive({ type: "reset", kind: 1, seed: sampleRate });
        const previousTail = renderBlocks(previous.processor, 8);
        handoffTail = previousTail.peak;
        assert.equal(previousTail.nonFinite, 0, `old ${previous.sampleRate} Hz processor must stay finite during handoff`);
        assert.ok(handoffTail <= SILENCE_CEILING,
          `old ${previous.sampleRate} Hz processor must be silent after handoff reset (${handoffTail})`);
      }

      const { processor } = await withSampleRate(sampleRate, async () => {
        const wasmBuffer = wasmBytes.buffer.slice(
          wasmBytes.byteOffset,
          wasmBytes.byteOffset + wasmBytes.byteLength,
        );
        const nextProcessor = new SynthEngineProcessor({ processorOptions: { wasmBytes: wasmBuffer } });
        const nextMessages = [];
        nextProcessor.port.postMessage = (message) => nextMessages.push(message);
        await waitUntilReady(nextProcessor, nextMessages);
        return { processor: nextProcessor, messages: nextMessages };
      });

      const initial = renderBlocks(processor, 8);
      assert.equal(initial.nonFinite, 0, `fresh ${sampleRate} Hz processor must start finite`);
      assert.ok(initial.peak <= SILENCE_CEILING,
        `fresh ${sampleRate} Hz processor must start silent (${initial.peak})`);

      processor.receive({
        type: "preset",
        params: [
          [0, 0], [1, 0], [2, 0.21],
          [3, 0.001], [4, 0.01], [5, 0.78], [6, 0.03], [7, 0.1],
          [9, 1], [17, 0], [18, 0], [19, 0], [20, 1], [26, 1], [27, 0],
          [28, 1], [29, 0], [32, 0], [35, 0], [75, 0], [78, 1],
          [90, 0], [94, 0], [99, 0], [103, 0],
        ],
      });
      processor.receive({
        type: "events",
        events: [{ frame: processor.renderFrame, kind: 1, id: 1, a: 108, b: 0.7 }],
      });
      const held = renderBlocks(processor, 8);
      assert.equal(held.nonFinite, 0, `${sampleRate} Hz held note must stay finite`);
      assert.ok(held.peak > ACTIVE_FLOOR,
        `${sampleRate} Hz held note must become audible in the Worklet buffer (${held.peak})`);
      assert.ok(held.peak <= TEST_PEAK_CEILING,
        `${sampleRate} Hz held note must stay below the safety ceiling (${held.peak})`);
      summaries.push({ sampleRate, initialPeak: initial.peak, heldPeak: held.peak, handoffTail });
      previous = { processor, sampleRate };
    }

    previous.processor.receive({ type: "reset", kind: 1, seed: 1 });
    const finalTail = renderBlocks(previous.processor, 8);
    assert.equal(finalTail.nonFinite, 0, "final processor must stay finite after handoff reset");
    assert.ok(finalTail.peak <= SILENCE_CEILING,
      `final processor must be silent after handoff reset (${finalTail.peak})`);

    context.diagnostic(JSON.stringify({
      physicalOutput: "disconnected",
      reconfiguration: "fresh SynthEngineProcessor after explicit handoff reset",
      sampleRates: summaries,
      finalTail: finalTail.peak,
    }));
  } finally {
    if (originalSampleRate) Object.defineProperty(globalThis, "sampleRate", originalSampleRate);
    else delete globalThis.sampleRate;
  }
});
