const TWO_PI = Math.PI * 2;

function normalize(b0, b1, b2, a0, a1, a2) {
  return { b0:b0 / a0, b1:b1 / a0, b2:b2 / a0, a1:a1 / a0, a2:a2 / a0 };
}

export function designEqBand(type, gainDb, frequencyValue, q = .75, sampleRate = 48000) {
  if (!Number.isFinite(gainDb) || !Number.isFinite(frequencyValue) || !Number.isFinite(q) || !Number.isFinite(sampleRate) || sampleRate <= 0) throw new TypeError("EQ values must be finite and sample rate must be positive");
  if (Math.abs(gainDb) < 1e-7) return { b0:1, b1:0, b2:0, a1:0, a2:0 };
  const frequency = Math.min(sampleRate * .45, Math.max(1, frequencyValue));
  const omega = TWO_PI * frequency / sampleRate;
  const cosine = Math.cos(omega);
  const sine = Math.sin(omega);
  const a = 2 ** (gainDb / 12.041199826559248);
  if (type === "mid") {
    const alpha = sine / (2 * Math.max(.0001, q));
    return normalize(1 + alpha * a, -2 * cosine, 1 - alpha * a, 1 + alpha / a, -2 * cosine, 1 - alpha / a);
  }
  const alpha = sine / Math.SQRT2;
  const squareRootA = 2 ** (gainDb / 24.082399653118496);
  const beta = 2 * squareRootA * alpha;
  const plus = a + 1;
  const minus = a - 1;
  if (type === "low") return normalize(
    a * (plus - minus * cosine + beta),
    2 * a * (minus - plus * cosine),
    a * (plus - minus * cosine - beta),
    plus + minus * cosine + beta,
    -2 * (minus + plus * cosine),
    plus + minus * cosine - beta,
  );
  if (type === "high") return normalize(
    a * (plus + minus * cosine + beta),
    -2 * a * (minus + plus * cosine),
    a * (plus + minus * cosine - beta),
    plus - minus * cosine + beta,
    2 * (minus - plus * cosine),
    plus - minus * cosine - beta,
  );
  throw new RangeError(`unknown EQ band: ${type}`);
}

function bandMagnitudeSquared(coefficients, frequency, sampleRate) {
  const omega = TWO_PI * frequency / sampleRate;
  const cosine1 = Math.cos(omega);
  const sine1 = Math.sin(omega);
  const cosine2 = Math.cos(omega * 2);
  const sine2 = Math.sin(omega * 2);
  const numeratorReal = coefficients.b0 + coefficients.b1 * cosine1 + coefficients.b2 * cosine2;
  const numeratorImaginary = -coefficients.b1 * sine1 - coefficients.b2 * sine2;
  const denominatorReal = 1 + coefficients.a1 * cosine1 + coefficients.a2 * cosine2;
  const denominatorImaginary = -coefficients.a1 * sine1 - coefficients.a2 * sine2;
  return (numeratorReal ** 2 + numeratorImaginary ** 2) /
    Math.max(1e-30, denominatorReal ** 2 + denominatorImaginary ** 2);
}

export function eqResponseDb(values, frequency, sampleRate = 48000) {
  const bands = [
    designEqBand("low", values.low, values.lowFrequency, values.midQ, sampleRate),
    designEqBand("mid", values.mid, values.midFrequency, values.midQ, sampleRate),
    designEqBand("high", values.high, values.highFrequency, values.midQ, sampleRate),
  ];
  const magnitudeSquared = bands.reduce((product, band) => product * bandMagnitudeSquared(band, frequency, sampleRate), 1);
  return 10 * Math.log10(Math.max(1e-30, magnitudeSquared));
}

export function eqResponsePoints(values, { count = 160, width = 480, height = 144, padding = 12, sampleRate = 48000 } = {}) {
  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;
  return Array.from({ length:count }, (_, index) => {
    const position = count <= 1 ? 0 : index / (count - 1);
    const frequency = 20 * (1000 ** position);
    const decibels = Math.max(-24, Math.min(24, eqResponseDb(values, frequency, sampleRate)));
    return { frequency, decibels, x:padding + position * innerWidth, y:padding + (24 - decibels) / 48 * innerHeight };
  });
}

export function eqResponsePath(values, options) {
  return eqResponsePoints(values, options).map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
}
