import assert from "node:assert/strict";
import test from "node:test";
import { estimateFilterCutoff, planFilterCutoffProbe } from "../filter-match.js";

const base = { filterEnabled:1, filterMode:0, currentCutoff:1000, referenceBrightness:600, currentBrightness:400 };

test("monotonic local response calibrates a finite bracketed Cutoff", () => {
  const plan = planFilterCutoffProbe(base);
  assert.equal(plan.state, "calibrating");
  assert.equal(plan.probeCutoff, 2000);
  const result = estimateFilterCutoff(plan, 800);
  assert.equal(result.available, true);
  assert.equal(result.state, "ready");
  assert.equal(result.suggestedCutoff, 1500);
  assert.equal(result.confidence, "HIGH");
  assert.equal(result.limited, false);
});

test("darker reference probes downward and respects the one-step limit", () => {
  const downward = planFilterCutoffProbe({ ...base, currentCutoff:2000, referenceBrightness:400, currentBrightness:800 });
  assert.equal(downward.probeCutoff, 1000);
  assert.equal(estimateFilterCutoff(downward, 400).suggestedCutoff, 1000);
  const shallow = planFilterCutoffProbe({ ...base, referenceBrightness:1600 });
  const limited = estimateFilterCutoff(shallow, 500);
  assert.equal(limited.suggestedCutoff, 4000);
  assert.equal(limited.limited, true);
  assert.equal(limited.confidence, "LOW");
});

test("brightness within five percent is aligned without an apply candidate", () => {
  const result = planFilterCutoffProbe({ ...base, referenceBrightness:408, currentBrightness:400 });
  assert.equal(result.state, "aligned");
  assert.equal(result.available, false);
  assert.equal(result.suggestedCutoff, 1000);
});

test("bypass, unsupported modes, boundaries, reversed response, and low sensitivity are unavailable", () => {
  assert.equal(planFilterCutoffProbe({ ...base, filterEnabled:0 }).state, "unavailable");
  assert.equal(planFilterCutoffProbe({ ...base, filterMode:4 }).state, "unavailable");
  assert.equal(planFilterCutoffProbe({ ...base, currentCutoff:20000 }).state, "unavailable");
  const plan = planFilterCutoffProbe(base);
  assert.equal(estimateFilterCutoff(plan, 350).state, "unavailable");
  assert.equal(estimateFilterCutoff(plan, 405).state, "unavailable");
});
