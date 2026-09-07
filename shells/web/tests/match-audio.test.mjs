import assert from "node:assert/strict";
import test from "node:test";
import { candidateRenderPlan, compareSoundAnalyses, levelMatchGain, midiForFrequency } from "../match-audio.js";

test("frequency maps to nearest MIDI note with cents offset", () => {
  assert.deepEqual(midiForFrequency(440), { midi:69, exact:69, frequency:440, cents:0 });
  const sharp = midiForFrequency(445);
  assert.equal(sharp.midi, 69);
  assert.ok(sharp.cents > 19 && sharp.cents < 20);
});

test("candidate timing preserves leading silence and release room", () => {
  const plan = candidateRenderPlan({ pitchHz:440, pitchConfidence:.95, durationSeconds:2, activeStartSeconds:.2, activeEndSeconds:1.8 }, .4);
  assert.equal(plan.ready, true);
  assert.equal(plan.midi, 69);
  assert.equal(plan.noteOnSeconds, .2);
  assert.ok(Math.abs(plan.noteOffSeconds - 1.4) < 1e-9);
  assert.equal(plan.durationSeconds, 2);
});

test("candidate timing refuses uncertain pitch and caps long files", () => {
  assert.equal(candidateRenderPlan({ pitchHz:440, pitchConfidence:.69, durationSeconds:1 }, .1).ready, false);
  const capped = candidateRenderPlan({ pitchHz:440, pitchConfidence:.9, durationSeconds:20, activeStartSeconds:0, activeEndSeconds:19 }, .1);
  assert.equal(capped.durationSeconds, 12);
  assert.equal(capped.truncated, true);
});

test("level match targets active RMS unless peak ceiling is lower", () => {
  const rmsLimited = levelMatchGain({ activeRmsDbfs:-24, peakDbfs:-10 });
  assert.ok(Math.abs(rmsLimited.gain - 10 ** (6 / 20)) < 1e-9);
  assert.equal(rmsLimited.limitedBy, "rms");
  const peakLimited = levelMatchGain({ activeRmsDbfs:-30, peakDbfs:-2 });
  assert.ok(Math.abs(peakLimited.gain - 10 ** (1 / 20)) < 1e-9);
  assert.equal(peakLimited.limitedBy, "peak");
});

test("comparison reports signed candidate differences", () => {
  const result = compareSoundAnalyses(
    { pitchHz:440, attackSeconds:.1, brightnessHz:1000, envelope:{ values:[0, 1, .5, 0] } },
    { pitchHz:880, attackSeconds:.15, brightnessHz:1200, envelope:{ values:[0, 1, .5, 0] } },
  );
  assert.equal(result.envelopeCorrelation, 1);
  assert.equal(result.pitchDeltaCents, 1200);
  assert.ok(Math.abs(result.attackDeltaMs - 50) < 1e-9);
  assert.ok(Math.abs(result.brightnessDeltaPercent - 20) < 1e-9);
});
