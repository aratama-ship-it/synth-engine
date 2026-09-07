const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function median(source) {
  if (!source.length) return 0;
  const sorted = [...source].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) * .5;
}

function movingAverage(source, radius = 1) {
  return source.map((_, index) => {
    let total = 0;
    let count = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      if (index + offset < 0 || index + offset >= source.length) continue;
      total += source[index + offset];
      count += 1;
    }
    return count ? total / count : 0;
  });
}

function confidenceFor(stability, sampleCount) {
  if (stability <= .08 && sampleCount >= 8) return "HIGH";
  if (stability <= .2 && sampleCount >= 5) return "MEDIUM";
  return "LOW";
}

function unavailable(reason) {
  return {
    available:false,
    state:"unavailable",
    mode:"uncertain",
    suggestions:{ attack:null, decay:null, sustain:null, release:null },
    stableBody:null,
    noteOffSeconds:null,
    reason,
  };
}

function stableBodyCandidate(source, first, peak, last) {
  const activeCount = last - first + 1;
  const windowSize = clamp(Math.round(activeCount * .12), 5, 12);
  const startMinimum = Math.min(last, peak + 2);
  const startMaximum = last - windowSize - 3;
  if (startMaximum < startMinimum) return null;
  let best = null;
  for (let start = startMinimum; start <= startMaximum; start += 1) {
    const slice = source.slice(start, start + windowSize);
    const level = median(slice);
    if (level < .025) continue;
    const deviation = median(slice.map((value) => Math.abs(value - level))) / level;
    const slope = Math.abs(slice.at(-1) - slice[0]) / level;
    const stability = deviation + slope * .5;
    const position = (start - startMinimum) / Math.max(1, startMaximum - startMinimum);
    const score = stability + position * .025;
    if (!best || score < best.score) best = { start, end:start + windowSize - 1, level, stability, score, windowSize };
  }
  return best && best.stability <= .32 ? best : null;
}

function releaseCandidate(source, body, first, last, windowSeconds, curve) {
  if (!body || body.stability > .2) return null;
  const activeCount = last - first + 1;
  const earliest = Math.max(body.end + 1, first + Math.floor(activeCount * .8));
  for (let index = earliest; index <= last - 2; index += 1) {
    const before = median(source.slice(Math.max(body.start, index - 4), index));
    const after = median(source.slice(index, Math.min(last + 1, index + 3)));
    if (before < body.level * .78 || after > body.level * .7) continue;
    const remaining = source.slice(index, last + 1);
    const rebounds = remaining.filter((value) => value > body.level * .82).length;
    if (rebounds > Math.max(1, Math.floor(remaining.length * .08))) continue;
    const finalLevel = median(source.slice(Math.max(index, last - 2), last + 1));
    if (finalLevel > body.level * .42) continue;
    const tailSeconds = Math.max(windowSeconds, (last - index + 1) * windowSeconds);
    const value = clamp(tailSeconds * (2 - clamp(curve, 0, 1)), .005, 60);
    const confidence = finalLevel <= body.level * .25 && last - index >= 3 ? "HIGH" : "MEDIUM";
    return {
      value,
      confidence,
      evidence:`stable body → tail drop (${Math.round(tailSeconds * 1000)} ms observed)`,
      start:index,
    };
  }
  return null;
}

export function suggestAmpEnvelope(analysis, { curve = 0 } = {}) {
  const envelope = analysis?.envelope;
  const raw = Array.isArray(envelope?.values) || ArrayBuffer.isView(envelope?.values) ? Array.from(envelope.values, Number) : [];
  const windowSeconds = Number(envelope?.windowSeconds);
  if (!(windowSeconds > 0) || raw.length < 8 || raw.some((value) => !Number.isFinite(value) || value < 0)) return unavailable("usable envelope not found");
  const maximum = raw.reduce((result, value) => Math.max(result, value), 0);
  if (!(maximum >= .005)) return unavailable("reference is too quiet");
  const normalized = raw.map((value) => value / maximum);
  const smoothed = movingAverage(normalized, 1);
  const first = clamp(Math.floor((analysis.activeStartSeconds ?? 0) / windowSeconds), 0, raw.length - 1);
  const last = clamp(Math.ceil((analysis.activeEndSeconds ?? raw.length * windowSeconds) / windowSeconds) - 1, first, raw.length - 1);
  if (last - first + 1 < 8) return unavailable("active sound is too short");
  let peak = first;
  for (let index = first + 1; index <= last; index += 1) if (smoothed[index] > smoothed[peak]) peak = index;

  const measuredAttack = Number(analysis.attackSeconds);
  const attackValue = Number.isFinite(measuredAttack)
    ? clamp(measuredAttack <= windowSeconds * 1.25 ? .005 : measuredAttack / .8, .005, 60)
    : null;
  const body = stableBodyCandidate(smoothed, first, peak, last);
  const release = releaseCandidate(smoothed, body, first, last, windowSeconds, Number(curve) || 0);
  const attack = attackValue === null ? null : {
    value:attackValue,
    confidence:measuredAttack <= windowSeconds * 1.25 ? "LOW" : measuredAttack >= windowSeconds * 3 ? "HIGH" : "MEDIUM",
    evidence:"10–90% rise (linear AMP mapping)",
  };
  const sustain = body ? {
    value:clamp(body.level, 0, 1),
    confidence:confidenceFor(body.stability, body.windowSize),
    evidence:`stable body / peak (${body.windowSize} windows)`,
  } : null;
  const decaySeconds = body ? Math.max(windowSeconds, (body.start - peak) * windowSeconds) : null;
  const decay = body ? {
    value:clamp(decaySeconds, .005, 60),
    confidence:confidenceFor(body.stability, body.windowSize),
    evidence:"peak → stable body",
  } : null;
  const suggestions = { attack, decay, sustain, release };
  const detectedCount = Object.values(suggestions).filter(Boolean).length;
  if (!detectedCount) return unavailable("ADSR landmarks are not separable");
  return {
    available:true,
    state:detectedCount === 4 ? "ready" : "partial",
    mode:release ? "held" : "one-shot",
    suggestions,
    stableBody:body ? {
      fromSeconds:body.start * windowSeconds,
      toSeconds:(body.end + 1) * windowSeconds,
      level:body.level,
      stability:body.stability,
    } : null,
    noteOffSeconds:release ? release.start * windowSeconds : null,
    reason:release ? "four envelope landmarks detected" : "note-off is not separable; keep current Release",
  };
}
