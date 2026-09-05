import test from "node:test";
import assert from "node:assert/strict";
import { importSource } from "./load-module.mjs";

const { getParams } = await importSource("../synth-node.js");

function fakeParameterExports() {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const bytes = new Uint8Array(memory.buffer);
  const data = new DataView(memory.buffer);
  const encoder = new TextEncoder();
  let stringPointer = 64;
  const strings = new Map();
  const pointerFor = (text) => {
    if (strings.has(text)) return strings.get(text);
    const encoded = encoder.encode(`${text}\0`);
    const pointer = stringPointer;
    bytes.set(encoded, pointer);
    stringPointer += encoded.length;
    strings.set(text, pointer);
    return pointer;
  };
  const definitions = Array.from({ length: 53 }, (_, id) => ({
    id,
    identifier: `parameter${id}`,
    displayName: `Parameter ${id}`,
    min: id === 0 ? -1 : 0,
    max: id + 1,
    default: 0,
    flags: id === 0 ? 128 : 0,
  }));
  return {
    memory,
    __heap_base: new WebAssembly.Global({ value: "i32", mutable: false }, 4096),
    synth_param_count: () => definitions.length,
    synth_param_info: (id, pointer) => {
      const parameter = definitions[id];
      if (!parameter) return -1;
      data.setUint32(pointer, parameter.id, true);
      data.setUint32(pointer + 4, pointerFor(parameter.identifier), true);
      data.setUint32(pointer + 8, pointerFor(parameter.displayName), true);
      data.setFloat32(pointer + 12, parameter.min, true);
      data.setFloat32(pointer + 16, parameter.max, true);
      data.setFloat32(pointer + 20, parameter.default, true);
      data.setUint32(pointer + 24, parameter.flags, true);
      return 0;
    },
  };
}

test("getParams returns 53 metadata items with unique identifiers", async () => {
  const instantiate = WebAssembly.instantiate;
  WebAssembly.instantiate = async () => ({ instance: { exports: fakeParameterExports() } });
  try {
    const params = await getParams(new ArrayBuffer(0));
    assert.equal(params.length, 53);
    assert.equal(new Set(params.map(({ identifier }) => identifier)).size, 53);
    assert.deepEqual(params[0], {
      id: 0,
      identifier: "parameter0",
      displayName: "Parameter 0",
      min: -1,
      max: 1,
      default: 0,
      flags: 128,
    });
  } finally {
    WebAssembly.instantiate = instantiate;
  }
});
