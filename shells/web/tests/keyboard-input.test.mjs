import assert from "node:assert/strict";
import test from "node:test";
import { importSource } from "./load-module.mjs";

const {
  KEYBOARD_OCTAVE_MIN,
  KEYBOARD_OCTAVE_MAX,
  clampKeyboardOctave,
  keyboardInputId,
  keyboardOctaveLabel,
  noteForKeyboardEvent,
  octaveDeltaForKeyboardEvent,
} = await importSource("../keyboard-input.js");

test("Z and X move the performance keyboard by one clamped octave", () => {
  assert.equal(octaveDeltaForKeyboardEvent({ code:"KeyZ", key:"z" }), -1);
  assert.equal(octaveDeltaForKeyboardEvent({ code:"KeyX", key:"x" }), 1);
  assert.equal(octaveDeltaForKeyboardEvent({ key:"Z" }), -1);
  assert.equal(clampKeyboardOctave(-99), KEYBOARD_OCTAVE_MIN);
  assert.equal(clampKeyboardOctave(99), KEYBOARD_OCTAVE_MAX);
});

test("note lookup follows the selected octave and keeps a stable physical key id", () => {
  assert.equal(noteForKeyboardEvent({ code:"KeyA", key:"a" }, 0), 60);
  assert.equal(noteForKeyboardEvent({ code:"KeyA", key:"a" }, -1), 48);
  assert.equal(noteForKeyboardEvent({ code:"KeyK", key:"k" }, 2), 96);
  assert.equal(keyboardInputId({ code:"KeyA", key:"q" }), "KeyA");
  assert.equal(keyboardInputId({ key:"A" }), "key:a");
});

test("octave status names the exact PC note range", () => {
  assert.equal(keyboardOctaveLabel(0), "OCTAVE 0 · C4–C5");
  assert.equal(keyboardOctaveLabel(2), "OCTAVE +2 · C6–C7");
});
