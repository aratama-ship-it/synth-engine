import test from "node:test";
import assert from "node:assert/strict";
import { importSource } from "./load-module.mjs";

const { AbsoluteEventRing } = await importSource("../synth-worklet.js");

const event = (frame, id) => ({ frame, kind: 1, id, a: 60 + id, b: 0.8 });

test("Worklet ring converts absolute frames to block offsets and retains future events", () => {
  const ring = new AbsoluteEventRing(8);
  assert.equal(ring.pushMany([event(132, 2), event(127, 1), event(256, 3)]), true);

  assert.deepEqual(
    ring.takeBlock(128, 128).map(({ offset, id }) => ({ offset, id })),
    [
      { offset: 0, id: 1 },
      { offset: 4, id: 2 },
    ],
  );
  assert.equal(ring.length, 1);
  assert.deepEqual(
    ring.takeBlock(256, 128).map(({ offset, id }) => ({ offset, id })),
    [{ offset: 0, id: 3 }],
  );
});

test("Worklet ring preserves insertion order at the same offset", () => {
  const ring = new AbsoluteEventRing(4);
  ring.pushMany([event(10, 3), event(10, 1), event(10, 2)]);
  assert.deepEqual(ring.takeBlock(0, 128).map(({ id }) => id), [3, 1, 2]);
});

test("Worklet ring wraps and rejects a batch that exceeds fixed capacity", () => {
  const ring = new AbsoluteEventRing(3);
  assert.equal(ring.pushMany([event(0, 0), event(20, 1)]), true);
  assert.deepEqual(ring.takeBlock(0, 10).map(({ id }) => id), [0]);
  assert.equal(ring.pushMany([event(30, 2), event(40, 3)]), true);
  assert.equal(ring.push(event(50, 4)), false);
  assert.equal(ring.length, 3);
  assert.deepEqual(ring.takeBlock(10, 40).map(({ id }) => id), [1, 2, 3]);
});

test("Worklet ring validates events without partially accepting an oversized batch", () => {
  const ring = new AbsoluteEventRing(1);
  assert.equal(ring.pushMany([event(0, 0), event(1, 1)]), false);
  assert.equal(ring.length, 0);
  assert.throws(() => ring.push({ ...event(0, 0), frame: -1 }), /event\.frame/);
});
