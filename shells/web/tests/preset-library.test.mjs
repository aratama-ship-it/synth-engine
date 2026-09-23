import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { COLLECTION_PRESETS, mergePresetParameters } from "../preset-collection.js";
import { importSource } from "./load-module.mjs";

const { parsePreset, getParams } = await importSource("../synth-node.js");
const { SynthEngineProcessor } = await importSource("../synth-worklet.js");
const collection = Object.entries(COLLECTION_PRESETS);

test("library collection has 20 distinct, bounded, complete starting points", async () => {
  assert.equal(collection.length, 20);
  assert.equal(new Set(collection.map(([, item]) => item.label.toLocaleLowerCase())).size, collection.length);
  const wasm = await readFile(new URL("../../../build/synth_engine.wasm", import.meta.url));
  const parameters = await getParams(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
  const byId = new Map(parameters.map((parameter) => [parameter.id, parameter]));
  const signatures = new Set();
  for (const [id, item] of collection) {
    assert.ok(item.label && item.description && item.category, id);
    const text = await readFile(new URL(`../../../presets/${item.file}`, import.meta.url), "utf8");
    const core = mergePresetParameters(parsePreset(text), item.overrides);
    const values = new Map(core);
    assert.equal(values.size, core.length, `${id}: duplicate parameter`);
    assert.ok(values.size >= 16, `${id}: incomplete patch`);
    assert.ok(values.get(7) > 0 && values.get(7) <= .35, `${id}: conservative master level`);
    assert.ok(values.get(6) >= 0 && values.get(6) <= 1.2, `${id}: bounded release`);
    for (const [paramId, value] of core) {
      const info = byId.get(paramId);
      assert.ok(info, `${id}: unknown parameter ${paramId}`);
      assert.ok(Number.isFinite(value) && value >= info.min - 1e-5 && value <= info.max + 1e-5, `${id}: ${paramId} outside ${info.min}..${info.max}`);
    }
    const signature = JSON.stringify(core);
    assert.ok(!signatures.has(signature), `${id}: duplicate sound settings`);
    signatures.add(signature);
  }
});

test("all collection patches render finite and below full scale with no audio device", { concurrency:false }, async () => {
  const bytes = await readFile(new URL("../../../build/synth_engine.wasm", import.meta.url));
  const wasm = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const parameters = await getParams(wasm);
  const defaults = parameters.map(({ id, default: value }) => [id, value]);
  const original = Object.getOwnPropertyDescriptor(globalThis, "sampleRate");
  Object.defineProperty(globalThis, "sampleRate", { configurable:true, value:48_000 });
  try {
    const processor = new SynthEngineProcessor({ processorOptions:{ wasmBytes:wasm } });
    const errors = []; processor.port.postMessage = (message) => { if (message.type === "error") errors.push(message.message); };
    const deadline = Date.now() + 5_000;
    while (!processor.ready && !processor.failed && Date.now() < deadline) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(processor.ready, true, errors.join("; "));
    for (const [id, item] of collection) {
      const core = mergePresetParameters(parsePreset(await readFile(new URL(`../../../presets/${item.file}`, import.meta.url), "utf8")), item.overrides);
      processor.receive({ type:"reset", kind:1, seed:1 });
      processor.receive({ type:"preset", params:[...defaults, ...core] });
      processor.receive({ type:"events", events:[{ frame:processor.renderFrame, kind:1, id:1, a:60, b:.5 }] });
      let peak = 0;
      for (let block = 0; block < 80; block += 1) {
        const outputs = [[new Float32Array(128), new Float32Array(128)], [new Float32Array(128), new Float32Array(128)]];
        processor.process([], outputs);
        for (const output of outputs) for (const channel of output) for (const sample of channel) {
          assert.ok(Number.isFinite(sample), `${id}: non-finite sample`);
          peak = Math.max(peak, Math.abs(sample));
        }
      }
      assert.ok(peak > 1e-5, `${id}: silent preset`);
      assert.ok(peak < 1, `${id}: peak ${peak.toFixed(3)} exceeds full scale`);
      assert.equal(processor.failed, false, `${id}: ${errors.join("; ")}`);
    }
  } finally {
    if (original) Object.defineProperty(globalThis, "sampleRate", original);
    else delete globalThis.sampleRate;
  }
});
