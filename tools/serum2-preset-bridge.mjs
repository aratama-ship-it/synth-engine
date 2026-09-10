import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { zstdDecompressSync } from "node:zlib";

const MAGIC = Buffer.from("XferJson\0", "ascii");
const MAX_HEADER_BYTES = 1_048_576;
const MAX_PAYLOAD_BYTES = 67_108_864;
const MAX_CBOR_DEPTH = 64;
const MAX_CBOR_ITEMS = 250_000;
const IMPORT_MASTER_CEILING = 0.2;
const SYNTH_MOD_CAPACITY = 6;
const SAFE_DISTORTION_DRIVE_CEILING = 0.24;
const SAFE_DISTORTION_MIX_CEILING = 0.2;

const SERUM_MOD_SOURCES = Object.freeze({
  2:{ synthId:2, label:"ENV 1 · Amp", kind:"env", index:0 },
  3:{ synthId:3, label:"ENV 2 · Filter", kind:"env", index:1 },
  4:{ synthId:11, label:"ENV 3 · Mod", kind:"env", index:2 },
  25:{ synthId:6, label:"Macro 1", kind:"macro", index:0, paramId:73 },
  26:{ synthId:7, label:"Macro 2", kind:"macro", index:1, paramId:74 },
  27:{ synthId:9, label:"Macro 3", kind:"macro", index:2, paramId:83 },
  28:{ synthId:10, label:"Macro 4", kind:"macro", index:3, paramId:84 },
});

const SERUM_MOD_DESTINATIONS = Object.freeze({
  "Oscillator:0:kParamVolume":{ synthId:1, label:"OSC A Level", amountScale:0.25 },
  "Oscillator:1:kParamVolume":{ synthId:2, label:"OSC B Level", amountScale:0.25 },
  "Oscillator:3:kParamVolume":{ synthId:7, label:"Noise Level", amountScale:0.25 },
  "WTOsc:0:kParamTablePos":{ synthId:3, label:"OSC A Position", amountScale:1 },
  "WTOsc:1:kParamTablePos":{ synthId:4, label:"OSC B Position", amountScale:1 },
  "VoiceFilter:0:kParamFreq":{ synthId:8, label:"Filter Cutoff", amountScale:1 },
  "VoiceFilter:0:kParamReso":{ synthId:9, label:"Filter Resonance", amountScale:1 },
  "Oscillator:0:kParamDetune":{ synthId:11, label:"OSC A Detune", amountScale:1 },
  "WTOsc:0:kParamWarp":{ synthId:14, label:"OSC A Warp", amountScale:1 },
  "WTOsc:1:kParamWarp":{ synthId:15, label:"OSC B Warp", amountScale:1 },
});

function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError("preset input must be Buffer or Uint8Array");
}

function halfFloat(value) {
  const sign = (value & 0x8000) ? -1 : 1;
  const exponent = (value >> 10) & 0x1f;
  const fraction = value & 0x03ff;
  if (exponent === 0) return sign * Math.pow(2, -14) * (fraction / 1024);
  if (exponent === 31) return fraction ? Number.NaN : sign * Number.POSITIVE_INFINITY;
  return sign * Math.pow(2, exponent - 15) * (1 + fraction / 1024);
}

class CborReader {
  constructor(bytes) {
    this.bytes = asBuffer(bytes);
    this.offset = 0;
    this.items = 0;
  }

  require(count) {
    if (count < 0 || this.offset + count > this.bytes.length) throw new RangeError("truncated CBOR payload");
  }

  uint(count) {
    this.require(count);
    let value;
    if (count === 1) value = this.bytes.readUInt8(this.offset);
    else if (count === 2) value = this.bytes.readUInt16BE(this.offset);
    else if (count === 4) value = this.bytes.readUInt32BE(this.offset);
    else if (count === 8) {
      const bigint = this.bytes.readBigUInt64BE(this.offset);
      if (bigint > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("CBOR integer exceeds safe JavaScript range");
      value = Number(bigint);
    } else throw new RangeError("unsupported CBOR integer width");
    this.offset += count;
    return value;
  }

  length(additional) {
    if (additional < 24) return additional;
    if (additional === 24) return this.uint(1);
    if (additional === 25) return this.uint(2);
    if (additional === 26) return this.uint(4);
    if (additional === 27) return this.uint(8);
    if (additional === 31) return -1;
    throw new RangeError(`unsupported CBOR additional value ${additional}`);
  }

  read(depth = 0) {
    if (depth > MAX_CBOR_DEPTH) throw new RangeError("CBOR nesting is too deep");
    this.items += 1;
    if (this.items > MAX_CBOR_ITEMS) throw new RangeError("CBOR item limit exceeded");
    this.require(1);
    const initial = this.bytes[this.offset++];
    const major = initial >> 5;
    const additional = initial & 0x1f;
    if (major === 0) return this.length(additional);
    if (major === 1) return -1 - this.length(additional);
    if (major === 2 || major === 3) return this.readBytesOrText(major, additional, depth);
    if (major === 4) return this.readArray(additional, depth);
    if (major === 5) return this.readMap(additional, depth);
    if (major === 6) {
      this.length(additional);
      return this.read(depth + 1);
    }
    if (major === 7) return this.readSimple(additional);
    throw new RangeError(`unsupported CBOR major type ${major}`);
  }

  readBytesOrText(major, additional, depth) {
    const length = this.length(additional);
    if (length >= 0) {
      this.require(length);
      const slice = this.bytes.subarray(this.offset, this.offset + length);
      this.offset += length;
      return major === 2 ? Buffer.from(slice) : slice.toString("utf8");
    }
    const chunks = [];
    while (true) {
      this.require(1);
      if (this.bytes[this.offset] === 0xff) { this.offset += 1; break; }
      const chunk = this.read(depth + 1);
      if (major === 2 && !Buffer.isBuffer(chunk)) throw new TypeError("invalid indefinite CBOR byte string");
      if (major === 3 && typeof chunk !== "string") throw new TypeError("invalid indefinite CBOR text string");
      chunks.push(chunk);
    }
    return major === 2 ? Buffer.concat(chunks) : chunks.join("");
  }

  readArray(additional, depth) {
    const length = this.length(additional);
    const result = [];
    if (length >= 0) {
      for (let index = 0; index < length; index += 1) result.push(this.read(depth + 1));
      return result;
    }
    while (true) {
      this.require(1);
      if (this.bytes[this.offset] === 0xff) { this.offset += 1; break; }
      result.push(this.read(depth + 1));
    }
    return result;
  }

  readMap(additional, depth) {
    const length = this.length(additional);
    const result = Object.create(null);
    const readPair = () => {
      const key = this.read(depth + 1);
      if (typeof key !== "string") throw new TypeError("CBOR preset map key must be text");
      if (Object.hasOwn(result, key)) throw new RangeError(`duplicate CBOR map key: ${key}`);
      result[key] = this.read(depth + 1);
    };
    if (length >= 0) {
      for (let index = 0; index < length; index += 1) readPair();
      return result;
    }
    while (true) {
      this.require(1);
      if (this.bytes[this.offset] === 0xff) { this.offset += 1; break; }
      readPair();
    }
    return result;
  }

  readSimple(additional) {
    if (additional < 20) return additional;
    if (additional === 20) return false;
    if (additional === 21) return true;
    if (additional === 22) return null;
    if (additional === 23) return undefined;
    if (additional === 24) return this.uint(1);
    if (additional === 25) return halfFloat(this.uint(2));
    if (additional === 26) { this.require(4); const value = this.bytes.readFloatBE(this.offset); this.offset += 4; return value; }
    if (additional === 27) { this.require(8); const value = this.bytes.readDoubleBE(this.offset); this.offset += 8; return value; }
    if (additional === 31) throw new RangeError("unexpected CBOR break marker");
    throw new RangeError(`unsupported CBOR simple value ${additional}`);
  }
}

export function decodeCbor(bytes) {
  const reader = new CborReader(bytes);
  const value = reader.read();
  if (reader.offset !== reader.bytes.length) throw new RangeError(`trailing CBOR bytes: ${reader.bytes.length - reader.offset}`);
  return value;
}

export function parseSerum2Preset(input) {
  const bytes = asBuffer(input);
  if (bytes.length < 25 || !bytes.subarray(0, MAGIC.length).equals(MAGIC)) throw new TypeError("not a Serum 2 XferJson preset");
  const headerLengthBig = bytes.readBigUInt64LE(MAGIC.length);
  if (headerLengthBig > BigInt(MAX_HEADER_BYTES)) throw new RangeError("Serum metadata header is too large");
  const headerLength = Number(headerLengthBig);
  const headerStart = MAGIC.length + 8;
  const descriptorStart = headerStart + headerLength;
  if (descriptorStart + 8 > bytes.length) throw new RangeError("truncated Serum preset header");
  let metadata;
  try { metadata = JSON.parse(bytes.subarray(headerStart, descriptorStart).toString("utf8")); }
  catch (error) { throw new TypeError(`invalid Serum metadata JSON: ${error.message}`); }
  if (metadata?.fileType !== "SerumPreset") throw new TypeError(`unsupported Xfer file type: ${metadata?.fileType ?? "missing"}`);
  const payloadLength = bytes.readUInt32LE(descriptorStart);
  const compression = bytes.readUInt32LE(descriptorStart + 4);
  if (payloadLength > MAX_PAYLOAD_BYTES) throw new RangeError("Serum preset payload is too large");
  if (compression !== 2) throw new RangeError(`unsupported Serum payload compression: ${compression}`);
  const compressed = bytes.subarray(descriptorStart + 8);
  if (compressed.length === 0) throw new RangeError("missing Serum preset payload");
  let payload;
  try { payload = zstdDecompressSync(compressed, { maxOutputLength: MAX_PAYLOAD_BYTES }); }
  catch (error) { throw new TypeError(`invalid Serum Zstandard payload: ${error.message}`); }
  if (payload.length !== payloadLength) throw new RangeError(`Serum payload length mismatch: expected ${payloadLength}, got ${payload.length}`);
  return Object.freeze({ metadata, data:decodeCbor(payload), payloadLength, compression });
}

export function assertSafeOutputPaths(inputPath, outputPaths) {
  const seen = new Set([resolve(inputPath)]);
  for (const outputPath of outputPaths.filter(Boolean)) {
    const absolute = resolve(outputPath);
    if (seen.has(absolute)) throw new RangeError("output paths must be unique and must not overwrite the source preset");
    seen.add(absolute);
  }
}

function describe(value) {
  if (Buffer.isBuffer(value)) return { type:"bytes", length:value.length };
  if (Array.isArray(value)) return { type:"array", length:value.length };
  if (value && typeof value === "object") return { type:"object", keys:Object.keys(value).length };
  return { type:typeof value, value };
}

export function inspectSerum2Preset(parsed) {
  return {
    metadata:parsed.metadata,
    payloadLength:parsed.payloadLength,
    topLevel:Object.entries(parsed.data).map(([key, value]) => ({ key, ...describe(value) })),
  };
}

function clamp(value, minimum, maximum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.min(maximum, Math.max(minimum, numeric));
}

function sourceParams(data, section) {
  const params = data?.[section]?.plainParams;
  return params && params !== "default" && typeof params === "object" ? params : Object.create(null);
}

function mappedFilterMode(type) {
  if (typeof type !== "string") return undefined;
  if (/notch/i.test(type)) return 3;
  if (/^(h|hp)|high/i.test(type)) return 2;
  if (/^(b|bp)|band/i.test(type)) return 1;
  if (/^(l|lp|mgl)|low|ladder/i.test(type)) return /24|ladder/i.test(type) ? 4 : 0;
  return undefined;
}

function addRecord(list, source, target, value, note) {
  list.push({ source, target, value, ...(note ? { note } : {}) });
}

function serumModSourceLabel(sourceId) {
  if (SERUM_MOD_SOURCES[sourceId]) return SERUM_MOD_SOURCES[sourceId].label;
  if (sourceId === 5) return "ENV 4";
  if (sourceId >= 6 && sourceId <= 15) return `LFO ${sourceId - 5}`;
  if (sourceId === 17) return "Note#";
  if (sourceId >= 25 && sourceId <= 32) return `Macro ${sourceId - 24}`;
  return `Source ${sourceId}`;
}

function serumRackEffects(data) {
  const effects = [];
  for (let rackIndex = 0; rackIndex < 3; rackIndex += 1) {
    const rack = data?.[`FXRack${rackIndex}`];
    if (!Array.isArray(rack?.FX)) continue;
    rack.FX.forEach((entry, effectIndex) => effects.push({ rackIndex, effectIndex, entry }));
  }
  return effects;
}

function safeDistortionApproximation(data, filter, approximate) {
  const filterDrive = filter.kParamEnable === 1
    ? clamp(Number(filter.kParamDrive) / 100, 0, 1) ?? 0
    : 0;
  const tape = serumRackEffects(data).find(({ entry }) =>
    entry?.FXDistortion?.plainParams?.kParamMode === "kTapeSat");
  const tapeParams = tape?.entry?.FXDistortion?.plainParams;
  const tapeDrive = clamp(Number(tapeParams?.kParamDrive) / 100, 0, 1) ?? 0;
  const combined = clamp(filterDrive * 0.45 + tapeDrive * 0.55, 0, 1) ?? 0;
  if (combined <= 1e-9) return {};

  const normalizedTone = clamp(tapeParams?.kParamFreq, 0, 1);
  const tone = normalizedTone === undefined
    ? 12_000
    : 800 * Math.pow(18_000 / 800, normalizedTone);
  const drive = Math.min(SAFE_DISTORTION_DRIVE_CEILING, 0.07 + combined * 0.65);
  const mix = Math.min(SAFE_DISTORTION_MIX_CEILING, 0.1 + combined * 0.45);
  const result = { on:true, drive, tone, mix };
  addRecord(
    approximate,
    tape ? `VoiceFilter0.kParamDrive + FXRack${tape.rackIndex}.FX[${tape.effectIndex}].FXDistortion` : "VoiceFilter0.kParamDrive",
    "fx.modules.distortion",
    result,
    `filter drive${tape ? " and Tape Sat" : ""} folded into one post-filter soft saturation; drive <= ${SAFE_DISTORTION_DRIVE_CEILING}, mix <= ${SAFE_DISTORTION_MIX_CEILING}; topology and transfer curves differ`,
  );
  return { modules:{ distortion:result } };
}

function serumModDestination(slot) {
  const moduleId = Number(slot?.destModuleID);
  const moduleType = typeof slot?.destModuleTypeString === "string" ? slot.destModuleTypeString : "";
  const parameter = typeof slot?.destModuleParamName === "string" ? slot.destModuleParamName : "";
  if (!Number.isInteger(moduleId) || !moduleType || !parameter) return undefined;
  return SERUM_MOD_DESTINATIONS[`${moduleType}:${moduleId}:${parameter}`];
}

function activeModulationSlots(data) {
  return Object.entries(data)
    .map(([key, value]) => {
      const match = /^ModSlot(\d+)$/.exec(key);
      return { key, value, index:match ? Number(match[1]) : -1 };
    })
    .filter(({ index, value }) => index >= 0 && value && typeof value === "object" &&
      value.plainParams && value.plainParams !== "default" && typeof value.plainParams === "object")
    .sort((a, b) => a.index - b.index);
}

function modulationRaw(slotEntry) {
  const slot = slotEntry.value;
  const source = Array.isArray(slot.source) ? slot.source : [];
  return {
    sourceSlot:slotEntry.key,
    sourceId:Number(source[0]),
    auxSourceId:Number(source[1] ?? 0),
    destination:{
      moduleType:slot.destModuleTypeString ?? null,
      moduleId:Number.isFinite(Number(slot.destModuleID)) ? Number(slot.destModuleID) : null,
      parameter:slot.destModuleParamName ?? null,
    },
    amountPercent:Number(slot.plainParams.kParamAmount),
  };
}

function convertModulation(data, core, approximate, unsupported) {
  const transferred = [];
  const skipped = [];
  const usedSources = new Set();
  const skip = (raw, reason) => skipped.push({ ...raw, reason });
  for (const entry of activeModulationSlots(data)) {
    const raw = modulationRaw(entry);
    const params = entry.value.plainParams;
    if (params.kParamBypass === 1 || params.kParamBypass === true) { skip(raw, "route is bypassed in the source preset"); continue; }
    if (!Number.isInteger(raw.sourceId)) { skip(raw, "source identifier is missing"); continue; }
    if (raw.auxSourceId !== 0) { skip(raw, "aux source is not transferred"); continue; }
    if (params.kParamBipolar === 1 || params.kParamBipolar === true) { skip(raw, "bipolar source remapping is not transferred"); continue; }
    if (["kParamCurveIn", "kParamCurveOut", "kParamOut"].some((key) => params[key] !== undefined)) {
      skip(raw, "non-linear input/output curve is not transferred");
      continue;
    }
    const source = SERUM_MOD_SOURCES[raw.sourceId];
    if (!source) { skip(raw, `${serumModSourceLabel(raw.sourceId)} has no source-equivalent in this bridge slice`); continue; }
    const destination = serumModDestination(entry.value);
    if (!destination) { skip(raw, "destination has no safe SynthEngine Matrix equivalent"); continue; }
    if (!Number.isFinite(raw.amountPercent)) { skip(raw, "modulation amount is missing or non-finite"); continue; }
    if (Math.abs(raw.amountPercent) < 1e-9) { skip(raw, "zero-amount route does not consume a SynthEngine slot"); continue; }
    if (transferred.length >= SYNTH_MOD_CAPACITY) { skip(raw, "SynthEngine Matrix capacity is six routes"); continue; }
    const amount = clamp(raw.amountPercent / 100 * destination.amountScale, -1, 1);
    const synthSlot = transferred.length;
    const base = 55 + synthSlot * 3;
    core.set(base, source.synthId);
    core.set(base + 1, destination.synthId);
    core.set(base + 2, amount);
    usedSources.add(raw.sourceId);
    const result = {
      ...raw,
      sourceLabel:source.label,
      synthSlot:synthSlot + 1,
      synthSourceId:source.synthId,
      synthDestination:destination.label,
      synthDestinationId:destination.synthId,
      synthAmount:amount,
    };
    transferred.push(result);
    addRecord(
      approximate,
      entry.key,
      `Matrix slot ${synthSlot + 1}`,
      { source:source.label, destination:destination.label, amount },
      destination.amountScale === 0.25
        ? "Serum percentage mapped to SynthEngine level +1.0 at 100%; response curves differ"
        : "linear amount transferred; source and destination response curves differ",
    );
  }
  if (skipped.length > 0) {
    addRecord(
      unsupported,
      "ModSlot*",
      "Modulation routes",
      { active:transferred.length + skipped.length, transferred:transferred.length, skipped:skipped.length },
      "see report.modulation.skipped for route-specific reasons",
    );
  }
  return { capacity:SYNTH_MOD_CAPACITY, active:transferred.length + skipped.length, transferred, skipped, usedSources };
}

export function convertSerum2ToPatch(parsed) {
  if (!parsed?.data || !parsed?.metadata) throw new TypeError("parsed Serum preset is required");
  const data = parsed.data;
  const mapped = [];
  const approximate = [];
  const unsupported = [];
  const core = new Map();
  const setCore = (id, value, source, status = "mapped", note) => {
    if (!Number.isFinite(value)) return;
    core.set(id, value);
    addRecord(status === "mapped" ? mapped : approximate, source, `core ${id}`, value, note);
  };

  for (let oscillator = 0; oscillator < 2; oscillator += 1) {
    const source = sourceParams(data, `Oscillator${oscillator}`);
    const target = oscillator === 0
      ? { level:2, unison:9, detune:10, width:11, octave:12, semitone:13, fine:14, morph:1, warp:117, warpMode:119 }
      : { level:19, unison:20, detune:21, width:22, octave:23, semitone:24, fine:25, morph:18, warp:118, warpMode:120 };
    const enabled = oscillator === 0 ? source.kParamEnable !== 0 : source.kParamEnable === 1;
    if (!enabled) setCore(target.level, 0, `Oscillator${oscillator}.kParamEnable`);
    else if (source.kParamVolume !== undefined) {
      const volume = clamp(source.kParamVolume, 0, 1);
      if (volume !== undefined) setCore(target.level, volume, `Oscillator${oscillator}.kParamVolume`, "approximate", "linear gain staging differs");
    } else if (oscillator === 1) {
      setCore(target.level, 0.8, `Oscillator${oscillator}.default volume`, "approximate", "Serum sparse default assumed");
    }
    const octave = clamp(source.kParamOctave, -2, 2);
    if (octave !== undefined) setCore(target.octave, Math.round(octave), `Oscillator${oscillator}.kParamOctave`, source.kParamOctave === octave ? "mapped" : "approximate", "SynthEngine octave range is -2..2");
    const semitone = clamp(source.kParamPitch, -12, 12);
    if (semitone !== undefined) setCore(target.semitone, Math.round(semitone), `Oscillator${oscillator}.kParamPitch`);
    const fine = clamp(source.kParamFine, -100, 100);
    if (fine !== undefined) setCore(target.fine, fine, `Oscillator${oscillator}.kParamFine`);
    const unison = clamp(source.kParamUnison, 1, 4);
    if (unison !== undefined) setCore(target.unison, Math.round(unison), `Oscillator${oscillator}.kParamUnison`, source.kParamUnison === unison ? "mapped" : "approximate", "SynthEngine supports at most four unison voices");
    const detune = clamp(Number(source.kParamDetune) * 50, 0, 50);
    if (detune !== undefined) setCore(target.detune, detune, `Oscillator${oscillator}.kParamDetune`, "approximate", "normalized Serum spread mapped to cents");
    const width = clamp(Math.abs(Number(source.kParamDetuneWid)) / 100, 0, 1);
    if (width !== undefined) setCore(target.width, width, `Oscillator${oscillator}.kParamDetuneWid`, "approximate", "Serum width percentage mapped to SynthEngine width");

    const wt = data?.[`Oscillator${oscillator}`]?.[`WTOsc${oscillator}`];
    const wtParams = wt?.plainParams && wt.plainParams !== "default" ? wt.plainParams : Object.create(null);
    const wtPath = typeof wt?.relativePathToWT === "string" ? wt.relativePathToWT : "";
    if (/basic shapes|default shapes/i.test(wtPath) && Number.isFinite(wtParams.kParamTablePos)) {
      setCore(target.morph, clamp(wtParams.kParamTablePos / 256, 0, 1), `WTOsc${oscillator}.kParamTablePos`, "approximate", "mapped only for Basic/Default Shapes; frame sets are not identical");
    } else if (wtPath) {
      addRecord(unsupported, `WTOsc${oscillator}.relativePathToWT`, `OSC ${oscillator === 0 ? "A" : "B"} wavetable`, wtPath, "source wavetable asset not transferred");
    }
    const warpMenu = wtParams.kParamWarpMenu;
    const warpDepth = clamp(wtParams.kParamWarp, 0, 1);
    const warpMap = {
      kBendPos:[0, 1], kBendNeg:[0, -1], kASYMPos:[1, 1], kASYMNeg:[1, -1], kSync:[2, 1],
    };
    if (warpDepth !== undefined && warpMap[warpMenu]) {
      const [mode, polarity] = warpMap[warpMenu];
      setCore(target.warpMode, mode, `WTOsc${oscillator}.kParamWarpMenu`);
      setCore(target.warp, warpDepth * polarity, `WTOsc${oscillator}.kParamWarp`, "approximate", "warp curves and depth response differ");
    } else if (warpMenu && warpDepth !== undefined) {
      addRecord(unsupported, `WTOsc${oscillator}.kParamWarpMenu`, `OSC ${oscillator === 0 ? "A" : "B"} Warp`, warpMenu, "no equivalent Warp mode");
    }
  }

  const envelope = sourceParams(data, "Env0");
  for (const [sourceKey, targetId, maximum] of [
    ["kParamAttack", 3, 60], ["kParamDecay", 4, 60],
    ["kParamSustain", 5, 1], ["kParamRelease", 6, 60],
  ]) {
    const value = clamp(envelope[sourceKey], 0, maximum);
    if (value !== undefined) setCore(targetId, value, `Env0.${sourceKey}`);
  }
  if (["kParamCurve1", "kParamCurve2", "kParamCurve3", "kParamHold", "kParamBeatSync"]
    .some((key) => envelope[key] !== undefined)) {
    addRecord(unsupported, "Env0 curve/hold/sync", "AMP envelope shape", null, "SynthEngine uses one shared curve and has no hold stage");
  }

  const global = sourceParams(data, "Global0");
  const master = clamp(global.kParamMasterVolume, 0, 4);
  if (master !== undefined) {
    setCore(
      7,
      Math.min(master, IMPORT_MASTER_CEILING),
      "Global0.kParamMasterVolume",
      "approximate",
      `output gain staging differs; local audition safety ceiling is ${IMPORT_MASTER_CEILING}`,
    );
  } else setCore(7, IMPORT_MASTER_CEILING, "Global0.kParamMasterVolume", "approximate", "source value missing; local audition safety ceiling applied");
  const voices = clamp(global.kParamPolyCount, 1, 16);
  if (voices !== undefined) setCore(8, Math.round(voices), "Global0.kParamPolyCount", global.kParamPolyCount === voices ? "mapped" : "approximate", "SynthEngine maximum is 16");
  if (global.kParamMonoToggle === 1) setCore(113, global.kParamLegato === 1 ? 2 : 1, "Global0 mono/legato");
  const glide = clamp(global.kParamPortamentoTime, 0, 2);
  if (glide !== undefined) setCore(114, glide, "Global0.kParamPortamentoTime", "approximate", "glide curve/scaling options are not transferred");

  const filter = sourceParams(data, "VoiceFilter0");
  if (filter.kParamEnable === 1) {
    const mode = mappedFilterMode(filter.kParamType);
    if (mode === undefined) {
      addRecord(unsupported, "VoiceFilter0.kParamType", "Filter", filter.kParamType ?? "sparse default", "filter family could not be mapped safely");
    } else {
      setCore(35, 1, "VoiceFilter0.kParamEnable");
      setCore(36, mode, "VoiceFilter0.kParamType", "approximate", "filter algorithms differ");
      const normalizedCutoff = clamp(filter.kParamFreq, 0, 1);
      if (normalizedCutoff !== undefined) setCore(37, 20 * Math.pow(1000, normalizedCutoff), "VoiceFilter0.kParamFreq", "approximate", "normalized cutoff mapped logarithmically to 20..20000 Hz");
      const resonance = clamp(Number(filter.kParamReso) / 100, 0, 1);
      if (resonance !== undefined) setCore(38, resonance, "VoiceFilter0.kParamReso", "approximate", "resonance response differs by algorithm");
      if (filter.kParamKeyTrack !== undefined) setCore(39, filter.kParamKeyTrack ? 1 : 0, "VoiceFilter0.kParamKeyTrack", "approximate", "source key tracking is a toggle");
    }
  }
  const fx = safeDistortionApproximation(data, filter, approximate);

  const modulation = convertModulation(data, core, approximate, unsupported);
  const mapEnvelope = (sourceId, section, targetIds, label) => {
    if (!modulation.usedSources.has(sourceId)) return;
    const source = sourceParams(data, section);
    for (const [sourceKey, targetId, maximum] of [
      ["kParamAttack", targetIds[0], 20], ["kParamDecay", targetIds[1], 20],
      ["kParamSustain", targetIds[2], 1], ["kParamRelease", targetIds[3], 20],
    ]) {
      const value = clamp(source[sourceKey], 0, maximum);
      if (value !== undefined) setCore(targetId, value, `${section}.${sourceKey}`, "approximate", `${label} timing transferred; envelope response and curves differ`);
    }
    if (["kParamCurve1", "kParamCurve2", "kParamCurve3", "kParamHold", "kParamBeatSync"]
      .some((key) => source[key] !== undefined)) {
      addRecord(unsupported, `${section} curve/hold/sync`, `${label} shape`, null, "route remains active with SynthEngine's envelope shape");
    }
  };
  mapEnvelope(3, "Env1", [41, 42, 43, 44], "ENV 2 · Filter");
  mapEnvelope(4, "Env2", [85, 86, 87, 88], "ENV 3 · Mod");
  for (const sourceId of [25, 26, 27, 28]) {
    if (!modulation.usedSources.has(sourceId)) continue;
    const definition = SERUM_MOD_SOURCES[sourceId];
    const value = clamp(Number(sourceParams(data, `Macro${definition.index}`).kParamValue) / 100, 0, 1);
    if (value !== undefined) {
      setCore(definition.paramId, value, `Macro${definition.index}.kParamValue`, "approximate", `${definition.label} value transferred; only the first four Serum macros are supported`);
    }
  }
  if (serumRackEffects(data).length > 0) {
    addRecord(
      unsupported,
      "FXRack*",
      "Remaining insert / space FX",
      null,
      "only the VoiceFilter drive and Tape Sat contribution is folded into a conservative SynthEngine distortion; other modules, routing, and curves are not transferred",
    );
  }

  const presetName = String(parsed.metadata.presetName ?? data.presetName ?? "Imported preset").trim();
  const name = `Serum 2 · ${presetName}`.slice(0, 80);
  const patch = {
    schemaVersion:1,
    name,
    category:"Custom",
    core:[...core.entries()].sort((a, b) => a[0] - b[0]),
    space:{ delayOn:false, reverbOn:false },
    fx,
  };
  const report = {
    reportVersion:3,
    source:{ format:"SerumPreset", product:parsed.metadata.product, productVersion:parsed.metadata.productVersion, presetName },
    result:"approximate",
    counts:{ mapped:mapped.length, approximate:approximate.length, unsupported:unsupported.length },
    mapped,
    approximate,
    unsupported,
    modulation:{
      capacity:modulation.capacity,
      active:modulation.active,
      transferred:modulation.transferred,
      skipped:modulation.skipped,
    },
    fxApproximation:{
      profile:"safe-audition-v1",
      distortion:fx.modules?.distortion ?? { on:false },
      limits:{ drive:SAFE_DISTORTION_DRIVE_CEILING, mix:SAFE_DISTORTION_MIX_CEILING },
    },
    notice:"This is an editable parameter approximation, not compatible playback or an identical sound.",
  };
  return { patch, report };
}

async function main(argv) {
  const inputPath = argv[0];
  if (!inputPath) throw new TypeError("usage: node tools/serum2-preset-bridge.mjs INPUT.SerumPreset [--out PATCH.json --report REPORT.json | --inspect FILE.json]");
  const outputIndex = argv.indexOf("--out");
  const reportIndex = argv.indexOf("--report");
  const inspectIndex = argv.indexOf("--inspect");
  if (outputIndex >= 0 && inspectIndex >= 0) throw new TypeError("--out and --inspect cannot be used together");
  if (reportIndex >= 0 && outputIndex < 0) throw new TypeError("--report requires --out");
  const outputPath = outputIndex >= 0 ? argv[outputIndex + 1] : undefined;
  const reportPath = reportIndex >= 0 ? argv[reportIndex + 1] : undefined;
  const inspectPath = inspectIndex >= 0 ? argv[inspectIndex + 1] : undefined;
  if (outputIndex >= 0 && !outputPath) throw new TypeError("--out requires a patch path");
  if (reportIndex >= 0 && !reportPath) throw new TypeError("--report requires a report path");
  if (inspectIndex >= 0 && !inspectPath) throw new TypeError("--inspect requires an output path");
  assertSafeOutputPaths(inputPath, [outputPath, reportPath, inspectPath]);
  const parsed = parseSerum2Preset(await readFile(inputPath));
  if (outputIndex >= 0) {
    const converted = convertSerum2ToPatch(parsed);
    await writeFile(outputPath, `${JSON.stringify(converted.patch, null, 2)}\n`, { encoding:"utf8", flag:"wx" });
    if (reportIndex >= 0) {
      await writeFile(reportPath, `${JSON.stringify(converted.report, null, 2)}\n`, { encoding:"utf8", flag:"wx" });
    }
    process.stdout.write(`PRESET BRIDGE OK: ${converted.patch.name} · mapped ${converted.report.counts.mapped} · approximate ${converted.report.counts.approximate} · unsupported ${converted.report.counts.unsupported}\n`);
    return;
  }
  const output = `${JSON.stringify(inspectSerum2Preset(parsed), null, 2)}\n`;
  if (inspectIndex >= 0) {
    await writeFile(inspectPath, output, { encoding:"utf8", flag:"wx" });
  } else process.stdout.write(output);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`PRESET BRIDGE ERROR: ${error.message}\n`);
    process.exitCode = 1;
  });
}
