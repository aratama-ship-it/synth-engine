export const REVERB_MATERIALS = Object.freeze({
  clear: Object.freeze({ label: "CLEAR", duration: 2.8, decay: 2.1, density: 1, tone: 12000, preDelay: 0 }),
  warm: Object.freeze({ label: "WARM", duration: 3.6, decay: 3.6, density: 0.72, tone: 4800, preDelay: 0.024 }),
  grain: Object.freeze({ label: "GRAIN", duration: 1.6, decay: 0.95, density: 0.28, tone: 7500, preDelay: 0.006 }),
});
// The core exposes one musical send output. The Web shell fans that output out
// into two independent effect modules so their audible roles remain separate.
export const SPACE_DEFAULTS = Object.freeze({ delaySend: 0, delayMix: 0.18, delayTime: 0.36, reverbSend: 1, reverbMix: 0.28, reverbMaterial: "clear" });

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value)));
}

function setAudioParam(parameter, value, context) {
  const at = Number.isFinite(context.currentTime) ? context.currentTime : 0;
  parameter.cancelScheduledValues?.(at);
  if (typeof parameter.setTargetAtTime === "function") parameter.setTargetAtTime(value, at, 0.015);
  else parameter.value = value;
}

function createImpulse(context, material) {
  const frames = Math.max(1, Math.round(context.sampleRate * material.duration));
  const buffer = context.createBuffer(2, frames, context.sampleRate);
  let seed = 0x4d595df4;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let frame = 0; frame < frames; frame += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const noise = seed / 0x100000000 * 2 - 1;
      const keep = (seed / 0x100000000) <= material.density;
      data[frame] = keep ? noise * Math.pow(1 - frame / frames, material.decay) : 0;
    }
  }
  return buffer;
}

export function createSpaceEffects(context, synth, destination = context.destination) {
  if (!context || !synth || !destination) throw new TypeError("context, synth, and destination are required");
  const sendFilter = context.createBiquadFilter();
  sendFilter.type = "highpass";
  sendFilter.frequency.value = 120;
  sendFilter.Q.value = 0.5;

  const delayInput = context.createGain();
  const delay = context.createDelay(0.8);
  const feedbackTone = context.createBiquadFilter();
  feedbackTone.type = "lowpass";
  feedbackTone.frequency.value = 4200;
  feedbackTone.Q.value = 0.4;
  const feedback = context.createGain();
  feedback.gain.value = 0.38;
  const delayWet = context.createGain();
  const reverbInput = context.createGain();
  const reverbPreDelay = context.createDelay(0.08);
  const reverbTone = context.createBiquadFilter();
  reverbTone.type = "lowpass";
  reverbTone.Q.value = 0.5;
  const reverb = context.createConvolver();
  reverb.normalize = true;
  const reverbWet = context.createGain();

  synth.connect(sendFilter, synth.sendOutput);
  sendFilter.connect(delayInput);
  delayInput.connect(delay);
  delay.connect(delayWet);
  delayWet.connect(destination);
  delay.connect(feedbackTone);
  feedbackTone.connect(feedback);
  feedback.connect(delay);
  sendFilter.connect(reverbInput);
  reverbInput.connect(reverbPreDelay);
  reverbPreDelay.connect(reverbTone);
  reverbTone.connect(reverb);
  reverb.connect(reverbWet);
  reverbWet.connect(destination);

  const values = { ...SPACE_DEFAULTS };
  function setValues(patch = {}) {
    if (patch.delaySend !== undefined) values.delaySend = clamp(patch.delaySend, 0, 1);
    if (patch.delayMix !== undefined) values.delayMix = clamp(patch.delayMix, 0, 0.65);
    if (patch.delayTime !== undefined) values.delayTime = clamp(patch.delayTime, 0.08, 0.72);
    if (patch.reverbSend !== undefined) values.reverbSend = clamp(patch.reverbSend, 0, 1);
    if (patch.reverbMix !== undefined) values.reverbMix = clamp(patch.reverbMix, 0, 0.65);
    if (patch.reverbMaterial !== undefined) {
      if (!Object.hasOwn(REVERB_MATERIALS, patch.reverbMaterial)) throw new RangeError(`unknown reverb material: ${patch.reverbMaterial}`);
      values.reverbMaterial = patch.reverbMaterial;
    }
    const material = REVERB_MATERIALS[values.reverbMaterial];
    setAudioParam(delayInput.gain, values.delaySend, context);
    setAudioParam(delayWet.gain, values.delayMix, context);
    setAudioParam(delay.delayTime, values.delayTime, context);
    setAudioParam(reverbInput.gain, values.reverbSend, context);
    setAudioParam(reverbWet.gain, values.reverbMix, context);
    setAudioParam(reverbPreDelay.delayTime, material.preDelay, context);
    setAudioParam(reverbTone.frequency, material.tone, context);
    if (patch.reverbMaterial !== undefined || !reverb.buffer) reverb.buffer = createImpulse(context, material);
    return { ...values };
  }

  setValues();
  return Object.freeze({ setValues, getValues: () => ({ ...values }) });
}
