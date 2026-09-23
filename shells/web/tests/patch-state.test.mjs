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
  assert.equal(MAX_USER_PATCHES, 64);
});

test("patch parser rejects schema drift, duplicate IDs, non-finite values, and malformed JSON", () => {
  assert.throws(() => validatePatch({ ...patch(), schemaVersion:99 }), /unsupported patch schema/);
  assert.throws(() => validatePatch({ ...patch(), core:[[1, .2], [1, .3]] }), /duplicate/);
  assert.throws(() => validatePatch({ ...patch(), core:[[1, Number.NaN]] }), /finite/);
  assert.throws(() => parsePatch("{"), SyntaxError);
});

test("patch schema accepts appended articulation, warp, and parametric EQ parameters without renumbering older core values", () => {
  const extended = validatePatch({ ...patch(), core:[[0, 1], [79, .5], [82, .25], [83, .4], [84, .6], [85, .01], [86, .2], [87, .5], [88, .4], [89, 1], [90, 1], [112, 3], [113, 2], [114, .12], [115, .5], [116, .75], [117, -.6], [118, .6], [119, 1], [120, 1], [121, 180], [122, 1400], [123, 1.2], [124, 7200]] });
  const values = new Map(extended.core);
  assert.equal(values.get(112), 3);
  assert.equal(values.get(113), 2);
  assert.equal(values.get(114), .12);
  assert.equal(values.get(115), .5);
  assert.equal(values.get(116), .75);
  assert.equal(values.get(117), -.6);
  assert.equal(values.get(118), .6);
  assert.equal(values.get(119), 1);
  assert.equal(values.get(120), 1);
  assert.equal(values.get(121), 180);
  assert.equal(values.get(122), 1400);
  assert.equal(values.get(123), 1.2);
  assert.equal(values.get(124), 7200);
  assert.throws(() => validatePatch({ ...patch(), core:[[125, 0]] }), /invalid/);
});

test("legacy insert patches receive the former fixed EQ frequency and Q defaults", () => {
  const legacyFx = structuredClone(FX_DEFAULTS);
  legacyFx.modules.eq = { on:true, low:2, mid:-1, high:3 };
  const restored = validatePatch({ ...patch(), core:[[0, 1]], fx:legacyFx });
  assert.deepEqual(
    {
      lowFrequency:restored.fx.modules.eq.lowFrequency,
      midFrequency:restored.fx.modules.eq.midFrequency,
      midQ:restored.fx.modules.eq.midQ,
      highFrequency:restored.fx.modules.eq.highFrequency,
    },
    { lowFrequency:160, midFrequency:1200, midQ:.75, highFrequency:6800 },
  );
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
