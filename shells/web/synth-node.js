const loadedContexts = new WeakSet();

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
