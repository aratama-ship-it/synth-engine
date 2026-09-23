import { MAX_USER_PATCHES, validatePatch } from "./patch-state.js?library=20260923";

const FORMAT = "synth-engine.patch-bank";
const VERSION = 1;

export function createPatchBank(items, exportedAt = new Date().toISOString()) {
  return { format:FORMAT, version:VERSION, exportedAt, patches:items.map((item) => validatePatch(item.patch)) };
}

export function planPatchBankImport(bank, existing, createId) {
  if (bank?.format !== FORMAT || bank.version !== VERSION || !Array.isArray(bank.patches) || bank.patches.length > MAX_USER_PATCHES)
    throw new TypeError("SynthEngineの一括書出しJSONではありません");
  const patches = bank.patches.map((patch) => validatePatch(patch));
  const names = patches.map((patch) => patch.name.toLocaleLowerCase());
  if (new Set(names).size !== names.length) throw new RangeError("一括ファイルに同名の音色があります");
  const next = [...existing]; const overwrittenIds = [];
  for (const patch of patches) {
    const index = next.findIndex((item) => item.patch.name.toLocaleLowerCase() === patch.name.toLocaleLowerCase());
    if (index >= 0) { overwrittenIds.push(next[index].id); next[index] = { ...next[index], patch }; }
    else next.push({ id:createId(), patch });
  }
  if (next.length > MAX_USER_PATCHES) throw new RangeError(`上限${MAX_USER_PATCHES}件を超えるため読み込みませんでした`);
  return { next, imported:patches.length, replaces:overwrittenIds.length, overwrittenIds };
}
