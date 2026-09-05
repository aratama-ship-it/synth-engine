#include "synth_engine.h"
#include "engine.hpp"
#include "fast_math.hpp"
#include "rng.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <limits>
#include <sstream>
#include <string>
#include <vector>

struct TimedEvent {
    uint64_t frame;
    uint32_t kind;
    uint32_t id;
    float a;
    float b;
};

struct Parameters {
    uint32_t id;
    float value;
};

static std::vector<float> render(uint32_t sampleRate, uint32_t block, uint64_t frameCount,
                                 const std::vector<TimedEvent>& events,
                                 const std::vector<Parameters>& parameters) {
    std::vector<unsigned char> state(synth_state_size());
    SynthEngine* engine = synth_create(state.data(), state.size(), sampleRate, block);
    if (engine == nullptr) return {};
    for (const Parameters& parameter : parameters) {
        if (synth_set_param(engine, parameter.id, parameter.value) != 0) return {};
    }
    std::vector<float> output(frameCount);
    std::vector<float> right(frameCount);
    std::vector<SynthEvent> blockEvents;
    uint64_t position = 0;
    while (position < frameCount) {
        const uint32_t count = static_cast<uint32_t>(
            std::min<uint64_t>(block, frameCount - position));
        blockEvents.clear();
        for (const TimedEvent& event : events) {
            if (event.frame >= position && event.frame < position + count) {
                blockEvents.push_back(SynthEvent{
                    static_cast<uint32_t>(event.frame - position), event.kind, event.id,
                    event.a, event.b
                });
            }
        }
        const int result = synth_process(engine,
            blockEvents.empty() ? nullptr : blockEvents.data(),
            static_cast<uint32_t>(blockEvents.size()), output.data() + position,
            right.data() + position, count);
        if (result != 0) return {};
        position += count;
    }
    return output;
}

struct StereoRender {
    std::vector<float> left;
    std::vector<float> right;
};

static StereoRender render_stereo(uint32_t sampleRate, uint32_t block, uint64_t frameCount,
                                  const std::vector<TimedEvent>& events,
                                  const std::vector<Parameters>& parameters,
                                  uint64_t seed, bool resetVoices = true) {
    std::vector<unsigned char> state(synth_state_size());
    SynthEngine* engine = synth_create(state.data(), state.size(), sampleRate, block);
    if (engine == nullptr) return {};
    for (const Parameters& parameter : parameters) {
        if (synth_set_param(engine, parameter.id, parameter.value) != 0) return {};
    }
    if (resetVoices) synth_reset(engine, SYNTH_RESET_VOICES, seed);
    StereoRender output{std::vector<float>(frameCount), std::vector<float>(frameCount)};
    std::vector<SynthEvent> blockEvents;
    uint64_t position = 0;
    while (position < frameCount) {
        const uint32_t count = static_cast<uint32_t>(
            std::min<uint64_t>(block, frameCount - position));
        blockEvents.clear();
        for (const TimedEvent& event : events) {
            if (event.frame >= position && event.frame < position + count) {
                blockEvents.push_back(SynthEvent{
                    static_cast<uint32_t>(event.frame - position), event.kind, event.id,
                    event.a, event.b
                });
            }
        }
        const int result = synth_process(engine,
            blockEvents.empty() ? nullptr : blockEvents.data(),
            static_cast<uint32_t>(blockEvents.size()), output.left.data() + position,
            output.right.data() + position, count);
        if (result != 0) return {};
        position += count;
    }
    return output;
}

static size_t bit_mismatches(const std::vector<float>& a, const std::vector<float>& b) {
    if (a.size() != b.size()) return std::max(a.size(), b.size());
    size_t mismatches = 0;
    for (size_t i = 0; i < a.size(); ++i) {
        if (std::memcmp(&a[i], &b[i], sizeof(float)) != 0) ++mismatches;
    }
    return mismatches;
}

static bool test_block_invariance() {
    const std::vector<TimedEvent> events = {
        {13, SYNTH_EV_NOTE_ON, 1, 60.0f, 0.8f},
        {97, SYNTH_EV_NOTE_ON, 2, 67.0f, 0.6f},
        {511, SYNTH_EV_PARAM, 7, 0.17f, 0.0f},
        {777, SYNTH_EV_NOTE_OFF, 1, 0.0f, 0.0f},
        {1200, SYNTH_EV_NOTE_OFF, 2, 0.0f, 0.0f}
    };
    const std::vector<Parameters> params = {{0, 1.0f}};
    const uint32_t blocks[] = {1, 7, 64, 128, 511};
    const std::vector<float> reference = render(48000, blocks[0], 4096, events, params);
    size_t mismatches = 0;
    for (size_t i = 1; i < sizeof(blocks) / sizeof(blocks[0]); ++i)
        mismatches += bit_mismatches(reference, render(48000, blocks[i], 4096, events, params));
    const bool ok = !reference.empty() && mismatches == 0;
    std::printf("%s 1 block invariance: blocks=1,7,64,128,511 bit_mismatches=%zu\n",
                ok ? "PASS" : "FAIL", mismatches);
    return ok;
}

static bool load_stress_fixture(std::vector<SynthEvent>& events) {
    std::ifstream input("fixtures/m0_events_1000.txt");
    std::string line;
    while (std::getline(input, line)) {
        const size_t comment = line.find('#');
        if (comment != std::string::npos) line.resize(comment);
        std::istringstream stream(line);
        SynthEvent event{};
        uint64_t frame = 0;
        if (!(stream >> frame)) continue;
        if (!(stream >> event.kind >> event.id >> event.a >> event.b) || frame > 999) return false;
        event.offset = static_cast<uint32_t>(frame);
        events.push_back(event);
    }
    return input.eof();
}

static bool test_event_ordering() {
    const std::vector<Parameters> params = {{0, 1.0f}, {3, 0.0f}};
    const std::vector<TimedEvent> orderA = {
        {10, SYNTH_EV_NOTE_ON, 7, 64.0f, 1.0f},
        {10, SYNTH_EV_NOTE_OFF, 7, 0.0f, 0.0f}
    };
    const std::vector<TimedEvent> orderB = {
        {10, SYNTH_EV_NOTE_OFF, 7, 0.0f, 0.0f},
        {10, SYNTH_EV_NOTE_ON, 7, 64.0f, 1.0f}
    };
    const size_t mismatches = bit_mismatches(render(48000, 64, 256, orderA, params),
                                             render(48000, 64, 256, orderB, params));
    std::vector<SynthEvent> fixture;
    const bool loaded = load_stress_fixture(fixture);
    std::vector<unsigned char> state(synth_state_size());
    SynthEngine* engine = synth_create(state.data(), state.size(), 48000.0, 1000);
    std::vector<float> left(1000);
    std::vector<float> right(1000);
    const int ignored = engine == nullptr ? -1 :
        synth_process(engine, fixture.data(), static_cast<uint32_t>(fixture.size()),
                      left.data(), right.data(), 1000);
    const SynthEvent outside{1, SYNTH_EV_NOTE_ON, 9999, 60.0f, 1.0f};
    float outsideLeft = 0.0f;
    float outsideRight = 0.0f;
    const int outsideIgnored = engine == nullptr ? -1 :
        synth_process(engine, &outside, 1, &outsideLeft, &outsideRight, 1);
    const bool ok = loaded && fixture.size() == 1000 && mismatches == 0 &&
                    ignored == 0 && outsideIgnored == 1;
    std::printf("%s 2 event ordering: bit_mismatches=%zu fixture_events=%zu missing=%d out_of_range_ignored=%d\n",
                ok ? "PASS" : "FAIL", mismatches, fixture.size(), ignored, outsideIgnored);
    return ok;
}

static bool test_note_position() {
    const std::vector<TimedEvent> events = {{17, SYNTH_EV_NOTE_ON, 1, 69.0f, 1.0f}};
    const std::vector<Parameters> params = {{0, 1.0f}, {3, 0.0f}};
    const std::vector<float> output = render(48000, 64, 64, events, params);
    size_t first = output.size();
    for (size_t i = 0; i < output.size(); ++i) {
        if (output[i] != 0.0f) {
            first = i;
            break;
        }
    }
    const bool ok = first == 17;
    std::printf("%s 3 note position: expected=17 first_nonzero=%zu pre_nonzero=0\n",
                ok ? "PASS" : "FAIL", first);
    return ok;
}

static bool test_finite_output() {
    const uint32_t rates[] = {96000, 44100, 48000};
    const uint32_t blocks[] = {1, 7, 64, 128, 511};
    uint64_t nanInf = 0;
    uint64_t denormal = 0;
    uint32_t renders = 0;
    for (uint32_t rate : rates) {
        for (uint32_t block : blocks) {
            const std::vector<TimedEvent> events = {
                {0, SYNTH_EV_NOTE_ON, 1, 48.0f, 1.0f},
                {2048, SYNTH_EV_NOTE_OFF, 1, 0.0f, 0.0f}
            };
            const std::vector<float> output = render(rate, block, 8192, events, {{0, 2.0f}});
            if (output.size() != 8192) {
                ++nanInf;
                continue;
            }
            for (float sample : output) {
                if (!std::isfinite(sample)) ++nanInf;
                if (std::fpclassify(sample) == FP_SUBNORMAL) ++denormal;
            }
            ++renders;
        }
    }
    const bool ok = nanInf == 0 && denormal == 0 && renders == 15;
    std::printf("%s 4 finite output: renders=%u nan_inf=%llu denormal=%llu\n",
                ok ? "PASS" : "FAIL", renders,
                static_cast<unsigned long long>(nanInf),
                static_cast<unsigned long long>(denormal));
    return ok;
}

static bool has_note(const SynthEngine* engine, uint32_t noteId) {
    for (uint32_t i = 0; i < synth::kVoiceCapacity; ++i)
        if (engine->voices[i].active != 0 && engine->voices[i].noteId == noteId) return true;
    return false;
}

static bool test_polyphony() {
    std::vector<unsigned char> state(synth_state_size());
    SynthEngine* engine = synth_create(state.data(), state.size(), 48000.0, 1);
    SynthEvent events[20]{};
    for (uint32_t i = 0; i < 20; ++i)
        events[i] = SynthEvent{0, SYNTH_EV_NOTE_ON, i, 48.0f + static_cast<float>(i), 0.5f};
    float left = 0.0f;
    float right = 0.0f;
    const int result = synth_process(engine, events, 20, &left, &right, 1);
    uint32_t active = 0;
    for (uint32_t i = 0; i < synth::kVoiceCapacity; ++i) active += engine->voices[i].active != 0;
    bool expectedSet = true;
    for (uint32_t id = 0; id < 4; ++id) expectedSet = expectedSet && !has_note(engine, id);
    for (uint32_t id = 4; id < 20; ++id) expectedSet = expectedSet && has_note(engine, id);

    synth_reset(engine, SYNTH_RESET_VOICES, 0);
    SynthEvent fill[16]{};
    for (uint32_t i = 0; i < 16; ++i)
        fill[i] = SynthEvent{0, SYNTH_EV_NOTE_ON, i, 60.0f, 0.5f};
    (void)synth_process(engine, fill, 16, &left, &right, 1);
    SynthEvent release2{0, SYNTH_EV_NOTE_OFF, 2, 0.0f, 0.0f};
    (void)synth_process(engine, &release2, 1, &left, &right, 1);
    SynthEvent release3{0, SYNTH_EV_NOTE_OFF, 3, 0.0f, 0.0f};
    (void)synth_process(engine, &release3, 1, &left, &right, 1);
    SynthEvent replacement{0, SYNTH_EV_NOTE_ON, 100, 72.0f, 0.5f};
    (void)synth_process(engine, &replacement, 1, &left, &right, 1);
    const bool releaseOldest = !has_note(engine, 2) && has_note(engine, 3) && has_note(engine, 100);
    const bool ok = result == 0 && active == 16 && expectedSet && releaseOldest;
    std::printf("%s 5 polyphony: requested=20 active=%u oldest_stolen=4 release_oldest=%s\n",
                ok ? "PASS" : "FAIL", active, releaseOldest ? "yes" : "no");
    return ok;
}

static bool test_determinism() {
    std::vector<unsigned char> state(synth_state_size());
    SynthEngine* engine = synth_create(state.data(), state.size(), 48000.0, 256);
    (void)synth_set_param(engine, 0, 3.0f);
    const SynthEvent on{0, SYNTH_EV_NOTE_ON, 77, 57.25f, 0.7f};
    std::vector<float> first(256);
    std::vector<float> firstR(256);
    synth_reset(engine, SYNTH_RESET_VOICES, 0x12345678u);
    const int resultA = synth_process(engine, &on, 1, first.data(), firstR.data(), 256);
    std::vector<float> second(256);
    std::vector<float> secondR(256);
    synth_reset(engine, SYNTH_RESET_VOICES, 0x12345678u);
    const int resultB = synth_process(engine, &on, 1, second.data(), secondR.data(), 256);
    const size_t mismatches = bit_mismatches(first, second);
    const uint32_t hashA = synth::hash32(0x12345678u, 77, 3, 1);
    const uint32_t hashB = synth::hash32(0x12345678u, 77, 3, 1);
    const bool unitRange = synth::hash_to_unit(hashA) >= 0.0f && synth::hash_to_unit(hashA) < 1.0f;
    const bool ok = resultA == 0 && resultB == 0 && mismatches == 0 &&
                    hashA == hashB && unitRange;
    std::printf("%s 6 determinism: bit_mismatches=%zu hash=0x%08x unit=%.9f\n",
                ok ? "PASS" : "FAIL", mismatches, hashA, synth::hash_to_unit(hashA));
    return ok;
}

static bool test_fast_math() {
    double maxSinError = 0.0;
    double maxCosError = 0.0;
    double maxExpRelative = 0.0;
    double maxTanRelative = 0.0;
    constexpr uint32_t samples = 100000;
    for (uint32_t i = 0; i <= samples; ++i) {
        const double ratio = static_cast<double>(i) / static_cast<double>(samples);
        const double angle = ratio * synth::kTwoPi;
        maxSinError = std::max(maxSinError, std::fabs(synth::fast_sin(angle) - std::sin(angle)));
        maxCosError = std::max(maxCosError, std::fabs(synth::fast_cos(angle) - std::cos(angle)));
        const double exponent = -14.0 + 28.0 * ratio;
        const double expected = std::exp2(exponent);
        maxExpRelative = std::max(maxExpRelative,
            std::fabs(synth::exp2_fast(exponent) - expected) / expected);
        const double normalized = 0.000001 + 0.449998 * ratio;
        const double expectedTan = std::tan(synth::kPi * normalized);
        maxTanRelative = std::max(maxTanRelative,
            std::fabs(synth::tan_pi_normalized(normalized) - expectedTan) / expectedTan);
    }
    const bool ok = maxSinError <= 1.0e-4 && maxCosError <= 1.0e-4 &&
                    maxExpRelative <= 1.0e-5 && maxTanRelative <= 1.0e-5;
    std::printf("%s 7 fast_math: sin_max=%.9g cos_max=%.9g exp2_rel_max=%.9g tan_rel_max=%.9g\n",
        ok ? "PASS" : "FAIL", maxSinError, maxCosError, maxExpRelative, maxTanRelative);
    return ok;
}

struct Complex {
    double real;
    double imag;
};

static void fft_in_place(Complex* values, uint32_t count) {
    for (uint32_t i = 1, j = 0; i < count; ++i) {
        uint32_t bit = count >> 1;
        while ((j & bit) != 0) {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if (i < j) std::swap(values[i], values[j]);
    }
    for (uint32_t length = 2; length <= count; length <<= 1) {
        const double angle = -2.0 * synth::kPi / static_cast<double>(length);
        const Complex step{std::cos(angle), std::sin(angle)};
        for (uint32_t base = 0; base < count; base += length) {
            Complex twiddle{1.0, 0.0};
            for (uint32_t offset = 0; offset < length / 2; ++offset) {
                const Complex even = values[base + offset];
                const Complex odd{
                    values[base + offset + length / 2].real * twiddle.real -
                        values[base + offset + length / 2].imag * twiddle.imag,
                    values[base + offset + length / 2].real * twiddle.imag +
                        values[base + offset + length / 2].imag * twiddle.real
                };
                values[base + offset] = {even.real + odd.real, even.imag + odd.imag};
                values[base + offset + length / 2] =
                    {even.real - odd.real, even.imag - odd.imag};
                twiddle = {
                    twiddle.real * step.real - twiddle.imag * step.imag,
                    twiddle.real * step.imag + twiddle.imag * step.real
                };
            }
        }
    }
}

static void fft_2048(Complex* values) { fft_in_place(values, 2048); }

static bool near_expected_harmonic(uint32_t bin, double fundamentalBin, uint32_t harmonics) {
    for (uint32_t harmonic = 1; harmonic <= harmonics; ++harmonic) {
        const double center = fundamentalBin * static_cast<double>(harmonic);
        if (std::fabs(static_cast<double>(bin) - center) <= 10.0) return true;
    }
    return false;
}

static bool test_aliasing() {
    constexpr uint32_t sampleRate = 48000;
    constexpr uint32_t fftSize = 2048;
    const double frequency = 440.0 * std::exp2((108.0 - 69.0) / 12.0);
    const std::vector<float> output = render(sampleRate, 128, sampleRate,
        {{0, SYNTH_EV_NOTE_ON, 1, 108.0f, 1.0f}},
        {{0, 1.0f}, {2, 1.0f}, {3, 0.0f}, {4, 0.0f}, {5, 1.0f}, {7, 1.0f}});
    Complex spectrum[fftSize]{};
    constexpr uint32_t start = 24000;
    for (uint32_t i = 0; i < fftSize; ++i) {
        const double phase = 2.0 * synth::kPi * static_cast<double>(i) /
                             static_cast<double>(fftSize - 1);
        const double window = 0.35875 - 0.48829 * std::cos(phase) +
                              0.14128 * std::cos(2.0 * phase) -
                              0.01168 * std::cos(3.0 * phase);
        spectrum[i] = {static_cast<double>(output[start + i]) * window, 0.0};
    }
    fft_2048(spectrum);
    const double fundamentalBin = frequency * static_cast<double>(fftSize) /
                                  static_cast<double>(sampleRate);
    const uint32_t harmonics = 4;
    double fundamentalPower = 0.0;
    double aliasPower = 0.0;
    for (uint32_t bin = 1; bin < fftSize / 2; ++bin) {
        const double power = spectrum[bin].real * spectrum[bin].real +
                             spectrum[bin].imag * spectrum[bin].imag;
        if (std::fabs(static_cast<double>(bin) - fundamentalBin) <= 10.0)
            fundamentalPower += power;
        else if (static_cast<double>(bin) > fundamentalBin &&
                 !near_expected_harmonic(bin, fundamentalBin, harmonics))
            aliasPower += power;
    }
    const double ratioDb = 10.0 * std::log10(aliasPower / fundamentalPower);
    const bool ok = output.size() == sampleRate && std::isfinite(ratioDb) && ratioDb <= -60.0;
    std::printf("%s 8 aliasing: midi=108 fft=2048 alias_ratio_db=%.6f threshold_db=-60.000000\n",
                ok ? "PASS" : "FAIL", ratioDb);
    return ok;
}

static double stereo_rms(const StereoRender& output, size_t start, size_t count) {
    if (output.left.size() < start + count || output.right.size() < start + count || count == 0)
        return 0.0;
    double sum = 0.0;
    for (size_t i = start; i < start + count; ++i) {
        sum += static_cast<double>(output.left[i]) * static_cast<double>(output.left[i]);
        sum += static_cast<double>(output.right[i]) * static_cast<double>(output.right[i]);
    }
    return std::sqrt(sum / static_cast<double>(count * 2));
}

static std::vector<double> spectrum_power(const std::vector<float>& input, uint32_t start,
                                          uint32_t fftSize, bool blackmanHarris) {
    if (input.size() < static_cast<size_t>(start) + fftSize) return {};
    std::vector<Complex> spectrum(fftSize);
    for (uint32_t i = 0; i < fftSize; ++i) {
        const double phase = 2.0 * synth::kPi * static_cast<double>(i) /
                             static_cast<double>(fftSize - 1);
        const double window = blackmanHarris
            ? 0.35875 - 0.48829 * std::cos(phase) + 0.14128 * std::cos(2.0 * phase) -
                0.01168 * std::cos(3.0 * phase)
            : 0.5 - 0.5 * std::cos(phase);
        spectrum[i] = {static_cast<double>(input[start + i]) * window, 0.0};
    }
    fft_in_place(spectrum.data(), fftSize);
    std::vector<double> power(fftSize / 2);
    for (uint32_t i = 0; i < fftSize / 2; ++i) {
        power[i] = spectrum[i].real * spectrum[i].real + spectrum[i].imag * spectrum[i].imag;
    }
    return power;
}

static double peak_frequency(const std::vector<double>& power, double sampleRate,
                             uint32_t fftSize, double lowHz, double highHz) {
    if (power.size() < 3) return 0.0;
    uint32_t low = static_cast<uint32_t>(lowHz * static_cast<double>(fftSize) / sampleRate);
    uint32_t high = static_cast<uint32_t>(highHz * static_cast<double>(fftSize) / sampleRate + 1.0);
    low = std::max<uint32_t>(1, low);
    high = std::min<uint32_t>(static_cast<uint32_t>(power.size() - 2), high);
    uint32_t peak = low;
    for (uint32_t bin = low + 1; bin <= high; ++bin)
        if (power[bin] > power[peak]) peak = bin;
    const double logLeft = std::log(std::max(power[peak - 1], 1.0e-300));
    const double logCenter = std::log(std::max(power[peak], 1.0e-300));
    const double logRight = std::log(std::max(power[peak + 1], 1.0e-300));
    double offset = 0.0;
    const double denominator = logLeft - 2.0 * logCenter + logRight;
    if (denominator != 0.0) {
        offset = 0.5 * (logLeft - logRight) / denominator;
        offset = std::clamp(offset, -0.5, 0.5);
    }
    return (static_cast<double>(peak) + offset) * sampleRate / static_cast<double>(fftSize);
}

static std::vector<Parameters> clean_analysis_params() {
    return {
        {0, 0.0f}, {1, 0.0f}, {2, 1.0f}, {3, 0.0f}, {4, 0.0f},
        {5, 1.0f}, {6, 0.01f}, {7, 1.0f}, {15, 1.0f}, {16, 0.25f}
    };
}

static bool test_unison_determinism() {
    std::vector<Parameters> params = clean_analysis_params();
    params.insert(params.end(), {{9, 4.0f}, {10, 10.0f}, {11, 0.5f}, {15, 0.0f}});
    const std::vector<TimedEvent> events = {{0, SYNTH_EV_NOTE_ON, 31, 60.0f, 0.8f}};
    const StereoRender first = render_stereo(48000, 128, 4096, events, params, 0x1234u);
    const StereoRender second = render_stereo(48000, 128, 4096, events, params, 0x1234u);
    const StereoRender changed = render_stereo(48000, 128, 4096, events, params, 0x5678u);
    const size_t repeatMismatch = bit_mismatches(first.left, second.left) +
                                  bit_mismatches(first.right, second.right);
    const size_t seedMismatch = bit_mismatches(first.left, changed.left) +
                                bit_mismatches(first.right, changed.right);
    const bool ok = !first.left.empty() && repeatMismatch == 0 && seedMismatch != 0;
    std::printf("%s 9 unison determinism: repeat_bit_mismatches=%zu seed_bit_mismatches=%zu\n",
                ok ? "PASS" : "FAIL", repeatMismatch, seedMismatch);
    return ok;
}

static bool test_unison_loudness() {
    std::vector<Parameters> oneParams = clean_analysis_params();
    oneParams.insert(oneParams.end(), {{9, 1.0f}, {10, 10.0f}, {11, 0.5f}});
    std::vector<Parameters> fourParams = oneParams;
    fourParams.push_back({9, 4.0f});
    const std::vector<TimedEvent> events = {{0, SYNTH_EV_NOTE_ON, 32, 60.0f, 1.0f}};
    const StereoRender one = render_stereo(48000, 128, 96000, events, oneParams, 7u);
    const StereoRender four = render_stereo(48000, 128, 96000, events, fourParams, 7u);
    const double rmsOne = stereo_rms(one, 24000, 72000);
    const double rmsFour = stereo_rms(four, 24000, 72000);
    const double differenceDb = 20.0 * std::log10(rmsFour / rmsOne);
    const bool ok = std::isfinite(differenceDb) && std::fabs(differenceDb) <= 3.0;
    std::printf("%s 10 unison loudness: rms_u1=%.9f rms_u4=%.9f difference_db=%.6f limit_db=3.000000\n",
                ok ? "PASS" : "FAIL", rmsOne, rmsFour, differenceDb);
    return ok;
}

static bool test_unison_detune() {
    constexpr uint32_t sampleRate = 48000;
    constexpr uint32_t fftSize = 4096;
    std::vector<Parameters> params = clean_analysis_params();
    params.insert(params.end(), {{9, 2.0f}, {10, 50.0f}, {11, 1.0f}});
    const StereoRender output = render_stereo(sampleRate, 128, 16384,
        {{0, SYNTH_EV_NOTE_ON, 33, 69.0f, 1.0f}}, params, 9u);
    const std::vector<double> lowPower = spectrum_power(output.left, 8192, fftSize, false);
    const std::vector<double> highPower = spectrum_power(output.right, 8192, fftSize, false);
    const double midpoint = 440.0;
    const double low = peak_frequency(lowPower, sampleRate, fftSize, 390.0, midpoint);
    const double high = peak_frequency(highPower, sampleRate, fftSize, midpoint, 490.0);
    const double separation = 1200.0 * std::log2(high / low);
    const bool ok = !lowPower.empty() && !highPower.empty() &&
                    separation >= 92.0 && separation <= 108.0;
    std::printf("%s 11 detune: low_hz=%.6f high_hz=%.6f separation_cents=%.6f expected=100+/-8\n",
                ok ? "PASS" : "FAIL", low, high, separation);
    return ok;
}

static double channel_correlation(const StereoRender& output, size_t start, size_t count) {
    double meanLeft = 0.0;
    double meanRight = 0.0;
    for (size_t i = start; i < start + count; ++i) {
        meanLeft += output.left[i];
        meanRight += output.right[i];
    }
    meanLeft /= static_cast<double>(count);
    meanRight /= static_cast<double>(count);
    double numerator = 0.0;
    double leftPower = 0.0;
    double rightPower = 0.0;
    for (size_t i = start; i < start + count; ++i) {
        const double left = static_cast<double>(output.left[i]) - meanLeft;
        const double right = static_cast<double>(output.right[i]) - meanRight;
        numerator += left * right;
        leftPower += left * left;
        rightPower += right * right;
    }
    return numerator / std::sqrt(leftPower * rightPower);
}

static bool test_unison_pan() {
    std::vector<Parameters> wideParams = clean_analysis_params();
    wideParams.insert(wideParams.end(), {{9, 2.0f}, {10, 50.0f}, {11, 1.0f}});
    std::vector<Parameters> monoParams = wideParams;
    monoParams.push_back({11, 0.0f});
    const std::vector<TimedEvent> events = {{0, SYNTH_EV_NOTE_ON, 34, 60.0f, 1.0f}};
    const StereoRender wide = render_stereo(48000, 128, 48000, events, wideParams, 11u);
    const StereoRender mono = render_stereo(48000, 128, 48000, events, monoParams, 11u);
    const double correlation = channel_correlation(wide, 4096, 40000);
    const size_t monoMismatch = bit_mismatches(mono.left, mono.right);
    const bool ok = std::isfinite(correlation) && correlation < 0.99 && monoMismatch == 0;
    std::printf("%s 12 pan: width1_correlation=%.9f width0_bit_mismatches=%zu\n",
                ok ? "PASS" : "FAIL", correlation, monoMismatch);
    return ok;
}

static bool test_fm_disabled_bit_match() {
    std::vector<Parameters> aOnly = clean_analysis_params();
    aOnly.insert(aOnly.end(), {{9, 2.0f}, {10, 17.0f}, {11, 0.4f}, {19, 0.0f}, {28, 0.0f}});
    std::vector<Parameters> configuredB = aOnly;
    configuredB.insert(configuredB.end(), {
        {17, 3.0f}, {18, 0.75f}, {20, 4.0f}, {21, 50.0f}, {22, 1.0f},
        {23, 2.0f}, {24, 12.0f}, {25, 100.0f}
    });
    const std::vector<TimedEvent> events = {{0, SYNTH_EV_NOTE_ON, 35, 57.0f, 0.7f}};
    const StereoRender reference = render_stereo(48000, 128, 8192, events, aOnly, 13u);
    const StereoRender comparison = render_stereo(48000, 128, 8192, events, configuredB, 13u);
    const size_t mismatch = bit_mismatches(reference.left, comparison.left) +
                            bit_mismatches(reference.right, comparison.right);
    const bool ok = !reference.left.empty() && mismatch == 0;
    std::printf("%s 13 FM disabled bit match: bit_mismatches=%zu\n",
                ok ? "PASS" : "FAIL", mismatch);
    return ok;
}

static double spectral_centroid(const std::vector<float>& input, uint32_t sampleRate,
                                uint32_t start, uint32_t fftSize) {
    const std::vector<double> power = spectrum_power(input, start, fftSize, false);
    double weighted = 0.0;
    double total = 0.0;
    for (uint32_t bin = 1; bin < power.size(); ++bin) {
        const double magnitude = std::sqrt(power[bin]);
        weighted += magnitude * static_cast<double>(bin) * sampleRate / fftSize;
        total += magnitude;
    }
    return weighted / total;
}

static std::vector<Parameters> fm_analysis_params(float amount) {
    std::vector<Parameters> params = clean_analysis_params();
    params.insert(params.end(), {
        {15, 1.0f}, {16, 0.25f}, {17, 0.0f}, {18, 0.0f}, {19, 0.0f},
        {20, 1.0f}, {26, 1.0f}, {27, 0.0f}, {28, amount}
    });
    return params;
}

static bool test_fm_bandwidth() {
    constexpr uint32_t fftSize = 4096;
    const std::vector<TimedEvent> events = {{0, SYNTH_EV_NOTE_ON, 36, 60.0f, 1.0f}};
    const StereoRender off = render_stereo(48000, 128, 16384, events, fm_analysis_params(0.0f), 17u);
    const StereoRender on = render_stereo(48000, 128, 16384, events, fm_analysis_params(1.0f), 17u);
    const double offCentroid = spectral_centroid(off.left, 48000, 8192, fftSize);
    const double onCentroid = spectral_centroid(on.left, 48000, 8192, fftSize);
    const double ratio = onCentroid / offCentroid;
    const bool ok = std::isfinite(ratio) && ratio >= 2.0;
    std::printf("%s 14 FM bandwidth: centroid_off_hz=%.6f centroid_on_hz=%.6f ratio=%.6f minimum=2.000000\n",
                ok ? "PASS" : "FAIL", offCentroid, onCentroid, ratio);
    return ok;
}

static bool test_fm_aliasing() {
    constexpr uint32_t sampleRate = 48000;
    constexpr uint32_t fftSize = 4096;
    constexpr float midi = 72.0f;
    const double frequency = 440.0 * std::exp2((static_cast<double>(midi) - 69.0) / 12.0);
    const StereoRender output = render_stereo(sampleRate, 128, 32768,
        {{0, SYNTH_EV_NOTE_ON, 37, midi, 1.0f}}, fm_analysis_params(1.0f), 19u);
    const std::vector<double> power = spectrum_power(output.left, 16384, fftSize, true);
    const double fundamentalBin = frequency * fftSize / sampleRate;
    double expectedPower = 0.0;
    double aliasPower = 0.0;
    for (uint32_t bin = 1; bin < power.size(); ++bin) {
        // Equal carrier/modulator frequencies produce an expected DC sideband.
        bool expected = bin <= 8;
        for (uint32_t harmonic = 1;
             static_cast<double>(harmonic) * fundamentalBin < power.size(); ++harmonic) {
            if (std::fabs(static_cast<double>(bin) - harmonic * fundamentalBin) <= 8.0) {
                expected = true;
                break;
            }
        }
        if (expected) expectedPower += power[bin];
        else aliasPower += power[bin];
    }
    const double ratioDb = 10.0 * std::log10(aliasPower / expectedPower);
    const bool ok = !power.empty() && std::isfinite(ratioDb) && ratioDb <= -30.0;
    std::printf("%s 15 FM aliasing: midi=72 fft=4096 fold_ratio_db=%.6f threshold_db=-30.000000\n",
                ok ? "PASS" : "FAIL", ratioDb);
    return ok;
}

static bool test_sub_oscillator() {
    constexpr uint32_t sampleRate = 48000;
    constexpr uint32_t fftSize = 4096;
    std::vector<Parameters> params = clean_analysis_params();
    params.insert(params.end(), {{2, 0.0f}, {29, 1.0f}, {30, 0.0f}, {31, -1.0f}});
    const StereoRender output = render_stereo(sampleRate, 128, 16384,
        {{0, SYNTH_EV_NOTE_ON, 38, 69.0f, 1.0f}}, params, 23u);
    const std::vector<double> power = spectrum_power(output.left, 8192, fftSize, false);
    const double peak = peak_frequency(power, sampleRate, fftSize, 150.0, 300.0);
    const double error = std::fabs(peak - 220.0) / 220.0;
    const bool ok = !power.empty() && error <= 0.01;
    std::printf("%s 16 sub: peak_hz=%.6f expected_hz=220.000000 relative_error=%.9f\n",
                ok ? "PASS" : "FAIL", peak, error);
    return ok;
}

static bool test_sub_oscillator_one_octave_up() {
    constexpr uint32_t sampleRate = 48000;
    constexpr uint32_t fftSize = 4096;
    constexpr float midi = 69.0f;
    const double expected = 440.0 * 2.0;
    std::vector<Parameters> params = clean_analysis_params();
    params.insert(params.end(), {{2, 0.0f}, {29, 1.0f}, {30, 0.0f}, {31, 1.0f}});
    const StereoRender output = render_stereo(sampleRate, 128, 16384,
        {{0, SYNTH_EV_NOTE_ON, 72, midi, 1.0f}}, params, 277u);
    const std::vector<double> power = spectrum_power(output.left, 8192, fftSize, false);
    const double peak = peak_frequency(power, sampleRate, fftSize, 700.0, 1050.0);
    const double ratio = peak / expected;
    const bool ok = !power.empty() && std::isfinite(ratio) &&
                    std::fabs(ratio - 1.0) <= 0.02;
    std::printf("%s 49 sub +1 octave: peak_hz=%.6f expected_hz=%.6f ratio=%.9f tolerance=+/-2%%\n",
                ok ? "PASS" : "FAIL", peak, expected, ratio);
    return ok;
}

static bool test_noise_decay_determinism() {
    std::vector<Parameters> params = clean_analysis_params();
    params.insert(params.end(), {{2, 0.0f}, {32, 1.0f}, {33, 0.0f}, {34, 0.05f}});
    const std::vector<TimedEvent> events = {{0, SYNTH_EV_NOTE_ON, 39, 60.0f, 1.0f}};
    const StereoRender first = render_stereo(48000, 128, 28000, events, params, 29u);
    const StereoRender second = render_stereo(48000, 128, 28000, events, params, 29u);
    const size_t mismatch = bit_mismatches(first.left, second.left) +
                            bit_mismatches(first.right, second.right);
    const double rms = stereo_rms(first, 24000, 2048);
    const double dbfs = 20.0 * std::log10(std::max(rms, 1.0e-30));
    const bool ok = mismatch == 0 && std::isfinite(dbfs) && dbfs <= -60.0;
    std::printf("%s 17 noise decay/determinism: rms_0p5s_dbfs=%.6f bit_mismatches=%zu threshold_dbfs=-60.000000\n",
                ok ? "PASS" : "FAIL", dbfs, mismatch);
    return ok;
}

static bool test_pink_noise_slope() {
    constexpr uint32_t sampleRate = 48000;
    constexpr uint32_t fftSize = 32768;
    std::vector<Parameters> params = clean_analysis_params();
    params.insert(params.end(), {{2, 0.0f}, {32, 1.0f}, {33, 1.0f}, {34, 60.0f}});
    const StereoRender output = render_stereo(sampleRate, 128, 98304,
        {{0, SYNTH_EV_NOTE_ON, 40, 60.0f, 1.0f}}, params, 31u);
    const std::vector<double> power = spectrum_power(output.left, 32768, fftSize, false);
    constexpr uint32_t bandCount = 24;
    double sumX = 0.0;
    double sumY = 0.0;
    double sumXX = 0.0;
    double sumXY = 0.0;
    uint32_t used = 0;
    for (uint32_t band = 0; band < bandCount; ++band) {
        const double low = 100.0 * std::exp2(std::log2(100.0) * band / bandCount);
        const double high = 100.0 * std::exp2(std::log2(100.0) * (band + 1) / bandCount);
        uint32_t lowBin = static_cast<uint32_t>(low * fftSize / sampleRate + 0.5);
        uint32_t highBin = static_cast<uint32_t>(high * fftSize / sampleRate + 0.5);
        lowBin = std::max<uint32_t>(1, lowBin);
        highBin = std::min<uint32_t>(static_cast<uint32_t>(power.size()), highBin);
        if (highBin <= lowBin) continue;
        double meanPower = 0.0;
        for (uint32_t bin = lowBin; bin < highBin; ++bin) meanPower += power[bin];
        meanPower /= static_cast<double>(highBin - lowBin);
        const double x = std::log2(std::sqrt(low * high) / 100.0);
        const double y = 10.0 * std::log10(std::max(meanPower, 1.0e-300));
        sumX += x;
        sumY += y;
        sumXX += x * x;
        sumXY += x * y;
        ++used;
    }
    const double slope = (static_cast<double>(used) * sumXY - sumX * sumY) /
                         (static_cast<double>(used) * sumXX - sumX * sumX);
    const bool ok = power.size() == fftSize / 2 && used == bandCount &&
                    std::isfinite(slope) && slope >= -4.5 && slope <= -1.5;
    std::printf("%s 18 pink slope: range_hz=100..10000 slope_db_per_oct=%.6f expected=-3.0+/-1.5 bands=%u\n",
                ok ? "PASS" : "FAIL", slope, used);
    return ok;
}

static bool test_parameter_sweep() {
    static constexpr float values[75][3] = {
        {0.0f, 0.0f, 3.0f}, {0.0f, 0.0f, 1.0f}, {0.0f, 0.8f, 4.0f},
        {0.0f, 0.005f, 60.0f}, {0.0f, 0.1f, 60.0f}, {0.0f, 0.8f, 1.0f},
        {0.0f, 0.2f, 60.0f}, {0.0f, 0.2f, 4.0f}, {1.0f, 16.0f, 16.0f},
        {1.0f, 1.0f, 4.0f}, {0.0f, 10.0f, 50.0f}, {0.0f, 0.5f, 1.0f},
        {-2.0f, 0.0f, 2.0f}, {-12.0f, 0.0f, 12.0f}, {-100.0f, 0.0f, 100.0f},
        {0.0f, 0.0f, 1.0f}, {0.0f, 0.0f, 1.0f}, {0.0f, 0.0f, 3.0f},
        {0.0f, 0.0f, 1.0f}, {0.0f, 0.0f, 4.0f}, {1.0f, 1.0f, 4.0f},
        {0.0f, 10.0f, 50.0f}, {0.0f, 0.5f, 1.0f}, {-2.0f, 0.0f, 2.0f},
        {-12.0f, 0.0f, 12.0f}, {-100.0f, 0.0f, 100.0f}, {0.0f, 0.0f, 1.0f},
        {0.0f, 0.0f, 1.0f}, {0.0f, 0.0f, 1.0f}, {0.0f, 0.0f, 4.0f},
        {0.0f, 0.0f, 2.0f}, {-2.0f, -1.0f, 0.0f}, {0.0f, 0.0f, 4.0f},
        {0.0f, 0.0f, 1.0f}, {0.0f, 0.05f, 60.0f},
        {0.0f, 0.0f, 1.0f}, {0.0f, 0.0f, 5.0f}, {20.0f, 20000.0f, 20000.0f},
        {0.0f, 0.0f, 1.0f}, {0.0f, 0.0f, 1.0f}, {-8.0f, 0.0f, 8.0f},
        {0.0f, 0.005f, 20.0f}, {0.0f, 0.2f, 20.0f}, {0.0f, 1.0f, 1.0f},
        {0.0f, 0.2f, 20.0f}, {0.0f, 0.0f, 1.0f}, {0.01f, 1.0f, 40.0f},
        {0.0f, 0.0f, 5.0f}, {0.0f, 0.0f, 1.0f}, {-8.0f, 0.0f, 8.0f},
        {-1200.0f, 0.0f, 1200.0f}, {0.0f, 0.0f, 1.0f}, {0.0f, 0.0f, 1.0f},
        {0.0f, 0.0f, 1.0f}, {0.0f, 0.0f, 1.0f},
        {0.0f, 0.0f, 7.0f}, {0.0f, 0.0f, 13.0f}, {-1.0f, 0.0f, 1.0f},
        {0.0f, 0.0f, 7.0f}, {0.0f, 0.0f, 13.0f}, {-1.0f, 0.0f, 1.0f},
        {0.0f, 0.0f, 7.0f}, {0.0f, 0.0f, 13.0f}, {-1.0f, 0.0f, 1.0f},
        {0.0f, 0.0f, 7.0f}, {0.0f, 0.0f, 13.0f}, {-1.0f, 0.0f, 1.0f},
        {0.0f, 0.0f, 7.0f}, {0.0f, 0.0f, 13.0f}, {-1.0f, 0.0f, 1.0f},
        {0.0f, 0.0f, 7.0f}, {0.0f, 0.0f, 13.0f}, {-1.0f, 0.0f, 1.0f},
        {0.0f, 0.0f, 1.0f}, {0.0f, 0.0f, 1.0f}
    };
    uint64_t nonFinite = 0;
    double peak = 0.0;
    uint32_t renders = 0;
    for (uint32_t id = 0; id < 75; ++id) {
        for (uint32_t choice = 0; choice < 3; ++choice) {
            std::vector<Parameters> params = {
                {3, 0.0f}, {4, 0.0f}, {5, 1.0f}, {6, 0.01f}, {7, 0.2f},
                {id, values[id][choice]}
            };
            const StereoRender output = render_stereo(48000, 128, 9600,
                {{0, SYNTH_EV_NOTE_ON, 41, 60.0f, 1.0f}}, params, 37u + id);
            if (output.left.size() != 9600 || output.right.size() != 9600) {
                ++nonFinite;
                continue;
            }
            for (size_t i = 0; i < output.left.size(); ++i) {
                if (!std::isfinite(output.left[i]) || !std::isfinite(output.right[i])) ++nonFinite;
                peak = std::max(peak, std::fabs(static_cast<double>(output.left[i])));
                peak = std::max(peak, std::fabs(static_cast<double>(output.right[i])));
            }
            ++renders;
        }
    }
    const bool ok = renders == 225 && nonFinite == 0 && peak <= 8.0 && synth_engine_version() == 6;
    std::printf("%s 19 parameter sweep: renders=%u nan_inf=%llu peak=%.9f limit=8.000000 version=%u\n",
                ok ? "PASS" : "FAIL", renders,
                static_cast<unsigned long long>(nonFinite), peak, synth_engine_version());
    return ok;
}

static std::vector<Parameters> full_configuration_params() {
    return {
        {0, 2.0f}, {1, 0.0f}, {2, 1.0f}, {3, 0.0f}, {4, 0.0f}, {5, 1.0f},
        {6, 0.1f}, {7, 0.1f}, {8, 16.0f}, {9, 4.0f}, {10, 20.0f}, {11, 1.0f},
        {17, 3.0f}, {18, 0.0f}, {19, 1.0f}, {20, 4.0f}, {21, 15.0f}, {22, 1.0f},
        {28, 0.7f}, {29, 1.0f}, {30, 1.0f}, {31, -1.0f}, {32, 1.0f},
        {33, 1.0f}, {34, 0.2f}
    };
}

static bool test_performance() {
    constexpr uint32_t block = 128;
    constexpr uint32_t iterations = 1000;
    std::vector<unsigned char> state(synth_state_size());
    SynthEngine* engine = synth_create(state.data(), state.size(), 48000.0, block);
    if (engine == nullptr) return false;
    for (const Parameters& parameter : full_configuration_params())
        if (synth_set_param(engine, parameter.id, parameter.value) != 0) return false;
    synth_reset(engine, SYNTH_RESET_VOICES, 43u);
    SynthEvent notes[16]{};
    for (uint32_t i = 0; i < 16; ++i)
        notes[i] = SynthEvent{0, SYNTH_EV_NOTE_ON, 100u + i, 36.0f + i * 2.0f, 0.7f};
    float left[block]{};
    float right[block]{};
    if (synth_process(engine, notes, 16, left, right, block) != 0) return false;
    for (uint32_t i = 0; i < 100; ++i)
        if (synth_process(engine, nullptr, 0, left, right, block) != 0) return false;
    std::vector<double> timings;
    timings.reserve(iterations);
    double sum = 0.0;
    for (uint32_t i = 0; i < iterations; ++i) {
        const auto start = std::chrono::steady_clock::now();
        const int result = synth_process(engine, nullptr, 0, left, right, block);
        const auto stop = std::chrono::steady_clock::now();
        if (result != 0) return false;
        const double micros = std::chrono::duration<double, std::micro>(stop - start).count();
        timings.push_back(micros);
        sum += micros;
    }
    std::sort(timings.begin(), timings.end());
    const double average = sum / iterations;
    const double p99 = timings[static_cast<size_t>(iterations * 0.99)];
    const bool ok = std::isfinite(average) && std::isfinite(p99) && average > 0.0 && p99 > 0.0;
    std::printf("%s 20 performance: voices=16 unison=4 block=128 average_us=%.6f p99_us=%.6f iterations=%u\n",
                ok ? "PASS" : "FAIL", average, p99, iterations);
    return ok;
}

static bool test_extended_block_invariance() {
    const std::vector<TimedEvent> events = {
        {0, SYNTH_EV_NOTE_ON, 201, 48.0f, 0.8f},
        {257, SYNTH_EV_NOTE_ON, 202, 55.0f, 0.6f},
        {2049, SYNTH_EV_NOTE_OFF, 201, 0.0f, 0.0f},
        {3073, SYNTH_EV_NOTE_OFF, 202, 0.0f, 0.0f}
    };
    const uint32_t blocks[] = {1, 7, 64, 128, 511};
    const StereoRender reference = render_stereo(
        48000, blocks[0], 4096, events, full_configuration_params(), 47u);
    size_t mismatch = 0;
    for (size_t i = 1; i < sizeof(blocks) / sizeof(blocks[0]); ++i) {
        const StereoRender comparison = render_stereo(
            48000, blocks[i], 4096, events, full_configuration_params(), 47u);
        mismatch += bit_mismatches(reference.left, comparison.left);
        mismatch += bit_mismatches(reference.right, comparison.right);
    }
    const bool ok = !reference.left.empty() && mismatch == 0;
    std::printf("%s 21 extended block invariance: blocks=1,7,64,128,511 bit_mismatches=%zu\n",
                ok ? "PASS" : "FAIL", mismatch);
    return ok;
}

static bool load_parameter_file(const char* path, std::vector<Parameters>& parameters) {
    std::ifstream input(path);
    std::string line;
    while (std::getline(input, line)) {
        const size_t comment = line.find('#');
        if (comment != std::string::npos) line.resize(comment);
        for (char& character : line) if (character == '=') character = ' ';
        std::istringstream stream(line);
        Parameters parameter{};
        if (!(stream >> parameter.id)) continue;
        if (!(stream >> parameter.value)) return false;
        parameters.push_back(parameter);
    }
    return input.eof();
}

static bool load_timed_event_file(const char* path, std::vector<TimedEvent>& events) {
    std::ifstream input(path);
    std::string line;
    while (std::getline(input, line)) {
        const size_t comment = line.find('#');
        if (comment != std::string::npos) line.resize(comment);
        std::istringstream stream(line);
        TimedEvent event{};
        if (!(stream >> event.frame)) continue;
        if (!(stream >> event.kind >> event.id >> event.a >> event.b)) return false;
        events.push_back(event);
    }
    return input.eof();
}

static uint32_t read_le_u32(const unsigned char* bytes) {
    return static_cast<uint32_t>(bytes[0]) |
        (static_cast<uint32_t>(bytes[1]) << 8) |
        (static_cast<uint32_t>(bytes[2]) << 16) |
        (static_cast<uint32_t>(bytes[3]) << 24);
}

static StereoRender load_float_stereo_wav(const char* path) {
    std::ifstream input(path, std::ios::binary);
    unsigned char header[44]{};
    input.read(reinterpret_cast<char*>(header), sizeof(header));
    if (!input || std::memcmp(header, "RIFF", 4) != 0 ||
        std::memcmp(header + 8, "WAVEfmt ", 8) != 0 ||
        std::memcmp(header + 36, "data", 4) != 0 ||
        header[20] != 3 || header[22] != 2 || header[34] != 32) return {};
    const uint32_t dataBytes = read_le_u32(header + 40);
    if ((dataBytes & 7u) != 0) return {};
    const size_t frames = dataBytes / 8u;
    StereoRender output{std::vector<float>(frames), std::vector<float>(frames)};
    unsigned char sampleBytes[8]{};
    for (size_t i = 0; i < frames; ++i) {
        input.read(reinterpret_cast<char*>(sampleBytes), sizeof(sampleBytes));
        if (!input) return {};
        uint32_t bits = read_le_u32(sampleBytes);
        std::memcpy(&output.left[i], &bits, sizeof(bits));
        bits = read_le_u32(sampleBytes + 4);
        std::memcpy(&output.right[i], &bits, sizeof(bits));
    }
    return output;
}

static bool golden_case(const char* presetPath, const char* eventPath,
                        const char* goldenPath, size_t* mismatches,
                        bool explicitCurveZero = false, bool resetVoices = true) {
    std::vector<Parameters> parameters;
    std::vector<TimedEvent> events;
    if (!load_parameter_file(presetPath, parameters) ||
        !load_timed_event_file(eventPath, events)) return false;
    if (explicitCurveZero) parameters.insert(parameters.end(), {{53, 0.0f}, {54, 0.0f}});
    const StereoRender rendered = render_stereo(
        48000, 128, 96000, events, parameters, 0, resetVoices);
    const StereoRender golden = load_float_stereo_wav(goldenPath);
    *mismatches += bit_mismatches(rendered.left, golden.left);
    *mismatches += bit_mismatches(rendered.right, golden.right);
    return rendered.left.size() == 96000 && golden.left.size() == 96000;
}

static bool test_m1b_bypass_golden() {
    size_t sawMismatch = 0;
    size_t unisonMismatch = 0;
    const bool sawLoaded = golden_case("presets/m0_saw.txt", "fixtures/m0_events_chord.txt",
        "/tmp/golden_m0_saw.wav", &sawMismatch);
    const bool unisonLoaded = golden_case("presets/m1_unison_saw.txt", "fixtures/listen_chord.txt",
        "/tmp/golden_m1_unison.wav", &unisonMismatch);
    const bool ok = sawLoaded && unisonLoaded && sawMismatch == 0 && unisonMismatch == 0;
    std::printf("%s 22 M1b bypass golden: m0_saw_bit_mismatches=%zu m1_unison_bit_mismatches=%zu\n",
                ok ? "PASS" : "FAIL", sawMismatch, unisonMismatch);
    return ok;
}

static std::vector<Parameters> filter_noise_params(float cutoff, float resonance, float mode,
                                                    float keyTrack, bool enabled) {
    std::vector<Parameters> params = clean_analysis_params();
    params.insert(params.end(), {
        {2, 0.0f}, {7, 1.0f}, {32, 1.0f}, {33, 0.0f}, {34, 60.0f},
        {35, enabled ? 1.0f : 0.0f}, {36, mode}, {37, cutoff}, {38, resonance},
        {39, keyTrack}, {40, 0.0f}, {41, 0.0f}, {42, 0.0f}, {43, 1.0f}
    });
    return params;
}

static std::vector<double> averaged_spectrum_power(const std::vector<float>& input,
                                                   uint32_t start, uint32_t fftSize,
                                                   uint32_t segments) {
    std::vector<double> average(fftSize / 2, 0.0);
    for (uint32_t segment = 0; segment < segments; ++segment) {
        const std::vector<double> power = spectrum_power(
            input, start + segment * fftSize, fftSize, false);
        if (power.size() != average.size()) return {};
        for (size_t bin = 0; bin < average.size(); ++bin) average[bin] += power[bin];
    }
    return average;
}

static double transfer_db(const std::vector<double>& filtered,
                          const std::vector<double>& reference, uint32_t center,
                          uint32_t radius) {
    const uint32_t low = center > radius ? center - radius : 1u;
    const uint32_t high = std::min<uint32_t>(
        static_cast<uint32_t>(filtered.size() - 1), center + radius);
    double numerator = 0.0;
    double denominator = 0.0;
    for (uint32_t bin = low; bin <= high; ++bin) {
        numerator += filtered[bin];
        denominator += reference[bin];
    }
    return 10.0 * std::log10(std::max(numerator, 1.0e-300) /
                             std::max(denominator, 1.0e-300));
}

static double measured_filter_cutoff(float cutoff, float midi, float keyTrack,
                                     double* measuredDb) {
    constexpr uint32_t sampleRate = 48000;
    constexpr uint32_t fftSize = 32768;
    constexpr uint32_t segments = 4;
    constexpr uint32_t start = 32768;
    constexpr uint32_t frames = start + fftSize * segments;
    constexpr float butterworthResonance = 0.294415f;
    const std::vector<TimedEvent> events = {{0, SYNTH_EV_NOTE_ON, 301, midi, 1.0f}};
    const StereoRender reference = render_stereo(sampleRate, 128, frames, events,
        filter_noise_params(cutoff, butterworthResonance, 0.0f, keyTrack, false), 101u);
    const StereoRender filtered = render_stereo(sampleRate, 128, frames, events,
        filter_noise_params(cutoff, butterworthResonance, 0.0f, keyTrack, true), 101u);
    const std::vector<double> referencePower = averaged_spectrum_power(
        reference.left, start, fftSize, segments);
    const std::vector<double> filteredPower = averaged_spectrum_power(
        filtered.left, start, fftSize, segments);
    if (referencePower.empty() || filteredPower.empty()) return 0.0;
    const double expected = static_cast<double>(cutoff) *
        std::exp2(static_cast<double>(keyTrack) * (static_cast<double>(midi) - 60.0) / 12.0);
    uint32_t low = static_cast<uint32_t>(expected * 0.45 * fftSize / sampleRate);
    uint32_t high = static_cast<uint32_t>(expected * 1.55 * fftSize / sampleRate);
    low = std::max<uint32_t>(2, low);
    high = std::min<uint32_t>(static_cast<uint32_t>(filteredPower.size() - 2), high);
    uint32_t best = low;
    double bestDistance = 1.0e30;
    double bestDb = 0.0;
    for (uint32_t bin = low; bin <= high; ++bin) {
        const double db = transfer_db(filteredPower, referencePower, bin, 2);
        const double distance = std::fabs(db + 3.01029995664);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = bin;
            bestDb = db;
        }
    }
    *measuredDb = bestDb;
    return static_cast<double>(best) * sampleRate / fftSize;
}

static bool test_filter_cutoff_accuracy() {
    const float settings[3] = {200.0f, 1000.0f, 5000.0f};
    double measured[3]{};
    double errors[3]{};
    double db[3]{};
    bool ok = true;
    for (uint32_t i = 0; i < 3; ++i) {
        measured[i] = measured_filter_cutoff(settings[i], 60.0f, 0.0f, &db[i]);
        errors[i] = std::fabs(measured[i] - settings[i]) / settings[i];
        ok = ok && errors[i] <= 0.05;
    }
    std::printf("%s 23 cutoff: 200=%.3fHz err=%.3f%% 1000=%.3fHz err=%.3f%% 5000=%.3fHz err=%.3f%%\n",
        ok ? "PASS" : "FAIL", measured[0], errors[0] * 100.0,
        measured[1], errors[1] * 100.0, measured[2], errors[2] * 100.0);
    return ok;
}

static double measured_filter_slope(uint32_t mode) {
    constexpr uint32_t sampleRate = 48000;
    constexpr uint32_t fftSize = 32768;
    constexpr uint32_t segments = 4;
    constexpr uint32_t start = 32768;
    constexpr uint32_t frames = start + fftSize * segments;
    const std::vector<TimedEvent> events = {{0, SYNTH_EV_NOTE_ON, 302, 60.0f, 1.0f}};
    const StereoRender reference = render_stereo(sampleRate, 128, frames, events,
        filter_noise_params(1000.0f, 0.0f, static_cast<float>(mode), 0.0f, false), 103u);
    const StereoRender filtered = render_stereo(sampleRate, 128, frames, events,
        filter_noise_params(1000.0f, 0.0f, static_cast<float>(mode), 0.0f, true), 103u);
    const std::vector<double> referencePower = averaged_spectrum_power(
        reference.left, start, fftSize, segments);
    const std::vector<double> filteredPower = averaged_spectrum_power(
        filtered.left, start, fftSize, segments);
    const uint32_t bin2k = static_cast<uint32_t>(2000.0 * fftSize / sampleRate + 0.5);
    const uint32_t bin8k = static_cast<uint32_t>(8000.0 * fftSize / sampleRate + 0.5);
    const double db2k = transfer_db(filteredPower, referencePower, bin2k, 12);
    const double db8k = transfer_db(filteredPower, referencePower, bin8k, 48);
    return (db8k - db2k) / 2.0;
}

static bool test_filter_slopes() {
    const double lp12 = measured_filter_slope(0);
    const double lp24 = measured_filter_slope(4);
    const bool ok = std::fabs(lp12 + 12.0) <= 3.0 && std::fabs(lp24 + 24.0) <= 3.0;
    std::printf("%s 24 slopes: LP12=%.6f_dB/oct LP24=%.6f_dB/oct expected=-12/-24 +/-3\n",
                ok ? "PASS" : "FAIL", lp12, lp24);
    return ok;
}

static bool test_filter_resonance_peak() {
    constexpr uint32_t sampleRate = 48000;
    constexpr uint32_t fftSize = 32768;
    constexpr uint32_t segments = 4;
    constexpr uint32_t start = 32768;
    constexpr uint32_t frames = start + fftSize * segments;
    const std::vector<TimedEvent> events = {{0, SYNTH_EV_NOTE_ON, 303, 60.0f, 1.0f}};
    const StereoRender zero = render_stereo(sampleRate, 128, frames, events,
        filter_noise_params(1000.0f, 0.0f, 0.0f, 0.0f, true), 107u);
    const StereoRender resonant = render_stereo(sampleRate, 128, frames, events,
        filter_noise_params(1000.0f, 0.8f, 0.0f, 0.0f, true), 107u);
    const std::vector<double> zeroPower = averaged_spectrum_power(
        zero.left, start, fftSize, segments);
    const std::vector<double> resonantPower = averaged_spectrum_power(
        resonant.left, start, fftSize, segments);
    double peakDb = -1000.0;
    const uint32_t low = static_cast<uint32_t>(700.0 * fftSize / sampleRate);
    const uint32_t high = static_cast<uint32_t>(1300.0 * fftSize / sampleRate);
    for (uint32_t bin = low; bin <= high; ++bin)
        peakDb = std::max(peakDb, transfer_db(resonantPower, zeroPower, bin, 2));
    const bool ok = std::isfinite(peakDb) && peakDb >= 10.0;
    std::printf("%s 25 resonance peak: gain_over_res0_db=%.6f minimum_db=10.000000\n",
                ok ? "PASS" : "FAIL", peakDb);
    return ok;
}

static void finite_and_peak(const StereoRender& output, uint64_t* nonFinite, double* peak) {
    for (size_t i = 0; i < output.left.size(); ++i) {
        if (!std::isfinite(output.left[i]) || !std::isfinite(output.right[i])) ++*nonFinite;
        *peak = std::max(*peak, std::fabs(static_cast<double>(output.left[i])));
        *peak = std::max(*peak, std::fabs(static_cast<double>(output.right[i])));
    }
}

static bool test_filter_self_oscillation_stability() {
    std::vector<Parameters> params = clean_analysis_params();
    params.insert(params.end(), {{2, 0.0f}, {32, 0.0f}, {35, 1.0f}, {36, 0.0f},
        {37, 1000.0f}, {38, 1.0f}});
    const StereoRender output = render_stereo(48000, 128, 480000,
        {{0, SYNTH_EV_NOTE_ON, 304, 60.0f, 1.0f}}, params, 109u);
    uint64_t nonFinite = 0;
    double peak = 0.0;
    finite_and_peak(output, &nonFinite, &peak);
    const bool ok = output.left.size() == 480000 && nonFinite == 0 && peak <= 8.0;
    std::printf("%s 26 self oscillation stability: seconds=10 nan_inf=%llu peak=%.9f limit=8.000000\n",
        ok ? "PASS" : "FAIL", static_cast<unsigned long long>(nonFinite), peak);
    return ok;
}

static bool test_filter_fast_modulation_stability() {
    std::vector<Parameters> params = clean_analysis_params();
    params.insert(params.end(), {{0, 1.0f}, {2, 0.5f}, {7, 0.1f}, {35, 1.0f},
        {36, 4.0f}, {37, 1000.0f}, {38, 0.9f}, {46, 40.0f}, {49, 8.0f}});
    const StereoRender output = render_stereo(48000, 128, 240000,
        {{0, SYNTH_EV_NOTE_ON, 305, 48.0f, 1.0f}}, params, 113u);
    uint64_t nonFinite = 0;
    double peak = 0.0;
    finite_and_peak(output, &nonFinite, &peak);
    const bool ok = output.left.size() == 240000 && nonFinite == 0 && peak <= 8.0;
    std::printf("%s 27 fast modulation stability: seconds=5 nan_inf=%llu peak=%.9f limit=8.000000\n",
        ok ? "PASS" : "FAIL", static_cast<unsigned long long>(nonFinite), peak);
    return ok;
}

static bool test_filter_key_tracking() {
    double c3Db = 0.0;
    double c4Db = 0.0;
    const double c3 = measured_filter_cutoff(1000.0f, 48.0f, 1.0f, &c3Db);
    const double c4 = measured_filter_cutoff(1000.0f, 60.0f, 1.0f, &c4Db);
    const double ratio = c4 / c3;
    const bool ok = std::isfinite(ratio) && std::fabs(ratio - 2.0) <= 0.2;
    std::printf("%s 28 key track: C3_cutoff=%.3fHz C4_cutoff=%.3fHz ratio=%.6f expected=2.0+/-10%%\n",
                ok ? "PASS" : "FAIL", c3, c4, ratio);
    return ok;
}

static bool test_filter_envelope_centroid() {
    std::vector<Parameters> params = clean_analysis_params();
    params.insert(params.end(), {{0, 1.0f}, {2, 1.0f}, {35, 1.0f}, {36, 4.0f},
        {37, 200.0f}, {38, 0.0f}, {40, 4.0f}, {41, 0.0f}, {42, 0.3f}, {43, 0.0f}});
    const StereoRender output = render_stereo(48000, 128, 56000,
        {{0, SYNTH_EV_NOTE_ON, 306, 48.0f, 1.0f}}, params, 127u);
    const double early = spectral_centroid(output.left, 48000, 0, 2048);
    const double late = spectral_centroid(output.left, 48000, 48000, 2048);
    const double ratio = early / late;
    const bool ok = std::isfinite(ratio) && ratio >= 2.0;
    std::printf("%s 29 filter EG: centroid_first50ms=%.6fHz centroid_1s=%.6fHz ratio=%.6f minimum=2.000000\n",
                ok ? "PASS" : "FAIL", early, late, ratio);
    return ok;
}

static std::vector<Parameters> lfo_analysis_params(uint32_t shape, float ampDepth) {
    std::vector<Parameters> params = clean_analysis_params();
    params.insert(params.end(), {{0, 0.0f}, {2, 1.0f}, {9, 2.0f}, {10, 0.0f},
        {11, 0.0f}, {15, 1.0f}, {16, 0.25f}, {46, 5.0f},
        {47, static_cast<float>(shape)}, {48, 0.0f}, {51, ampDepth}, {52, 0.0f}});
    return params;
}

static uint32_t measured_lfo_period(uint32_t shape) {
    std::vector<unsigned char> state(synth_state_size());
    SynthEngine* engine = synth_create(state.data(), state.size(), 48000.0, 1);
    if (engine == nullptr || synth_set_param(engine, 46, 5.0f) != 0 ||
        synth_set_param(engine, 47, static_cast<float>(shape)) != 0) return 0;
    synth_reset(engine, SYNTH_RESET_VOICES, 131u);
    float left = 0.0f;
    float right = 0.0f;
    for (uint32_t samples = 1; samples <= 20000; ++samples) {
        if (synth_process(engine, nullptr, 0, &left, &right, 1) != 0) return 0;
        if (engine->globalLfoCycleIndex != 0) return samples;
    }
    return 0;
}

static bool test_lfo_shapes() {
    constexpr uint32_t expectedPeriod = 9600;
    double minimum[5]{};
    double maximum[5]{};
    double maxPeriodError = 0.0;
    bool rangesOk = true;
    for (uint32_t shape = 0; shape < 6; ++shape) {
        const uint32_t period = measured_lfo_period(shape);
        const double error = std::fabs(static_cast<double>(period) - expectedPeriod) / expectedPeriod;
        maxPeriodError = std::max(maxPeriodError, error);
        if (shape == 5) continue;
        const StereoRender baseline = render_stereo(48000, 128, expectedPeriod,
            {{0, SYNTH_EV_NOTE_ON, 307, 69.0f, 1.0f}}, lfo_analysis_params(shape, 0.0f), 137u);
        const StereoRender modulated = render_stereo(48000, 128, expectedPeriod,
            {{0, SYNTH_EV_NOTE_ON, 307, 69.0f, 1.0f}}, lfo_analysis_params(shape, 1.0f), 137u);
        minimum[shape] = 1000.0;
        maximum[shape] = -1000.0;
        for (uint32_t i = 0; i < expectedPeriod; ++i) {
            if (std::fabs(baseline.left[i]) < 0.05f) continue;
            const double value = 2.0 * static_cast<double>(modulated.left[i]) /
                                     static_cast<double>(baseline.left[i]) - 1.0;
            minimum[shape] = std::min(minimum[shape], value);
            maximum[shape] = std::max(maximum[shape], value);
        }
        rangesOk = rangesOk && std::fabs(minimum[shape] + 1.0) <= 0.005 &&
            std::fabs(maximum[shape] - 1.0) <= 0.005;
    }
    const StereoRender shA = render_stereo(48000, 128, expectedPeriod * 3,
        {{0, SYNTH_EV_NOTE_ON, 308, 69.0f, 1.0f}}, lfo_analysis_params(5, 1.0f), 139u);
    const StereoRender shB = render_stereo(48000, 128, expectedPeriod * 3,
        {{0, SYNTH_EV_NOTE_ON, 308, 69.0f, 1.0f}}, lfo_analysis_params(5, 1.0f), 139u);
    const size_t shMismatch = bit_mismatches(shA.left, shB.left) +
                              bit_mismatches(shA.right, shB.right);
    const bool ok = rangesOk && maxPeriodError <= 0.01 && shMismatch == 0;
    std::printf("%s 30 LFO shapes: minmax_sine=%.4f/%.4f triangle=%.4f/%.4f sawUp=%.4f/%.4f sawDown=%.4f/%.4f square=%.4f/%.4f period_error=%.6f%% SH_bit_mismatches=%zu\n",
        ok ? "PASS" : "FAIL", minimum[0], maximum[0], minimum[1], maximum[1],
        minimum[2], maximum[2], minimum[3], maximum[3], minimum[4], maximum[4],
        maxPeriodError * 100.0, shMismatch);
    return ok;
}

static bool test_lfo_retrigger() {
    const std::vector<TimedEvent> events = {
        {0, SYNTH_EV_NOTE_ON, 309, 69.0f, 1.0f},
        {2048, SYNTH_EV_NOTE_OFF, 309, 0.0f, 0.0f},
        {4096, SYNTH_EV_NOTE_ON, 309, 69.0f, 1.0f}
    };
    std::vector<Parameters> retriggerParams = lfo_analysis_params(2, 1.0f);
    retriggerParams.insert(retriggerParams.end(), {{6, 0.0f}, {46, 3.7f}, {48, 1.0f}});
    std::vector<Parameters> freeParams = retriggerParams;
    freeParams.push_back({48, 0.0f});
    const StereoRender retrigger = render_stereo(48000, 128, 6144, events, retriggerParams, 149u);
    const StereoRender freeRun = render_stereo(48000, 128, 6144, events, freeParams, 149u);
    size_t retriggerMismatch = 0;
    size_t freeMismatch = 0;
    for (uint32_t i = 0; i < 1024; ++i) {
        if (std::memcmp(&retrigger.left[i], &retrigger.left[4096 + i], sizeof(float)) != 0)
            ++retriggerMismatch;
        if (std::memcmp(&freeRun.left[i], &freeRun.left[4096 + i], sizeof(float)) != 0)
            ++freeMismatch;
    }
    const bool ok = retriggerMismatch == 0 && freeMismatch != 0;
    std::printf("%s 31 LFO retrigger: retrigger_bit_mismatches=%zu free_run_bit_mismatches=%zu\n",
                ok ? "PASS" : "FAIL", retriggerMismatch, freeMismatch);
    return ok;
}

static std::vector<Parameters> all_m1b_params() {
    std::vector<Parameters> params = full_configuration_params();
    params.insert(params.end(), {{35, 1.0f}, {36, 4.0f}, {37, 1200.0f}, {38, 0.65f},
        {39, 0.5f}, {40, 3.0f}, {41, 0.003f}, {42, 0.4f}, {43, 0.25f},
        {44, 0.3f}, {45, 0.7f}, {46, 7.3f}, {47, 1.0f}, {48, 1.0f},
        {49, 2.0f}, {50, 37.0f}, {51, 0.4f}, {52, 0.17f}});
    return params;
}

static bool test_m1b_block_invariance() {
    const std::vector<TimedEvent> events = {
        {0, SYNTH_EV_NOTE_ON, 310, 48.0f, 0.8f},
        {257, SYNTH_EV_NOTE_ON, 311, 55.0f, 0.6f},
        {701, SYNTH_EV_PARAM, 37, 2500.0f, 0.0f},
        {1009, SYNTH_EV_PARAM, 38, 0.8f, 0.0f},
        {2049, SYNTH_EV_NOTE_OFF, 310, 0.0f, 0.0f},
        {3073, SYNTH_EV_NOTE_OFF, 311, 0.0f, 0.0f}
    };
    const uint32_t blocks[] = {1, 7, 64, 128, 511};
    const StereoRender reference = render_stereo(
        48000, blocks[0], 4096, events, all_m1b_params(), 151u);
    size_t mismatch = 0;
    for (size_t i = 1; i < sizeof(blocks) / sizeof(blocks[0]); ++i) {
        const StereoRender comparison = render_stereo(
            48000, blocks[i], 4096, events, all_m1b_params(), 151u);
        mismatch += bit_mismatches(reference.left, comparison.left);
        mismatch += bit_mismatches(reference.right, comparison.right);
    }
    const bool ok = !reference.left.empty() && mismatch == 0;
    std::printf("%s 32 M1b block invariance: blocks=1,7,64,128,511 bit_mismatches=%zu\n",
                ok ? "PASS" : "FAIL", mismatch);
    return ok;
}

static bool test_m1b_reset_determinism() {
    constexpr uint32_t block = 128;
    constexpr uint32_t frames = 8192;
    std::vector<unsigned char> state(synth_state_size());
    SynthEngine* engine = synth_create(state.data(), state.size(), 48000.0, block);
    if (engine == nullptr) return false;
    for (const Parameters& parameter : all_m1b_params())
        if (synth_set_param(engine, parameter.id, parameter.value) != 0) return false;
    std::vector<float> firstLeft(frames);
    std::vector<float> firstRight(frames);
    std::vector<float> secondLeft(frames);
    std::vector<float> secondRight(frames);
    const SynthEvent note{0, SYNTH_EV_NOTE_ON, 312, 52.0f, 0.8f};
    for (uint32_t pass = 0; pass < 2; ++pass) {
        synth_reset(engine, SYNTH_RESET_VOICES, 157u);
        float* left = pass == 0 ? firstLeft.data() : secondLeft.data();
        float* right = pass == 0 ? firstRight.data() : secondRight.data();
        for (uint32_t position = 0; position < frames; position += block) {
            const SynthEvent* event = position == 0 ? &note : nullptr;
            const uint32_t eventCount = position == 0 ? 1u : 0u;
            if (synth_process(engine, event, eventCount, left + position, right + position, block) != 0)
                return false;
        }
    }
    const size_t mismatch = bit_mismatches(firstLeft, secondLeft) +
                            bit_mismatches(firstRight, secondRight);
    const bool ok = mismatch == 0;
    std::printf("%s 33 M1b determinism: reset_render_bit_mismatches=%zu\n",
                ok ? "PASS" : "FAIL", mismatch);
    return ok;
}

static bool test_m1b_performance() {
    constexpr uint32_t block = 128;
    constexpr uint32_t iterations = 1000;
    constexpr double deadline = 2667.0;
    std::vector<unsigned char> state(synth_state_size());
    SynthEngine* engine = synth_create(state.data(), state.size(), 48000.0, block);
    if (engine == nullptr) return false;
    const std::vector<Parameters> params = {
        {0, 1.0f}, {2, 0.8f}, {3, 0.0f}, {4, 0.0f}, {5, 1.0f}, {7, 0.05f},
        {8, 16.0f}, {9, 4.0f}, {10, 12.0f}, {11, 0.8f}, {35, 1.0f},
        {36, 4.0f}, {37, 1000.0f}, {38, 0.7f}, {46, 5.0f}, {49, 3.0f}
    };
    for (const Parameters& parameter : params)
        if (synth_set_param(engine, parameter.id, parameter.value) != 0) return false;
    synth_reset(engine, SYNTH_RESET_VOICES, 163u);
    SynthEvent notes[16]{};
    for (uint32_t i = 0; i < 16; ++i)
        notes[i] = SynthEvent{0, SYNTH_EV_NOTE_ON, 400u + i, 36.0f + i * 2.0f, 0.7f};
    float left[block]{};
    float right[block]{};
    if (synth_process(engine, notes, 16, left, right, block) != 0) return false;
    for (uint32_t i = 0; i < 100; ++i)
        if (synth_process(engine, nullptr, 0, left, right, block) != 0) return false;
    std::vector<double> timings;
    timings.reserve(iterations);
    double sum = 0.0;
    for (uint32_t i = 0; i < iterations; ++i) {
        const auto start = std::chrono::steady_clock::now();
        const int result = synth_process(engine, nullptr, 0, left, right, block);
        const auto stop = std::chrono::steady_clock::now();
        if (result != 0) return false;
        const double micros = std::chrono::duration<double, std::micro>(stop - start).count();
        timings.push_back(micros);
        sum += micros;
    }
    std::sort(timings.begin(), timings.end());
    const double average = sum / iterations;
    const double p99 = timings[static_cast<size_t>(iterations * 0.99)];
    const bool ok = std::isfinite(average) && std::isfinite(p99) &&
                    p99 < deadline * 0.5;
    std::printf("%s 34 M1b performance: voices=16 unison=4 LP24 average_us=%.6f p99_us=%.6f half_deadline_us=%.6f\n",
                ok ? "PASS" : "FAIL", average, p99, deadline * 0.5);
    return ok;
}

static bool test_curve_zero_golden_and_metadata() {
    const uint32_t count = synth_param_count();
    std::vector<SynthParamInfo> parameters(count);
    bool metadataValid = count == 75;
    for (uint32_t id = 0; id < count; ++id) {
        SynthParamInfo& parameter = parameters[id];
        metadataValid = metadataValid && synth_param_info(id, &parameter) == 0;
        metadataValid = metadataValid && parameter.id == id && parameter.identifier != nullptr &&
                        parameter.identifier[0] != '\0' && parameter.displayName != nullptr &&
                        parameter.displayName[0] != '\0';
        metadataValid = metadataValid && parameter.minimum <= parameter.defaultValue &&
                        parameter.defaultValue <= parameter.maximum;
        if (parameter.identifier != nullptr) {
            for (const unsigned char* character =
                     reinterpret_cast<const unsigned char*>(parameter.identifier);
                 *character != '\0'; ++character) {
                metadataValid = metadataValid && *character >= 0x21u && *character <= 0x7eu;
            }
        }
        for (uint32_t previous = 0; previous < id; ++previous) {
            if (parameters[previous].identifier != nullptr && parameter.identifier != nullptr)
                metadataValid = metadataValid &&
                    std::strcmp(parameters[previous].identifier, parameter.identifier) != 0;
        }
    }

    SynthParamInfo ignored{};
    const bool boundsValid = synth_param_info(count, &ignored) < 0 &&
                             synth_param_info(0, nullptr) < 0;
    std::vector<unsigned char> state(synth_state_size());
    SynthEngine* engine = synth_create(state.data(), state.size(), 48000.0, 128);
    bool defaultsMatch = engine != nullptr;
    if (engine != nullptr) {
        for (uint32_t id = 0; id < count; ++id)
            defaultsMatch = defaultsMatch && engine->params[id] == parameters[id].defaultValue;
    }

    size_t sawMismatch = 0;
    size_t unisonMismatch = 0;
    const bool sawLoaded = golden_case("presets/m0_saw.txt", "fixtures/m0_events_chord.txt",
        "/tmp/g2_m0.wav", &sawMismatch, true);
    const bool unisonLoaded = golden_case("presets/m1_unison_saw.txt", "fixtures/listen_chord.txt",
        "/tmp/g2_m1.wav", &unisonMismatch, true);
    const bool ok = metadataValid && boundsValid && defaultsMatch && sawLoaded && unisonLoaded &&
                    sawMismatch == 0 && unisonMismatch == 0;
    std::printf("%s 35 curve 0 golden: m0_mismatches=%zu m1_mismatches=%zu params=%u metadata=%s\n",
                ok ? "PASS" : "FAIL", sawMismatch, unisonMismatch, count,
                metadataValid && defaultsMatch ? "valid" : "invalid");
    return ok;
}

static bool set_envelope_test_params(SynthEngine* engine, float curve,
                                     float decay, float release) {
    const Parameters parameters[] = {
        {0, 1.0f}, {1, 0.0f}, {2, 0.8f}, {3, 0.0f}, {4, decay}, {5, 0.0f},
        {6, release}, {7, 0.2f}, {8, 1.0f}, {35, 1.0f}, {36, 4.0f},
        {37, 200.0f}, {38, 0.6f}, {40, 4.0f}, {41, 0.0f}, {42, decay},
        {43, 0.0f}, {44, release}, {53, curve}, {54, curve}
    };
    for (const Parameters& parameter : parameters) {
        if (synth_set_param(engine, parameter.id, parameter.value) != 0) return false;
    }
    return true;
}

static bool process_empty_frames(SynthEngine* engine, uint32_t frames) {
    float left[128]{};
    float right[128]{};
    uint32_t position = 0;
    while (position < frames) {
        const uint32_t count = std::min<uint32_t>(128, frames - position);
        if (synth_process(engine, nullptr, 0, left, right, count) != 0) return false;
        position += count;
    }
    return true;
}

static bool test_linear_envelope_uniformity() {
    std::vector<unsigned char> state(synth_state_size());
    SynthEngine* engine = synth_create(state.data(), state.size(), 48000.0, 128);
    if (engine == nullptr || !set_envelope_test_params(engine, 1.0f, 1.0f, 1.0f)) return false;
    synth_reset(engine, SYNTH_RESET_VOICES, 173u);
    const SynthEvent note{0, SYNTH_EV_NOTE_ON, 501, 48.0f, 1.0f};
    float left = 0.0f;
    float right = 0.0f;
    if (synth_process(engine, &note, 1, &left, &right, 1) != 0) return false;
    float measured[3]{};
    for (uint32_t point = 0; point < 3; ++point) {
        if (!process_empty_frames(engine, 12000)) return false;
        measured[point] = engine->voices[0].filterEnvelope;
    }
    const float expected[3] = {0.75f, 0.50f, 0.25f};
    bool ok = true;
    for (uint32_t point = 0; point < 3; ++point)
        ok = ok && std::fabs(measured[point] - expected[point]) <= 0.03f;
    std::printf("%s 36 linear curve: eg25=%.9f eg50=%.9f eg75=%.9f tolerance=0.030000000\n",
                ok ? "PASS" : "FAIL", measured[0], measured[1], measured[2]);
    return ok;
}

static double measure_filter_half_time(float curve) {
    std::vector<unsigned char> state(synth_state_size());
    SynthEngine* engine = synth_create(state.data(), state.size(), 48000.0, 1);
    if (engine == nullptr || !set_envelope_test_params(engine, curve, 1.0f, 1.0f)) return -1.0;
    synth_reset(engine, SYNTH_RESET_VOICES, 179u);
    const SynthEvent note{0, SYNTH_EV_NOTE_ON, 502, 48.0f, 1.0f};
    float left = 0.0f;
    float right = 0.0f;
    if (synth_process(engine, &note, 1, &left, &right, 1) != 0) return -1.0;
    for (uint32_t sample = 1; sample <= 48000; ++sample) {
        if (synth_process(engine, nullptr, 0, &left, &right, 1) != 0) return -1.0;
        if (engine->voices[0].filterEnvelope <= 0.5f)
            return static_cast<double>(sample) / 48000.0;
    }
    return -1.0;
}

static bool test_envelope_curve_monotonicity() {
    const double half0 = measure_filter_half_time(0.0f);
    const double half05 = measure_filter_half_time(0.5f);
    const double half1 = measure_filter_half_time(1.0f);
    const bool ok = half0 > 0.0 && half0 < half05 && half05 < half1;
    std::printf("%s 37 curve half times: curve0=%.9fs curve0.5=%.9fs curve1=%.9fs\n",
                ok ? "PASS" : "FAIL", half0, half05, half1);
    return ok;
}

static bool test_envelope_curve_health() {
    static constexpr float curves[] = {0.0f, 0.25f, 0.5f, 0.75f, 1.0f};
    static constexpr float times[] = {0.0f, 0.01f, 1.0f, 20.0f};
    constexpr uint32_t sampleRate = 48000;
    constexpr uint32_t block = 128;
    constexpr uint32_t renderFrames = 14400;
    constexpr uint32_t noteOffFrame = 4800;
    uint32_t cases = 0;
    uint32_t unreleased = 0;
    uint64_t nonFinite = 0;
    double peak = 0.0;
    for (float curve : curves) {
        for (float decay : times) {
            for (float release : times) {
                std::vector<unsigned char> state(synth_state_size());
                SynthEngine* engine = synth_create(state.data(), state.size(), sampleRate, block);
                if (engine == nullptr || !set_envelope_test_params(engine, curve, decay, release))
                    return false;
                synth_reset(engine, SYNTH_RESET_VOICES, 181u + cases);
                float left[block]{};
                float right[block]{};
                uint32_t position = 0;
                while (position < renderFrames) {
                    const uint32_t count = std::min<uint32_t>(block, renderFrames - position);
                    SynthEvent event{};
                    const SynthEvent* events = nullptr;
                    uint32_t eventCount = 0;
                    if (position == 0) {
                        event = SynthEvent{0, SYNTH_EV_NOTE_ON, 503, 48.0f, 1.0f};
                        events = &event;
                        eventCount = 1;
                    } else if (noteOffFrame >= position && noteOffFrame < position + count) {
                        event = SynthEvent{noteOffFrame - position, SYNTH_EV_NOTE_OFF, 503, 0.0f, 0.0f};
                        events = &event;
                        eventCount = 1;
                    }
                    if (synth_process(engine, events, eventCount, left, right, count) != 0)
                        return false;
                    for (uint32_t i = 0; i < count; ++i) {
                        if (!std::isfinite(left[i]) || !std::isfinite(right[i])) ++nonFinite;
                        peak = std::max(peak, std::fabs(static_cast<double>(left[i])));
                        peak = std::max(peak, std::fabs(static_cast<double>(right[i])));
                    }
                    position += count;
                }
                const uint32_t releaseFrames = static_cast<uint32_t>(
                    static_cast<double>(release) * sampleRate + 0.999999) + block;
                uint32_t tail = 0;
                while (engine->voices[0].active != 0 && tail < releaseFrames) {
                    const uint32_t count = std::min<uint32_t>(block, releaseFrames - tail);
                    if (synth_process(engine, nullptr, 0, left, right, count) != 0) return false;
                    for (uint32_t i = 0; i < count; ++i) {
                        if (!std::isfinite(left[i]) || !std::isfinite(right[i])) ++nonFinite;
                        peak = std::max(peak, std::fabs(static_cast<double>(left[i])));
                        peak = std::max(peak, std::fabs(static_cast<double>(right[i])));
                    }
                    tail += count;
                }
                if (engine->voices[0].active != 0) ++unreleased;
                ++cases;
            }
        }
    }
    const bool ok = cases == 80 && nonFinite == 0 && peak <= 8.0 && unreleased == 0;
    std::printf("%s 38 curve health: cases=%u nan_inf=%llu peak=%.9f unreleased=%u\n",
                ok ? "PASS" : "FAIL", cases,
                static_cast<unsigned long long>(nonFinite), peak, unreleased);
    return ok;
}

static bool test_m0a_g3_bit_match() {
    size_t mismatch = 0;
    const bool loaded = golden_case("presets/m0_saw.txt", "fixtures/m0_events_chord.txt",
                                    "/tmp/g3_m0.wav", &mismatch);
    const bool ok = loaded && mismatch == 0;
    std::printf("%s 39 M0a g3 golden: bit_mismatches=%zu\n",
                ok ? "PASS" : "FAIL", mismatch);
    return ok;
}

static bool test_path_independent_randomness() {
    static constexpr const char* presets[] = {
        "presets/m1_unison_saw.txt",
        "presets/m1b_filter_sweep.txt"
    };
    std::vector<TimedEvent> originalEvents;
    std::vector<TimedEvent> alternateEvents;
    const bool eventsLoaded =
        load_timed_event_file("fixtures/au_compare_vel1.txt", originalEvents) &&
        load_timed_event_file("fixtures/au_compare_vel1_altids.txt", alternateEvents);
    size_t unisonMismatch = 0;
    size_t filterMismatch = 0;
    bool loaded = eventsLoaded;
    for (uint32_t i = 0; i < 2; ++i) {
        std::vector<Parameters> parameters;
        loaded = loaded && load_parameter_file(presets[i], parameters);
        if (!loaded) break;
        const StereoRender original = render_stereo(
            48000, 128, 96000, originalEvents, parameters, 0);
        const StereoRender alternate = render_stereo(
            48000, 128, 96000, alternateEvents, parameters, 0);
        const size_t mismatch = bit_mismatches(original.left, alternate.left) +
                                bit_mismatches(original.right, alternate.right);
        if (i == 0) unisonMismatch = mismatch;
        else filterMismatch = mismatch;
        loaded = loaded && original.left.size() == 96000 && alternate.left.size() == 96000;
    }
    const bool ok = loaded && unisonMismatch == 0 && filterMismatch == 0;
    std::printf("%s 40 path-independent randomness: unison_bit_mismatches=%zu filter_bit_mismatches=%zu\n",
                ok ? "PASS" : "FAIL", unisonMismatch, filterMismatch);
    return ok;
}

static bool test_m1a_character_preservation() {
    std::vector<Parameters> parameters;
    std::vector<TimedEvent> events;
    const bool inputsLoaded = load_parameter_file("presets/m1_unison_saw.txt", parameters) &&
                              load_timed_event_file("fixtures/listen_chord.txt", events);
    const StereoRender before = load_float_stereo_wav("/tmp/g3_m1.wav");
    const StereoRender after = inputsLoaded
        ? render_stereo(48000, 128, 96000, events, parameters, 0) : StereoRender{};
    const double beforeRms = stereo_rms(before, 0, before.left.size());
    const double afterRms = stereo_rms(after, 0, after.left.size());
    const double rmsDifferenceDb = 20.0 * std::log10(afterRms / beforeRms);
    constexpr uint32_t centroidStart = 9600;
    constexpr uint32_t centroidFftSize = 8192;
    const double beforeCentroid =
        (spectral_centroid(before.left, 48000, centroidStart, centroidFftSize) +
         spectral_centroid(before.right, 48000, centroidStart, centroidFftSize)) * 0.5;
    const double afterCentroid =
        (spectral_centroid(after.left, 48000, centroidStart, centroidFftSize) +
         spectral_centroid(after.right, 48000, centroidStart, centroidFftSize)) * 0.5;
    const double centroidDifferencePercent =
        std::fabs(afterCentroid - beforeCentroid) / beforeCentroid * 100.0;
    const bool loaded = before.left.size() == 96000 && before.right.size() == 96000 &&
                        after.left.size() == 96000 && after.right.size() == 96000;
    const bool ok = loaded && std::isfinite(rmsDifferenceDb) &&
                    std::isfinite(centroidDifferencePercent) &&
                    std::fabs(rmsDifferenceDb) <= 1.0 && centroidDifferencePercent <= 10.0;
    std::printf("%s 41 M1a character: before_rms_dbfs=%.6f after_rms_dbfs=%.6f rms_difference_db=%.6f "
                "before_centroid_hz=%.6f after_centroid_hz=%.6f centroid_difference_percent=%.6f\n",
                ok ? "PASS" : "FAIL",
                20.0 * std::log10(beforeRms), 20.0 * std::log10(afterRms), rmsDifferenceDb,
                beforeCentroid, afterCentroid, centroidDifferencePercent);
    return ok;
}

static void add_mod_slot(std::vector<Parameters>& parameters, uint32_t slot,
                         uint32_t source, uint32_t destination, float amount) {
    const uint32_t base = 55u + slot * 3u;
    parameters.insert(parameters.end(), {
        {base, static_cast<float>(source)},
        {base + 1u, static_cast<float>(destination)},
        {base + 2u, amount}
    });
}

static std::vector<Parameters> modulation_analysis_params() {
    return {
        {0, 0.0f}, {1, 0.0f}, {2, 1.0f}, {3, 0.0f}, {4, 0.0f}, {5, 1.0f},
        {6, 0.01f}, {7, 0.25f}, {8, 1.0f}, {9, 1.0f}, {10, 0.0f}, {11, 0.0f},
        {15, 1.0f}, {16, 0.25f}, {17, 0.0f}, {18, 0.0f}, {19, 0.0f},
        {20, 1.0f}, {21, 0.0f}, {22, 0.0f}, {26, 1.0f}, {27, 0.0f},
        {29, 0.0f}, {32, 0.0f}, {35, 0.0f}, {41, 0.0f}, {42, 0.0f},
        {43, 1.0f}, {44, 0.01f}, {46, 2.0f}, {47, 0.0f}, {48, 0.0f},
        {49, 0.0f}, {50, 0.0f}, {51, 0.0f}, {52, 0.25f}
    };
}

static double rms_difference_db(const StereoRender& changed, const StereoRender& reference,
                                size_t start, size_t count) {
    const double changedRms = stereo_rms(changed, start, count);
    const double referenceRms = stereo_rms(reference, start, count);
    if (changedRms <= 0.0 || referenceRms <= 0.0) return -1000.0;
    return 20.0 * std::log10(changedRms / referenceRms);
}

static bool test_m1c_bypass_golden() {
    size_t m0Mismatch = 0;
    size_t m1Mismatch = 0;
    size_t m1bMismatch = 0;
    const bool loaded =
        golden_case("presets/m0_saw.txt", "fixtures/m0_events_chord.txt",
                    "/tmp/g4_m0_saw.wav", &m0Mismatch, false, false) &&
        golden_case("presets/m1_unison_saw.txt", "fixtures/m0_events_chord.txt",
                    "/tmp/g4_m1_unison_saw.wav", &m1Mismatch, false, false) &&
        golden_case("presets/m1b_filter_sweep.txt", "fixtures/m0_events_chord.txt",
                    "/tmp/g4_m1b_filter_sweep.wav", &m1bMismatch, false, false);
    const bool ok = loaded && m0Mismatch == 0 && m1Mismatch == 0 && m1bMismatch == 0;
    std::printf("%s 42 M1c bypass golden: m0=%zu m1=%zu m1b=%zu bit_mismatches\n",
                ok ? "PASS" : "FAIL", m0Mismatch, m1Mismatch, m1bMismatch);
    return ok;
}

static bool test_modulation_sources() {
    constexpr uint32_t frames = 24000;
    const std::vector<TimedEvent> note = {{0, SYNTH_EV_NOTE_ON, 601, 60.0f, 1.0f}};
    double effects[7]{};

    std::vector<Parameters> lfoBase = modulation_analysis_params();
    const StereoRender lfoReference = render_stereo(48000, 128, frames, note, lfoBase, 211u);
    add_mod_slot(lfoBase, 0, 1, 1, 1.0f);
    effects[0] = rms_difference_db(
        render_stereo(48000, 128, frames, note, lfoBase, 211u), lfoReference, 0, frames);

    std::vector<Parameters> ampBase = modulation_analysis_params();
    ampBase.insert(ampBase.end(), {{4, 0.25f}, {5, 0.0f}});
    const StereoRender ampReference = render_stereo(48000, 128, frames, note, ampBase, 213u);
    add_mod_slot(ampBase, 0, 2, 1, 1.0f);
    effects[1] = rms_difference_db(
        render_stereo(48000, 128, frames, note, ampBase, 213u), ampReference, 0, frames);

    std::vector<Parameters> filterBase = modulation_analysis_params();
    filterBase.insert(filterBase.end(), {{42, 0.25f}, {43, 0.0f}});
    const StereoRender filterReference = render_stereo(48000, 128, frames, note, filterBase, 217u);
    add_mod_slot(filterBase, 0, 3, 1, 1.0f);
    effects[2] = rms_difference_db(
        render_stereo(48000, 128, frames, note, filterBase, 217u), filterReference, 0, frames);

    std::vector<Parameters> velocityParams = modulation_analysis_params();
    velocityParams.push_back({2, 4.0f});
    add_mod_slot(velocityParams, 0, 4, 1, 1.0f);
    const StereoRender velocityLow = render_stereo(48000, 128, frames,
        {{0, SYNTH_EV_NOTE_ON, 602, 60.0f, 0.25f}}, velocityParams, 219u);
    const StereoRender velocityHigh = render_stereo(48000, 128, frames,
        {{0, SYNTH_EV_NOTE_ON, 602, 60.0f, 1.0f}}, velocityParams, 219u);
    const double velocityRatio = stereo_rms(velocityHigh, 0, frames) /
                                 stereo_rms(velocityLow, 0, frames);
    std::vector<Parameters> velocityEffectBase = modulation_analysis_params();
    velocityEffectBase.push_back({2, 0.25f});
    const StereoRender velocityReference = render_stereo(
        48000, 128, frames, note, velocityEffectBase, 223u);
    add_mod_slot(velocityEffectBase, 0, 4, 1, 1.0f);
    effects[3] = rms_difference_db(
        render_stereo(48000, 128, frames, note, velocityEffectBase, 223u),
        velocityReference, 0, frames);

    std::vector<Parameters> noteParams = modulation_analysis_params();
    noteParams.push_back({2, 2.0f});
    const StereoRender c1Reference = render_stereo(48000, 128, frames,
        {{0, SYNTH_EV_NOTE_ON, 603, 36.0f, 1.0f}}, noteParams, 227u);
    const StereoRender c7Reference = render_stereo(48000, 128, frames,
        {{0, SYNTH_EV_NOTE_ON, 604, 96.0f, 1.0f}}, noteParams, 229u);
    add_mod_slot(noteParams, 0, 5, 1, 1.0f);
    const double c1Db = rms_difference_db(render_stereo(48000, 128, frames,
        {{0, SYNTH_EV_NOTE_ON, 603, 36.0f, 1.0f}}, noteParams, 227u),
        c1Reference, 0, frames);
    const double c7Db = rms_difference_db(render_stereo(48000, 128, frames,
        {{0, SYNTH_EV_NOTE_ON, 604, 96.0f, 1.0f}}, noteParams, 229u),
        c7Reference, 0, frames);
    effects[4] = std::max(std::fabs(c1Db), std::fabs(c7Db));

    for (uint32_t macro = 0; macro < 2; ++macro) {
        std::vector<Parameters> macroZero = modulation_analysis_params();
        add_mod_slot(macroZero, 0, 6u + macro, 1, 1.0f);
        std::vector<Parameters> macroOne = macroZero;
        macroOne.push_back({73u + macro, 1.0f});
        const StereoRender zero = render_stereo(48000, 128, frames, note, macroZero, 233u + macro);
        const StereoRender one = render_stereo(48000, 128, frames, note, macroOne, 233u + macro);
        effects[5u + macro] = rms_difference_db(one, zero, 0, frames);
    }

    bool sourceEffects = true;
    for (double effect : effects) sourceEffects = sourceEffects && std::fabs(effect) >= 1.0;
    const bool ok = sourceEffects && velocityRatio >= 3.5 && velocityRatio <= 4.5 &&
                    c1Db < -1.0 && c7Db > 1.0;
    std::printf("%s 43 sources: LFO=%.3fdB ampEG=%.3fdB filterEG=%.3fdB velocity=%.3fdB "
                "velocity_ratio=%.6f note_C1=%.3fdB note_C7=%.3fdB macro1=%.3fdB macro2=%.3fdB\n",
                ok ? "PASS" : "FAIL", effects[0], effects[1], effects[2], effects[3],
                velocityRatio, c1Db, c7Db, effects[5], effects[6]);
    return ok;
}

static bool test_modulation_destinations() {
    constexpr uint32_t sampleRate = 48000;
    constexpr uint32_t frames = 48000;
    constexpr uint32_t fftSize = 8192;
    double rmsDb[13]{};
    double centroidPercent[13]{};
    bool ok = true;
    for (uint32_t destination = 1; destination <= 13; ++destination) {
        std::vector<Parameters> base = modulation_analysis_params();
        base.insert(base.end(), {{0, 0.0f}, {1, 0.2f}, {2, 1.0f}, {7, 0.2f},
            {17, 0.0f}, {18, 0.2f}, {19, 0.0f}, {46, 2.0f}, {47, 0.0f}, {52, 0.25f}});
        if (destination == 2) base.insert(base.end(), {{2, 0.2f}, {19, 0.25f}});
        if (destination == 4) base.insert(base.end(), {{2, 0.2f}, {19, 1.0f}});
        if (destination == 5) {
            base.insert(base.end(), {{0, 1.0f}, {17, 1.0f}, {46, 0.01f}, {52, 0.25f}});
        }
        if (destination == 6) base.insert(base.end(), {{2, 0.25f}, {29, 0.25f}});
        if (destination == 7) base.insert(base.end(), {{2, 0.25f}, {32, 0.25f}, {34, 60.0f}});
        if (destination == 8 || destination == 9) {
            base.insert(base.end(), {{0, 1.0f}, {35, 1.0f}, {36, 4.0f},
                {37, destination == 8 ? 500.0f : 1000.0f}, {38, 0.0f}});
        }
        if (destination == 10) {
            base.insert(base.end(), {{0, 1.0f}, {46, 0.01f}, {52, 0.25f}});
        }
        if (destination == 11) {
            base.insert(base.end(), {{0, 0.0f}, {9, 4.0f}, {10, 0.0f},
                {15, 1.0f}, {16, 0.25f}, {46, 0.01f}, {52, 0.25f}});
        }
        if (destination == 12) {
            base.insert(base.end(), {{46, 0.5f}, {47, 4.0f}, {51, 1.0f}, {52, 0.0f}});
        }
        const std::vector<TimedEvent> events = {{0, SYNTH_EV_NOTE_ON, 620u + destination, 48.0f, 1.0f}};
        const StereoRender reference = render_stereo(sampleRate, 128, frames, events, base, 241u);
        add_mod_slot(base, 0, 1, destination, 1.0f);
        const StereoRender changed = render_stereo(sampleRate, 128, frames, events, base, 241u);
        const size_t rmsFrames = destination == 12 ? 12000u : frames;
        rmsDb[destination - 1] = rms_difference_db(changed, reference, 0, rmsFrames);
        const double referenceCentroid = spectral_centroid(reference.left, sampleRate, 0, fftSize);
        const double changedCentroid = spectral_centroid(changed.left, sampleRate, 0, fftSize);
        centroidPercent[destination - 1] =
            std::fabs(changedCentroid - referenceCentroid) / referenceCentroid * 100.0;
        ok = ok && std::isfinite(rmsDb[destination - 1]) &&
            std::isfinite(centroidPercent[destination - 1]) &&
            (std::fabs(rmsDb[destination - 1]) >= 1.0 ||
             centroidPercent[destination - 1] >= 5.0);
    }
    std::printf("%s 44 destinations:", ok ? "PASS" : "FAIL");
    for (uint32_t destination = 1; destination <= 13; ++destination) {
        std::printf(" d%u=%.3fdB/%.2f%%", destination,
                    rmsDb[destination - 1], centroidPercent[destination - 1]);
    }
    std::printf("\n");
    return ok;
}

static double centroid_span_octaves(const StereoRender& output, uint32_t windows) {
    constexpr uint32_t fftSize = 2048;
    double minimum = 1.0e30;
    double maximum = 0.0;
    for (uint32_t window = 0; window < windows; ++window) {
        const double centroid = spectral_centroid(output.left, 48000, window * fftSize, fftSize);
        minimum = std::min(minimum, centroid);
        maximum = std::max(maximum, centroid);
    }
    return std::log2(maximum / minimum);
}

static bool test_modulation_summing() {
    constexpr uint32_t windows = 24;
    constexpr uint32_t frames = windows * 2048;
    std::vector<Parameters> oneSlot = modulation_analysis_params();
    oneSlot.insert(oneSlot.end(), {{2, 0.0f}, {32, 1.0f}, {34, 60.0f},
        {35, 1.0f}, {36, 4.0f}, {37, 1000.0f}, {38, 0.0f},
        {46, 1.0f}, {47, 0.0f}, {52, 0.0f}});
    add_mod_slot(oneSlot, 0, 1, 8, 0.0625f);
    std::vector<Parameters> twoSlots = oneSlot;
    add_mod_slot(twoSlots, 1, 1, 8, 0.0625f);
    const std::vector<TimedEvent> events = {{0, SYNTH_EV_NOTE_ON, 641, 60.0f, 1.0f}};
    const StereoRender one = render_stereo(48000, 128, frames, events, oneSlot, 251u);
    const StereoRender two = render_stereo(48000, 128, frames, events, twoSlots, 251u);
    const double oneSpan = centroid_span_octaves(one, windows);
    const double twoSpan = centroid_span_octaves(two, windows);
    const double ratio = twoSpan / oneSpan;
    const bool ok = std::isfinite(ratio) && ratio >= 1.6 && ratio <= 2.4;
    std::printf("%s 45 summing: cutoff_centroid_span_one=%.6foct two=%.6foct ratio=%.6f expected=2+/-20%%\n",
                ok ? "PASS" : "FAIL", oneSpan, twoSpan, ratio);
    return ok;
}

static bool test_macro_event() {
    constexpr uint32_t sampleRate = 48000;
    constexpr uint32_t frames = 48000;
    std::vector<Parameters> parameters = modulation_analysis_params();
    parameters.push_back({2, 0.0f});
    add_mod_slot(parameters, 0, 6, 1, 1.0f);
    const std::vector<TimedEvent> events = {
        {0, SYNTH_EV_NOTE_ON, 651, 60.0f, 1.0f},
        {24000, SYNTH_EV_MACRO, 0, 1.0f, 0.0f}
    };
    const StereoRender output = render_stereo(sampleRate, 128, frames, events, parameters, 257u);
    const double beforeRms = stereo_rms(output, 12000, 10000);
    const double afterRms = stereo_rms(output, 30000, 16000);

    std::vector<unsigned char> state(synth_state_size());
    SynthEngine* engine = synth_create(state.data(), state.size(), sampleRate, 1);
    if (engine == nullptr) return false;
    for (const Parameters& parameter : parameters)
        if (synth_set_param(engine, parameter.id, parameter.value) != 0) return false;
    synth_reset(engine, SYNTH_RESET_VOICES, 257u);
    float left = 0.0f;
    float right = 0.0f;
    const SynthEvent noteOn{0, SYNTH_EV_NOTE_ON, 651, 60.0f, 1.0f};
    if (synth_process(engine, &noteOn, 1, &left, &right, 1) != 0) return false;
    for (uint32_t i = 1; i < 24000; ++i)
        if (synth_process(engine, nullptr, 0, &left, &right, 1) != 0) return false;
    const double before = engine->macroSmoothed[0];
    const SynthEvent macro{0, SYNTH_EV_MACRO, 0, 1.0f, 0.0f};
    if (synth_process(engine, &macro, 1, &left, &right, 1) != 0) return false;
    const double immediate = engine->macroSmoothed[0];
    for (uint32_t i = 1; i < 240; ++i)
        if (synth_process(engine, nullptr, 0, &left, &right, 1) != 0) return false;
    const double atFiveMs = engine->macroSmoothed[0];
    const SynthEvent invalid{0, SYNTH_EV_MACRO, 2, 0.5f, 0.0f};
    const int invalidIgnored = synth_process(engine, &invalid, 1, &left, &right, 1);
    const bool ok = beforeRms == 0.0 && afterRms > 0.01 && before == 0.0 &&
                    immediate > 0.0 && atFiveMs >= 0.62 && atFiveMs <= 0.65 &&
                    invalidIgnored == 1;
    std::printf("%s 46 macro event: before_rms=%.9f after_rms=%.9f immediate=%.9f at_5ms=%.9f invalid_ignored=%d\n",
                ok ? "PASS" : "FAIL", beforeRms, afterRms, immediate, atFiveMs, invalidIgnored);
    return ok;
}

static std::vector<Parameters> all_m1c_params() {
    std::vector<Parameters> parameters = all_m1b_params();
    parameters.insert(parameters.end(), {{47, 5.0f}, {73, 0.4f}, {74, 0.7f}});
    add_mod_slot(parameters, 0, 1, 1, 0.2f);
    add_mod_slot(parameters, 1, 2, 3, 0.3f);
    add_mod_slot(parameters, 2, 3, 8, 0.15f);
    add_mod_slot(parameters, 3, 4, 9, 0.2f);
    add_mod_slot(parameters, 4, 5, 10, 0.1f);
    add_mod_slot(parameters, 5, 6, 13, 0.25f);
    return parameters;
}

static bool test_m1c_determinism() {
    const std::vector<TimedEvent> events = {
        {0, SYNTH_EV_NOTE_ON, 661, 48.0f, 0.8f},
        {257, SYNTH_EV_NOTE_ON, 662, 55.0f, 0.6f},
        {2049, SYNTH_EV_NOTE_OFF, 661, 0.0f, 0.0f},
        {3073, SYNTH_EV_NOTE_OFF, 662, 0.0f, 0.0f}
    };
    const uint32_t blocks[] = {1, 7, 64, 128, 511};
    const StereoRender reference = render_stereo(
        48000, blocks[0], 4096, events, all_m1c_params(), 263u);
    size_t blockMismatch = 0;
    for (size_t i = 1; i < sizeof(blocks) / sizeof(blocks[0]); ++i) {
        const StereoRender comparison = render_stereo(
            48000, blocks[i], 4096, events, all_m1c_params(), 263u);
        blockMismatch += bit_mismatches(reference.left, comparison.left);
        blockMismatch += bit_mismatches(reference.right, comparison.right);
    }

    constexpr uint32_t block = 128;
    constexpr uint32_t frames = 4096;
    std::vector<unsigned char> state(synth_state_size());
    SynthEngine* engine = synth_create(state.data(), state.size(), 48000.0, block);
    if (engine == nullptr) return false;
    for (const Parameters& parameter : all_m1c_params())
        if (synth_set_param(engine, parameter.id, parameter.value) != 0) return false;
    StereoRender first{std::vector<float>(frames), std::vector<float>(frames)};
    StereoRender second{std::vector<float>(frames), std::vector<float>(frames)};
    const SynthEvent note{0, SYNTH_EV_NOTE_ON, 663, 52.0f, 0.8f};
    for (uint32_t pass = 0; pass < 2; ++pass) {
        synth_reset(engine, SYNTH_RESET_VOICES, 269u);
        StereoRender& output = pass == 0 ? first : second;
        for (uint32_t position = 0; position < frames; position += block) {
            const SynthEvent* blockEvent = position == 0 ? &note : nullptr;
            const uint32_t eventCount = position == 0 ? 1u : 0u;
            if (synth_process(engine, blockEvent, eventCount,
                output.left.data() + position, output.right.data() + position, block) != 0)
                return false;
        }
    }
    const size_t resetMismatch = bit_mismatches(first.left, second.left) +
                                 bit_mismatches(first.right, second.right);
    const bool ok = !reference.left.empty() && blockMismatch == 0 && resetMismatch == 0;
    std::printf("%s 47 M1c determinism: blocks=1,7,64,128,511 block_mismatches=%zu reset_mismatches=%zu\n",
                ok ? "PASS" : "FAIL", blockMismatch, resetMismatch);
    return ok;
}

static bool test_m1c_performance() {
    constexpr uint32_t block = 128;
    constexpr uint32_t iterations = 1000;
    constexpr double deadline = 2667.0;
    std::vector<unsigned char> state(synth_state_size());
    SynthEngine* engine = synth_create(state.data(), state.size(), 48000.0, block);
    if (engine == nullptr) return false;
    std::vector<Parameters> parameters = {
        {0, 1.0f}, {2, 0.8f}, {3, 0.0f}, {4, 0.0f}, {5, 1.0f}, {7, 0.05f},
        {8, 16.0f}, {9, 4.0f}, {10, 12.0f}, {11, 0.8f}, {35, 1.0f},
        {36, 4.0f}, {37, 1000.0f}, {38, 0.7f}, {46, 5.0f}, {47, 0.0f},
        {49, 3.0f}, {73, 0.5f}, {74, 0.25f}
    };
    add_mod_slot(parameters, 0, 1, 8, 0.25f);
    add_mod_slot(parameters, 1, 2, 1, 0.1f);
    add_mod_slot(parameters, 2, 3, 9, 0.1f);
    add_mod_slot(parameters, 3, 4, 10, 0.05f);
    add_mod_slot(parameters, 4, 5, 11, 0.1f);
    add_mod_slot(parameters, 5, 6, 13, 0.25f);
    for (const Parameters& parameter : parameters)
        if (synth_set_param(engine, parameter.id, parameter.value) != 0) return false;
    synth_reset(engine, SYNTH_RESET_VOICES, 271u);
    SynthEvent notes[16]{};
    for (uint32_t i = 0; i < 16; ++i)
        notes[i] = SynthEvent{0, SYNTH_EV_NOTE_ON, 700u + i, 36.0f + i * 2.0f, 0.7f};
    float left[block]{};
    float right[block]{};
    if (synth_process(engine, notes, 16, left, right, block) != 0) return false;
    for (uint32_t i = 0; i < 100; ++i)
        if (synth_process(engine, nullptr, 0, left, right, block) != 0) return false;
    std::vector<double> timings;
    timings.reserve(iterations);
    double sum = 0.0;
    for (uint32_t i = 0; i < iterations; ++i) {
        const auto start = std::chrono::steady_clock::now();
        const int result = synth_process(engine, nullptr, 0, left, right, block);
        const auto stop = std::chrono::steady_clock::now();
        if (result != 0) return false;
        const double micros = std::chrono::duration<double, std::micro>(stop - start).count();
        timings.push_back(micros);
        sum += micros;
    }
    std::sort(timings.begin(), timings.end());
    const double average = sum / iterations;
    const double p99 = timings[static_cast<size_t>(iterations * 0.99)];
    const bool ok = std::isfinite(average) && std::isfinite(p99) && p99 < deadline * 0.5;
    std::printf("%s 48 M1c performance: slots=6 voices=16 unison=4 LP24 average_us=%.6f p99_us=%.6f half_deadline_us=%.6f\n",
                ok ? "PASS" : "FAIL", average, p99, deadline * 0.5);
    return ok;
}

int main() {
    uint32_t passed = 0;
    passed += test_block_invariance();
    passed += test_event_ordering();
    passed += test_note_position();
    passed += test_finite_output();
    passed += test_polyphony();
    passed += test_determinism();
    passed += test_fast_math();
    passed += test_aliasing();
    passed += test_unison_determinism();
    passed += test_unison_loudness();
    passed += test_unison_detune();
    passed += test_unison_pan();
    passed += test_fm_disabled_bit_match();
    passed += test_fm_bandwidth();
    passed += test_fm_aliasing();
    passed += test_sub_oscillator();
    passed += test_noise_decay_determinism();
    passed += test_pink_noise_slope();
    passed += test_parameter_sweep();
    passed += test_performance();
    passed += test_extended_block_invariance();
    passed += test_m1b_bypass_golden();
    passed += test_filter_cutoff_accuracy();
    passed += test_filter_slopes();
    passed += test_filter_resonance_peak();
    passed += test_filter_self_oscillation_stability();
    passed += test_filter_fast_modulation_stability();
    passed += test_filter_key_tracking();
    passed += test_filter_envelope_centroid();
    passed += test_lfo_shapes();
    passed += test_lfo_retrigger();
    passed += test_m1b_block_invariance();
    passed += test_m1b_reset_determinism();
    passed += test_m1b_performance();
    passed += test_curve_zero_golden_and_metadata();
    passed += test_linear_envelope_uniformity();
    passed += test_envelope_curve_monotonicity();
    passed += test_envelope_curve_health();
    passed += test_m0a_g3_bit_match();
    passed += test_path_independent_randomness();
    passed += test_m1a_character_preservation();
    passed += test_m1c_bypass_golden();
    passed += test_modulation_sources();
    passed += test_modulation_destinations();
    passed += test_modulation_summing();
    passed += test_macro_event();
    passed += test_m1c_determinism();
    passed += test_m1c_performance();
    passed += test_sub_oscillator_one_octave_up();
    std::printf("SUMMARY passed=%u failed=%u total=49\n", passed, 49u - passed);
    return passed == 49 ? 0 : 1;
}
