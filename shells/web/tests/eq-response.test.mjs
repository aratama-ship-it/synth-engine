import assert from "node:assert/strict";
import test from "node:test";
import { eqResponseDb, eqResponsePath } from "../eq-response.js";

const neutral = Object.freeze({ low:0, lowFrequency:160, mid:0, midFrequency:1200, midQ:.75, high:0, highFrequency:6800 });

test("neutral response remains exactly flat across the displayed frequency span", () => {
  for (const frequency of [20, 65, 160, 1200, 6800, 20000]) assert.ok(Math.abs(eqResponseDb(neutral, frequency)) < 1e-10);
});

test("frequency controls move the intended shelf and bell response", () => {
  const low160 = { ...neutral, low:12, lowFrequency:160 };
  const low500 = { ...neutral, low:12, lowFrequency:500 };
  assert.ok(eqResponseDb(low500, 300) > eqResponseDb(low160, 300) + 2);

  const mid1200 = { ...neutral, mid:12, midFrequency:1200 };
  const mid3000 = { ...neutral, mid:12, midFrequency:3000 };
  assert.ok(eqResponseDb(mid1200, 1200) > eqResponseDb(mid3000, 1200) + 3);

  const high6800 = { ...neutral, high:12, highFrequency:6800 };
  const high3000 = { ...neutral, high:12, highFrequency:3000 };
  assert.ok(eqResponseDb(high3000, 5000) > eqResponseDb(high6800, 5000) + 2);
});

test("higher mid Q narrows the bell and curve output stays finite", () => {
  const broad = { ...neutral, mid:12, midQ:.75 };
  const narrow = { ...neutral, mid:12, midQ:6 };
  assert.ok(eqResponseDb(broad, 600) > eqResponseDb(narrow, 600) + 3);
  assert.ok(Math.abs(eqResponseDb(broad, 1200) - eqResponseDb(narrow, 1200)) < .05);
  const path = eqResponsePath({ ...neutral, low:18, mid:-18, midQ:8, high:18 });
  assert.match(path, /^M/);
  assert.doesNotMatch(path, /NaN|Infinity/);
  assert.equal((path.match(/[ML]/g) ?? []).length, 160);
});
