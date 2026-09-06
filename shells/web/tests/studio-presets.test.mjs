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

test("studio preset candidates are parseable and only address SynthEngine parameter IDs", async () => {
  for (const file of studioPresetFiles) {
    const text = await readFile(new URL(`../../../presets/${file}`, import.meta.url), "utf8");
    const values = parsePreset(text);
    const ids = new Set(values.map(([id]) => id));
    assert.ok(values.length >= 16, `${file} should contain a complete audible starting point`);
    assert.equal(ids.size, values.length, `${file} should not define a parameter twice`);
    assert.ok(ids.has(75), `${file} should opt into the SPACE send bus`);
    for (const [id, value] of values) {
      assert.ok(id >= 0 && id < 76, `${file} parameter ${id} should be in range`);
      assert.ok(Number.isFinite(value), `${file} parameter ${id} should be finite`);
    }
  }
});
