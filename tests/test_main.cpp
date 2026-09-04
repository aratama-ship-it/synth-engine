#include "synth_engine.h"
#include "engine.hpp"
#include "fast_math.hpp"
#include "rng.hpp"

#include <algorithm>
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
    constexpr uint32_t samples = 100000;
    for (uint32_t i = 0; i <= samples; ++i) {
        const double ratio = static_cast<double>(i) / static_cast<double>(samples);
        const double angle = ratio * synth::kTwoPi;
        maxSinError = std::max(maxSinError, std::fabs(synth::fast_sin(angle) - std::sin(angle)));
        maxCosError = std::max(maxCosError, std::fabs(synth::fast_cos(angle) - std::cos(angle)));
        const double expected = std::exp2(ratio);
        maxExpRelative = std::max(maxExpRelative,
            std::fabs(synth::fast_exp2(ratio) - expected) / expected);
    }
    const bool ok = maxSinError <= 1.0e-4 && maxCosError <= 1.0e-4 &&
                    maxExpRelative <= 1.0e-5;
    std::printf("%s 7 fast_math: sin_max=%.9g cos_max=%.9g exp2_rel_max=%.9g\n",
                ok ? "PASS" : "FAIL", maxSinError, maxCosError, maxExpRelative);
    return ok;
}

struct Complex {
    double real;
    double imag;
};

static void fft_2048(Complex* values) {
    constexpr uint32_t count = 2048;
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
    std::printf("SUMMARY passed=%u failed=%u total=8\n", passed, 8u - passed);
    return passed == 8 ? 0 : 1;
}
