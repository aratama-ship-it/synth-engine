import assert from "node:assert/strict";
import test from "node:test";
import { FX_DEFAULTS } from "../fx-rack.js";
import { SPACE_DEFAULTS } from "../space-effects.js";
import { MAX_USER_PATCHES, createPatchHistory, createPatchSnapshot, parsePatch, serializePatch, validatePatch } from "../patch-state.js";

function patch(name = "Roundtrip") {
  return createPatchSnapshot({ name, category:"Pad", core:[[0, 1], [1, .42], [55, 6], [56, 8], [57, -.35]], space:{ ...SPACE_DEFAULTS, reverbDecay:4.2, reverbDamping:.25 }, fx:{ ...structuredClone(FX_DEFAULTS), modules:{ ...structuredClone(FX_DEFAULTS.modules), chorus:{ ...FX_DEFAULTS.modules.chorus, on:true } } } });
}

test("patch JSON roundtrips core, modulation, space, insert state, and order", () => {
  const before = patch(); const after = parsePatch(serializePatch(before));
  assert.deepEqual(after, before);
  assert.equal(after.core.find(([id]) => id === 57)[1], -.35);
  assert.equal(after.space.reverbDecay, 4.2);
  assert.equal(after.space.reverbDamping, .25);
  assert.equal(after.fx.modules.chorus.on, true);
  assert.equal(MAX_USER_PATCHES, 8);
});

test("patch parser rejects schema drift, duplicate IDs, non-finite values, and malformed JSON", () => {
  assert.throws(() => validatePatch({ ...patch(), schemaVersion:99 }), /unsupported patch schema/);
  assert.throws(() => validatePatch({ ...patch(), core:[[1, .2], [1, .3]] }), /duplicate/);
  assert.throws(() => validatePatch({ ...patch(), core:[[1, Number.NaN]] }), /finite/);
  assert.throws(() => parsePatch("{"), SyntaxError);
});

test("patch schema accepts appended modulation parameters without renumbering older core values", () => {
  const extended = validatePatch({ ...patch(), core:[[0, 1], [79, .5], [82, .25], [83, .4], [84, .6], [85, .01], [86, .2], [87, .5], [88, .4], [89, 1], [90, 1], [112, 3]] });
  assert.deepEqual(extended.core.slice(-9), [[83, .4], [84, .6], [85, .01], [86, .2], [87, .5], [88, .4], [89, 1], [90, 1], [112, 3]]);
  assert.throws(() => validatePatch({ ...patch(), core:[[113, 0]] }), /invalid/);
});

test("history restores edited states and discards redo after a new branch", () => {
  const first = patch("First"); const second = { ...patch("Second"), core:[[0, 2]] }; const third = { ...patch("Third"), core:[[0, 3]] };
  const history = createPatchHistory(first, 4); history.push(second); history.push(third);
  assert.equal(history.undo().name, "Second");
  assert.equal(history.undo().name, "First");
  assert.equal(history.redo().name, "Second");
  history.push(first);
  assert.equal(history.redo(), null);
});
