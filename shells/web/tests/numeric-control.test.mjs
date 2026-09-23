import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { importSource } from "./load-module.mjs";
const { parseNumericInput, bindNumericInput, dragControlValue, bindDialDrag } = await importSource("../numeric-control.js");
const { insertDefinitions, formatInsertValue, insertSliderPosition, insertSliderValue } = await importSource("../fx-controls.js");

test("numeric inputs interpret displayed units without truncating invalid text", () => {
  for (const [text, unit, value] of [
    ["1.2 kHz", "hz", 1200], ["1,200 Hz", "hz", 1200], ["５ ms", "seconds", .005],
    ["12", "milliseconds", .012], ["0.2 s", "milliseconds", .2], ["50", "percent", .5],
    ["−25%", "percent", -.25], ["+3 dB", "db", 3], ["Q 0.75", "q", .75], ["4:1", "ratio", 4],
    ["1e-3", "number", .001], ["-1 oct", "oct", -1],
  ]) assert.equal(parseNumericInput(text, unit), value, text);
  for (const text of ["", "words5", "5foo", "1.2.3", "1,2", "Infinity", "NaN", "2e999", "5ms"]) {
    assert.ok(Number.isNaN(parseNumericInput(text, "hz")), text);
  }
});

test("numeric input focus is lossless, Escape cancels, invalid entries never call the setter", () => {
  let value = .123456; let writes = 0; let errors = 0;
  const listeners = new Map();
  const input = {
    value:"", addEventListener:(name, fn) => listeners.set(name, fn),
    select() {}, setAttribute() {}, removeAttribute() {},
    blur:() => listeners.get("blur")(),
  };
  const focus = () => listeners.get("focus")();
  const key = (key) => listeners.get("keydown")({ key, preventDefault() {} });
  bindNumericInput(input, { getValue:() => value, setValue:(v) => { value = v; writes += 1; }, format:(v) => `${Math.round(v * 100)}%`, unit:"percent", onInvalid:() => errors += 1 });
  focus(); input.blur(); assert.equal(writes, 0); assert.equal(value, .123456);
  focus(); input.value = "90%"; key("Escape"); assert.equal(value, .123456); assert.equal(writes, 0);
  focus(); input.value = "50"; key("Enter"); assert.equal(value, .5); assert.equal(writes, 1);
  focus(); input.value = "40foo"; input.blur(); assert.equal(value, .5); assert.equal(errors, 1);
});

test("dial drag uses its scale and fine motion stays bounded", () => {
  assert.ok(Math.abs(dragControlValue({ min:20, max:20000, scale:"log" }, 20, .5) - Math.sqrt(20 * 20000)) < 1e-10);
  assert.equal(dragControlValue({ min:0, max:1 }, .5, .1), .6);
  assert.equal(dragControlValue({ min:0, max:1 }, .5, 2), 1);
  assert.equal(dragControlValue({ min:20, max:20000, scale:"log" }, 20, -1), 20);
});

test("extracted FX metadata, formatting and slider transforms exactly match the release baseline", () => {
  const samples = Object.entries(insertDefinitions).flatMap(([effect, d]) => d.controls.flatMap((control) =>
    Array.from({ length:51 }, (_, i) => {
      const v = control.min + (control.max - control.min) * i / 50;
      return [effect, control.id, v, formatInsertValue(effect, control.id, v), insertSliderPosition(control, v), insertSliderValue(control, insertSliderPosition(control, v))];
    })));
  // Golden SHA generated from the exact functions in a4fce012, before extraction: 969 samples.
  assert.equal(samples.length, 969);
  assert.equal(createHash("sha256").update(JSON.stringify({ definitions:insertDefinitions, samples })).digest("hex"), "ddb8616b065fba3fe1e6ea95dd0d905131c3e4776e3b3562573760cef76dd0fe");
});

test("dial gestures focus before capturing the value and clear lost pointer capture", () => {
  const listeners = {}; let value = .1; let captured = false; let focused = false;
  const input = {
    addEventListener:(name, callback) => { listeners[name] = callback; },
    focus() { focused = true; value = .25; },
    setPointerCapture() { captured = true; }, hasPointerCapture:() => captured,
    releasePointerCapture() { captured = false; },
  };
  bindDialDrag(input, { min:0, max:1, defaultValue:.3, getValue:() => value, setValue:(v) => { value = v; } });
  const event = { button:0, clientY:200, pointerId:1, preventDefault() {} };
  listeners.pointerdown(event); assert.ok(focused);
  listeners.pointermove({ ...event, clientY:184 }); assert.equal(value, .35);
  listeners.lostpointercapture(); listeners.pointermove({ ...event, clientY:0 }); assert.equal(value, .35);
  listeners.dblclick(event); assert.equal(value, .3);
});
