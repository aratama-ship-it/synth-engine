import { correlation } from "./sound-analysis.js";

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const dbToGain = (db) => 10 ** (db / 20);

export const MATCH_TARGET_RMS_DBFS = -18;
export const MATCH_PEAK_CEILING_DBFS = -1;
export const MATCH_MIN_PITCH_CONFIDENCE = .7;
export const MATCH_MAX_RENDER_SECONDS = 12;

export function midiForFrequency(hz) {
  if (!(hz > 0)) return null;
  const exact = 69 + 12 * Math.log2(hz / 440);
  const midi = Math.round(exact);
  return { midi, exact, frequency:440 * (2 ** ((midi - 69) / 12)), cents:(exact - midi) * 100 };
}

export function candidateRenderPlan(analysis, releaseSeconds, maxSeconds = MATCH_MAX_RENDER_SECONDS) {
  const pitch = midiForFrequency(analysis?.pitchHz);
  if (!pitch || !(analysis?.pitchConfidence >= MATCH_MIN_PITCH_CONFIDENCE)) {
    return { ready:false, reason:"単音ピッチの信頼度が70%未満のため、候補音は描画しません。" };
  }
  const sourceDuration = Number(analysis.durationSeconds);
  if (!(sourceDuration > 0)) return { ready:false, reason:"参照音の長さを測定できません。" };
  const durationSeconds = clamp(sourceDuration, .25, maxSeconds);
  const noteOnSeconds = clamp(Number(analysis.activeStartSeconds) || 0, 0, Math.max(0, durationSeconds - .06));
  const activeEndSeconds = clamp(Number(analysis.activeEndSeconds) || durationSeconds, noteOnSeconds + .05, durationSeconds);
  const release = clamp(Number(releaseSeconds) || 0, 0, Math.max(0, activeEndSeconds - noteOnSeconds - .05));
  const noteOffSeconds = clamp(activeEndSeconds - release, noteOnSeconds + .05, Math.max(noteOnSeconds + .05, durationSeconds - .01));
  return {
    ready:true,
    midi:pitch.midi,
    nearestFrequency:pitch.frequency,
    detuneCents:pitch.cents,
    durationSeconds,
    truncated:sourceDuration > maxSeconds,
    noteOnSeconds,
    noteOffSeconds,
  };
}

export function levelMatchGain(analysis, targetDbfs = MATCH_TARGET_RMS_DBFS, peakCeilingDbfs = MATCH_PEAK_CEILING_DBFS) {
  if (!Number.isFinite(analysis?.activeRmsDbfs) || !Number.isFinite(analysis?.peakDbfs)) return { gain:0, limitedBy:"silence" };
  const rmsGain = dbToGain(targetDbfs - analysis.activeRmsDbfs);
  const peakGain = dbToGain(peakCeilingDbfs - analysis.peakDbfs);
  const limitedBy = peakGain < rmsGain ? "peak" : "rms";
  return { gain:Math.max(0, Math.min(rmsGain, peakGain)), limitedBy };
}

export function compareSoundAnalyses(reference, candidate) {
  const cents = reference?.pitchHz > 0 && candidate?.pitchHz > 0 ? 1200 * Math.log2(candidate.pitchHz / reference.pitchHz) : null;
  const attackDeltaMs = Number.isFinite(reference?.attackSeconds) && Number.isFinite(candidate?.attackSeconds) ? (candidate.attackSeconds - reference.attackSeconds) * 1000 : null;
  const brightnessDeltaPercent = reference?.brightnessHz > 0 && Number.isFinite(candidate?.brightnessHz) ? ((candidate.brightnessHz - reference.brightnessHz) / reference.brightnessHz) * 100 : null;
  return {
    envelopeCorrelation:correlation(reference?.envelope?.values ?? [], candidate?.envelope?.values ?? []),
    pitchDeltaCents:cents,
    attackDeltaMs,
    brightnessDeltaPercent,
  };
}
