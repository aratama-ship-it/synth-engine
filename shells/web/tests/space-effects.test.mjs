import test from "node:test";
import assert from "node:assert/strict";
import { importSource } from "./load-module.mjs";

const { REVERB_MATERIALS, SPACE_DEFAULTS, createSpaceEffects } = await importSource("../space-effects.js");

function audioParam() {
  return { value: 0, cancelScheduledValues() {}, setTargetAtTime(value) { this.value = value; } };
}

function node(extra = {}) {
  return { connections: [], connect(destination) { this.connections.push(destination); return destination; }, ...extra };
}

function contextMock() {
  return {
    currentTime: 0,
    sampleRate: 48000,
    destination: node(),
    createGain: () => node({ gain: audioParam() }),
    createDelay: () => node({ delayTime: audioParam() }),
    createBiquadFilter: () => node({ frequency: audioParam(), Q: audioParam(), type: "" }),
    createConvolver: () => node({ normalize: false, buffer: null }),
    createBuffer(channels, frames) {
      const data = Array.from({ length: channels }, () => new Float32Array(frames));
      return { numberOfChannels: channels, getChannelData: (channel) => data[channel] };
    },
  };
}

test("delay and reverb receive only the SynthEngine send output through independent inputs", () => {
  const context = contextMock();
  const synth = { sendOutput: 1, calls: [], connect(destination, output) { this.calls.push({ destination, output }); } };
  const effects = createSpaceEffects(context, synth);

  assert.equal(synth.calls.length, 1);
  assert.equal(synth.calls[0].output, 1);
  assert.deepEqual(effects.getValues(), SPACE_DEFAULTS);
  assert.deepEqual(Object.keys(REVERB_MATERIALS), ["clear", "warm", "grain"]);
  const values = effects.setValues({ delaySend: 9, delayMix: 1, delayTime: 9, reverbSend: -1, reverbMix: -1, reverbMaterial: "warm" });
  assert.deepEqual(values, { delaySend: 1, delayMix: 0.65, delayTime: 0.72, reverbSend: 0, reverbMix: 0, reverbMaterial: "warm" });
  assert.throws(() => effects.setValues({ reverbMaterial: "unknown" }), /unknown reverb material/);
});
