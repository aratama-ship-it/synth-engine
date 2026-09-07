export const SOUND_ANALYSIS_VERSION = 2;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export function toMono(channels) {
  if (!Array.isArray(channels) || channels.length === 0) throw new TypeError("channels must contain at least one channel");
  const length = channels[0]?.length ?? 0;
  if (!Number.isInteger(length) || channels.some((channel) => !channel || channel.length !== length)) throw new TypeError("all channels must have the same length");
  const mono = new Float32Array(length);
  const gain = 1 / channels.length;
  for (const channel of channels) for (let index = 0; index < length; index += 1) mono[index] += channel[index] * gain;
  return mono;
}

export function rmsEnvelope(samples, sampleRate, windowSeconds = 0.02) {
  if (!(sampleRate > 0) || !(windowSeconds > 0)) throw new RangeError("sampleRate and windowSeconds must be positive");
  const size = Math.max(1, Math.round(sampleRate * windowSeconds));
  const values = [];
  for (let start = 0; start < samples.length; start += size) {
    const end = Math.min(samples.length, start + size);
    let sum = 0;
    for (let index = start; index < end; index += 1) sum += samples[index] * samples[index];
    values.push(Math.sqrt(sum / Math.max(1, end - start)));
  }
  return { values, windowSeconds:size / sampleRate };
}

export function derivativeCentroid(samples, sampleRate, from = 0, to = samples.length) {
  let numerator = 0;
  let denominator = 0;
  const start = Math.max(1, Math.floor(from));
  const end = Math.min(samples.length, Math.ceil(to));
  for (let index = start; index < end; index += 1) {
    const difference = samples[index] - samples[index - 1];
    numerator += difference * difference;
    denominator += samples[index] * samples[index];
  }
  return denominator > 0 ? (sampleRate / (2 * Math.PI)) * Math.sqrt(numerator / denominator) : 0;
}

export function correlation(a, b) {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;
  let meanA = 0;
  let meanB = 0;
  for (let index = 0; index < length; index += 1) { meanA += a[index]; meanB += b[index]; }
  meanA /= length;
  meanB /= length;
  let numerator = 0;
  let energyA = 0;
  let energyB = 0;
  for (let index = 0; index < length; index += 1) {
    const valueA = a[index] - meanA;
    const valueB = b[index] - meanB;
    numerator += valueA * valueB;
    energyA += valueA * valueA;
    energyB += valueB * valueB;
  }
  return energyA > 0 && energyB > 0 ? numerator / Math.sqrt(energyA * energyB) : 0;
}

function downsample(samples, sampleRate, targetRate = 12000) {
  const factor = Math.max(1, Math.floor(sampleRate / targetRate));
  if (factor === 1) return { samples, sampleRate };
  const length = Math.floor(samples.length / factor);
  const result = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    let sum = 0;
    const source = index * factor;
    for (let offset = 0; offset < factor; offset += 1) sum += samples[source + offset];
    result[index] = sum / factor;
  }
  return { samples:result, sampleRate:sampleRate / factor };
}

export function estimatePitch(samples, sampleRate, { minHz = 40, maxHz = 2000 } = {}) {
  if (samples.length < sampleRate * 0.035) return { hz:null, confidence:0 };
  const reduced = downsample(samples, sampleRate);
  const source = reduced.samples;
  const rate = reduced.sampleRate;
  let mean = 0;
  for (const value of source) mean += value;
  mean /= source.length;
  const windowed = new Float32Array(source.length);
  for (let index = 0; index < source.length; index += 1) {
    const hann = source.length > 1 ? .5 - .5 * Math.cos((2 * Math.PI * index) / (source.length - 1)) : 1;
    windowed[index] = (source[index] - mean) * hann;
  }
  const minLag = Math.max(2, Math.floor(rate / maxHz));
  const maxLag = Math.min(windowed.length - 3, Math.ceil(rate / minHz));
  if (maxLag <= minLag) return { hz:null, confidence:0 };
  const scores = new Float32Array(maxLag + 1);
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let numerator = 0;
    let energyA = 0;
    let energyB = 0;
    for (let index = 0; index + lag < windowed.length; index += 1) {
      const a = windowed[index];
      const b = windowed[index + lag];
      numerator += a * b;
      energyA += a * a;
      energyB += b * b;
    }
    scores[lag] = energyA > 0 && energyB > 0 ? numerator / Math.sqrt(energyA * energyB) : 0;
    best = Math.max(best, scores[lag]);
  }
  const threshold = Math.max(.45, best * .92);
  let selected = -1;
  for (let lag = minLag + 1; lag < maxLag; lag += 1) {
    if (scores[lag] >= threshold && scores[lag] >= scores[lag - 1] && scores[lag] > scores[lag + 1]) { selected = lag; break; }
  }
  if (selected < 0) {
    for (let lag = minLag; lag <= maxLag; lag += 1) if (selected < 0 || scores[lag] > scores[selected]) selected = lag;
  }
  const confidence = clamp(scores[selected], 0, 1);
  if (confidence < .45) return { hz:null, confidence };
  const left = scores[selected - 1] ?? scores[selected];
  const center = scores[selected];
  const right = scores[selected + 1] ?? scores[selected];
  const curvature = left - 2 * center + right;
  const offset = Math.abs(curvature) > 1e-9 ? clamp(.5 * (left - right) / curvature, -.5, .5) : 0;
  return { hz:rate / (selected + offset), confidence };
}

function stereoWidth(channels) {
  if (channels.length < 2 || channels[0].length === 0) return 0;
  const left = channels[0];
  const right = channels[1];
  let midEnergy = 0;
  let sideEnergy = 0;
  for (let index = 0; index < left.length; index += 1) {
    const mid = (left[index] + right[index]) * .5;
    const side = (left[index] - right[index]) * .5;
    midEnergy += mid * mid;
    sideEnergy += side * side;
  }
  const midRms = Math.sqrt(midEnergy / left.length);
  const sideRms = Math.sqrt(sideEnergy / left.length);
  return sideRms + midRms > 0 ? sideRms / (sideRms + midRms) : 0;
}

function dbfs(value) {
  return value > 0 ? 20 * Math.log10(value) : null;
}

export function analyzeSound({ channels, sampleRate }) {
  if (!(sampleRate > 0)) throw new RangeError("sampleRate must be positive");
  const mono = toMono(channels);
  const durationSeconds = mono.length / sampleRate;
  let peak = 0;
  let sumSquares = 0;
  for (const sample of mono) { peak = Math.max(peak, Math.abs(sample)); sumSquares += sample * sample; }
  const rms = mono.length ? Math.sqrt(sumSquares / mono.length) : 0;
  const envelope = rmsEnvelope(mono, sampleRate);
  const maximumEnvelope = envelope.values.reduce((maximum, value) => Math.max(maximum, value), 0);
  const activeThreshold = Math.max(.0003, maximumEnvelope * .04);
  let firstActive = envelope.values.findIndex((value) => value >= activeThreshold);
  let lastActive = -1;
  for (let index = envelope.values.length - 1; index >= 0; index -= 1) if (envelope.values[index] >= activeThreshold) { lastActive = index; break; }
  if (firstActive < 0) firstActive = 0;
  const activeStartSeconds = firstActive * envelope.windowSeconds;
  const activeEndSeconds = lastActive >= 0 ? Math.min(durationSeconds, (lastActive + 1) * envelope.windowSeconds) : 0;
  const activeStartFrame = Math.max(0, Math.min(mono.length, Math.floor(activeStartSeconds * sampleRate)));
  const activeEndFrame = Math.max(activeStartFrame, Math.min(mono.length, Math.ceil(activeEndSeconds * sampleRate)));
  let activeSumSquares = 0;
  for (let index = activeStartFrame; index < activeEndFrame; index += 1) activeSumSquares += mono[index] * mono[index];
  const activeRms = activeEndFrame > activeStartFrame ? Math.sqrt(activeSumSquares / (activeEndFrame - activeStartFrame)) : 0;
  const attackLow = maximumEnvelope * .1;
  const attackHigh = maximumEnvelope * .9;
  let attackStart = firstActive;
  while (attackStart < envelope.values.length && envelope.values[attackStart] < attackLow) attackStart += 1;
  let attackEnd = attackStart;
  while (attackEnd < envelope.values.length && envelope.values[attackEnd] < attackHigh) attackEnd += 1;
  const attackSeconds = maximumEnvelope > 0 && attackEnd < envelope.values.length ? Math.max(0, (attackEnd - attackStart) * envelope.windowSeconds) : null;
  const pitchStart = Math.min(mono.length, Math.round((activeStartSeconds + Math.max(attackSeconds ?? 0, .03)) * sampleRate));
  const pitchEnd = Math.min(mono.length, pitchStart + Math.round(sampleRate * .25), Math.max(pitchStart, Math.round(activeEndSeconds * sampleRate)));
  const pitch = estimatePitch(mono.subarray(pitchStart, pitchEnd), sampleRate);
  const brightnessStart = Math.max(0, Math.round(activeStartSeconds * sampleRate));
  const brightnessEnd = Math.max(brightnessStart, Math.round(activeEndSeconds * sampleRate));
  const brightnessHz = derivativeCentroid(mono, sampleRate, brightnessStart, brightnessEnd);
  const warnings = [];
  if (durationSeconds < .25) warnings.push("too-short");
  if (durationSeconds > 30) warnings.push("too-long");
  if (peak >= .999) warnings.push("clipped");
  if (peak < .01 || maximumEnvelope < .005) warnings.push("too-quiet");
  if (activeEndSeconds - activeStartSeconds < durationSeconds * .2) warnings.push("mostly-silent");
  if (pitch.hz === null || pitch.confidence < .7) warnings.push("pitch-uncertain");
  return {
    version:SOUND_ANALYSIS_VERSION,
    sampleRate,
    channels:channels.length,
    durationSeconds,
    peakDbfs:dbfs(peak),
    rmsDbfs:dbfs(rms),
    activeRmsDbfs:dbfs(activeRms),
    activeStartSeconds,
    activeEndSeconds,
    activeDurationSeconds:Math.max(0, activeEndSeconds - activeStartSeconds),
    attackSeconds,
    pitchHz:pitch.hz,
    pitchConfidence:pitch.confidence,
    brightnessHz,
    stereoWidth:stereoWidth(channels),
    envelope:{ windowSeconds:envelope.windowSeconds, values:envelope.values },
    warnings,
  };
}
