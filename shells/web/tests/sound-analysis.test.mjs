import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSound, correlation, derivativeCentroid, rmsEnvelope } from "../sound-analysis.js";

function sine({ frequency = 440, seconds = 1, sampleRate = 48000, attack = 0, phase = 0 } = {}) {
  const samples = new Float32Array(Math.round(seconds * sampleRate));
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / sampleRate;
    const gain = attack > 0 ? Math.min(1, time / attack) : 1;
    samples[index] = Math.sin(time * frequency * Math.PI * 2 + phase) * gain * .5;
  }
  return samples;
}

test("analysis recovers a monophonic pitch and known attack", () => {
  const analysis = analyzeSound({ channels:[sine({ attack:.2 })], sampleRate:48000 });
  assert.ok(Math.abs(analysis.pitchHz - 440) < 2, `pitch=${analysis.pitchHz}`);
  assert.ok(analysis.pitchConfidence >= .9, `confidence=${analysis.pitchConfidence}`);
  assert.ok(analysis.attackSeconds >= .14 && analysis.attackSeconds <= .22, `attack=${analysis.attackSeconds}`);
  assert.ok(Number.isFinite(analysis.activeRmsDbfs));
  assert.equal(analysis.warnings.length, 0);
});

test("active RMS excludes leading and trailing silence", () => {
  const signal = new Float32Array(48000);
  signal.set(sine({ seconds:.5 }), 12000);
  const analysis = analyzeSound({ channels:[signal], sampleRate:48000 });
  assert.ok(analysis.activeRmsDbfs > analysis.rmsDbfs + 2.5, `active=${analysis.activeRmsDbfs}, overall=${analysis.rmsDbfs}`);
});

test("stereo width distinguishes identical and opposite channels", () => {
  const left = sine();
  const same = analyzeSound({ channels:[left, left.slice()], sampleRate:48000 });
  const opposite = Float32Array.from(left, (value) => -value);
  const wide = analyzeSound({ channels:[left, opposite], sampleRate:48000 });
  assert.ok(same.stereoWidth < 1e-6);
  assert.ok(wide.stereoWidth > .999);
});

test("shared M2 metrics stay deterministic", () => {
  const source = sine({ frequency:220, seconds:.5 });
  const envelope = rmsEnvelope(source, 48000);
  assert.equal(envelope.values.length, 25);
  assert.ok(derivativeCentroid(source, 48000) > 200);
  assert.equal(correlation(envelope.values, envelope.values), 1);
});

test("quiet input reports quality warnings instead of inventing pitch", () => {
  const analysis = analyzeSound({ channels:[new Float32Array(48000)], sampleRate:48000 });
  assert.equal(analysis.pitchHz, null);
  assert.ok(analysis.warnings.includes("too-quiet"));
  assert.ok(analysis.warnings.includes("pitch-uncertain"));
});
