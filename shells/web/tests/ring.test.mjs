import test from "node:test";
import assert from "node:assert/strict";
import { importSource } from "./load-module.mjs";

const { AbsoluteEventRing, SynthEngineProcessor, audioContextFrame } = await importSource("../synth-worklet.js");

const event = (frame, id) => ({ frame, kind: 1, id, a: 60 + id, b: 0.8 });

function withCurrentFrame(frame, action) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "currentFrame");
  Object.defineProperty(globalThis, "currentFrame", { configurable: true, value: frame });
  try {
    return action();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "currentFrame", descriptor);
    else delete globalThis.currentFrame;
  }
}

test("Worklet prefers AudioContext currentFrame and falls back outside AudioWorklet", () => {
  assert.equal(audioContextFrame(512), 512);
  withCurrentFrame(4096, () => assert.equal(audioContextFrame(512), 4096));
  withCurrentFrame(-1, () => assert.equal(audioContextFrame(512), 512));
});

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

test("Worklet preserves same-frame VOICE_PARAM/NOTE_ON bundle order", () => {
  const processor = Object.create(SynthEngineProcessor.prototype);
  processor.ring = new AbsoluteEventRing(8);
  processor.renderFrame = 256;
  processor.applyMessage({
    type: "events",
    events: [
      event(256, 60),
      { frame: 256, kind: 5, id: 37, a: 4000, b: 0 },
      { frame: 256, kind: 5, id: 75, a: 0.5, b: 0 },
      event(256, 67),
    ],
  });

  assert.deepEqual(
    processor.ring.takeBlock(256, 128).map(({ offset, kind, id, a, b }) => ({ offset, kind, id, a, b })),
    [
      { offset: 0, kind: 1, id: 60, a: 120, b: 0.8 },
      { offset: 0, kind: 5, id: 37, a: 4000, b: 0 },
      { offset: 0, kind: 5, id: 75, a: 0.5, b: 0 },
      { offset: 0, kind: 1, id: 67, a: 127, b: 0.8 },
    ],
  );
});

test("Worklet uses AudioContext currentFrame for an implicit voiceParam frame", () => {
  const processor = Object.create(SynthEngineProcessor.prototype);
  processor.ring = new AbsoluteEventRing(4);
  processor.renderFrame = 256;
  withCurrentFrame(4096, () => {
    processor.applyMessage({ type: "voiceParam", params: [[37, 4000]] });
  });
  assert.deepEqual(
    processor.ring.takeBlock(4096, 128).map(({ offset, kind, id, a }) => ({ offset, kind, id, a })),
    [{ offset: 0, kind: 5, id: 37, a: 4000 }],
  );
});

test("events messages accept kind 5 and retain an explicit absolute frame", () => {
  const processor = Object.create(SynthEngineProcessor.prototype);
  processor.ring = new AbsoluteEventRing(4);
  processor.renderFrame = 0;
  processor.applyMessage({
    type: "events",
    events: [{ frame: 513, kind: 5, id: 37, a: 4000, b: 0 }],
  });
  assert.deepEqual(
    processor.ring.takeBlock(512, 128).map(({ offset, kind, id, a }) => ({ offset, kind, id, a })),
    [{ offset: 1, kind: 5, id: 37, a: 4000 }],
  );
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
