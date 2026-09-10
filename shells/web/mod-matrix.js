export const MOD_SOURCES = Object.freeze([
  "None", "LFO 1", "ENV 1 · Amp", "ENV 2 · Filter", "Velocity", "Key Track", "Macro 1", "Macro 2", "LFO 2", "Macro 3", "Macro 4", "ENV 3 · Mod",
]);

export const MOD_DESTINATIONS = Object.freeze([
  "None", "OSC A Level", "OSC B Level", "OSC A Position", "OSC B Position", "FM B → A",
  "Sub Level", "Noise Level", "Filter Cutoff", "Filter Resonance", "Pitch", "OSC A Detune", "LFO Rate", "Amp",
  "OSC A Warp", "OSC B Warp",
]);

export const MOD_DEST_BY_PARAM = Object.freeze({
  2:1, 19:2, 1:3, 18:4, 28:5, 29:6, 32:7, 37:8, 38:9, 13:10, 10:11, 46:12,
  117:14, 118:15,
});

export function modulationSlotIds(index) {
  if (!Number.isInteger(index) || index < 0 || index >= 6) throw new RangeError("modulation slot index must be 0..5");
  const base = 55 + index * 3;
  return { source:base, destination:base + 1, amount:base + 2 };
}

export function findAssignmentSlot(readValue, source, destination) {
  if (typeof readValue !== "function") throw new TypeError("readValue must be a function");
  if (!Number.isInteger(source) || source < 1 || source >= MOD_SOURCES.length) throw new RangeError("unsupported modulation source");
  if (!Number.isInteger(destination) || destination < 1 || destination >= MOD_DESTINATIONS.length) throw new RangeError("unsupported modulation destination");
  let empty = -1;
  for (let index = 0; index < 6; index += 1) {
    const ids = modulationSlotIds(index);
    const currentSource = Math.round(readValue(ids.source));
    const currentDestination = Math.round(readValue(ids.destination));
    if (currentSource === source && currentDestination === destination) return index;
    if (empty === -1 && (currentSource === 0 || currentDestination === 0)) empty = index;
  }
  return empty;
}

export function modulationAmountLabel(value) {
  const finite = Number(value);
  if (!Number.isFinite(finite)) return "0%";
  const percent = Math.round(Math.min(1, Math.max(-1, finite)) * 100);
  return `${percent > 0 ? "+" : ""}${percent}%`;
}
