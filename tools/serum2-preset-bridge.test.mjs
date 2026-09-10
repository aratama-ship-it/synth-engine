import assert from "node:assert/strict";
import test from "node:test";
import { zstdCompressSync } from "node:zlib";
import { assertSafeOutputPaths, convertSerum2ToPatch, decodeCbor, parseSerum2Preset } from "./serum2-preset-bridge.mjs";
import { validatePatch } from "../shells/web/patch-state.js";

function cborLength(major, length) {
  if (length < 24) return Buffer.from([(major << 5) | length]);
  if (length <= 0xff) return Buffer.from([(major << 5) | 24, length]);
  if (length <= 0xffff) { const result = Buffer.alloc(3); result[0] = (major << 5) | 25; result.writeUInt16BE(length, 1); return result; }
  const result = Buffer.alloc(5); result[0] = (major << 5) | 26; result.writeUInt32BE(length, 1); return result;
}

function encodeCbor(value) {
  if (value === null) return Buffer.from([0xf6]);
  if (value === false) return Buffer.from([0xf4]);
  if (value === true) return Buffer.from([0xf5]);
  if (typeof value === "number") {
    if (Number.isInteger(value) && value >= 0) return cborLength(0, value);
    if (Number.isInteger(value) && value < 0) return cborLength(1, -1 - value);
    const result = Buffer.alloc(9); result[0] = 0xfb; result.writeDoubleBE(value, 1); return result;
  }
  if (typeof value === "string") { const bytes = Buffer.from(value); return Buffer.concat([cborLength(3, bytes.length), bytes]); }
  if (Array.isArray(value)) return Buffer.concat([cborLength(4, value.length), ...value.map(encodeCbor)]);
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    return Buffer.concat([cborLength(5, entries.length), ...entries.flatMap(([key, item]) => [encodeCbor(key), encodeCbor(item)])]);
  }
  throw new TypeError(`cannot encode ${typeof value}`);
}

function makePreset(data, metadata = {}) {
  const header = Buffer.from(JSON.stringify({ fileType:"SerumPreset", presetName:"Bridge Fixture", product:"Serum2", productVersion:"2.0-test", ...metadata }));
  const payload = encodeCbor(data);
  const descriptor = Buffer.alloc(8);
  descriptor.writeUInt32LE(payload.length, 0);
  descriptor.writeUInt32LE(2, 4);
  const headerLength = Buffer.alloc(8);
  headerLength.writeBigUInt64LE(BigInt(header.length));
  return Buffer.concat([Buffer.from("XferJson\0"), headerLength, header, descriptor, zstdCompressSync(payload)]);
}

test("Serum 2 bridge decodes XferJson + Zstandard + CBOR deterministically", () => {
  const data = { fileType:"SerumPreset", nested:{ value:0.75, enabled:true }, list:[1, "two", null] };
  const parsed = parseSerum2Preset(makePreset(data));
  assert.equal(parsed.metadata.presetName, "Bridge Fixture");
  assert.equal(parsed.data.nested.value, 0.75);
  assert.deepEqual(parsed.data.list, [1, "two", null]);
  assert.deepEqual(decodeCbor(encodeCbor(data)), parsed.data);
});

test("Serum 2 bridge creates an accepted sparse SynthEngine patch and explicit mapping report", () => {
  const source = {
    Oscillator0:{ plainParams:{ kParamVolume:0.6, kParamOctave:-1, kParamUnison:7, kParamDetune:0.2, kParamDetuneWid:80 }, WTOsc0:{ plainParams:{ kParamTablePos:128, kParamWarp:0.4, kParamWarpMenu:"kSync" }, relativePathToWT:"Analog/Basic Shapes.wav" } },
    Oscillator1:{ plainParams:{ kParamEnable:1, kParamVolume:0.3, kParamPitch:7, kParamFine:-4 }, WTOsc1:{ plainParams:{ kParamWarp:0.2, kParamWarpMenu:"kPWM" }, relativePathToWT:"Digital/Unknown.wav" } },
    Env0:{ plainParams:{ kParamAttack:0.01, kParamDecay:0.4, kParamSustain:0.5, kParamRelease:0.7, kParamCurve1:60 } },
    Env1:{ plainParams:{ kParamAttack:0.02, kParamDecay:0.3, kParamSustain:0.4, kParamRelease:0.5 } },
    Macro0:{ plainParams:{ kParamValue:75 } },
    Global0:{ plainParams:{ kParamMasterVolume:0.25, kParamPolyCount:24, kParamMonoToggle:1, kParamLegato:1, kParamPortamentoTime:0.12 } },
    VoiceFilter0:{ plainParams:{ kParamEnable:1, kParamType:"MgL24", kParamFreq:0.5, kParamReso:50, kParamDrive:22 } },
    ModSlot0:{ destModuleID:0, destModuleParamName:"kParamFreq", destModuleTypeString:"VoiceFilter", plainParams:{ kParamAmount:25 }, source:[3, 0] },
    ModSlot1:{ destModuleID:0, destModuleParamName:"kParamWarp", destModuleTypeString:"WTOsc", plainParams:{ kParamAmount:50 }, source:[25, 0] },
    ModSlot2:{ destModuleID:0, destModuleParamName:"kParamVolume", destModuleTypeString:"Oscillator", plainParams:{ kParamAmount:40, kParamBipolar:1 }, source:[4, 0] },
    ModSlot3:{ destModuleID:1, destModuleParamName:"kParamWarp", destModuleTypeString:"WTOsc", plainParams:{ kParamAmount:30 }, source:[4, 16] },
    ModSlot4:{ destModuleID:0, destModuleParamName:"kParamReso", destModuleTypeString:"VoiceFilter", plainParams:{ kParamAmount:20, kParamCurveIn:0.4 }, source:[25, 0] },
    ModSlot5:{ destModuleID:0, destModuleParamName:"kParamTablePos", destModuleTypeString:"WTOsc", plainParams:{ kParamAmount:10, kParamBypass:true }, source:[25, 0] },
    ModSlot6:{ destModuleID:0, destModuleParamName:"kParamFreq", destModuleTypeString:"VoiceFilter", plainParams:{ kParamAmount:10 }, source:[6, 0] },
    FXRack0:{ FX:[{ FXDistortion:{ plainParams:{ kParamDrive:7, kParamFreq:0.9, kParamMode:"kTapeSat" } }, type:0 }] },
  };
  const converted = convertSerum2ToPatch(parseSerum2Preset(makePreset(source)));
  const patch = validatePatch(converted.patch);
  const core = new Map(patch.core);
  assert.equal(core.get(9), 4, "unison must clamp to SynthEngine capacity");
  assert.equal(core.get(119), 2, "Serum kSync should select SynthEngine SYNC");
  assert.equal(core.get(117), 0.4);
  assert.equal(core.get(113), 2, "mono + legato should select LEGATO");
  assert.equal(core.get(35), 1);
  assert.equal(core.get(36), 4);
  assert.equal(core.get(7), 0.2, "imported master must use the low-volume audition ceiling");
  assert.equal(core.get(55), 3, "Serum ENV 2 should map to SynthEngine ENV 2 · Filter");
  assert.equal(core.get(56), 8, "the first route should target Filter Cutoff");
  assert.equal(core.get(57), 0.25);
  assert.equal(core.get(58), 6, "Serum Macro 1 should map to SynthEngine Macro 1");
  assert.equal(core.get(59), 14, "the second route should target OSC A Warp");
  assert.equal(core.get(60), 0.5);
  assert.equal(core.get(41), 0.02, "a used ENV 2 should transfer its attack");
  assert.equal(core.get(42), 0.3);
  assert.equal(core.get(43), 0.4);
  assert.equal(core.get(44), 0.5);
  assert.equal(core.get(73), 0.75, "a used Macro 1 should transfer its current value");
  assert.equal(patch.space.delayOn, false, "unmapped delay must stay off");
  assert.equal(patch.space.reverbOn, false, "unmapped reverb must stay off");
  assert.equal(patch.fx.modules.distortion.on, true);
  assert.ok(patch.fx.modules.distortion.drive > 0 && patch.fx.modules.distortion.drive <= 0.24);
  assert.ok(patch.fx.modules.distortion.mix > 0 && patch.fx.modules.distortion.mix <= 0.2);
  assert.equal(converted.report.reportVersion, 3);
  assert.equal(converted.report.fxApproximation.profile, "safe-audition-v1");
  assert.equal(converted.report.modulation.capacity, 6);
  assert.equal(converted.report.modulation.active, 7);
  assert.equal(converted.report.modulation.transferred.length, 2);
  assert.equal(converted.report.modulation.skipped.length, 5);
  const skipReasons = converted.report.modulation.skipped.map(({ reason }) => reason).join("\n");
  assert.match(skipReasons, /bipolar/);
  assert.match(skipReasons, /aux source/);
  assert.match(skipReasons, /non-linear/);
  assert.match(skipReasons, /bypassed/);
  assert.match(skipReasons, /LFO 1 has no source-equivalent/);
  assert.ok(converted.report.counts.mapped > 0);
  assert.ok(converted.report.counts.approximate > 0);
  assert.ok(converted.report.counts.unsupported > 0);
  assert.match(converted.report.notice, /not compatible playback/);
});

test("Serum 2 UI source numbering maps ENV 2, ENV 3, and Noise without the earlier off-by-one", () => {
  const source = {
    Env1:{ plainParams:{ kParamAttack:0.12, kParamDecay:0.34, kParamSustain:0.56, kParamRelease:0.78 } },
    Env2:{ plainParams:{ kParamAttack:0.23, kParamDecay:0.45, kParamSustain:0.67, kParamRelease:0.89 } },
    ModSlot0:{ destModuleID:3, destModuleParamName:"kParamVolume", destModuleTypeString:"Oscillator", plainParams:{ kParamAmount:40 }, source:[3, 0] },
    ModSlot1:{ destModuleID:0, destModuleParamName:"kParamFreq", destModuleTypeString:"VoiceFilter", plainParams:{ kParamAmount:30 }, source:[4, 0] },
    ModSlot2:{ destModuleID:0, destModuleParamName:"kParamFreq", destModuleTypeString:"VoiceFilter", plainParams:{ kParamAmount:20 }, source:[6, 0] },
  };
  const converted = convertSerum2ToPatch(parseSerum2Preset(makePreset(source)));
  const core = new Map(validatePatch(converted.patch).core);
  assert.equal(core.get(55), 3, "Serum source 3 is UI ENV 2");
  assert.equal(core.get(56), 7, "Serum Noise volume should map to SynthEngine Noise Level");
  assert.equal(core.get(57), 0.1);
  assert.equal(core.get(58), 11, "Serum source 4 is UI ENV 3");
  assert.equal(core.get(59), 8);
  assert.equal(core.get(60), 0.3);
  assert.equal(core.get(41), 0.12);
  assert.equal(core.get(85), 0.23);
  assert.match(converted.report.modulation.skipped[0].reason, /LFO 1 has no source-equivalent/);
});

test("Serum 2 bridge fails closed for wrong magic, compression, sizes, and corrupt CBOR", () => {
  const valid = makePreset({ ok:true });
  assert.throws(() => parseSerum2Preset(Buffer.from("not a preset")), /not a Serum 2/);
  const wrongCompression = Buffer.from(valid);
  const headerLength = Number(wrongCompression.readBigUInt64LE(9));
  wrongCompression.writeUInt32LE(9, 17 + headerLength + 4);
  assert.throws(() => parseSerum2Preset(wrongCompression), /unsupported Serum payload compression/);
  const wrongLength = Buffer.from(valid);
  wrongLength.writeUInt32LE(999, 17 + headerLength);
  assert.throws(() => parseSerum2Preset(wrongLength), /payload length mismatch/);
  assert.throws(() => decodeCbor(Buffer.from([0x9f, 0x01])), /truncated CBOR payload/);
});

test("Serum 2 bridge refuses source overwrite and duplicate output paths", () => {
  assert.doesNotThrow(() => assertSafeOutputPaths("/tmp/source.SerumPreset", ["/tmp/patch.json", "/tmp/report.json"]));
  assert.throws(() => assertSafeOutputPaths("/tmp/source.SerumPreset", ["/tmp/../tmp/source.SerumPreset"]), /must not overwrite/);
  assert.throws(() => assertSafeOutputPaths("/tmp/source.SerumPreset", ["/tmp/result.json", "/tmp/result.json"]), /must be unique/);
});

test("Serum 2 bridge applies the audition ceiling when source master is sparse", () => {
  const converted = convertSerum2ToPatch(parseSerum2Preset(makePreset({ Oscillator0:{ plainParams:"default" } })));
  const patch = validatePatch(converted.patch);
  assert.equal(new Map(patch.core).get(7), 0.2);
  assert.equal(patch.space.delayOn, false);
  assert.equal(patch.space.reverbOn, false);
});

test("Serum 2 bridge fills at most six Matrix slots and reports overflow routes", () => {
  const source = {
    Macro0:{ plainParams:{ kParamValue:50 } },
    ...Object.fromEntries(Array.from({ length:7 }, (_, index) => [
      `ModSlot${index}`,
      {
        destModuleID:0,
        destModuleParamName:"kParamReso",
        destModuleTypeString:"VoiceFilter",
        plainParams:{ kParamAmount:(index + 1) * 10 },
        source:[25, 0],
      },
    ])),
  };
  const converted = convertSerum2ToPatch(parseSerum2Preset(makePreset(source)));
  const core = new Map(validatePatch(converted.patch).core);
  assert.equal(converted.report.modulation.active, 7);
  assert.equal(converted.report.modulation.transferred.length, 6);
  assert.equal(converted.report.modulation.skipped.length, 1);
  assert.match(converted.report.modulation.skipped[0].reason, /capacity is six/);
  assert.equal(core.get(55), 6);
  assert.equal(core.get(56), 9);
  assert.equal(core.get(57), 0.1);
  assert.equal(core.get(70), 6);
  assert.equal(core.get(71), 9);
  assert.equal(core.get(72), 0.6);
  assert.equal(core.get(73), 0.5);
});
