import test from "node:test";
import assert from "node:assert/strict";
import { importSource } from "./load-module.mjs";

const { createSynthNode } = await importSource("../synth-node.js");

function parameterExports() {
  return {
    memory: new WebAssembly.Memory({ initial: 1 }),
    __heap_base: new WebAssembly.Global({ value: "i32", mutable: false }, 4096),
    synth_param_count: () => 0,
    synth_param_info: () => -1,
  };
}

test("node API exposes two stereo outputs, ordered noteOnWith events, and output-selecting connect", async () => {
  const originalInstantiate = WebAssembly.instantiate;
  const OriginalAudioWorkletNode = globalThis.AudioWorkletNode;
  const messages = [];
  const connections = [];
  let nodeOptions;
  class FakeAudioWorkletNode {
    constructor(_context, _name, options) {
      nodeOptions = options;
      this.port = {
        addEventListener() {},
        start() {},
        postMessage(message) { messages.push(message); },
      };
    }

    connect(...args) {
      connections.push(args);
      return "connected";
    }

    disconnect() {}
  }

  WebAssembly.instantiate = async () => ({ instance: { exports: parameterExports() } });
  globalThis.AudioWorkletNode = FakeAudioWorkletNode;
  const context = {
    currentTime: 1,
    sampleRate: 48000,
    audioWorklet: { async addModule() {} },
  };
  try {
    const synth = await createSynthNode(context, new ArrayBuffer(0));
    assert.equal(nodeOptions.numberOfInputs, 0);
    assert.equal(nodeOptions.numberOfOutputs, 2);
    assert.deepEqual(nodeOptions.outputChannelCount, [2, 2]);
    assert.equal(synth.sendOutput, 1);

    const destination = {};
    assert.equal(synth.connect(destination), "connected");
    assert.equal(synth.connect(destination, 1), "connected");
    assert.deepEqual(connections, [[destination, 0], [destination, 1]]);

    synth.voiceParam([[37, 4000]]);
    synth.noteOnWith(60, 0.75, [[37, 4000], [75, 1]], 1234);
    assert.deepEqual(messages, [
      { type: "voiceParam", params: [[37, 4000]], frame: 48000 },
      {
        type: "events",
        events: [
          { frame: 1234, kind: 5, id: 37, a: 4000, b: 0 },
          { frame: 1234, kind: 5, id: 75, a: 1, b: 0 },
          { frame: 1234, kind: 1, id: 60, a: 60, b: 0.75 },
        ],
      },
    ]);
  } finally {
    WebAssembly.instantiate = originalInstantiate;
    globalThis.AudioWorkletNode = OriginalAudioWorkletNode;
  }
});
