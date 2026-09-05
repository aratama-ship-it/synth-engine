const loadedContexts = new WeakSet();
const PARAM_INFO_BYTES = 28;

function exportedNumber(value, name) {
  const number = Number(value instanceof WebAssembly.Global ? value.value : value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`wasm export '${name}' is invalid`);
  return number;
}

function readCString(memory, pointer) {
  const bytes = new Uint8Array(memory.buffer);
  if (!Number.isInteger(pointer) || pointer <= 0 || pointer >= bytes.length) {
    throw new Error(`invalid wasm string pointer: ${pointer}`);
  }
  let end = pointer;
  while (end < bytes.length && bytes[end] !== 0) end += 1;
  if (end === bytes.length) throw new Error(`unterminated wasm string at ${pointer}`);
  return new TextDecoder().decode(bytes.subarray(pointer, end));
}

function decodeParams(exports) {
  const memory = exports?.memory;
  if (!(memory instanceof WebAssembly.Memory)) throw new Error("wasm export 'memory' is missing");
  if (typeof exports.synth_param_count !== "function" || typeof exports.synth_param_info !== "function") {
    throw new Error("wasm parameter metadata exports are missing");
  }
  const count = exportedNumber(exports.synth_param_count(), "synth_param_count");
  const heapBase = exportedNumber(exports.__heap_base, "__heap_base");
  const pointer = (heapBase + 3) & ~3;
  const requiredBytes = pointer + PARAM_INFO_BYTES;
  if (requiredBytes > memory.buffer.byteLength) {
    memory.grow(Math.ceil((requiredBytes - memory.buffer.byteLength) / 65536));
  }
  const data = new DataView(memory.buffer);
  const params = [];
  for (let id = 0; id < count; id += 1) {
    if (exports.synth_param_info(id, pointer) !== 0) {
      throw new Error(`synth_param_info failed for id ${id}`);
    }
    params.push({
      id: data.getUint32(pointer, true),
      identifier: readCString(memory, data.getUint32(pointer + 4, true)),
      displayName: readCString(memory, data.getUint32(pointer + 8, true)),
      min: data.getFloat32(pointer + 12, true),
      max: data.getFloat32(pointer + 16, true),
      default: data.getFloat32(pointer + 20, true),
      flags: data.getUint32(pointer + 24, true),
    });
  }
  return params;
}

export async function getParams(wasmBytes) {
  if (!(wasmBytes instanceof ArrayBuffer)) throw new TypeError("wasmBytes must be an ArrayBuffer");
  const result = await WebAssembly.instantiate(wasmBytes, {});
  return decodeParams(result.instance.exports);
}

export function parsePreset(text) {
  if (typeof text !== "string") throw new TypeError("preset text must be a string");
  const params = [];
  for (const [index, sourceLine] of text.split(/\r?\n/).entries()) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(\d+)\s*=\s*([^\s#]+)\s*(?:#.*)?$/);
    if (!match) throw new Error(`invalid preset line ${index + 1}: ${sourceLine}`);
    const id = Number(match[1]);
    const value = Number(match[2]);
    if (!Number.isSafeInteger(id) || !Number.isFinite(value)) {
      throw new Error(`invalid preset value on line ${index + 1}: ${sourceLine}`);
    }
    params.push([id, value]);
  }
  return params;
}

function defaultFrame(context) {
  return Math.max(0, Math.ceil(context.currentTime * context.sampleRate));
}

export async function createSynthNode(context, wasmBytes) {
  if (!context?.audioWorklet || typeof context.audioWorklet.addModule !== "function") {
    throw new TypeError("context must provide audioWorklet.addModule");
  }
  if (!(wasmBytes instanceof ArrayBuffer)) throw new TypeError("wasmBytes must be an ArrayBuffer");
  const params = await getParams(wasmBytes);
  if (!loadedContexts.has(context)) {
    await context.audioWorklet.addModule(new URL("./synth-worklet.js", import.meta.url));
    loadedContexts.add(context);
  }

  const audioNode = new AudioWorkletNode(context, "synth-engine", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: { wasmBytes },
  });
  let nextMessageId = 1;
  const waiters = new Map();
  const listeners = new Set();

  audioNode.port.addEventListener("message", (event) => {
    const message = event.data;
    for (const listener of listeners) listener(message);
    if (message?.type === "ready") {
      for (const [id, waiter] of waiters) {
        waiter.resolve(message);
        waiters.delete(id);
      }
    } else if (message?.type === "error") {
      const error = new Error(message.message || "AudioWorklet error");
      for (const [id, waiter] of waiters) {
        waiter.reject(error);
        waiters.delete(id);
      }
    }
  });
  audioNode.port.start();

  function postEvents(events) {
    audioNode.port.postMessage({ type: "events", events });
  }

  return {
    audioNode,
    connect(destination) {
      return audioNode.connect(destination);
    },
    disconnect() {
      return audioNode.disconnect();
    },
    noteOn(note, velocity = 0.8, atFrame = defaultFrame(context)) {
      postEvents([{ frame: atFrame, kind: 1, id: note, a: note, b: velocity }]);
    },
    noteOff(note, atFrame = defaultFrame(context)) {
      postEvents([{ frame: atFrame, kind: 2, id: note, a: 0, b: 0 }]);
    },
    setParam(id, value) {
      audioNode.port.postMessage({ type: "preset", params: [[id, value]] });
    },
    getParams() {
      return params.map((parameter) => ({ ...parameter }));
    },
    loadPreset(text) {
      const params = parsePreset(text);
      audioNode.port.postMessage({ type: "preset", params });
      return params;
    },
    reset(kind = 0, seed = 1) {
      audioNode.port.postMessage({ type: "reset", kind, seed });
    },
    sendEvents(events) {
      postEvents(events);
    },
    batch(preset, events) {
      const id = nextMessageId++;
      const ready = new Promise((resolve, reject) => waiters.set(id, { resolve, reject }));
      audioNode.port.postMessage({ type: "batch", preset, events });
      return ready;
    },
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
