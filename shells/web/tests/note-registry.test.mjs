import assert from "node:assert/strict";
import test from "node:test";
import { importSource } from "./load-module.mjs";

const { createNoteRegistry } = await importSource("../note-registry.js");

test("a release during async audio preparation cannot become an active note", () => {
  const pressed = [];
  const key = {};
  const registry = createNoteRegistry((element, value) => pressed.push([element, value]));
  const ticket = registry.begin("pointer-1-60", key);
  assert.equal(registry.isPending(ticket), true);
  assert.equal(registry.release("pointer-1-60"), undefined);
  assert.equal(registry.isPending(ticket), false);
  assert.equal(registry.activate(ticket, {}, {}), false);
  assert.deepEqual(registry.snapshot(), { pending:0, active:0, generation:0 });
  assert.deepEqual(pressed, [[key, true], [key, false]]);
});

test("drain invalidates pending work and returns every active handle for emergency release", () => {
  const registry = createNoteRegistry(() => {});
  const first = registry.begin("KeyA", {});
  const second = registry.begin("pointer-2-64", {});
  const firstNode = {};
  const firstHandle = {};
  assert.equal(registry.activate(first, firstNode, firstHandle), true);
  assert.deepEqual(registry.drain(), [{ node:firstNode, handle:firstHandle, keyElement:first.keyElement, generation:0 }]);
  assert.equal(registry.isPending(second), false);
  assert.deepEqual(registry.snapshot(), { pending:0, active:0, generation:1 });
});

test("one of two sources releasing the same piano key keeps its visual hold", () => {
  const states = [];
  const key = {};
  const registry = createNoteRegistry((_element, value) => states.push(value));
  const keyboard = registry.begin("keyboard-60", key);
  const pointer = registry.begin("pointer-3-60", key);
  registry.activate(keyboard, {}, {});
  registry.activate(pointer, {}, {});
  registry.release("keyboard-60");
  assert.deepEqual(states, [true]);
  registry.release("pointer-3-60");
  assert.deepEqual(states, [true, false]);
});
