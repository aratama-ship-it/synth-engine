import assert from "node:assert/strict";
import test from "node:test";
import { FX_CORE_PARAM_IDS, FX_DEFAULTS, FX_IDS, createInsertFxRack, fxCoreParams, normalizeFxOrder, sanitizeFxPatch } from "../fx-rack.js";

function audioParam(value = 0, scheduledTargets) { return { value, cancelScheduledValues() {}, setTargetAtTime(next) { scheduledTargets?.push(next); this.value = next; } }; }
function audioNode(extra = {}) { return { connections:[], connect(destination, output, input) { this.connections.push({ destination, output, input }); return destination; }, disconnect() { this.connections = []; }, ...extra }; }
function contextMock(state) {
  const scheduledTargets = [];
  return {
    currentTime:0,
    state,
    scheduledTargets,
    destination:audioNode(),
    createGain:() => audioNode({ gain:audioParam(1, scheduledTargets) }),
    createWaveShaper:() => audioNode({ curve:null, oversample:"none" }),
    createBiquadFilter:() => audioNode({ type:"", frequency:audioParam(0, scheduledTargets), Q:audioParam(0, scheduledTargets), gain:audioParam(0, scheduledTargets) }),
    createDelay:() => audioNode({ delayTime:audioParam(0, scheduledTargets) }),
    createChannelSplitter:() => audioNode(),
    createChannelMerger:() => audioNode(),
    createOscillator:() => audioNode({ frequency:audioParam(1, scheduledTargets), start() {} }),
    createDynamicsCompressor:() => audioNode({ threshold:audioParam(0, scheduledTargets), ratio:audioParam(0, scheduledTargets), attack:audioParam(0, scheduledTargets), release:audioParam(0, scheduledTargets) }),
  };
}

test("insert order contains each supported effect exactly once", () => {
  assert.deepEqual(normalizeFxOrder(["chorus", "distortion", "compressor", "eq"]), ["chorus", "distortion", "compressor", "eq"]);
  assert.throws(() => normalizeFxOrder(["chorus", "chorus", "eq", "compressor"]), /exactly once/);
  assert.deepEqual(FX_IDS, ["distortion", "chorus", "eq", "compressor"]);
});

test("insert patch clamps finite values and rejects unknown controls", () => {
  const next = sanitizeFxPatch(structuredClone(FX_DEFAULTS), { modules:{ distortion:{ on:true, drive:4 }, compressor:{ threshold:-100, ratio:40 } } });
  assert.equal(next.modules.distortion.on, true);
  assert.equal(next.modules.distortion.drive, 1);
  assert.equal(next.modules.compressor.threshold, -60);
  assert.equal(next.modules.compressor.ratio, 20);
  assert.throws(() => sanitizeFxPatch(next, { modules:{ chorus:{ rate:Number.NaN } } }), /finite number/);
  assert.throws(() => sanitizeFxPatch(next, { modules:{ limiter:{ on:true } } }), /unknown insert effect/);
});

test("rack connects the dry synth output and restores reordered state", () => {
  const context = contextMock(); const source = audioNode();
  const rack = createInsertFxRack(context, source);
  assert.equal(source.connections.length, 1);
  assert.equal(source.connections[0].output, 0);
  assert.deepEqual(rack.getValues(), FX_DEFAULTS);
  const state = rack.setValues({ order:["eq", "distortion", "chorus", "compressor"], modules:{ eq:{ on:true, low:3.5 }, distortion:{ on:true } } });
  assert.deepEqual(state.order, ["eq", "distortion", "chorus", "compressor"]);
  assert.equal(state.modules.eq.low, 3.5);
  assert.equal(state.modules.distortion.on, true);
});

test("suspended rack applies bypass gains before audio starts instead of scheduling from unity", () => {
  const context = contextMock("suspended");
  createInsertFxRack(context, audioNode());
  assert.deepEqual(context.scheduledTargets, []);
});

test("human-readable insert patch maps to contiguous shared-core parameters", () => {
  const params = new Map(fxCoreParams({
    order:["eq", "distortion", "compressor", "chorus"],
    modules:{ distortion:{ on:true, drive:.7 }, chorus:{ mix:.4 }, eq:{ high:6 }, compressor:{ threshold:-24 } },
  }));
  assert.equal(params.size, 23);
  assert.equal(params.get(FX_CORE_PARAM_IDS.distortion.on), 1);
  assert.equal(params.get(FX_CORE_PARAM_IDS.distortion.drive), .7);
  assert.equal(params.get(FX_CORE_PARAM_IDS.chorus.on), 0);
  assert.equal(params.get(FX_CORE_PARAM_IDS.eq.high), 6);
  assert.equal(params.get(FX_CORE_PARAM_IDS.compressor.threshold), -24);
  assert.deepEqual(FX_CORE_PARAM_IDS.order.map((id) => params.get(id)), [2, 0, 3, 1]);
});
