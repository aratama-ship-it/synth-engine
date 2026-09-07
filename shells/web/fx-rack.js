export const FX_IDS = Object.freeze(["distortion", "chorus", "eq", "compressor"]);

export const FX_CORE_PARAM_IDS = Object.freeze({
  distortion:Object.freeze({ on:90, drive:91, tone:92, mix:93 }),
  chorus:Object.freeze({ on:94, rate:95, depth:96, width:97, mix:98 }),
  eq:Object.freeze({ on:99, low:100, mid:101, high:102 }),
  compressor:Object.freeze({ on:103, threshold:104, ratio:105, attack:106, release:107, makeup:108 }),
  order:Object.freeze([109, 110, 111, 112]),
});

export const FX_DEFAULTS = Object.freeze({
  order:Object.freeze([...FX_IDS]),
  modules:Object.freeze({
    distortion:Object.freeze({ on:false, drive:.28, tone:12000, mix:.48 }),
    chorus:Object.freeze({ on:false, rate:.32, depth:.45, width:.8, mix:.32 }),
    eq:Object.freeze({ on:false, low:0, mid:0, high:0 }),
    compressor:Object.freeze({ on:false, threshold:-18, ratio:3, attack:.012, release:.22, makeup:1 }),
  }),
});

const RANGES = Object.freeze({
  distortion:{ drive:[0,1], tone:[800,18000], mix:[0,1] },
  chorus:{ rate:[.05,5], depth:[0,1], width:[0,1], mix:[0,.65] },
  eq:{ low:[-18,18], mid:[-18,18], high:[-18,18] },
  compressor:{ threshold:[-60,0], ratio:[1,20], attack:[.001,.2], release:[.03,1], makeup:[0,12] },
});

function finiteClamp(value, range, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${name} must be a finite number`);
  return Math.min(range[1], Math.max(range[0], number));
}

function setParam(parameter, value, context) {
  const at = Number.isFinite(context.currentTime) ? context.currentTime : 0;
  parameter.cancelScheduledValues?.(at);
  if (typeof context.state === "string" && context.state !== "running") {
    parameter.value = value;
    return;
  }
  if (typeof parameter.setTargetAtTime === "function") parameter.setTargetAtTime(value, at, .012);
  else parameter.value = value;
}

export function normalizeFxOrder(order) {
  if (!Array.isArray(order) || order.length !== FX_IDS.length || new Set(order).size !== FX_IDS.length || order.some((id) => !FX_IDS.includes(id))) throw new RangeError("FX order must contain every insert exactly once");
  return [...order];
}

export function sanitizeFxPatch(current, patch = {}) {
  if (!current || typeof current !== "object" || !patch || typeof patch !== "object") throw new TypeError("FX state and patch must be objects");
  const next = structuredClone(current);
  if (patch.order !== undefined) next.order = normalizeFxOrder(patch.order);
  if (patch.modules !== undefined) {
    if (!patch.modules || typeof patch.modules !== "object") throw new TypeError("FX modules patch must be an object");
    for (const [id, update] of Object.entries(patch.modules)) {
      if (!FX_IDS.includes(id)) throw new RangeError(`unknown insert effect: ${id}`);
      if (!update || typeof update !== "object") throw new TypeError(`${id} patch must be an object`);
      for (const [name, value] of Object.entries(update)) {
        if (name === "on") next.modules[id].on = Boolean(value);
        else {
          const range = RANGES[id][name];
          if (!range) throw new RangeError(`unknown ${id} parameter: ${name}`);
          next.modules[id][name] = finiteClamp(value, range, `${id}.${name}`);
        }
      }
    }
  }
  return next;
}

export function fxCoreParams(candidate) {
  const state = sanitizeFxPatch(structuredClone(FX_DEFAULTS), candidate ?? {});
  const params = [];
  for (const id of FX_IDS) {
    for (const [name, paramId] of Object.entries(FX_CORE_PARAM_IDS[id])) {
      const value = state.modules[id][name];
      params.push([paramId, name === "on" ? (value ? 1 : 0) : value]);
    }
  }
  state.order.forEach((id, slot) => params.push([FX_CORE_PARAM_IDS.order[slot], FX_IDS.indexOf(id)]));
  return params;
}

function createMixModule(context, processedOutput) {
  const input = context.createGain(); const output = context.createGain(); const dry = context.createGain(); const wet = context.createGain();
  input.connect(dry); dry.connect(output); processedOutput(input, wet); wet.connect(output);
  return { input, output, setMix(on, mix = 1) { const amount = on ? mix : 0; setParam(dry.gain, 1 - amount, context); setParam(wet.gain, amount, context); } };
}

function distortionModule(context, state) {
  const shaper = context.createWaveShaper(); shaper.oversample = "4x"; const tone = context.createBiquadFilter(); tone.type = "lowpass"; tone.Q.value = .45;
  const module = createMixModule(context, (input, wet) => { input.connect(shaper); shaper.connect(tone); tone.connect(wet); });
  return { ...module, update(values) { const amount = 1 + values.drive * 28; const curve = new Float32Array(2048); const normalization = Math.tanh(amount); for (let index = 0; index < curve.length; index += 1) { const x = index / (curve.length - 1) * 2 - 1; curve[index] = Math.tanh(x * amount) / normalization; } shaper.curve = curve; setParam(tone.frequency, values.tone, context); module.setMix(values.on, values.mix); } };
}

function chorusModule(context, state) {
  const splitter = context.createChannelSplitter(2); const merger = context.createChannelMerger(2); const leftDelay = context.createDelay(.04); const rightDelay = context.createDelay(.04);
  const leftLfo = context.createOscillator(); const rightLfo = context.createOscillator(); const leftDepth = context.createGain(); const rightDepth = context.createGain();
  leftLfo.connect(leftDepth); rightLfo.connect(rightDepth); leftDepth.connect(leftDelay.delayTime); rightDepth.connect(rightDelay.delayTime); leftLfo.start(); rightLfo.start();
  const module = createMixModule(context, (input, wet) => { input.connect(splitter); splitter.connect(leftDelay, 0); splitter.connect(rightDelay, 1); leftDelay.connect(merger, 0, 0); rightDelay.connect(merger, 0, 1); merger.connect(wet); });
  return { ...module, update(values) { const base = .012; const depth = .001 + values.depth * .008; setParam(leftDelay.delayTime, base - depth * values.width * .35, context); setParam(rightDelay.delayTime, base + depth * values.width * .35, context); setParam(leftLfo.frequency, values.rate, context); setParam(rightLfo.frequency, values.rate * 1.013, context); setParam(leftDepth.gain, depth, context); setParam(rightDepth.gain, -depth, context); module.setMix(values.on, values.mix); } };
}

function eqModule(context) {
  const low = context.createBiquadFilter(); const mid = context.createBiquadFilter(); const high = context.createBiquadFilter(); low.type = "lowshelf"; mid.type = "peaking"; high.type = "highshelf"; low.frequency.value = 160; mid.frequency.value = 1200; mid.Q.value = .75; high.frequency.value = 6800;
  const module = createMixModule(context, (input, wet) => { input.connect(low); low.connect(mid); mid.connect(high); high.connect(wet); });
  return { ...module, update(values) { setParam(low.gain, values.low, context); setParam(mid.gain, values.mid, context); setParam(high.gain, values.high, context); module.setMix(values.on, 1); } };
}

function compressorModule(context) {
  const compressor = context.createDynamicsCompressor(); const makeup = context.createGain();
  const module = createMixModule(context, (input, wet) => { input.connect(compressor); compressor.connect(makeup); makeup.connect(wet); });
  return { ...module, update(values) { setParam(compressor.threshold, values.threshold, context); setParam(compressor.ratio, values.ratio, context); setParam(compressor.attack, values.attack, context); setParam(compressor.release, values.release, context); setParam(makeup.gain, 10 ** (values.makeup / 20), context); module.setMix(values.on, 1); } };
}

export function createInsertFxRack(context, source, destination = context.destination, options = {}) {
  if (!context || !source || !destination) throw new TypeError("context, source, and destination are required");
  const input = context.createGain(); const output = context.createGain(); const state = structuredClone(FX_DEFAULTS);
  const modules = { distortion:distortionModule(context), chorus:chorusModule(context), eq:eqModule(context), compressor:compressorModule(context) };
  function rebuild() {
    input.disconnect(); for (const module of Object.values(modules)) module.output.disconnect();
    let previous = input;
    for (const id of state.order) { previous.connect(modules[id].input); previous = modules[id].output; }
    previous.connect(output);
  }
  function apply() { for (const id of FX_IDS) modules[id].update(state.modules[id]); }
  function setValues(patch = {}) { const next = sanitizeFxPatch(state, patch); state.order = next.order; for (const id of FX_IDS) Object.assign(state.modules[id], next.modules[id]); rebuild(); apply(); return structuredClone(state); }
  source.connect(input, options.sourceOutput ?? 0); output.connect(destination); rebuild(); apply();
  return Object.freeze({ input, output, connect(target) { return output.connect(target); }, setValues, setOrder(order) { return setValues({ order }); }, getValues:() => structuredClone(state) });
}
