export const KEYBOARD_OCTAVE_MIN = -3;
export const KEYBOARD_OCTAVE_MAX = 3;

const notesByCode = Object.freeze({
  KeyA:60, KeyW:61, KeyS:62, KeyE:63, KeyD:64, KeyF:65, KeyT:66,
  KeyG:67, KeyY:68, KeyH:69, KeyU:70, KeyJ:71, KeyK:72,
});
const notesByKey = Object.freeze({
  a:60, w:61, s:62, e:63, d:64, f:65, t:66,
  g:67, y:68, h:69, u:70, j:71, k:72,
});

function lowerKey(event) {
  return typeof event?.key === "string" ? event.key.toLowerCase() : "";
}

export function keyboardInputId(event) {
  if (notesByCode[event?.code] !== undefined) return event.code;
  const key = lowerKey(event);
  return notesByKey[key] === undefined ? undefined : `key:${key}`;
}

export function noteForKeyboardEvent(event, octave = 0) {
  const base = notesByCode[event?.code] ?? notesByKey[lowerKey(event)];
  return base === undefined ? undefined : base + clampKeyboardOctave(octave) * 12;
}

export function octaveDeltaForKeyboardEvent(event) {
  if (event?.code === "KeyZ") return -1;
  if (event?.code === "KeyX") return 1;
  const key = lowerKey(event);
  return key === "z" ? -1 : key === "x" ? 1 : 0;
}

export function clampKeyboardOctave(octave) {
  const value = Number.isFinite(Number(octave)) ? Math.round(Number(octave)) : 0;
  return Math.min(KEYBOARD_OCTAVE_MAX, Math.max(KEYBOARD_OCTAVE_MIN, value));
}

export function keyboardOctaveLabel(octave) {
  const value = clampKeyboardOctave(octave);
  const sign = value > 0 ? `+${value}` : String(value);
  return `OCTAVE ${sign} · C${4 + value}–C${5 + value}`;
}
