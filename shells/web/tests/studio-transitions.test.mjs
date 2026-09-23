import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { importSource } from "./load-module.mjs";
const { createPatchLoadState } = await importSource("../patch-load-state.js");
const source = await readFile(new URL("../synth-ui.js", import.meta.url), "utf8");
function extract(name) {
  const text = source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^}`, "m"))?.[0];
  assert.ok(text, `${name} remains testable`); return text;
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function loaderContext() {
  const requests = new Map(); const applied = []; const messages = [];
  const context = vm.createContext({
    patchLoads:createPatchLoadState(), userPatches:[],
    currentPatchName:() => "Current", currentPatchCategory:() => "Custom", syncPresetIdentity() {},
    presets:{ a:{ label:"A", file:"a" }, b:{ label:"B", file:"b" } }, presetCategories:{ a:"Keys", b:"Lead" },
    paths:{ presets:"" }, SPACE_DEFAULTS:{}, FX_DEFAULTS:{},
    fetchChecked:(id) => { const task = deferred(); requests.set(id, task); return task.promise; },
    parsePreset:() => [], createPatchSnapshot:(patch) => patch,
    applyPatch:(patch) => { context.patchLoads.invalidate(); applied.push(patch); },
    elements:{ "patch-file":{ value:"" } }, parsePatch:JSON.parse,
    setStatus:(message) => messages.push(message),
  });
  vm.runInContext(["loadPreset", "importPatchFile", "initPatch"].map(extract).join("\n"), context);
  return { context, requests, applied, messages };
}

test("latest preset wins even when responses arrive in reverse order", async () => {
  const { context, requests, applied } = loaderContext();
  const first = context.loadPreset("a"); const last = context.loadPreset("b");
  requests.get("b").resolve("B"); await last;
  requests.get("a").resolve("A"); await first;
  assert.deepEqual(applied.map((p) => p.name), ["B"]);
});

test("INIT and edits invalidate pending preset reads and stale errors", async () => {
  const { context, requests, applied } = loaderContext();
  const first = context.loadPreset("a"); context.initPatch(); requests.get("a").resolve("A"); await first;
  assert.deepEqual(applied.map((p) => p.name), ["INIT"]);
  const second = context.loadPreset("b"); context.patchLoads.invalidate(); requests.get("b").reject(new Error("old failure")); await second;
  assert.equal(applied.length, 1);
});

test("invalid JSON does not reset current sound or roll back concurrent edits", async () => {
  const { context, applied, messages } = loaderContext();
  await context.importPatchFile({ text:async () => "not json" });
  assert.equal(applied.length, 0); assert.equal(messages.length, 1);
  const read = deferred(); const pending = context.importPatchFile({ text:() => read.promise });
  context.patchLoads.invalidate(); read.resolve('{"name":"outdated"}'); await pending;
  assert.equal(applied.length, 0); assert.equal(messages.length, 1);
});

test("current preset and apply errors are surfaced rather than swallowed", async () => {
  const { context, requests } = loaderContext();
  const pending = context.loadPreset("a"); requests.get("a").reject(new Error("network"));
  await assert.rejects(pending, /network/);
  context.applyPatch = () => { context.patchLoads.invalidate(); throw new Error("apply failed"); };
  const next = context.loadPreset("b"); requests.get("b").resolve("B");
  await assert.rejects(next, /apply failed/);
});

test("blocked storage is nonfatal and panic preserves patch parameters", () => {
  const calls = []; const context = vm.createContext({
    localStorage:{ getItem() { throw new Error("denied"); } }, storageKeys:{ autosave:"test" }, reportStorageError:(error) => calls.push(error.message),
    stopAllNotes:() => calls.push("notes"), synth:{ reset:(kind) => calls.push(kind) },
    closeOutputGate:() => calls.push("gate"), suspendAudioContext:() => calls.push("suspend"),
  });
  vm.runInContext(extract("readAutosave") + "\n" + extract("panicAudio"), context);
  assert.equal(context.readAutosave(), null);
  context.panicAudio(); assert.deepEqual(calls, ["denied", "notes", 0, "gate", "suspend"]);
});

test("patch application always clears applying state on an exception", () => {
  const context = vm.createContext({
    validatePatch:(p) => p, patchLoads:createPatchLoadState(), applyingPatch:false,
    clearTimeout() {}, captureTimer:undefined, stopAllNotes() {},
    syncPresetIdentity() {}, restoreDefaults() { throw new Error("render failed"); },
  });
  vm.runInContext(extract("applyPatch"), context);
  assert.throws(() => context.applyPatch({ name:"test", category:"Custom" }), /render failed/);
  assert.equal(context.applyingPatch, false);
});

test("worklet errors and processor failures mute output and block unsafe reopening", async () => {
  for (const event of ["error", "processorerror"]) {
    const callbacks = {}; const warning = { hidden:true }; const calls = [];
    const node = { onMessage:(fn) => { callbacks.message = fn; }, audioNode:{ addEventListener:(name, fn) => { callbacks[name] = fn; } }, connect() {}, setParam() {} };
    const context = vm.createContext({
      audioReady:undefined, audioFailure:undefined, context:undefined, synth:undefined, outputGate:undefined, spaceEffects:undefined,
      AudioContext:class { createGain() { return { gain:{ value:1 }, connect() {} }; } },
      createSynthNode:async () => node, createSpaceEffects:() => ({ setValues() {} }),
      wasmBytes:new ArrayBuffer(8), values:new Map([[7, .13]]), spaceValues:{},
      panicAudio:() => calls.push("muted"), document:{ getElementById:() => warning }, setStatus:(message) => calls.push(message),
    });
    vm.runInContext(extract("prepareAudio") + "\n" + extract("ensureAudio"), context);
    await context.prepareAudio();
    if (event === "error") callbacks.message({ type:"error", message:"forced failure" });
    else callbacks.processorerror();
    assert.equal(warning.hidden, false); assert.equal(calls[0], "muted");
    await assert.rejects(context.ensureAudio(), /再読み込み/);
  }
});
