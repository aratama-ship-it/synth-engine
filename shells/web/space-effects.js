export const REVERB_MATERIALS = Object.freeze({
  clear: Object.freeze({ label:"CLEAR", size:.62, decay:2.8, damping:1, lowCut:120, highCut:12000, width:.82 }),
  bright: Object.freeze({ label:"BRIGHT", size:.58, decay:2.2, damping:.18, lowCut:80, highCut:18000, width:.9 }),
  warm: Object.freeze({ label:"WARM", size:.78, decay:3.8, damping:1, lowCut:180, highCut:5600, width:.72 }),
  grain: Object.freeze({ label:"GRAIN", size:.42, decay:1.35, damping:1, lowCut:260, highCut:7800, width:.92 }),
});

export const SPACE_DEFAULTS = Object.freeze({
  delayOn:false, delayTime:.36, delayFeedback:.34, delayTone:5200, delayMix:.18,
  reverbOn:true, reverbMaterial:"clear", reverbSize:.62, reverbDecay:2.8, reverbDamping:1,
  reverbPreDelay:.008, reverbLowCut:120, reverbHighCut:12000, reverbWidth:.82, reverbMix:.28,
});

const SPACE_RANGES = Object.freeze({
  delayTime:[.03, 1.5], delayFeedback:[0, .85], delayTone:[800, 18000], delayMix:[0, .65],
  reverbSize:[0, 1], reverbDecay:[.3, 8], reverbDamping:[0, 1], reverbPreDelay:[0, .1], reverbLowCut:[20, 1000],
  reverbHighCut:[1000, 18000], reverbWidth:[0, 1], reverbMix:[0, .65],
});

function finiteClamp(value, minimum, maximum, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${name} must be a finite number`);
  return Math.min(maximum, Math.max(minimum, number));
}

function setAudioParam(parameter, value, context, timeConstant = .015) {
  const at = Number.isFinite(context.currentTime) ? context.currentTime : 0;
  parameter.cancelScheduledValues?.(at);
  if (typeof context.state === "string" && context.state !== "running") {
    parameter.value = value;
    return;
  }
  if (typeof parameter.setTargetAtTime === "function") parameter.setTargetAtTime(value, at, timeConstant);
  else parameter.value = value;
}

function rampAudioParam(parameter, value, context, duration = .06) {
  const at = Number.isFinite(context.currentTime) ? context.currentTime : 0;
  parameter.cancelScheduledValues?.(at);
  if (typeof context.state === "string" && context.state !== "running") {
    parameter.value = value;
    return;
  }
  if (typeof parameter.setValueAtTime === "function" && typeof parameter.linearRampToValueAtTime === "function") {
    parameter.setValueAtTime(parameter.value, at);
    parameter.linearRampToValueAtTime(value, at + duration);
  } else parameter.value = value;
}

function prng(seed) {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0x100000000; };
}

export function createReverbImpulse(context, settings = SPACE_DEFAULTS) {
  if (!context || !Number.isFinite(context.sampleRate) || context.sampleRate <= 0 || typeof context.createBuffer !== "function") throw new TypeError("valid audio context required");
  const decay = finiteClamp(settings.reverbDecay ?? SPACE_DEFAULTS.reverbDecay, .3, 8, "reverbDecay");
  const size = finiteClamp(settings.reverbSize ?? SPACE_DEFAULTS.reverbSize, 0, 1, "reverbSize");
  const damping = finiteClamp(settings.reverbDamping ?? SPACE_DEFAULTS.reverbDamping, 0, 1, "reverbDamping");
  const highDecayRate = 5.6 + damping * 3.2;
  const duration = Math.min(9, decay * 1.08 + .18);
  const frames = Math.max(1, Math.round(context.sampleRate * duration));
  const buffer = context.createBuffer(2, frames, context.sampleRate);
  const onsetSeconds = .004 + size * .014;
  const density = .52 + size * .46;
  const reflectionTimes = [.006, .011, .017, .026, .039].map((time) => time * (.55 + size * 1.65));

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    const keepRandom = prng(0x315ca691 ^ (channel * 0x9e3779b9));
    const amplitudeRandom = prng(0xa511e9b3 ^ (channel * 0x85ebca6b));
    let low = 0;
    for (let frame = 0; frame < frames; frame += 1) {
      const time = frame / context.sampleRate;
      const noise = amplitudeRandom() * 2 - 1;
      low += .065 * (noise - low);
      const high = noise - low;
      const lowEnvelope = Math.exp(-5.6 * time / decay);
      const highEnvelope = Math.exp(-highDecayRate * time / decay);
      const onset = 1 - Math.exp(-time / onsetSeconds);
      const keep = keepRandom() <= Math.min(1, density + time * .8);
      const diffusion = keep ? (low * lowEnvelope * .72 + high * highEnvelope * .38) * onset : 0;
      data[frame] = diffusion;
    }
    reflectionTimes.forEach((time, index) => {
      const offset = Math.round((time + channel * .00073 * (index % 2 ? 1 : -1)) * context.sampleRate);
      if (offset > 0 && offset < frames) data[offset] += (index % 2 ? -.42 : .54) * (1 - index * .11);
    });
    let sum = 0;
    for (let frame = 0; frame < frames; frame += 1) sum += data[frame];
    const mean = sum / frames;
    for (let frame = 0; frame < frames; frame += 1) data[frame] -= mean;
    const fadeFrames = Math.min(frames, Math.round(context.sampleRate * .025));
    let energy = 0;
    for (let frame = 0; frame < frames; frame += 1) {
      const tailFade = frame >= frames - fadeFrames ? (frames - frame - 1) / Math.max(1, fadeFrames) : 1;
      data[frame] *= Math.max(0, tailFade);
      energy += data[frame] * data[frame];
    }
    const scale = energy > 0 ? 1 / Math.sqrt(energy) : 1;
    for (let frame = 0; frame < frames; frame += 1) data[frame] *= scale;
  }
  return buffer;
}

function connectStereoWidth(context, input, output) {
  if (typeof context.createChannelSplitter !== "function" || typeof context.createChannelMerger !== "function") { input.connect(output); return { setWidth() {} }; }
  const splitter = context.createChannelSplitter(2); const merger = context.createChannelMerger(2);
  const ll = context.createGain(); const lr = context.createGain(); const rr = context.createGain(); const rl = context.createGain();
  input.connect(splitter); splitter.connect(ll, 0); splitter.connect(lr, 0); splitter.connect(rr, 1); splitter.connect(rl, 1);
  ll.connect(merger, 0, 0); rl.connect(merger, 0, 0); rr.connect(merger, 0, 1); lr.connect(merger, 0, 1); merger.connect(output);
  return { setWidth(width) { const direct = .5 + width * .5; const cross = .5 - width * .5; setAudioParam(ll.gain, direct, context); setAudioParam(rr.gain, direct, context); setAudioParam(lr.gain, cross, context); setAudioParam(rl.gain, cross, context); } };
}

export function createSpaceEffects(context, synth, destination = context.destination, options = {}) {
  if (!context || !synth || !destination) throw new TypeError("context, synth, and destination are required");
  const sourceOutput = options.sourceOutput ?? 0;
  const effectInput = context.createGain();

  const delayInput = context.createGain(); const delay = context.createDelay(1.5); const feedbackTone = context.createBiquadFilter(); const feedback = context.createGain(); const delayWet = context.createGain();
  feedbackTone.type = "lowpass"; feedbackTone.Q.value = .4;
  effectInput.connect(delayInput); delayInput.connect(delay); delay.connect(delayWet); delayWet.connect(destination); delay.connect(feedbackTone); feedbackTone.connect(feedback); feedback.connect(delay);

  const reverbInput = context.createGain(); const reverbPreDelay = context.createDelay(.1); const reverbLowCut = context.createBiquadFilter(); const reverbHighCut = context.createBiquadFilter();
  reverbLowCut.type = "highpass"; reverbLowCut.Q.value = .5; reverbHighCut.type = "lowpass"; reverbHighCut.Q.value = .5;
  const convolvers = [context.createConvolver(), context.createConvolver()]; const convolverGains = [context.createGain(), context.createGain()]; const reverbWidthInput = context.createGain(); const reverbWet = context.createGain();
  convolvers.forEach((convolver, index) => { convolver.normalize = false; reverbHighCut.connect(convolver); convolver.connect(convolverGains[index]); convolverGains[index].connect(reverbWidthInput); });
  effectInput.connect(reverbInput); reverbInput.connect(reverbPreDelay); reverbPreDelay.connect(reverbLowCut); reverbLowCut.connect(reverbHighCut);
  const width = connectStereoWidth(context, reverbWidthInput, reverbWet); reverbWet.connect(destination);
  synth.connect(effectInput, sourceOutput);

  convolverGains.forEach((gain) => { gain.gain.value = 0; });
  const values = { ...SPACE_DEFAULTS }; let activeConvolver = 0; let rebuildTimer;
  function rebuildImpulse() {
    const next = activeConvolver === 0 ? 1 : 0;
    convolvers[next].buffer = createReverbImpulse(context, values);
    rampAudioParam(convolverGains[next].gain, 1, context, .08); rampAudioParam(convolverGains[activeConvolver].gain, 0, context, .08); activeConvolver = next;
  }
  function scheduleImpulse() {
    if (rebuildTimer !== undefined) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => { rebuildTimer = undefined; rebuildImpulse(); }, 45);
  }
  function setValues(patch = {}) {
    if (patch.delayOn !== undefined) values.delayOn = Boolean(patch.delayOn);
    if (patch.reverbOn !== undefined) values.reverbOn = Boolean(patch.reverbOn);
    if (patch.reverbMaterial !== undefined) {
      if (!Object.hasOwn(REVERB_MATERIALS, patch.reverbMaterial)) throw new RangeError(`unknown reverb material: ${patch.reverbMaterial}`);
      values.reverbMaterial = patch.reverbMaterial;
      if (patch.applyMaterial !== false) {
        const material = REVERB_MATERIALS[patch.reverbMaterial];
        values.reverbSize = material.size; values.reverbDecay = material.decay; values.reverbDamping = material.damping; values.reverbLowCut = material.lowCut; values.reverbHighCut = material.highCut; values.reverbWidth = material.width;
      }
    }
    for (const [name, range] of Object.entries(SPACE_RANGES)) if (patch[name] !== undefined) values[name] = finiteClamp(patch[name], range[0], range[1], name);
    const nyquist = context.sampleRate * .5;
    values.reverbHighCut = Math.min(values.reverbHighCut, nyquist * .94);
    values.delayTone = Math.min(values.delayTone, nyquist * .94);
    setAudioParam(delayInput.gain, values.delayOn ? 1 : 0, context); setAudioParam(delayWet.gain, values.delayMix, context); setAudioParam(delay.delayTime, values.delayTime, context); setAudioParam(feedback.gain, values.delayFeedback, context); setAudioParam(feedbackTone.frequency, values.delayTone, context);
    setAudioParam(reverbInput.gain, values.reverbOn ? 1 : 0, context); setAudioParam(reverbWet.gain, values.reverbMix, context); setAudioParam(reverbPreDelay.delayTime, values.reverbPreDelay, context); setAudioParam(reverbLowCut.frequency, values.reverbLowCut, context); setAudioParam(reverbHighCut.frequency, values.reverbHighCut, context); width.setWidth(values.reverbWidth);
    const impulseKeys = ["reverbMaterial", "reverbSize", "reverbDecay", "reverbDamping"];
    if (!convolvers[activeConvolver].buffer) rebuildImpulse(); else if (impulseKeys.some((key) => patch[key] !== undefined)) scheduleImpulse();
    return { ...values };
  }
  function dispose() { if (rebuildTimer !== undefined) clearTimeout(rebuildTimer); }
  setValues();
  return Object.freeze({ setValues, getValues:() => ({ ...values }), dispose, input:effectInput });
}
