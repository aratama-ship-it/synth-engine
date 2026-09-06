// AudioWorkletGlobalScope には performance が無いブラウザがある（Chromium で "performance is not defined" を実測 2026-09-04）。
// 高分解能クロックが無ければ Date.now() に落とす（統計の精度は落ちるが Worklet は死なない）。
const nowMs = (typeof performance !== "undefined" && typeof performance.now === "function")
  ? () => performance.now()
  : () => Date.now();
const EVENT_BYTES = 20;
const EVENT_CAPACITY = 4096;
const MAX_BLOCK = 512;
const VOICE_PARAM_KIND = 5;

// AudioWorkletGlobalScope.currentFrame は AudioContext 全体の絶対フレーム。
// ライブの呼び出し側も同じ時刻系でイベントを送る。Node上の検査では未定義なので、
// 従来のWorklet内部カウンタをfallbackとして残す。
export function audioContextFrame(fallback) {
  const frame = Number(globalThis.currentFrame);
  return Number.isSafeInteger(frame) && frame >= 0 ? frame : fallback;
}

function align16(value) {
  return (value + 15) & ~15;
}

function normalizeEvent(event, sequence = 0) {
  const frame = Number(event?.frame);
  const kind = Number(event?.kind);
  const id = Number(event?.id);
  const a = Number(event?.a);
  const b = Number(event?.b);
  if (!Number.isSafeInteger(frame) || frame < 0) throw new Error("event.frame must be a non-negative safe integer");
  if (!Number.isInteger(kind) || kind < 0) throw new Error("event.kind must be a non-negative integer");
  if (!Number.isInteger(id) || id < 0) throw new Error("event.id must be a non-negative integer");
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error("event a/b must be finite");
  return { frame, kind, id, a, b, sequence };
}

export function voiceParamEvents(params, frame) {
  if (!Array.isArray(params)) throw new Error("voiceParam.params must be an array");
  const absoluteFrame = Number(frame);
  if (!Number.isSafeInteger(absoluteFrame) || absoluteFrame < 0) {
    throw new Error("voiceParam.frame must be a non-negative safe integer");
  }
  return params.map((pair) => {
    if (!Array.isArray(pair) || pair.length !== 2) {
      throw new Error("each voiceParam parameter must be [id, value]");
    }
    const id = Number(pair[0]);
    const value = Number(pair[1]);
    if (!Number.isInteger(id) || id < 0 || !Number.isFinite(value)) {
      throw new Error("invalid voiceParam parameter");
    }
    return { frame: absoluteFrame, kind: VOICE_PARAM_KIND, id, a: value, b: 0 };
  });
}

export class AbsoluteEventRing {
  constructor(capacity = EVENT_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error("capacity must be a positive integer");
    this.capacity = capacity;
    this.slots = new Array(capacity);
    this.head = 0;
    this.length = 0;
    this.sequence = 0;
  }

  push(event) {
    if (this.length >= this.capacity) return false;
    const tail = (this.head + this.length) % this.capacity;
    this.slots[tail] = normalizeEvent(event, this.sequence++);
    this.length += 1;
    return true;
  }

  pushMany(events) {
    if (!Array.isArray(events)) throw new Error("events must be an array");
    if (events.length > this.capacity - this.length) return false;
    for (const event of events) this.push(event);
    return true;
  }

  clear() {
    this.slots.fill(undefined);
    this.head = 0;
    this.length = 0;
  }

  takeBlock(blockStart, frameCount) {
    if (!Number.isSafeInteger(blockStart) || blockStart < 0) throw new Error("blockStart must be non-negative");
    if (!Number.isInteger(frameCount) || frameCount < 1) throw new Error("frameCount must be positive");
    const blockEnd = blockStart + frameCount;
    const due = [];
    const originalLength = this.length;
    for (let i = 0; i < originalLength; i += 1) {
      const event = this.slots[this.head];
      this.slots[this.head] = undefined;
      this.head = (this.head + 1) % this.capacity;
      this.length -= 1;
      if (event.frame < blockEnd) {
        due.push({ ...event, offset: Math.max(0, event.frame - blockStart) });
      } else {
        const tail = (this.head + this.length) % this.capacity;
        this.slots[tail] = event;
        this.length += 1;
      }
    }
    due.sort((left, right) => {
      const frameOrder = left.offset - right.offset;
      if (frameOrder !== 0) return frameOrder;
      return left.sequence - right.sequence;
    });
    return due;
  }
}

const ProcessorBase = globalThis.AudioWorkletProcessor ?? class {
  constructor() {
    this.port = { postMessage() {}, onmessage: null };
  }
};

export class SynthEngineProcessor extends ProcessorBase {
  constructor(options = {}) {
    super();
    this.ring = new AbsoluteEventRing();
    this.renderFrame = 0;
    this.ready = false;
    this.failed = false;
    this.pendingMessages = [];
    this.pendingBatch = null;
    this.timings = [];
    this.processCount = 0;
    this.wasmByteLength = 0;
    this.port.onmessage = (message) => this.receive(message.data);
    this.initialize(options.processorOptions?.wasmBytes);
  }

  fail(error) {
    this.failed = true;
    const message = error instanceof Error ? error.message : String(error);
    this.port.postMessage({ type: "error", message });
  }

  async initialize(wasmBytes) {
    try {
      if (!(wasmBytes instanceof ArrayBuffer)) throw new Error("processorOptions.wasmBytes must be an ArrayBuffer");
      this.wasmByteLength = wasmBytes.byteLength;
      const started = nowMs();
      this.initializeStarted = started;
      const result = await WebAssembly.instantiate(wasmBytes, {});
      this.exports = result.instance.exports;
      this.memory = this.exports.memory;
      if (!(this.memory instanceof WebAssembly.Memory)) throw new Error("wasm export 'memory' is missing");

      const stateSize = Number(this.exports.synth_state_size());
      let base = align16(Number(this.exports.__heap_base.value));
      this.statePtr = base;
      this.eventPtr = this.statePtr + align16(stateSize);
      this.outLPtr = this.eventPtr + EVENT_CAPACITY * EVENT_BYTES;
      this.outRPtr = this.outLPtr + MAX_BLOCK * 4;
      this.sendLPtr = this.outRPtr + MAX_BLOCK * 4;
      this.sendRPtr = this.sendLPtr + MAX_BLOCK * 4;
      const requiredBytes = this.sendRPtr + MAX_BLOCK * 4;
      if (requiredBytes > this.memory.buffer.byteLength) {
        this.memory.grow(Math.ceil((requiredBytes - this.memory.buffer.byteLength) / 65536));
      }

      this.engine = this.exports.synth_create(this.statePtr, stateSize, globalThis.sampleRate, MAX_BLOCK);
      if (!this.engine) throw new Error("synth_create failed");
      this.ready = true;
      this.instantiateMs = nowMs() - started;

      const pending = this.pendingMessages;
      this.pendingMessages = [];
      for (const message of pending) this.applyMessage(message);
      if (this.pendingBatch) {
        const batch = this.pendingBatch;
        this.pendingBatch = null;
        this.applyBatch(batch);
      }
    } catch (error) {
      this.fail(error);
    }
  }

  receive(message) {
    if (this.failed) return;
    try {
      if (!message || typeof message.type !== "string") throw new Error("message.type is required");
      if (message.type === "batch") {
        if (this.pendingBatch || (this.ready && this.renderFrame !== 0)) throw new Error("batch is accepted only once before rendering starts");
        if (this.ready) this.applyBatch(message);
        else this.pendingBatch = message;
        return;
      }
      if (!this.ready) {
        this.pendingMessages.push(message);
        return;
      }
      this.applyMessage(message);
    } catch (error) {
      this.fail(error);
    }
  }

  applyPreset(params) {
    if (!Array.isArray(params)) throw new Error("preset.params must be an array");
    for (const pair of params) {
      if (!Array.isArray(pair) || pair.length !== 2) throw new Error("each preset parameter must be [id, value]");
      const id = Number(pair[0]);
      const value = Number(pair[1]);
      if (!Number.isInteger(id) || id < 0 || !Number.isFinite(value)) throw new Error("invalid preset parameter");
      const result = this.exports.synth_set_param(this.engine, id, value);
      if (result < 0) throw new Error(`synth_set_param failed for id ${id}: ${result}`);
    }
  }

  applyMessage(message) {
    switch (message.type) {
      case "preset":
        this.applyPreset(message.params);
        break;
      case "events":
        if (!this.ring.pushMany(message.events)) throw new Error(`event ring capacity exceeded (${EVENT_CAPACITY})`);
        break;
      case "voiceParam": {
        const frame = message.frame === undefined
          ? audioContextFrame(this.renderFrame)
          : message.frame;
        if (!this.ring.pushMany(voiceParamEvents(message.params, frame))) {
          throw new Error(`event ring capacity exceeded (${EVENT_CAPACITY})`);
        }
        break;
      }
      case "reset": {
        const kind = Number(message.kind);
        if (!Number.isInteger(kind) || (kind !== 0 && kind !== 1)) throw new Error("reset.kind must be 0 or 1");
        this.exports.synth_reset(this.engine, kind, BigInt(message.seed ?? 1));
        this.ring.clear();
        break;
      }
      default:
        throw new Error(`unsupported message type: ${message.type}`);
    }
  }

  applyBatch(message) {
    if (!Array.isArray(message.preset) || !Array.isArray(message.events)) throw new Error("batch requires preset and events arrays");
    this.exports.synth_reset(this.engine, 1, 1n);
    this.applyPreset(message.preset);
    this.exports.synth_reset(this.engine, 0, 1n);
    if (!this.ring.pushMany(message.events)) throw new Error(`event ring capacity exceeded (${EVENT_CAPACITY})`);
    this.port.postMessage({
      type: "ready",
      readyMs: nowMs() - this.initializeStarted,
      instantiateMs: this.instantiateMs,
      wasmBytes: this.wasmByteLength,
      engineVersion: Number(this.exports.synth_engine_version()),
    });
  }

  zero(outputs) {
    for (const output of outputs) {
      for (const channel of output) channel.fill(0);
    }
  }

  reportTiming(elapsed) {
    this.timings.push(elapsed);
    if (this.timings.length > 1000) this.timings.shift();
    this.processCount += 1;
    if (this.processCount % 100 !== 0) return;
    const ordered = [...this.timings].sort((a, b) => a - b);
    const averageMs = this.timings.reduce((sum, value) => sum + value, 0) / this.timings.length;
    const p99Index = Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.99) - 1);
    this.port.postMessage({ type: "performance", averageMs, p99Ms: ordered[p99Index], blocks: this.timings.length });
  }

  process(_inputs, outputs) {
    this.zero(outputs);
    const dryOutput = outputs[0];
    const sendOutput = outputs[1];
    const frameCount = dryOutput?.[0]?.length ?? 0;
    if (frameCount === 0 || this.failed) return true;
    const blockStart = audioContextFrame(this.renderFrame);
    if (!this.ready) {
      this.renderFrame = blockStart + frameCount;
      return true;
    }
    if (frameCount > MAX_BLOCK) {
      this.fail(new Error(`audio block ${frameCount} exceeds maxBlock ${MAX_BLOCK}`));
      return true;
    }

    const started = nowMs();
    try {
      const events = this.ring.takeBlock(blockStart, frameCount);
      const data = new DataView(this.memory.buffer);
      for (let i = 0; i < events.length; i += 1) {
        const event = events[i];
        const pointer = this.eventPtr + i * EVENT_BYTES;
        data.setUint32(pointer, event.offset, true);
        data.setUint32(pointer + 4, event.kind, true);
        data.setUint32(pointer + 8, event.id, true);
        data.setFloat32(pointer + 12, event.a, true);
        data.setFloat32(pointer + 16, event.b, true);
      }
      const result = this.exports.synth_process_send(
        this.engine,
        this.eventPtr,
        events.length,
        this.outLPtr,
        this.outRPtr,
        this.sendLPtr,
        this.sendRPtr,
        frameCount,
      );
      if (result < 0) throw new Error(`synth_process_send failed: ${result}`);
      dryOutput[0].set(new Float32Array(this.memory.buffer, this.outLPtr, frameCount));
      if (dryOutput[1]) dryOutput[1].set(new Float32Array(this.memory.buffer, this.outRPtr, frameCount));
      if (sendOutput?.[0]) sendOutput[0].set(new Float32Array(this.memory.buffer, this.sendLPtr, frameCount));
      if (sendOutput?.[1]) sendOutput[1].set(new Float32Array(this.memory.buffer, this.sendRPtr, frameCount));
      this.renderFrame = blockStart + frameCount;
      this.reportTiming(nowMs() - started);
    } catch (error) {
      this.zero(outputs);
      this.fail(error);
    }
    return true;
  }
}

if (typeof globalThis.registerProcessor === "function") {
  globalThis.registerProcessor("synth-engine", SynthEngineProcessor);
}
