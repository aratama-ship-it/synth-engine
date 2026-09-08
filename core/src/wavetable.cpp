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

void profile_coefficients(uint32_t slot, uint32_t frame, uint32_t harmonic,
                          double* sine, double* cosine) {
    *sine = 0.0;
    *cosine = 0.0;
    const double h = static_cast<double>(harmonic);

    if (slot == 1u && frame == 1u) {
        // A rounded saw: the high harmonics fall faster than the legacy saw in frame 0.
        *sine = (-2.0 / (kPi * h)) * (10.0 / (10.0 + h));
        return;
    }
    if (slot == 1u && (frame == 2u || frame == 3u)) {
        // Zero-mean, phase-centred pulse waves. Narrowing the duty cycle produces the
        // recognisable PWM-like end of the Analog Sweep table.
        const double duty = frame == 2u ? 0.36 : 0.18;
        const double magnitude = 4.0 * fast_sin(kPi * h * duty) / (kPi * h);
        *cosine = (harmonic & 1u) == 0u ? magnitude : -magnitude;
        return;
    }

    if (slot == 2u && frame == 1u) {
        static constexpr double levels[] = {1.0, 0.62, 0.34, 0.19, 0.11, 0.06};
        if (harmonic <= sizeof(levels) / sizeof(levels[0]))
            *sine = levels[harmonic - 1u];
        return;
    }
    if (slot == 2u && frame == 2u) {
        const double band = harmonic <= 4u ? 1.0 : (harmonic <= 12u ? 0.70 : 0.24);
        const double sign = ((harmonic - 1u) / 2u) % 2u == 0u ? 1.0 : -1.0;
        *sine = sign * band / h;
        return;
    }
    if (slot == 2u && frame == 3u) {
        if ((harmonic & 1u) != 0u) {
            const double sign = ((harmonic - 1u) / 2u) % 2u == 0u ? 1.0 : -1.0;
            *sine = sign * 4.0 / (kPi * h);
        }
        return;
    }

    if (slot == 3u && frame == 1u) {
        static constexpr double levels[] = {1.0, 0.50, 0.25, 0.125, 0.06};
        if (harmonic <= sizeof(levels) / sizeof(levels[0]))
            *sine = levels[harmonic - 1u];
        return;
    }
    if (slot == 3u && frame == 2u) {
        if (harmonic == 1u) *sine = 1.0;
        else if (harmonic == 3u) *sine = 0.58;
        else if (harmonic == 5u) *sine = 0.26;
        else if (harmonic == 7u) *sine = -0.11;
        return;
    }
    if (slot == 3u && frame == 3u) {
        double weight = 0.0;
        if (harmonic == 1u) weight = 0.30;
        else if (harmonic == 2u) weight = 0.18;
        else if (harmonic <= 5u) weight = 1.0;
        else if (harmonic <= 8u) weight = 0.15;
        else if (harmonic <= 12u) weight = 0.70;
        *sine = weight / h;
    }
}

double frame_peak(const WavetableBank* bank, uint32_t slot, uint32_t frame) {
    double peak = 0.0;
    for (uint32_t i = 0; i < kTableSize; ++i) {
        const double value = absd(static_cast<double>(bank->samples[slot][frame][0][i]));
        if (value > peak) peak = value;
    }
    return peak;
}

void match_frame_peak(WavetableBank* bank, uint32_t slot, uint32_t frame,
                      double targetPeak) {
    const double peak = frame_peak(bank, slot, frame);
    if (peak <= 0.0) return;
    const float gain = static_cast<float>(targetPeak / peak);
    for (uint32_t mip = 0; mip < kMipLevels; ++mip)
        for (uint32_t i = 0; i < kTableSize; ++i)
            bank->samples[slot][frame][mip][i] *= gain;
}

}  // namespace

void initialize_builtin_wavetables(WavetableBank* bank) {
    static constexpr BuiltinShape firstShapes[kBuiltinWavetableSlots] = {
        kSine, kSaw, kSquare, kTriangle
    };
    static constexpr BuiltinShape basicShapes[kMaxWavetableFrames] = {
        kSine, kTriangle, kSaw, kSquare
    };
    for (uint32_t slot = 0; slot < kBuiltinWavetableSlots; ++slot) {
        bank->frameCount[slot] = kMaxWavetableFrames;
        const uint32_t legacyFrames = slot == 0u ? kMaxWavetableFrames : 1u;
        for (uint32_t frame = 0; frame < legacyFrames; ++frame)
            for (uint32_t mip = 0; mip < kMipLevels; ++mip) {
                const uint32_t limit = harmonic_limit(mip);
                for (uint32_t i = 0; i < kTableSize; ++i)
                    bank->samples[slot][frame][mip][i] = builtin_sample(
                        slot == 0u ? basicShapes[frame] : firstShapes[slot], i, limit);
            }
    }

    // The nine new frames share the same harmonic basis. Calculating sin/cos once per
    // sample and harmonic keeps synth creation much cheaper than generating each table
    // independently; no work is added to the real-time render path.
    for (uint32_t mip = 0; mip < kMipLevels; ++mip) {
        const uint32_t limit = harmonic_limit(mip);
        float* destinations[9];
        for (uint32_t slot = 1u; slot < kBuiltinWavetableSlots; ++slot)
            for (uint32_t frame = 1u; frame < kMaxWavetableFrames; ++frame) {
                const uint32_t profile = (slot - 1u) * 3u + (frame - 1u);
                destinations[profile] = bank->samples[slot][frame][mip];
                for (uint32_t i = 0; i < kTableSize; ++i) destinations[profile][i] = 0.0f;
            }
        for (uint32_t h = 1; h <= limit; ++h) {
            double sine[9]{};
            double cosine[9]{};
            for (uint32_t slot = 1u; slot < kBuiltinWavetableSlots; ++slot)
                for (uint32_t frame = 1u; frame < kMaxWavetableFrames; ++frame) {
                    const uint32_t profile = (slot - 1u) * 3u + (frame - 1u);
                    profile_coefficients(slot, frame, h,
                                         &sine[profile], &cosine[profile]);
                }
            for (uint32_t i = 0; i < kTableSize; ++i) {
                const double phase = static_cast<double>(i) /
                                     static_cast<double>(kTableSize);
                const double angle = kTwoPi * phase * static_cast<double>(h);
                const double sinAngle = fast_sin(angle);
                const double cosAngle = fast_cos(angle);
                for (uint32_t profile = 0; profile < 9u; ++profile)
                    destinations[profile][i] += static_cast<float>(
                        sine[profile] * sinAngle + cosine[profile] * cosAngle);
            }
        }
    }
    for (uint32_t slot = 1u; slot < kBuiltinWavetableSlots; ++slot) {
        const double targetPeak = frame_peak(bank, slot, 0u);
        for (uint32_t frame = 1u; frame < kMaxWavetableFrames; ++frame)
            match_frame_peak(bank, slot, frame, targetPeak);
    }

    // A safe deterministic fallback lives in the session-only custom slot until the
    // host explicitly replaces it. Copy every frame so the whole state is initialized,
    // while exposing one frame to readers until a custom table is loaded.
    for (uint32_t frame = 0; frame < kMaxWavetableFrames; ++frame)
        for (uint32_t mip = 0; mip < kMipLevels; ++mip)
            for (uint32_t i = 0; i < kTableSize; ++i)
                bank->samples[kCustomWavetableSlot][frame][mip][i] =
                    bank->samples[0][0][mip][i];
    bank->frameCount[kCustomWavetableSlot] = 1u;
}

int load_wavetable(WavetableBank* bank, uint32_t slot, const float* frames, uint32_t frameCount) {
    if (bank == 0 || frames == 0 || slot >= kWavetableSlots || frameCount == 0 ||
        frameCount > kMaxWavetableFrames) return -1;
    double frameDc[kMaxWavetableFrames]{};
    double framePeak[kMaxWavetableFrames]{};
    for (uint32_t frame = 0; frame < frameCount; ++frame) {
        const float* input = frames + frame * kTableSize;
        double dc = 0.0;
        for (uint32_t i = 0; i < kTableSize; ++i) {
            const double value = static_cast<double>(input[i]);
            // This comparison rejects NaN as well as infinities and unreasonable input.
            if (!(value >= -1000000.0 && value <= 1000000.0)) return -2;
            dc += value;
        }
        dc /= static_cast<double>(kTableSize);
        double peak = 0.0;
        for (uint32_t i = 0; i < kTableSize; ++i) {
            const double value = absd(static_cast<double>(input[i]) - dc);
            if (value > peak) peak = value;
        }
        if (peak <= 1.0e-8) return -3;
        frameDc[frame] = dc;
        framePeak[frame] = peak;
    }

    double cosine[1025];
    double sine[1025];
    for (uint32_t frame = 0; frame < frameCount; ++frame) {
        const float* input = frames + frame * kTableSize;
        const double gain = 0.95 / framePeak[frame];
        for (uint32_t h = 1; h <= 1024; ++h) {
            double re = 0.0;
            double im = 0.0;
            for (uint32_t i = 0; i < kTableSize; ++i) {
                const double angle = kTwoPi * static_cast<double>(h * i) /
                                     static_cast<double>(kTableSize);
                const double normalized =
                    (static_cast<double>(input[i]) - frameDc[frame]) * gain;
                re += normalized * fast_cos(angle);
                im += normalized * fast_sin(angle);
            }
            cosine[h] = 2.0 * re / static_cast<double>(kTableSize);
            sine[h] = 2.0 * im / static_cast<double>(kTableSize);
        }
        for (uint32_t mip = 0; mip < kMipLevels; ++mip) {
            const uint32_t limit = harmonic_limit(mip);
            for (uint32_t i = 0; i < kTableSize; ++i) {
                double output = 0.0;
                for (uint32_t h = 1; h <= limit; ++h) {
                    const double angle = kTwoPi * static_cast<double>(h * i) /
                                         static_cast<double>(kTableSize);
                    output += cosine[h] * fast_cos(angle) + sine[h] * fast_sin(angle);
                }
                bank->samples[slot][frame][mip][i] = static_cast<float>(output);
            }
        }

        double outputPeak = 0.0;
        for (uint32_t mip = 0; mip < kMipLevels; ++mip)
            for (uint32_t i = 0; i < kTableSize; ++i) {
                const double value = absd(static_cast<double>(
                    bank->samples[slot][frame][mip][i]));
                if (value > outputPeak) outputPeak = value;
            }
        if (outputPeak > 0.95) {
            const float outputGain = static_cast<float>(0.95 / outputPeak);
            for (uint32_t mip = 0; mip < kMipLevels; ++mip)
                for (uint32_t i = 0; i < kTableSize; ++i)
                    bank->samples[slot][frame][mip][i] *= outputGain;
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

float read_wavetable_bandlimited(const WavetableBank* bank, uint32_t slot, float morph,
                                 double frequency, double sampleRate, double phase) {
    const uint32_t primaryMip = select_mip(frequency, sampleRate);
    const float primary = read_wavetable(bank, slot, morph, primaryMip, phase);
    if (frequency <= 0.0 || sampleRate <= 0.0 || primaryMip + 1u >= kMipLevels)
        return primary;

    const double allowed = (0.5 * sampleRate) / frequency;
    const double boundary = static_cast<double>(harmonic_limit(primaryMip));
    // Fade across the first semitone after the richer mip becomes alias-safe.
    // Below the boundary only the more restrictive mip is used; the richer table
    // is never read early, so the existing Nyquist guarantee is preserved.
    constexpr double kSemitoneRatio = 1.0594630943592952646;
    double progress = (allowed / boundary - 1.0) / (kSemitoneRatio - 1.0);
    if (progress >= 1.0) return primary;
    if (progress < 0.0) progress = 0.0;
    const float mix = static_cast<float>(progress * progress * (3.0 - 2.0 * progress));
    const float restrictive = read_wavetable(
        bank, slot, morph, primaryMip + 1u, phase);
    return restrictive + (primary - restrictive) * mix;
}

}  // namespace synth
