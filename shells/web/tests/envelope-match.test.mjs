import assert from "node:assert/strict";
import test from "node:test";
import { suggestAmpEnvelope } from "../envelope-match.js";

function analysis(values, attackSeconds = .08) {
  return {
    activeStartSeconds:0,
    activeEndSeconds:values.length * .02,
    attackSeconds,
    envelope:{ windowSeconds:.02, values },
  };
}

test("held envelope proposes four reviewable AMP values", () => {
  const values = [0,.18,.48,.82,1,.82,.66,.52,.44,.4,.4,.4,.4,.4,.4,.4,.4,.4,.4,.4,.4,.4,.4,.4,.4,.4,.4,.4,.4,.4,.28,.16,.08,.03];
  const result = suggestAmpEnvelope(analysis(values), { curve:0 });
  assert.equal(result.available, true);
  assert.equal(result.state, "ready");
  assert.equal(result.mode, "held");
  for (const key of ["attack", "decay", "sustain", "release"]) assert.ok(Number.isFinite(result.suggestions[key].value), key);
  assert.ok(result.suggestions.sustain.value >= .34 && result.suggestions.sustain.value <= .48, result.suggestions.sustain.value);
  assert.ok(result.suggestions.release.value >= .08 && result.suggestions.release.value <= .3, result.suggestions.release.value);
});

test("continuous one-shot decay keeps Release instead of inventing note-off", () => {
  const values = Array.from({ length:64 }, (_, index) => index < 4 ? index / 4 : Math.exp(-(index - 4) / 15));
  const result = suggestAmpEnvelope(analysis(values));
  assert.equal(result.available, true);
  assert.equal(result.state, "partial");
  assert.equal(result.mode, "one-shot");
  assert.equal(result.suggestions.release, null);
  assert.match(result.reason, /keep current Release/);
});

test("a body dip that rebounds is skipped in favor of the final tail", () => {
  const values = [0,.2,.55,.9,1,.72,.55,.44,.41,.4,.42,.39,.4,.41,.4,.24,.2,.39,.41,.4,.4,.39,.4,.41,.4,.4,.39,.4,.3,.2,.1,.04];
  const result = suggestAmpEnvelope(analysis(values));
  assert.equal(result.available, true);
  assert.ok(result.noteOffSeconds >= .54, result.noteOffSeconds);
  assert.ok(result.suggestions.release.value <= .2, result.suggestions.release.value);
});

test("silent and malformed envelopes are unavailable", () => {
  const silent = suggestAmpEnvelope(analysis(Array(20).fill(0)));
  const malformed = suggestAmpEnvelope({ envelope:{ windowSeconds:0, values:[1, .5] } });
  assert.equal(silent.available, false);
  assert.equal(malformed.available, false);
  assert.equal(silent.state, "unavailable");
});
