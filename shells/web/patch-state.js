import { FX_DEFAULTS, sanitizeFxPatch } from "./fx-rack.js?m4ax=1";
import { REVERB_MATERIALS, SPACE_DEFAULTS } from "./space-effects.js";

export const PATCH_SCHEMA_VERSION = 1;
export const MAX_USER_PATCHES = 8;

const CATEGORIES = new Set(["Pad", "Bass", "Pluck", "Bell", "Lead", "Keys", "FX", "Custom"]);

function clone(value) { return structuredClone(value); }
function finite(value, name) { const number = Number(value); if (!Number.isFinite(number)) throw new TypeError(`${name} must be finite`); return number; }

export function createPatchSnapshot({ name = "Untitled", category = "Custom", core, space, fx }) {
  return validatePatch({ schemaVersion:PATCH_SCHEMA_VERSION, name, category, core, space, fx });
}

export function validatePatch(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new TypeError("patch must be an object");
  if (candidate.schemaVersion !== PATCH_SCHEMA_VERSION) throw new RangeError(`unsupported patch schema: ${candidate.schemaVersion}`);
  const name = String(candidate.name ?? "").trim(); if (!name || name.length > 80) throw new RangeError("patch name must contain 1..80 characters");
  const category = CATEGORIES.has(candidate.category) ? candidate.category : "Custom";
  if (!Array.isArray(candidate.core)) throw new TypeError("patch core must be an array");
  const seen = new Set(); const core = candidate.core.map((entry, index) => {
    if (!Array.isArray(entry) || entry.length !== 2) throw new TypeError(`patch core entry ${index} must be [id,value]`);
    const id = Number(entry[0]); if (!Number.isInteger(id) || id < 0 || id > 124 || seen.has(id)) throw new RangeError(`invalid or duplicate core parameter id: ${entry[0]}`); seen.add(id);
    return [id, finite(entry[1], `core ${id}`)];
  }).sort((a, b) => a[0] - b[0]);
  if (!candidate.space || typeof candidate.space !== "object" || Array.isArray(candidate.space)) throw new TypeError("patch space must be an object");
  const space = { ...SPACE_DEFAULTS };
  for (const [key, value] of Object.entries(candidate.space)) {
    if (!(key in SPACE_DEFAULTS)) continue;
    if (key === "delayOn" || key === "reverbOn") space[key] = Boolean(value);
    else if (key === "reverbMaterial") { if (!Object.hasOwn(REVERB_MATERIALS, value)) throw new RangeError(`unknown reverb material: ${value}`); space[key] = value; }
    else space[key] = finite(value, `space ${key}`);
  }
  const fx = sanitizeFxPatch(clone(FX_DEFAULTS), candidate.fx ?? {});
  return { schemaVersion:PATCH_SCHEMA_VERSION, name, category, core, space, fx };
}

export function serializePatch(patch) { return `${JSON.stringify(validatePatch(patch), null, 2)}\n`; }
export function parsePatch(text) { if (typeof text !== "string") throw new TypeError("patch JSON must be text"); return validatePatch(JSON.parse(text)); }

export function createPatchHistory(initial, limit = 80) {
  if (!Number.isInteger(limit) || limit < 2) throw new RangeError("history limit must be at least 2");
  let entries = [validatePatch(initial)]; let index = 0;
  return Object.freeze({
    push(patch) { const next = validatePatch(patch); if (JSON.stringify(entries[index]) === JSON.stringify(next)) return false; entries = entries.slice(0, index + 1); entries.push(next); if (entries.length > limit) entries.shift(); index = entries.length - 1; return true; },
    undo() { if (index === 0) return null; index -= 1; return clone(entries[index]); },
    redo() { if (index >= entries.length - 1) return null; index += 1; return clone(entries[index]); },
    reset(patch) { entries = [validatePatch(patch)]; index = 0; },
    state() { return { canUndo:index > 0, canRedo:index < entries.length - 1, length:entries.length }; },
  });
}
