import assert from "node:assert/strict";
import test from "node:test";
import { MOD_DESTINATIONS, MOD_SOURCES, findAssignmentSlot, modulationAmountLabel, modulationSlotIds } from "../mod-matrix.js";

test("matrix labels match the 12 source and 14 destination core contract", () => {
  assert.equal(MOD_SOURCES.length, 12);
  assert.equal(MOD_SOURCES[8], "LFO 2");
  assert.equal(MOD_SOURCES[9], "Macro 3");
  assert.equal(MOD_SOURCES[10], "Macro 4");
  assert.equal(MOD_SOURCES[11], "ENV 3 · Mod");
  assert.equal(MOD_DESTINATIONS.length, 14);
  assert.deepEqual(modulationSlotIds(0), { source:55, destination:56, amount:57 });
  assert.deepEqual(modulationSlotIds(5), { source:70, destination:71, amount:72 });
  assert.throws(() => modulationSlotIds(6), RangeError);
});

test("assignment reuses an exact route, otherwise chooses the first empty slot", () => {
  const values = new Map([[55, 1], [56, 8], [58, 3], [59, 5]]);
  assert.equal(findAssignmentSlot((id) => values.get(id) ?? 0, 1, 8), 0);
  assert.equal(findAssignmentSlot((id) => values.get(id) ?? 0, 6, 3), 2);
});

test("amount labels preserve polarity and reject non-finite presentation", () => {
  assert.equal(modulationAmountLabel(.375), "+38%");
  assert.equal(modulationAmountLabel(-1), "-100%");
  assert.equal(modulationAmountLabel(Number.NaN), "0%");
});
