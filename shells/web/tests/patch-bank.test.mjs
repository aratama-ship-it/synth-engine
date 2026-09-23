import test from "node:test";
import assert from "node:assert/strict";
import { createPatchBank, planPatchBankImport } from "../patch-bank.js";
import { createPatchSnapshot, MAX_USER_PATCHES } from "../patch-state.js";
import { SPACE_DEFAULTS } from "../space-effects.js";
import { FX_DEFAULTS } from "../fx-rack.js";

function patch(name, value = .3) { return createPatchSnapshot({ name, category:"Keys", core:[[7, value]], space:SPACE_DEFAULTS, fx:FX_DEFAULTS }); }

test("bank roundtrip merges names without mutating existing patches", () => {
  const existing = [{ id:"custom-old", patch:patch("One", .2) }];
  const bank = createPatchBank([{ id:"a", patch:patch("One", .25) }, { id:"b", patch:patch("Two", .3) }], "2026-09-23T00:00:00.000Z");
  const plan = planPatchBankImport(JSON.parse(JSON.stringify(bank)), existing, () => "custom-new");
  assert.equal(plan.imported, 2);
  assert.equal(plan.replaces, 1);
  assert.deepEqual(plan.overwrittenIds, ["custom-old"]);
  assert.deepEqual(plan.next.map(({ id }) => id), ["custom-old", "custom-new"]);
  assert.equal(plan.next[0].patch.core[0][1], .25);
  assert.equal(existing[0].patch.core[0][1], .2);
});

test("invalid, duplicate, and oversized banks never yield a partial merge", () => {
  const one = patch("One");
  const base = createPatchBank([{ id:"old", patch:one }]);
  assert.throws(() => planPatchBankImport({ ...base, version:2 }, [], () => "id"), /一括書出し/);
  assert.throws(() => planPatchBankImport({ ...base, patches:[one, { ...one, name:"one" }] }, [], () => "id"), /同名/);
  assert.throws(() => planPatchBankImport({ ...base, patches:[{ ...one, core:[[7, Number.NaN]] }] }, [], () => "id"), /finite/);
  const existing = Array.from({ length:MAX_USER_PATCHES }, (_, i) => ({ id:`id-${i}`, patch:patch(`Saved ${i}`) }));
  assert.throws(() => planPatchBankImport(base, existing, () => "new"), /上限/);
  assert.equal(existing.length, MAX_USER_PATCHES);
});
