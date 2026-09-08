import assert from "node:assert/strict";
import test from "node:test";
import { importSource } from "./load-module.mjs";

const { parseWavetableWav } = await importSource("../wavetable-import.js");

function writeFourCC(view, offset, text) {
  for (let index = 0; index < 4; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
}

function pcm16Wav(sampleFrames, channels, sampleAt, sampleRate = 48000) {
  const dataBytes = sampleFrames * channels * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeFourCC(view, 0, "RIFF"); view.setUint32(4, 36 + dataBytes, true);
  writeFourCC(view, 8, "WAVE"); writeFourCC(view, 12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
  writeFourCC(view, 36, "data"); view.setUint32(40, dataBytes, true);
  for (let frame = 0; frame < sampleFrames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, sampleAt(frame, channel)));
      view.setInt16(44 + (frame * channels + channel) * 2,
        Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
    }
  }
  return buffer;
}

test("custom wavetable parser accepts and normalizes 1-4 exact 2048-sample frames", () => {
  const buffer = pcm16Wav(4096, 1, (index) =>
    0.2 + 0.3 * Math.sin((index % 2048) / 2048 * Math.PI * 2));
  const parsed = parseWavetableWav(buffer);
  assert.equal(parsed.frameCount, 2);
  assert.equal(parsed.frames.length, 4096);
  assert.equal(parsed.sampleRate, 48000);
  assert.equal(parsed.channels, 1);
  for (let frame = 0; frame < 2; frame += 1) {
    const samples = parsed.frames.subarray(frame * 2048, (frame + 1) * 2048);
    const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    const peak = samples.reduce((maximum, value) => Math.max(maximum, Math.abs(value)), 0);
    assert.ok(Math.abs(mean) < 1e-6, `frame mean was ${mean}`);
    assert.ok(Math.abs(peak - 0.95) < 1e-5, `frame peak was ${peak}`);
  }
});

test("custom wavetable parser averages stereo and rejects ambiguous or silent input", () => {
  const stereo = pcm16Wav(2048, 2, (index, channel) =>
    (channel ? 0.25 : 0.75) * Math.sin(index / 2048 * Math.PI * 2));
  const parsed = parseWavetableWav(stereo);
  assert.equal(parsed.channels, 2);
  assert.ok(Math.abs(parsed.frames[512] - 0.95) < 1e-4);

  assert.throws(() => parseWavetableWav(
    pcm16Wav(2050, 1, (index) => Math.sin(index / 2048 * Math.PI * 2))),
  /2048/);
  assert.throws(() => parseWavetableWav(pcm16Wav(2048, 1, () => 0.25)), /無音|一定値/);
  assert.throws(() => parseWavetableWav(new ArrayBuffer(44)), /RIFF\/WAVE/);
});
