export const FILTER_MATCH_MIN_CUTOFF = 20;
export const FILTER_MATCH_MAX_CUTOFF = 20000;
export const FILTER_MATCH_ALIGNED_RATIO = .05;
export const FILTER_MATCH_MIN_RESPONSE_RATIO = .025;
export const FILTER_MATCH_MAX_STEP_RATIO = 4;

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const finitePositive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;

function unavailable(reason, details = {}) {
  return { ...details, available:false, ready:false, state:"unavailable", reason };
}

export function planFilterCutoffProbe({
  filterEnabled,
  filterMode,
  currentCutoff,
  referenceBrightness,
  currentBrightness,
  minimum = FILTER_MATCH_MIN_CUTOFF,
  maximum = FILTER_MATCH_MAX_CUTOFF,
} = {}) {
  const mode = Math.round(Number(filterMode));
  const cutoff = Number(currentCutoff);
  const reference = Number(referenceBrightness);
  const current = Number(currentBrightness);
  const brightnessRatio = reference / current;
  const base = { filterMode:mode, currentCutoff:cutoff, referenceBrightness:reference, currentBrightness:current, minimum, maximum, brightnessRatio };
  if (!(Number(filterEnabled) >= .5)) return unavailable("Filter is BYPASS; ON is preserved", base);
  if (![0, 1].includes(mode)) return unavailable("Cutoff calibration supports LP12 / LP24 only", base);
  if (!finitePositive(cutoff) || cutoff < minimum || cutoff > maximum) return unavailable("Current Cutoff is outside its parameter range", base);
  if (!finitePositive(reference) || !finitePositive(current)) return unavailable("Brightness metrics are unavailable", base);
  if (Math.abs(brightnessRatio - 1) <= FILTER_MATCH_ALIGNED_RATIO) {
    return { ...base, available:false, ready:false, state:"aligned", suggestedCutoff:cutoff, confidence:"HIGH", reason:"Reference and current brightness are within 5%" };
  }
  const direction = brightnessRatio > 1 ? 1 : -1;
  const probeCutoff = clamp(cutoff * (direction > 0 ? 2 : .5), minimum, maximum);
  if (Math.abs(Math.log(probeCutoff / cutoff)) < .01) return unavailable("No room for a Cutoff probe in the required direction", base);
  return { ...base, available:false, ready:true, state:"calibrating", direction, probeCutoff };
}

export function estimateFilterCutoff(plan, probeBrightness) {
  if (!plan?.ready || plan.state !== "calibrating") return unavailable(plan?.reason ?? "A valid Cutoff probe plan is required", plan ?? {});
  const probe = Number(probeBrightness);
  if (!finitePositive(probe)) return unavailable("Probe brightness is unavailable", plan);
  const cutoffStep = Math.log(plan.probeCutoff / plan.currentCutoff);
  const responseStep = Math.log(probe / plan.currentBrightness);
  const slope = responseStep / cutoffStep;
  const responseRatio = Math.abs(probe / plan.currentBrightness - 1);
  const details = { ...plan, probeBrightness:probe, responseRatio, slope };
  if (!(slope > .05)) return unavailable("Cutoff probe did not move brightness in the expected direction", details);
  if (responseRatio < FILTER_MATCH_MIN_RESPONSE_RATIO) return unavailable("Cutoff sensitivity is below 2.5%", details);
  const rawCutoff = plan.currentCutoff * Math.exp(Math.log(plan.referenceBrightness / plan.currentBrightness) / slope);
  const stepMinimum = Math.max(plan.minimum, plan.currentCutoff / FILTER_MATCH_MAX_STEP_RATIO);
  const stepMaximum = Math.min(plan.maximum, plan.currentCutoff * FILTER_MATCH_MAX_STEP_RATIO);
  const suggestedCutoff = clamp(rawCutoff, stepMinimum, stepMaximum);
  const limited = Math.abs(Math.log(suggestedCutoff / rawCutoff)) > .001;
  const lower = Math.min(plan.currentCutoff, plan.probeCutoff);
  const upper = Math.max(plan.currentCutoff, plan.probeCutoff);
  const bracketed = rawCutoff >= lower && rawCutoff <= upper;
  const confidence = bracketed && responseRatio >= .1 ? "HIGH" : responseRatio >= .05 && !limited ? "MEDIUM" : "LOW";
  return {
    ...details,
    available:true,
    ready:true,
    state:"ready",
    rawCutoff,
    suggestedCutoff,
    limited,
    bracketed,
    confidence,
    evidence:`${Math.round(plan.probeCutoff).toLocaleString()} Hz probe moved brightness ${probe >= plan.currentBrightness ? "+" : "−"}${Math.abs((probe / plan.currentBrightness - 1) * 100).toFixed(1)}%`,
  };
}
