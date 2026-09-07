import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { importSource } from "./load-module.mjs";

const { parsePreset } = await importSource("../synth-node.js");
const studioPresetFiles = [
  "studio_wide_pad.txt",
  "studio_warm_bass.txt",
  "studio_glass_bell.txt",
  "studio_bright_pluck.txt",
  "studio_motion_lead.txt",
  "studio_air_keys.txt",
];

const auditionEnvelopeTargets = new Map([
  ["rsk_epiano.txt", { sustain:.16, release:.18 }],
  ["rsk_saw.txt", { sustain:.24, release:.42 }],
  ["rsk_pluck.txt", { sustain:.09, release:.09 }],
  ["rsk_bell.txt", { sustain:.04, release:.42 }],
  ["studio_wide_pad.txt", { sustain:.64, release:1.8 }],
  ["studio_warm_bass.txt", { sustain:.68, release:.2 }],
  ["studio_glass_bell.txt", { sustain:0, release:1.9 }],
  ["studio_bright_pluck.txt", { sustain:.08, release:.13 }],
  ["studio_motion_lead.txt", { sustain:.54, release:.35 }],
  ["studio_air_keys.txt", { sustain:.32, release:.78 }],
]);

test("studio preset candidates are parseable and only address SynthEngine parameter IDs", async () => {
  for (const file of studioPresetFiles) {
    const text = await readFile(new URL(`../../../presets/${file}`, import.meta.url), "utf8");
    const values = parsePreset(text);
    const ids = new Set(values.map(([id]) => id));
    assert.ok(values.length >= 16, `${file} should contain a complete audible starting point`);
    assert.equal(ids.size, values.length, `${file} should not define a parameter twice`);
    assert.ok(ids.has(75), `${file} should opt into the SPACE send bus`);
    for (const [id, value] of values) {
      assert.ok(id >= 0 && id < 113, `${file} parameter ${id} should be in range`);
      assert.ok(Number.isFinite(value), `${file} parameter ${id} should be finite`);
    }
  }
});

test("audition presets keep shorter amp sustain and release targets", async () => {
  for (const [file, expected] of auditionEnvelopeTargets) {
    const text = await readFile(new URL(`../../../presets/${file}`, import.meta.url), "utf8");
    const values = new Map(parsePreset(text));
    assert.equal(values.get(5), expected.sustain, `${file} amp sustain`);
    assert.equal(values.get(6), expected.release, `${file} amp release`);
  }
});
