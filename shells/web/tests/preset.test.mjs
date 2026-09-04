import test from "node:test";
import assert from "node:assert/strict";
import { importSource } from "./load-module.mjs";

const { parsePreset } = await importSource("../synth-node.js");

test("preset parser accepts M0a lines, whitespace, comments, and scientific notation", () => {
  const text = `
    # saw
    0=1
    2 = 0.8
    3=5e-3 # attack
  `;
  assert.deepEqual(parsePreset(text), [[0, 1], [2, 0.8], [3, 0.005]]);
});

test("preset parser rejects malformed and non-finite values with a line number", () => {
  assert.throws(() => parsePreset("0=1\nwrong"), /line 2/);
  assert.throws(() => parsePreset("7=Infinity"), /line 1/);
  assert.throws(() => parsePreset("-1=0"), /line 1/);
});

test("preset parser rejects non-string input", () => {
  assert.throws(() => parsePreset(null), /string/);
});
