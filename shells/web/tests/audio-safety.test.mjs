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

test("silent safety gate: high-FM quality change, note release, and panic remain bounded", { concurrency: false }, async (context) => {
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
        [9, 1], [17, 0], [18, 0], [19, 0], [20, 1], [26, 1], [27, 0],
        [28, 1], [78, 1], [29, 0], [32, 0], [35, 0], [75, 0],
        [90, 0], [94, 0], [99, 0], [103, 0],
      ],
    });
    processor.receive({
      type: "events",
      events: [
        { frame: 0, kind: 1, id: 1, a: 108, b: 0.5 },
        { frame: 4096, kind: 3, id: 78, a: 0, b: 0 },
        { frame: 8192, kind: 2, id: 1, a: 0, b: 0 },
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
