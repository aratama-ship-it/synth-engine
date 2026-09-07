import test from "node:test";
import assert from "node:assert/strict";
import { importSource } from "./load-module.mjs";

const { REVERB_MATERIALS, SPACE_DEFAULTS, createReverbImpulse, createSpaceEffects } = await importSource("../space-effects.js");

function audioParam(scheduledTargets, scheduledRamps) {
  return { value: 0, cancelScheduledValues() {}, setTargetAtTime(value) { scheduledTargets?.push(value); this.value = value; }, setValueAtTime(value) { this.value = value; }, linearRampToValueAtTime(value) { scheduledRamps?.push(value); this.value = value; } };
}

function node(extra = {}) {
  return { connections: [], connect(destination) { this.connections.push(destination); return destination; }, ...extra };
}

function contextMock(state) {
  const scheduledTargets = []; const scheduledRamps = [];
  return {
    currentTime: 0,
    state,
    sampleRate: 48000,
    scheduledTargets,
    scheduledRamps,
    destination: node(),
    createGain: () => node({ gain: audioParam(scheduledTargets, scheduledRamps) }),
    createDelay: () => node({ delayTime: audioParam(scheduledTargets, scheduledRamps) }),
    createBiquadFilter: () => node({ frequency: audioParam(scheduledTargets, scheduledRamps), Q: audioParam(scheduledTargets, scheduledRamps), type: "" }),
    createConvolver: () => node({ normalize: false, buffer: null }),
    createBuffer(channels, frames) {
      const data = Array.from({ length: channels }, () => new Float32Array(frames));
      return { numberOfChannels: channels, length:frames, sampleRate:this.sampleRate, getChannelData: (channel) => data[channel] };
    },
  };
}

test("delay and reverb receive the audible dry output independently of the optional core send", () => {
  const context = contextMock();
  const synth = { sendOutput: 1, calls: [], connect(destination, output) { this.calls.push({ destination, output }); } };
  const effects = createSpaceEffects(context, synth);

  assert.equal(synth.calls.length, 1);
  assert.equal(synth.calls[0].output, 0);
  assert.deepEqual(effects.getValues(), SPACE_DEFAULTS);
  assert.deepEqual(Object.keys(REVERB_MATERIALS), ["clear", "bright", "warm", "grain"]);
  assert.ok(REVERB_MATERIALS.bright.highCut > REVERB_MATERIALS.clear.highCut);
  assert.ok(REVERB_MATERIALS.bright.damping < REVERB_MATERIALS.clear.damping);
  for (const material of Object.values(REVERB_MATERIALS)) assert.ok(material.highCut >= REVERB_MATERIALS.warm.highCut);
  for (const material of Object.values(REVERB_MATERIALS)) assert.ok(material.damping <= REVERB_MATERIALS.warm.damping);
  const values = effects.setValues({ delayOn:true, delayFeedback:9, delayMix:1, delayTime:9, reverbOn:false, reverbMix:-1, reverbMaterial:"warm", reverbDecay:5.2, reverbDamping:-1 });
  assert.equal(values.delayOn, true);
  assert.equal(values.delayFeedback, .85);
  assert.equal(values.delayMix, .65);
  assert.equal(values.delayTime, 1.5);
  assert.equal(values.reverbOn, false);
  assert.equal(values.reverbMix, 0);
  assert.equal(values.reverbMaterial, "warm");
  assert.equal(values.reverbDecay, 5.2);
  assert.equal(values.reverbDamping, 0);
  assert.equal(effects.setValues({ reverbDamping:9 }).reverbDamping, 1);
  assert.throws(() => effects.setValues({ reverbMaterial: "unknown" }), /unknown reverb material/);
  assert.throws(() => effects.setValues({ delayTime: Number.NaN }), /finite number/);
  effects.dispose();
});

test("damping changes high-frequency tail energy without extending the impulse", () => {
  const context = contextMock();
  const shared = { ...SPACE_DEFAULTS, reverbDecay:3, reverbSize:.7 };
  const open = createReverbImpulse(context, { ...shared, reverbDamping:0 });
  const damped = createReverbImpulse(context, { ...shared, reverbDamping:1 });
  assert.equal(open.length, damped.length);
  const highFrequencyTailEnergy = (buffer) => {
    const data = buffer.getChannelData(0);
    const start = Math.floor(data.length * .25);
    let energy = 0;
    for (let index = Math.max(1, start); index < data.length; index += 1) energy += (data[index] - data[index - 1]) ** 2;
    return energy;
  };
  assert.ok(highFrequencyTailEnergy(open) > highFrequencyTailEnergy(damped) * 3);
});

for (const sampleRate of [44100, 48000, 96000]) {
  test(`dense stereo impulse is finite, DC-controlled, and decays at ${sampleRate} Hz`, () => {
    const context = contextMock(); context.sampleRate = sampleRate;
    const buffer = createReverbImpulse(context, { ...SPACE_DEFAULTS, reverbDecay:.55, reverbSize:.7 });
    assert.ok(buffer.length > sampleRate * .6);
    const [left, right] = [buffer.getChannelData(0), buffer.getChannelData(1)];
    let sum = 0; let peak = 0; let nonzero = 0; let cross = 0; let leftEnergy = 0; let rightEnergy = 0;
    for (let index = 0; index < left.length; index += 1) {
      assert.ok(Number.isFinite(left[index]) && Number.isFinite(right[index]));
      sum += left[index]; peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index])); if (left[index] !== 0) nonzero += 1;
      cross += left[index] * right[index]; leftEnergy += left[index] ** 2; rightEnergy += right[index] ** 2;
    }
    const quarter = Math.floor(left.length / 4);
    const energy = (start, end) => left.slice(start, end).reduce((total, value) => total + value * value, 0);
    assert.ok(Math.abs(leftEnergy - 1) < 1e-5);
    assert.ok(Math.abs(rightEnergy - 1) < 1e-5);
    assert.ok(Math.abs(sum / left.length) < 1e-5);
    assert.ok(peak <= .781);
    assert.ok(nonzero / left.length > .65);
    assert.ok(energy(0, quarter) > energy(left.length - quarter, left.length) * 5);
    assert.ok(Math.abs(cross / Math.sqrt(leftEnergy * rightEnergy)) < .98);
  });
}

test("suspended space bus applies off and mix values before audio starts", () => {
  const context = contextMock("suspended");
  const synth = { connect() {} };
  createSpaceEffects(context, synth).dispose();
  assert.deepEqual(context.scheduledTargets, []);
  assert.deepEqual(context.scheduledRamps, []);
});
