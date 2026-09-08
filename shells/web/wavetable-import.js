export const WAVETABLE_SIZE = 2048;
export const MAX_WAVETABLE_FRAMES = 4;
export const MAX_WAV_BYTES = 2 * 1024 * 1024;

function readFourCC(view, offset) {
  if (offset < 0 || offset + 4 > view.byteLength) throw new Error("WAVヘッダーが途中で切れています");
  return String.fromCharCode(
    view.getUint8(offset), view.getUint8(offset + 1),
    view.getUint8(offset + 2), view.getUint8(offset + 3),
  );
}

function readPcmSample(view, offset, audioFormat, bitsPerSample) {
  if (audioFormat === 3 && bitsPerSample === 32) return view.getFloat32(offset, true);
  if (bitsPerSample === 16) return view.getInt16(offset, true) / 32768;
  if (bitsPerSample === 24) {
    let value = view.getUint8(offset) |
      (view.getUint8(offset + 1) << 8) |
      (view.getUint8(offset + 2) << 16);
    if (value & 0x800000) value |= 0xff000000;
    return value / 8388608;
  }
  if (bitsPerSample === 32) return view.getInt32(offset, true) / 2147483648;
  throw new Error(`未対応の量子化ビット数です: ${bitsPerSample} bit`);
}

function normalizeFrame(source, destination, destinationOffset) {
  let dc = 0;
  for (let index = 0; index < WAVETABLE_SIZE; index += 1) {
    const value = source[index];
    if (!Number.isFinite(value)) throw new Error("WAVに非有限値が含まれています");
    dc += value;
  }
  dc /= WAVETABLE_SIZE;
  let peak = 0;
  for (let index = 0; index < WAVETABLE_SIZE; index += 1) {
    peak = Math.max(peak, Math.abs(source[index] - dc));
  }
  if (peak <= 1e-8) throw new Error("無音または一定値だけのフレームは読み込めません");
  const gain = 0.95 / peak;
  for (let index = 0; index < WAVETABLE_SIZE; index += 1) {
    destination[destinationOffset + index] = (source[index] - dc) * gain;
  }
}

export function parseWavetableWav(buffer) {
  if (!(buffer instanceof ArrayBuffer)) throw new TypeError("WAVデータはArrayBufferで指定してください");
  if (buffer.byteLength > MAX_WAV_BYTES) throw new Error("WAVは2 MiB以下にしてください");
  if (buffer.byteLength < 44) throw new Error("WAVファイルが短すぎます");
  const view = new DataView(buffer);
  if (readFourCC(view, 0) !== "RIFF" || readFourCC(view, 8) !== "WAVE") {
    throw new Error("RIFF/WAVE形式ではありません");
  }

  let format;
  let dataOffset = -1;
  let dataBytes = 0;
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = readFourCC(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (body + size > view.byteLength) throw new Error(`WAVの${id}チャンクが途中で切れています`);
    if (id === "fmt ") {
      if (size < 16) throw new Error("WAVのfmtチャンクが短すぎます");
      format = {
        audioFormat: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        blockAlign: view.getUint16(body + 12, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (id === "data" && dataOffset < 0) {
      dataOffset = body;
      dataBytes = size;
    }
    offset = body + size + (size & 1);
  }
  if (!format || dataOffset < 0) throw new Error("WAVにfmtまたはdataチャンクがありません");
  const { audioFormat, channels, sampleRate, blockAlign, bitsPerSample } = format;
  if (!((audioFormat === 1 && [16, 24, 32].includes(bitsPerSample)) ||
        (audioFormat === 3 && bitsPerSample === 32))) {
    throw new Error("PCM 16/24/32-bitまたはfloat 32-bitのWAVだけ読み込めます");
  }
  if (channels !== 1 && channels !== 2) throw new Error("monoまたはstereoのWAVだけ読み込めます");
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 384000) {
    throw new Error("WAVのサンプルレートが範囲外です");
  }
  const bytesPerSample = bitsPerSample / 8;
  if (blockAlign !== channels * bytesPerSample || dataBytes % blockAlign !== 0) {
    throw new Error("WAVのサンプル配置が不正です");
  }
  const sampleFrames = dataBytes / blockAlign;
  if (sampleFrames % WAVETABLE_SIZE !== 0) {
    throw new Error("長さは2048サンプルの整数倍にしてください");
  }
  const frameCount = sampleFrames / WAVETABLE_SIZE;
  if (frameCount < 1 || frameCount > MAX_WAVETABLE_FRAMES) {
    throw new Error("1〜4フレーム（2048〜8192サンプル）だけ読み込めます");
  }

  const frames = new Float32Array(sampleFrames);
  const source = new Float64Array(WAVETABLE_SIZE);
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let index = 0; index < WAVETABLE_SIZE; index += 1) {
      const sampleIndex = frame * WAVETABLE_SIZE + index;
      let sum = 0;
      for (let channel = 0; channel < channels; channel += 1) {
        const sampleOffset = dataOffset + sampleIndex * blockAlign + channel * bytesPerSample;
        sum += readPcmSample(view, sampleOffset, audioFormat, bitsPerSample);
      }
      source[index] = sum / channels;
    }
    normalizeFrame(source, frames, frame * WAVETABLE_SIZE);
  }
  return { frames, frameCount, sampleRate, channels, bitsPerSample };
}
