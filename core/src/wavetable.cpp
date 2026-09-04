#include "wavetable.hpp"
#include "fast_math.hpp"

namespace synth {

namespace {

enum BuiltinShape { kSine = 0, kSaw = 1, kSquare = 2, kTriangle = 3 };

uint32_t harmonic_limit(uint32_t mip) { return 1024u >> mip; }

float builtin_sample(BuiltinShape shape, uint32_t index, uint32_t limit) {
    const double phase = static_cast<double>(index) / static_cast<double>(kTableSize);
    if (shape == kSine) return static_cast<float>(fast_sin(kTwoPi * phase));
    double sum = 0.0;
    if (shape == kSaw) {
        for (uint32_t h = 1; h <= limit; ++h) {
            sum += fast_sin(kTwoPi * phase * static_cast<double>(h)) / static_cast<double>(h);
        }
        return static_cast<float>(-2.0 * sum / kPi);
    }
    if (shape == kSquare) {
        for (uint32_t h = 1; h <= limit; h += 2) {
            sum += fast_sin(kTwoPi * phase * static_cast<double>(h)) / static_cast<double>(h);
        }
        return static_cast<float>(4.0 * sum / kPi);
    }
    double sign = 1.0;
    for (uint32_t h = 1; h <= limit; h += 2) {
        sum += sign * fast_sin(kTwoPi * phase * static_cast<double>(h)) /
               static_cast<double>(h * h);
        sign = -sign;
    }
    return static_cast<float>(8.0 * sum / (kPi * kPi));
}

}  // namespace

void initialize_builtin_wavetables(WavetableBank* bank) {
    for (uint32_t slot = 0; slot < kWavetableSlots; ++slot) {
        bank->frameCount[slot] = 1;
        for (uint32_t mip = 0; mip < kMipLevels; ++mip) {
            const uint32_t limit = harmonic_limit(mip);
            for (uint32_t i = 0; i < kTableSize; ++i) {
                bank->samples[slot][0][mip][i] =
                    builtin_sample(static_cast<BuiltinShape>(slot), i, limit);
            }
        }
    }
}

int load_wavetable(WavetableBank* bank, uint32_t slot, const float* frames, uint32_t frameCount) {
    if (bank == 0 || frames == 0 || slot >= kWavetableSlots || frameCount == 0 ||
        frameCount > kMaxWavetableFrames) return -1;
    double cosine[1025];
    double sine[1025];
    for (uint32_t frame = 0; frame < frameCount; ++frame) {
        const float* input = frames + frame * kTableSize;
        double dc = 0.0;
        for (uint32_t i = 0; i < kTableSize; ++i) dc += static_cast<double>(input[i]);
        dc /= static_cast<double>(kTableSize);
        for (uint32_t h = 1; h <= 1024; ++h) {
            double re = 0.0;
            double im = 0.0;
            for (uint32_t i = 0; i < kTableSize; ++i) {
                const double angle = kTwoPi * static_cast<double>(h * i) /
                                     static_cast<double>(kTableSize);
                re += static_cast<double>(input[i]) * fast_cos(angle);
                im += static_cast<double>(input[i]) * fast_sin(angle);
            }
            cosine[h] = 2.0 * re / static_cast<double>(kTableSize);
            sine[h] = 2.0 * im / static_cast<double>(kTableSize);
        }
        for (uint32_t mip = 0; mip < kMipLevels; ++mip) {
            const uint32_t limit = harmonic_limit(mip);
            for (uint32_t i = 0; i < kTableSize; ++i) {
                double output = dc;
                for (uint32_t h = 1; h <= limit; ++h) {
                    const double angle = kTwoPi * static_cast<double>(h * i) /
                                         static_cast<double>(kTableSize);
                    output += cosine[h] * fast_cos(angle) + sine[h] * fast_sin(angle);
                }
                bank->samples[slot][frame][mip][i] = static_cast<float>(output);
            }
        }
    }
    bank->frameCount[slot] = frameCount;
    return 0;
}

float read_wavetable(const WavetableBank* bank, uint32_t slot, float morph,
                     uint32_t mip, double phase) {
    if (slot >= kWavetableSlots) slot = 0;
    if (mip >= kMipLevels) mip = kMipLevels - 1;
    const uint32_t frames = bank->frameCount[slot];
    const float framePosition = clampf(morph, 0.0f, 1.0f) * static_cast<float>(frames - 1);
    const uint32_t frame0 = static_cast<uint32_t>(framePosition);
    const uint32_t frame1 = frame0 + 1 < frames ? frame0 + 1 : frame0;
    const float frameMix = framePosition - static_cast<float>(frame0);
    const double tablePosition = phase * static_cast<double>(kTableSize);
    const uint32_t integralPosition = static_cast<uint32_t>(tablePosition);
    const uint32_t index0 = integralPosition & (kTableSize - 1);
    const uint32_t index1 = (index0 + 1) & (kTableSize - 1);
    const float sampleMix = static_cast<float>(tablePosition - static_cast<double>(integralPosition));
    const float a0 = bank->samples[slot][frame0][mip][index0];
    const float a1 = bank->samples[slot][frame0][mip][index1];
    const float b0 = bank->samples[slot][frame1][mip][index0];
    const float b1 = bank->samples[slot][frame1][mip][index1];
    const float a = a0 + (a1 - a0) * sampleMix;
    const float b = b0 + (b1 - b0) * sampleMix;
    return a + (b - a) * frameMix;
}

uint32_t select_mip(double frequency, double sampleRate) {
    if (frequency <= 0.0 || sampleRate <= 0.0) return 0;
    const double allowed = (0.5 * sampleRate) / frequency;
    for (uint32_t mip = 0; mip < kMipLevels; ++mip) {
        if (static_cast<double>(harmonic_limit(mip)) <= allowed) return mip;
    }
    return kMipLevels - 1;
}

}  // namespace synth
