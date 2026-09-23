// Presentation units only. The synth and saved patches always receive native values.
const units = Object.freeze({
  number:{ "":1 }, hz:{ "":1, hz:1, khz:1000, k:1000 },
  seconds:{ "":1, s:1, ms:.001 }, milliseconds:{ "":.001, s:1, ms:.001 },
  percent:{ "":.01, "%":.01 }, db:{ "":1, db:1 },
  q:{ "":1 }, ratio:{ "":1, ":1":1 },
  ct:{ "":1, ct:1 }, st:{ "":1, st:1 }, oct:{ "":1, oct:1 },
});

export function parseNumericInput(text, unit = "number") {
  let normalized = String(text).normalize("NFKC").trim().toLowerCase().replaceAll("−", "-");
  if (unit === "q") normalized = normalized.replace(/^q\s*/, "");
  const match = normalized.match(/^([+-]?(?:\d+(?:,\d{3})*(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*([a-z%]*|:1)$/);
  const scale = match && units[unit]?.[match[2]];
  if (scale === undefined || scale === null) return NaN;
  const value = Number(match[1].replaceAll(",", "")) * scale;
  return Number.isFinite(value) ? value : NaN;
}

export function bindNumericInput(input, { getValue, setValue, format, unit = "number", onInvalid = () => {} }) {
  let initialText;
  let cancelled = false;
  const refresh = () => { input.value = format(getValue()); };
  input.title = "数値・単位を入力。Enterで確定、Escapeで取消";
  input.addEventListener("focus", () => {
    refresh(); initialText = input.value; cancelled = false;
    input.removeAttribute("aria-invalid"); input.select();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); cancelled = true; input.blur(); }
    if (event.key === "Enter") { event.preventDefault(); input.blur(); }
  });
  input.addEventListener("blur", () => {
    if (!cancelled && input.value !== initialText) {
      const next = parseNumericInput(input.value, unit);
      if (Number.isFinite(next)) setValue(next);
      else { input.setAttribute("aria-invalid", "true"); onInvalid(); }
    }
    refresh();
  });
  refresh();
  return refresh;
}

export function dragControlValue({ min, max, scale }, value, delta) {
  if (scale === "log") {
    const position = Math.log(value / min) / Math.log(max / min);
    return min * (max / min) ** Math.min(1, Math.max(0, position + delta));
  }
  return Math.min(max, Math.max(min, value + delta * (max - min)));
}

export function bindDialDrag(input, { getValue, setValue, min, max, scale, defaultValue }) {
  let drag;
  input.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    // Commit any focused numeric field first; preventDefault otherwise leaves its stale text visible.
    input.focus({ preventScroll:true });
    drag = { y:event.clientY, value:getValue() };
    input.setPointerCapture(event.pointerId); event.preventDefault();
  });
  input.addEventListener("pointermove", (event) => {
    if (!drag || !input.hasPointerCapture(event.pointerId)) return;
    const delta = (drag.y - event.clientY) / 160 * (event.shiftKey ? .1 : 1);
    setValue(dragControlValue({ min, max, scale }, drag.value, delta));
  });
  const finish = (event) => {
    if (input.hasPointerCapture(event.pointerId)) input.releasePointerCapture(event.pointerId);
    drag = undefined;
  };
  input.addEventListener("pointerup", finish);
  input.addEventListener("pointercancel", finish);
  input.addEventListener("lostpointercapture", () => { drag = undefined; });
  input.addEventListener("dblclick", (event) => { event.preventDefault(); setValue(defaultValue); });
}
