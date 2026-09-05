#include "engine.hpp"
#include "fast_math.hpp"
#include "rng.hpp"

namespace {

enum ParamId : uint32_t {
    kOscWavetable = 0,
    kOscMorph = 1,
    kOscLevel = 2,
    kAmpAttack = 3,
    kAmpDecay = 4,
    kAmpSustain = 5,
    kAmpRelease = 6,
    kMasterGain = 7,
    kVoiceCount = 8,
    kOscAUnison = 9,
    kOscADetune = 10,
    kOscAWidth = 11,
    kOscAOctave = 12,
    kOscASemitone = 13,
    kOscAFine = 14,
    kOscAPhaseMode = 15,
    kOscAPhase = 16,
    kOscBWavetable = 17,
    kOscBMorph = 18,
    kOscBLevel = 19,
    kOscBUnison = 20,
    kOscBDetune = 21,
    kOscBWidth = 22,
    kOscBOctave = 23,
    kOscBSemitone = 24,
    kOscBFine = 25,
    kOscBPhaseMode = 26,
    kOscBPhase = 27,
    kFmBToA = 28,
    kSubLevel = 29,
    kSubShape = 30,
    kSubOctave = 31,
    kNoiseLevel = 32,
    kNoiseColor = 33,
    kNoiseDecay = 34,
    kFilterEnabled = 35,
    kFilterMode = 36,
    kFilterCutoff = 37,
    kFilterResonance = 38,
    kFilterKeyTrack = 39,
    kFilterEnvAmount = 40,
    kFilterEgAttack = 41,
    kFilterEgDecay = 42,
    kFilterEgSustain = 43,
    kFilterEgRelease = 44,
    kFilterVelToEnv = 45,
    kLfoRate = 46,
    kLfoShape = 47,
    kLfoRetrigger = 48,
    kLfoToCutoff = 49,
    kLfoToPitch = 50,
    kLfoToAmp = 51,
    kLfoPhase = 52,
    kAmpEgCurve = 53,
    kFilterEgCurve = 54,
    kModSlotBase = 55,
    kMacro1 = 73,
    kMacro2 = 74
};

constexpr uint32_t kModSlotCount = 6;
constexpr uint32_t kModSlotStride = 3;
constexpr uint32_t kModDestinationCount = 14;
constexpr uint32_t kLfoHashLayer = 32u;
constexpr uint32_t kGlobalLfoIndex = 0xffffffffu;

struct ModulationValues {
    float destination[kModDestinationCount];
};

constexpr float kModDestinationFull[kModDestinationCount] = {
    0.0f, 4.0f, 4.0f, 1.0f, 1.0f, 1.0f, 4.0f,
    4.0f, 8.0f, 1.0f, 1200.0f, 50.0f, 8.0f, 1.0f
};

float rounded_integer(float value, float low, float high) {
    value = synth::clampf(value, low, high);
    const int32_t rounded = value >= 0.0f ? static_cast<int32_t>(value + 0.5f)
                                          : static_cast<int32_t>(value - 0.5f);
    return static_cast<float>(rounded);
}

double wrap_phase(double phase) {
    long long whole = static_cast<long long>(phase);
    if (phase < 0.0 && static_cast<double>(whole) != phase) --whole;
    return phase - static_cast<double>(whole);
}

double unison_position(uint32_t index, uint32_t count) {
    if (count <= 1) return 0.0;
    return (2.0 * static_cast<double>(index) / static_cast<double>(count - 1)) - 1.0;
}

float unison_normalization(uint32_t count) {
    static constexpr float gains[synth::kMaxUnison + 1] = {
        0.0f, 1.0f, 0.70710678118654752440f, 0.57735026918962576451f, 0.5f
    };
    return gains[count <= synth::kMaxUnison ? count : synth::kMaxUnison];
}

void pan_gains(uint32_t index, uint32_t count, float width, float* left, float* right) {
    const double pan = static_cast<double>(width) * unison_position(index, count);
    const double angle = (pan + 1.0) * synth::kPi * 0.25;
    if (pan == 0.0) {
        const float center = static_cast<float>(synth::fast_sin(synth::kPi * 0.25));
        *left = center;
        *right = center;
        return;
    }
    *left = static_cast<float>(synth::fast_cos(angle));
    *right = static_cast<float>(synth::fast_sin(angle));
}

void clear_voice(synth::Voice* voice) {
    voice->active = 0;
    voice->noteId = 0;
    voice->stage = synth::kEnvOff;
    voice->startOrder = 0;
    voice->releaseOrder = 0;
    voice->baseFrequency = 0.0;
    voice->midiNote = 0.0f;
    for (uint32_t i = 0; i < synth::kMaxUnison; ++i) {
        voice->phaseA[i] = 0.0;
        voice->phaseB[i] = 0.0;
        voice->frequencyA[i] = 0.0;
        voice->frequencyB[i] = 0.0;
    }
    voice->phaseSub = 0.0;
    voice->frequencySub = 0.0;
    voice->sampleIndex = 0;
    voice->noiseEnvelope = 0.0f;
    voice->pinkState[0] = 0.0f;
    voice->pinkState[1] = 0.0f;
    voice->pinkState[2] = 0.0f;
    voice->velocity = 0.0f;
    voice->envelope = 0.0f;
    voice->envelopeStageSamples = 0;
    voice->envelopeReleaseStart = 0.0f;
    voice->filterStage = synth::kEnvOff;
    voice->filterEnvelope = 0.0f;
    voice->filterEnvelopeStageSamples = 0;
    voice->filterEnvelopeReleaseStart = 0.0f;
    for (uint32_t channel = 0; channel < 2; ++channel) {
        for (uint32_t stage = 0; stage < 2; ++stage) {
            voice->filter[channel][stage].ic1 = 0.0;
            voice->filter[channel][stage].ic2 = 0.0;
        }
    }
    voice->lfoPhase = 0.0;
    voice->lfoCycleIndex = 0;
    voice->lfoHold = 0.0f;
}

void update_noise_coefficients(SynthEngine* engine) {
    const double decay = engine->params[kNoiseDecay] < 0.0005f
        ? 0.0005 : static_cast<double>(engine->params[kNoiseDecay]);
    engine->noiseDecayCoefficient = static_cast<float>(
        synth::fast_exp2(-1.0 / (decay * engine->sampleRate * synth::kLn2)));
    static constexpr double cutoffs[3] = {20.0, 200.0, 2000.0};
    for (uint32_t i = 0; i < 3; ++i) {
        engine->pinkCoefficient[i] = static_cast<float>(synth::fast_exp2(
            -synth::kTwoPi * cutoffs[i] / (engine->sampleRate * synth::kLn2)));
    }
}

void reset_params(SynthEngine* engine) {
    for (uint32_t id = 0; id < synth::kParamCount; ++id)
        engine->params[id] = synth::kParameterInfo[id].defaultValue;
    engine->voiceLimit = static_cast<uint32_t>(engine->params[kVoiceCount]);
    update_noise_coefficients(engine);
    engine->filterSmoothingCoefficient = 1.0 - synth::fast_exp2(
        -1.0 / (0.005 * engine->sampleRate * synth::kLn2));
}

float lfo_hash_value(const SynthEngine* engine, uint64_t cycleIndex, uint32_t voiceIndex) {
    return synth::hash_to_unit(synth::hash32(
        engine->seed, static_cast<uint32_t>(cycleIndex), voiceIndex, kLfoHashLayer)) * 2.0f - 1.0f;
}

void reset_modulators(SynthEngine* engine) {
    engine->filterCutoffSmoothed = static_cast<double>(engine->params[kFilterCutoff]);
    engine->filterResonanceSmoothed = static_cast<double>(engine->params[kFilterResonance]);
    engine->macroSmoothed[0] = static_cast<double>(engine->params[kMacro1]);
    engine->macroSmoothed[1] = static_cast<double>(engine->params[kMacro2]);
    engine->globalLfoPhase = static_cast<double>(engine->params[kLfoPhase]);
    engine->globalLfoCycleIndex = 0;
    engine->globalLfoHold = lfo_hash_value(engine, 0, kGlobalLfoIndex);
}

double midi_frequency(float midi) {
    return 440.0 * synth::fast_exp2((static_cast<double>(midi) - 69.0) / 12.0);
}

void update_voice_frequencies(const SynthEngine* engine, synth::Voice* voice) {
    const uint32_t unisonA = static_cast<uint32_t>(engine->params[kOscAUnison]);
    const uint32_t unisonB = static_cast<uint32_t>(engine->params[kOscBUnison]);
    const double pitchA = static_cast<double>(engine->params[kOscAOctave]) * 12.0 +
                          static_cast<double>(engine->params[kOscASemitone]) +
                          static_cast<double>(engine->params[kOscAFine]) * 0.01;
    const double pitchB = static_cast<double>(engine->params[kOscBOctave]) * 12.0 +
                          static_cast<double>(engine->params[kOscBSemitone]) +
                          static_cast<double>(engine->params[kOscBFine]) * 0.01;
    for (uint32_t i = 0; i < synth::kMaxUnison; ++i) {
        const double detuneA = static_cast<double>(engine->params[kOscADetune]) *
                               unison_position(i, unisonA) * 0.01;
        const double detuneB = static_cast<double>(engine->params[kOscBDetune]) *
                               unison_position(i, unisonB) * 0.01;
        voice->frequencyA[i] = voice->baseFrequency * synth::fast_exp2((pitchA + detuneA) / 12.0);
        voice->frequencyB[i] = voice->baseFrequency * synth::fast_exp2((pitchB + detuneB) / 12.0);
    }
    voice->frequencySub = voice->baseFrequency *
        synth::fast_exp2(static_cast<double>(engine->params[kSubOctave]));
}

void update_active_frequencies(SynthEngine* engine) {
    for (uint32_t i = 0; i < engine->voiceLimit; ++i) {
        if (engine->voices[i].active != 0) update_voice_frequencies(engine, &engine->voices[i]);
    }
}

bool legacy_configuration(const SynthEngine* engine) {
    return engine->params[kOscAUnison] == 1.0f &&
           engine->params[kOscAOctave] == 0.0f &&
           engine->params[kOscASemitone] == 0.0f &&
           engine->params[kOscAFine] == 0.0f &&
           engine->params[kOscAPhaseMode] == 0.0f &&
           engine->params[kOscAPhase] == 0.0f &&
           engine->params[kOscBLevel] == 0.0f &&
           engine->params[kFmBToA] == 0.0f &&
           engine->params[kSubLevel] == 0.0f &&
           engine->params[kNoiseLevel] == 0.0f &&
           engine->params[kFilterEnabled] == 0.0f &&
           engine->params[kLfoToCutoff] == 0.0f &&
           engine->params[kLfoToPitch] == 0.0f &&
           engine->params[kLfoToAmp] == 0.0f;
}

bool m1b_bypassed(const SynthEngine* engine) {
    return engine->params[kFilterEnabled] == 0.0f &&
           engine->params[kLfoToCutoff] == 0.0f &&
           engine->params[kLfoToPitch] == 0.0f &&
           engine->params[kLfoToAmp] == 0.0f;
}

bool modulation_matrix_active(const SynthEngine* engine) {
    for (uint32_t slot = 0; slot < kModSlotCount; ++slot) {
        const uint32_t base = kModSlotBase + slot * kModSlotStride;
        if (engine->params[base] != 0.0f && engine->params[base + 1] != 0.0f &&
            engine->params[base + 2] != 0.0f) return true;
    }
    return false;
}

synth::Voice* choose_voice(SynthEngine* engine, uint32_t noteId) {
    for (uint32_t i = 0; i < engine->voiceLimit; ++i) {
        if (engine->voices[i].active != 0 && engine->voices[i].noteId == noteId)
            return &engine->voices[i];
    }
    for (uint32_t i = 0; i < engine->voiceLimit; ++i) {
        if (engine->voices[i].active == 0) return &engine->voices[i];
    }
    synth::Voice* oldestRelease = 0;
    for (uint32_t i = 0; i < engine->voiceLimit; ++i) {
        synth::Voice* voice = &engine->voices[i];
        if (voice->stage == synth::kEnvRelease &&
            (oldestRelease == 0 || voice->releaseOrder < oldestRelease->releaseOrder))
            oldestRelease = voice;
    }
    if (oldestRelease != 0) return oldestRelease;
    synth::Voice* oldest = &engine->voices[0];
    for (uint32_t i = 1; i < engine->voiceLimit; ++i) {
        if (engine->voices[i].startOrder < oldest->startOrder) oldest = &engine->voices[i];
    }
    return oldest;
}

double hashed_phase(const SynthEngine* engine, uint32_t startOrder, uint32_t voiceIndex,
                    uint32_t layer) {
    return static_cast<double>(synth::hash_to_unit(
        synth::hash32(engine->seed, startOrder, voiceIndex, layer)));
}

void note_on(SynthEngine* engine, const SynthEvent& event) {
    synth::Voice* voice = choose_voice(engine, event.id);
    const uint32_t voiceIndex = static_cast<uint32_t>(voice - engine->voices);
    clear_voice(voice);
    voice->active = 1;
    voice->noteId = event.id;
    voice->stage = synth::kEnvAttack;
    voice->startOrder = ++engine->orderCounter;
    voice->baseFrequency = midi_frequency(event.a);
    voice->midiNote = event.a;
    voice->velocity = synth::clampf(event.b, 0.0f, 1.0f);
    voice->noiseEnvelope = 1.0f;
    voice->filterStage = synth::kEnvAttack;
    update_voice_frequencies(engine, voice);

    const bool fixedA = engine->params[kOscAPhaseMode] == 1.0f;
    const bool fixedB = engine->params[kOscBPhaseMode] == 1.0f;
    const uint32_t startOrder = static_cast<uint32_t>(voice->startOrder);
    for (uint32_t i = 0; i < synth::kMaxUnison; ++i) {
        voice->phaseA[i] = fixedA ? static_cast<double>(engine->params[kOscAPhase])
                                  : hashed_phase(engine, startOrder, voiceIndex, i);
        voice->phaseB[i] = fixedB ? static_cast<double>(engine->params[kOscBPhase])
                                  : hashed_phase(engine, startOrder, voiceIndex, 8u + i);
    }
    // M0a began at 0.25 cycle. Preserve that exact path when every M1a source is disabled.
    if (!fixedA && legacy_configuration(engine)) voice->phaseA[0] = 0.25;
    voice->phaseSub = hashed_phase(engine, startOrder, voiceIndex, 16u);
    voice->lfoPhase = static_cast<double>(engine->params[kLfoPhase]);
    voice->lfoCycleIndex = 0;
    voice->lfoHold = lfo_hash_value(engine, 0, voiceIndex);
}

void note_off(SynthEngine* engine, uint32_t noteId) {
    for (uint32_t i = 0; i < engine->voiceLimit; ++i) {
        synth::Voice* voice = &engine->voices[i];
        if (voice->active != 0 && voice->noteId == noteId) {
            voice->stage = synth::kEnvRelease;
            voice->envelopeStageSamples = 0;
            voice->envelopeReleaseStart = voice->envelope;
            voice->filterStage = synth::kEnvRelease;
            voice->filterEnvelopeStageSamples = 0;
            voice->filterEnvelopeReleaseStart = voice->filterEnvelope;
            voice->releaseOrder = ++engine->orderCounter;
        }
    }
}

float envelope_shape(uint64_t elapsedSamples, double samples, float curve) {
    const double progress = static_cast<double>(elapsedSamples) / samples;
    const double remaining = 1.0 - progress;
    if (curve == 1.0f) return static_cast<float>(remaining);
    constexpr double end = 0.00390625;  // 2^-8
    const double exponential = (synth::fast_exp2(-8.0 * progress) - end) / (1.0 - end);
    return static_cast<float>((1.0 - static_cast<double>(curve)) * exponential +
                              static_cast<double>(curve) * remaining);
}

float advance_filter_envelope(SynthEngine* engine, synth::Voice* voice) {
    if (voice->filterStage == synth::kEnvAttack) {
        const double samples = static_cast<double>(engine->params[kFilterEgAttack]) * engine->sampleRate;
        if (samples <= 1.0) voice->filterEnvelope = 1.0f;
        else voice->filterEnvelope += static_cast<float>(1.0 / samples);
        if (voice->filterEnvelope >= 1.0f) {
            voice->filterEnvelope = 1.0f;
            voice->filterStage = synth::kEnvDecay;
            voice->filterEnvelopeStageSamples = 0;
        }
    } else if (voice->filterStage == synth::kEnvDecay) {
        const float sustain = engine->params[kFilterEgSustain];
        const double samples = static_cast<double>(engine->params[kFilterEgDecay]) * engine->sampleRate;
        if (engine->params[kFilterEgCurve] == 0.0f) {
            if (samples <= 1.0) voice->filterEnvelope = sustain;
            else {
                const float coefficient = static_cast<float>(synth::fast_exp2(-8.0 / samples));
                voice->filterEnvelope = sustain + (voice->filterEnvelope - sustain) * coefficient;
            }
            if (synth::absd(static_cast<double>(voice->filterEnvelope - sustain)) < 1.0e-6) {
                voice->filterEnvelope = sustain;
                voice->filterStage = synth::kEnvSustain;
            }
        } else if (samples <= 1.0) {
            voice->filterEnvelope = sustain;
            voice->filterStage = synth::kEnvSustain;
        } else {
            ++voice->filterEnvelopeStageSamples;
            if (static_cast<double>(voice->filterEnvelopeStageSamples) >= samples) {
                voice->filterEnvelope = sustain;
                voice->filterStage = synth::kEnvSustain;
            } else {
                const float shape = envelope_shape(voice->filterEnvelopeStageSamples, samples,
                                                   engine->params[kFilterEgCurve]);
                voice->filterEnvelope = sustain + (1.0f - sustain) * shape;
            }
        }
    } else if (voice->filterStage == synth::kEnvSustain) {
        voice->filterEnvelope = engine->params[kFilterEgSustain];
    } else if (voice->filterStage == synth::kEnvRelease) {
        const double samples = static_cast<double>(engine->params[kFilterEgRelease]) * engine->sampleRate;
        if (engine->params[kFilterEgCurve] == 0.0f) {
            if (samples <= 1.0) voice->filterEnvelope = 0.0f;
            else voice->filterEnvelope *= static_cast<float>(synth::fast_exp2(-16.0 / samples));
            if (voice->filterEnvelope <= 0.0000158489319f) {
                voice->filterEnvelope = 0.0f;
                voice->filterStage = synth::kEnvOff;
            }
        } else if (samples <= 1.0) {
            voice->filterEnvelope = 0.0f;
            voice->filterStage = synth::kEnvOff;
        } else {
            ++voice->filterEnvelopeStageSamples;
            if (static_cast<double>(voice->filterEnvelopeStageSamples) >= samples) {
                voice->filterEnvelope = 0.0f;
                voice->filterStage = synth::kEnvOff;
            } else {
                voice->filterEnvelope = voice->filterEnvelopeReleaseStart * envelope_shape(
                    voice->filterEnvelopeStageSamples, samples, engine->params[kFilterEgCurve]);
            }
        }
    }
    return voice->filterEnvelope;
}

float advance_envelope(SynthEngine* engine, synth::Voice* voice) {
    if (voice->stage == synth::kEnvAttack) {
        const double samples = static_cast<double>(engine->params[kAmpAttack]) * engine->sampleRate;
        if (samples <= 1.0) voice->envelope = 1.0f;
        else voice->envelope += static_cast<float>(1.0 / samples);
        if (voice->envelope >= 1.0f) {
            voice->envelope = 1.0f;
            voice->stage = synth::kEnvDecay;
            voice->envelopeStageSamples = 0;
        }
    } else if (voice->stage == synth::kEnvDecay) {
        const float sustain = engine->params[kAmpSustain];
        const double samples = static_cast<double>(engine->params[kAmpDecay]) * engine->sampleRate;
        if (engine->params[kAmpEgCurve] == 0.0f) {
            if (samples <= 1.0) voice->envelope = sustain;
            else {
                const float coefficient = static_cast<float>(synth::fast_exp2(-8.0 / samples));
                voice->envelope = sustain + (voice->envelope - sustain) * coefficient;
            }
            if (synth::absd(static_cast<double>(voice->envelope - sustain)) < 1.0e-6) {
                voice->envelope = sustain;
                voice->stage = synth::kEnvSustain;
            }
        } else if (samples <= 1.0) {
            voice->envelope = sustain;
            voice->stage = synth::kEnvSustain;
        } else {
            ++voice->envelopeStageSamples;
            if (static_cast<double>(voice->envelopeStageSamples) >= samples) {
                voice->envelope = sustain;
                voice->stage = synth::kEnvSustain;
            } else {
                const float shape = envelope_shape(voice->envelopeStageSamples, samples,
                                                   engine->params[kAmpEgCurve]);
                voice->envelope = sustain + (1.0f - sustain) * shape;
            }
        }
    } else if (voice->stage == synth::kEnvSustain) {
        voice->envelope = engine->params[kAmpSustain];
    } else if (voice->stage == synth::kEnvRelease) {
        const double samples = static_cast<double>(engine->params[kAmpRelease]) * engine->sampleRate;
        if (engine->params[kAmpEgCurve] == 0.0f) {
            if (samples <= 1.0) voice->envelope = 0.0f;
            else voice->envelope *= static_cast<float>(synth::fast_exp2(-16.0 / samples));
            if (voice->envelope <= 0.0000158489319f) clear_voice(voice);
        } else if (samples <= 1.0) {
            clear_voice(voice);
        } else {
            ++voice->envelopeStageSamples;
            if (static_cast<double>(voice->envelopeStageSamples) >= samples) {
                clear_voice(voice);
            } else {
                voice->envelope = voice->envelopeReleaseStart * envelope_shape(
                    voice->envelopeStageSamples, samples, engine->params[kAmpEgCurve]);
            }
        }
    }
    return voice->envelope;
}

void apply_event_param(SynthEngine* engine, const SynthEvent& event) {
    if (event.kind == SYNTH_EV_PARAM) {
        (void)synth_set_param(engine, event.id, event.a);
    } else if (event.kind == SYNTH_EV_MACRO && event.id < 2u) {
        (void)synth_set_param(engine, kMacro1 + event.id, event.a);
    }
}

void advance_oscillators(synth::Voice* voice, double sampleRate) {
    for (uint32_t i = 0; i < synth::kMaxUnison; ++i) {
        voice->phaseA[i] = wrap_phase(voice->phaseA[i] + voice->frequencyA[i] / sampleRate);
        voice->phaseB[i] = wrap_phase(voice->phaseB[i] + voice->frequencyB[i] / sampleRate);
    }
    voice->phaseSub = wrap_phase(voice->phaseSub + voice->frequencySub / sampleRate);
    ++voice->sampleIndex;
}

void advance_modulated_oscillators(synth::Voice* voice, double sampleRate, double pitchFactor) {
    for (uint32_t i = 0; i < synth::kMaxUnison; ++i) {
        voice->phaseA[i] = wrap_phase(
            voice->phaseA[i] + voice->frequencyA[i] * pitchFactor / sampleRate);
        voice->phaseB[i] = wrap_phase(
            voice->phaseB[i] + voice->frequencyB[i] * pitchFactor / sampleRate);
    }
    voice->phaseSub = wrap_phase(
        voice->phaseSub + voice->frequencySub * pitchFactor / sampleRate);
    ++voice->sampleIndex;
}

float lfo_value(uint32_t shape, double phase, float held) {
    if (shape == 0) return static_cast<float>(synth::fast_sin(synth::kTwoPi * phase));
    if (shape == 1) return static_cast<float>(phase < 0.5 ? 4.0 * phase - 1.0
                                                         : 3.0 - 4.0 * phase);
    if (shape == 2) return static_cast<float>(2.0 * phase - 1.0);
    if (shape == 3) return static_cast<float>(1.0 - 2.0 * phase);
    if (shape == 4) return phase < 0.5 ? 1.0f : -1.0f;
    return held;
}

void advance_lfo(double* phase, uint64_t* cycleIndex, float* held,
                 const SynthEngine* engine, uint32_t voiceIndex) {
    const double advanced = *phase + static_cast<double>(engine->params[kLfoRate]) / engine->sampleRate;
    const uint64_t wraps = static_cast<uint64_t>(advanced);
    *phase = advanced - static_cast<double>(wraps);
    if (wraps != 0) {
        *cycleIndex += wraps;
        *held = lfo_hash_value(engine, *cycleIndex, voiceIndex);
    }
}

void advance_lfo_at_rate(double* phase, uint64_t* cycleIndex, float* held,
                         const SynthEngine* engine, uint32_t voiceIndex, double rate) {
    const double advanced = *phase + rate / engine->sampleRate;
    const uint64_t wraps = static_cast<uint64_t>(advanced);
    *phase = advanced - static_cast<double>(wraps);
    if (wraps != 0) {
        *cycleIndex += wraps;
        *held = lfo_hash_value(engine, *cycleIndex, voiceIndex);
    }
}

float modulation_source(const SynthEngine* engine, const synth::Voice* voice,
                        uint32_t source, float lfo) {
    if (source == 1u) return lfo;
    if (source == 6u) return static_cast<float>(engine->macroSmoothed[0]);
    if (source == 7u) return static_cast<float>(engine->macroSmoothed[1]);
    if (voice == 0 || voice->active == 0) return 0.0f;
    if (source == 2u) return voice->envelope;
    if (source == 3u) return voice->filterEnvelope;
    if (source == 4u) return voice->velocity;
    if (source == 5u) return synth::clampf((voice->midiNote - 60.0f) / 60.0f, -1.0f, 1.0f);
    return 0.0f;
}

void evaluate_modulation(const SynthEngine* engine, const synth::Voice* voice,
                         float lfo, ModulationValues* values) {
    for (uint32_t destination = 0; destination < kModDestinationCount; ++destination)
        values->destination[destination] = 0.0f;
    for (uint32_t slot = 0; slot < kModSlotCount; ++slot) {
        const uint32_t base = kModSlotBase + slot * kModSlotStride;
        const uint32_t source = static_cast<uint32_t>(engine->params[base]);
        const uint32_t destination = static_cast<uint32_t>(engine->params[base + 1]);
        if (source == 0u || destination == 0u || destination >= kModDestinationCount) continue;
        values->destination[destination] += modulation_source(engine, voice, source, lfo) *
            engine->params[base + 2] * kModDestinationFull[destination];
    }
}

double modulation_lfo_rate(const SynthEngine* engine, uint32_t lfoShape, float globalLfo) {
    const synth::Voice* voice = &engine->voices[0];
    const bool retrigger = engine->params[kLfoRetrigger] != 0.0f;
    const float lfo = retrigger
        ? lfo_value(lfoShape, voice->lfoPhase, voice->lfoHold) : globalLfo;
    ModulationValues modulation{};
    evaluate_modulation(engine, voice, lfo, &modulation);
    double rate = static_cast<double>(engine->params[kLfoRate]) *
        synth::exp2_fast(static_cast<double>(modulation.destination[12]));
    if (rate < 0.01) rate = 0.01;
    if (rate > 40.0) rate = 40.0;
    return rate;
}

float render_noise(SynthEngine* engine, synth::Voice* voice) {
    const float white = synth::hash_to_unit(synth::hash32(
        engine->seed, static_cast<uint32_t>(voice->startOrder),
        static_cast<uint32_t>(voice->sampleIndex), 3u)) * 2.0f - 1.0f;
    if (engine->params[kNoiseColor] == 0.0f) return white * voice->noiseEnvelope;
    for (uint32_t i = 0; i < 3; ++i) {
        const float coefficient = engine->pinkCoefficient[i];
        voice->pinkState[i] = coefficient * voice->pinkState[i] +
                              (1.0f - coefficient) * white;
    }
    // The poles are one decade apart; 0.32 approximates 1/sqrt(10), then 0.10.
    const float pink = voice->pinkState[0] + 0.32f * voice->pinkState[1] +
                       0.10f * voice->pinkState[2];
    return pink * voice->noiseEnvelope;
}

void render_extended_voice(SynthEngine* engine, synth::Voice* voice,
                           float* left, float* right) {
    const uint32_t countA = static_cast<uint32_t>(engine->params[kOscAUnison]);
    const uint32_t countB = static_cast<uint32_t>(engine->params[kOscBUnison]);
    const float normalizationA = unison_normalization(countA);
    const float normalizationB = unison_normalization(countB);
    const uint32_t slotA = static_cast<uint32_t>(engine->params[kOscWavetable]);
    const uint32_t slotB = static_cast<uint32_t>(engine->params[kOscBWavetable]);

    float bMod = 0.0f;
    for (uint32_t i = 0; i < countB; ++i) {
        const uint32_t mip = synth::select_mip(voice->frequencyB[i], engine->sampleRate);
        bMod += synth::read_wavetable(&engine->wavetable, slotB,
                                      engine->params[kOscBMorph], mip, voice->phaseB[i]);
    }
    bMod *= normalizationB;

    float voiceLeft = 0.0f;
    float voiceRight = 0.0f;
    for (uint32_t i = 0; i < countA; ++i) {
        double readPhase = voice->phaseA[i];
        if (engine->params[kFmBToA] != 0.0f) {
            readPhase = wrap_phase(readPhase +
                static_cast<double>(engine->params[kFmBToA]) * 2.0 * static_cast<double>(bMod));
        }
        const uint32_t mip = synth::select_mip(voice->frequencyA[i], engine->sampleRate);
        const float sample = synth::read_wavetable(&engine->wavetable, slotA,
            engine->params[kOscMorph], mip, readPhase) * normalizationA * engine->params[kOscLevel];
        float gainLeft = 0.0f;
        float gainRight = 0.0f;
        pan_gains(i, countA, engine->params[kOscAWidth], &gainLeft, &gainRight);
        voiceLeft += sample * gainLeft;
        voiceRight += sample * gainRight;
    }

    if (engine->params[kOscBLevel] != 0.0f) {
        for (uint32_t i = 0; i < countB; ++i) {
            const uint32_t mip = synth::select_mip(voice->frequencyB[i], engine->sampleRate);
            const float sample = synth::read_wavetable(&engine->wavetable, slotB,
                engine->params[kOscBMorph], mip, voice->phaseB[i]) *
                normalizationB * engine->params[kOscBLevel];
            float gainLeft = 0.0f;
            float gainRight = 0.0f;
            pan_gains(i, countB, engine->params[kOscBWidth], &gainLeft, &gainRight);
            voiceLeft += sample * gainLeft;
            voiceRight += sample * gainRight;
        }
    }

    if (engine->params[kSubLevel] != 0.0f) {
        static constexpr uint32_t subSlots[3] = {0u, 3u, 2u};
        const uint32_t shape = static_cast<uint32_t>(engine->params[kSubShape]);
        const uint32_t mip = synth::select_mip(voice->frequencySub, engine->sampleRate);
        const float sub = synth::read_wavetable(&engine->wavetable, subSlots[shape], 0.0f,
            mip, voice->phaseSub) * engine->params[kSubLevel];
        voiceLeft += sub;
        voiceRight += sub;
    }

    if (engine->params[kNoiseLevel] != 0.0f) {
        const float noise = render_noise(engine, voice) * engine->params[kNoiseLevel];
        voiceLeft += noise;
        voiceRight += noise;
    }
    voice->noiseEnvelope *= engine->noiseDecayCoefficient;

    const float voiceGain = voice->velocity * voice->envelope;
    *left += voiceLeft * voiceGain;
    *right += voiceRight * voiceGain;
}

double process_svf_stage(double input, synth::SvfState* state, uint32_t mode,
                         double a1, double a2, double a3, double k) {
    const double v3 = input - state->ic2;
    const double v1 = a1 * state->ic1 + a2 * v3;
    const double v2 = state->ic2 + a2 * state->ic1 + a3 * v3;
    state->ic1 = 2.0 * v1 - state->ic1;
    state->ic2 = 2.0 * v2 - state->ic2;
    if (mode == 0 || mode == 4) return v2;
    if (mode == 1) return v1;
    if (mode == 2 || mode == 5) return input - k * v1 - v2;
    return input - k * v1;
}

void apply_voice_filter(SynthEngine* engine, synth::Voice* voice, float lfo,
                        float* left, float* right) {
    if (engine->params[kFilterEnabled] == 0.0f) return;
    const double velocityDepth = 1.0 - static_cast<double>(engine->params[kFilterVelToEnv]) +
        static_cast<double>(engine->params[kFilterVelToEnv]) * static_cast<double>(voice->velocity);
    const double octaves = static_cast<double>(engine->params[kFilterKeyTrack]) *
            (static_cast<double>(voice->midiNote) - 60.0) / 12.0 +
        static_cast<double>(engine->params[kFilterEnvAmount]) * velocityDepth *
            static_cast<double>(voice->filterEnvelope) +
        static_cast<double>(engine->params[kLfoToCutoff]) * static_cast<double>(lfo);
    double cutoff = engine->filterCutoffSmoothed * synth::exp2_fast(octaves);
    const double maximum = 0.45 * engine->sampleRate;
    if (cutoff < 20.0) cutoff = 20.0;
    if (cutoff > maximum) cutoff = maximum;
    const double g = synth::tan_pi_normalized(cutoff / engine->sampleRate);
    const double k = 2.0 - 1.99 * engine->filterResonanceSmoothed;
    const double a1 = 1.0 / (1.0 + g * (g + k));
    const double a2 = g * a1;
    const double a3 = g * a2;
    const uint32_t mode = static_cast<uint32_t>(engine->params[kFilterMode]);
    float* channels[2] = {left, right};
    for (uint32_t channel = 0; channel < 2; ++channel) {
        double output = process_svf_stage(static_cast<double>(*channels[channel]),
            &voice->filter[channel][0], mode, a1, a2, a3, k);
        if (mode >= 4) {
            output = process_svf_stage(output, &voice->filter[channel][1],
                mode, a1, a2, a3, k);
        }
        *channels[channel] = static_cast<float>(output);
    }
}

void render_m1b_voice(SynthEngine* engine, synth::Voice* voice, float lfo,
                      float* left, float* right) {
    const uint32_t countA = static_cast<uint32_t>(engine->params[kOscAUnison]);
    const uint32_t countB = static_cast<uint32_t>(engine->params[kOscBUnison]);
    const float normalizationA = unison_normalization(countA);
    const float normalizationB = unison_normalization(countB);
    const uint32_t slotA = static_cast<uint32_t>(engine->params[kOscWavetable]);
    const uint32_t slotB = static_cast<uint32_t>(engine->params[kOscBWavetable]);
    const double pitchFactor = synth::exp2_fast(
        static_cast<double>(engine->params[kLfoToPitch]) * static_cast<double>(lfo) / 1200.0);

    float bMod = 0.0f;
    for (uint32_t i = 0; i < countB; ++i) {
        const uint32_t mip = synth::select_mip(
            voice->frequencyB[i] * pitchFactor, engine->sampleRate);
        bMod += synth::read_wavetable(&engine->wavetable, slotB,
            engine->params[kOscBMorph], mip, voice->phaseB[i]);
    }
    bMod *= normalizationB;

    float voiceLeft = 0.0f;
    float voiceRight = 0.0f;
    for (uint32_t i = 0; i < countA; ++i) {
        double readPhase = voice->phaseA[i];
        if (engine->params[kFmBToA] != 0.0f) {
            readPhase = wrap_phase(readPhase +
                static_cast<double>(engine->params[kFmBToA]) * 2.0 * static_cast<double>(bMod));
        }
        const uint32_t mip = synth::select_mip(
            voice->frequencyA[i] * pitchFactor, engine->sampleRate);
        const float sample = synth::read_wavetable(&engine->wavetable, slotA,
            engine->params[kOscMorph], mip, readPhase) * normalizationA * engine->params[kOscLevel];
        float gainLeft = 0.0f;
        float gainRight = 0.0f;
        pan_gains(i, countA, engine->params[kOscAWidth], &gainLeft, &gainRight);
        voiceLeft += sample * gainLeft;
        voiceRight += sample * gainRight;
    }

    if (engine->params[kOscBLevel] != 0.0f) {
        for (uint32_t i = 0; i < countB; ++i) {
            const uint32_t mip = synth::select_mip(
                voice->frequencyB[i] * pitchFactor, engine->sampleRate);
            const float sample = synth::read_wavetable(&engine->wavetable, slotB,
                engine->params[kOscBMorph], mip, voice->phaseB[i]) *
                normalizationB * engine->params[kOscBLevel];
            float gainLeft = 0.0f;
            float gainRight = 0.0f;
            pan_gains(i, countB, engine->params[kOscBWidth], &gainLeft, &gainRight);
            voiceLeft += sample * gainLeft;
            voiceRight += sample * gainRight;
        }
    }

    if (engine->params[kSubLevel] != 0.0f) {
        static constexpr uint32_t subSlots[3] = {0u, 3u, 2u};
        const uint32_t shape = static_cast<uint32_t>(engine->params[kSubShape]);
        const uint32_t mip = synth::select_mip(
            voice->frequencySub * pitchFactor, engine->sampleRate);
        const float sub = synth::read_wavetable(&engine->wavetable, subSlots[shape], 0.0f,
            mip, voice->phaseSub) * engine->params[kSubLevel];
        voiceLeft += sub;
        voiceRight += sub;
    }

    if (engine->params[kNoiseLevel] != 0.0f) {
        const float noise = render_noise(engine, voice) * engine->params[kNoiseLevel];
        voiceLeft += noise;
        voiceRight += noise;
    }
    voice->noiseEnvelope *= engine->noiseDecayCoefficient;

    apply_voice_filter(engine, voice, lfo, &voiceLeft, &voiceRight);
    const float ampLfo = 1.0f - engine->params[kLfoToAmp] *
        (1.0f - (0.5f + 0.5f * lfo));
    const float voiceGain = voice->velocity * voice->envelope * ampLfo;
    *left += voiceLeft * voiceGain;
    *right += voiceRight * voiceGain;
    advance_modulated_oscillators(voice, engine->sampleRate, pitchFactor);
}

void advance_m1c_oscillators(synth::Voice* voice, double sampleRate,
                             double pitchFactor, double detuneDeltaCents,
                             uint32_t unisonA) {
    for (uint32_t i = 0; i < synth::kMaxUnison; ++i) {
        const double detuneFactor = synth::exp2_fast(
            detuneDeltaCents * unison_position(i, unisonA) / 1200.0);
        voice->phaseA[i] = wrap_phase(
            voice->phaseA[i] + voice->frequencyA[i] * pitchFactor * detuneFactor / sampleRate);
        voice->phaseB[i] = wrap_phase(
            voice->phaseB[i] + voice->frequencyB[i] * pitchFactor / sampleRate);
    }
    voice->phaseSub = wrap_phase(
        voice->phaseSub + voice->frequencySub * pitchFactor / sampleRate);
    ++voice->sampleIndex;
}

void apply_m1c_voice_filter(SynthEngine* engine, synth::Voice* voice, float lfo,
                            const ModulationValues& modulation,
                            float* left, float* right) {
    if (engine->params[kFilterEnabled] == 0.0f) return;
    const double velocityDepth = 1.0 - static_cast<double>(engine->params[kFilterVelToEnv]) +
        static_cast<double>(engine->params[kFilterVelToEnv]) * static_cast<double>(voice->velocity);
    const double octaves = static_cast<double>(engine->params[kFilterKeyTrack]) *
            (static_cast<double>(voice->midiNote) - 60.0) / 12.0 +
        static_cast<double>(engine->params[kFilterEnvAmount]) * velocityDepth *
            static_cast<double>(voice->filterEnvelope) +
        static_cast<double>(engine->params[kLfoToCutoff]) * static_cast<double>(lfo) +
        static_cast<double>(modulation.destination[8]);
    double cutoff = engine->filterCutoffSmoothed * synth::exp2_fast(octaves);
    const double maximum = 0.45 * engine->sampleRate;
    if (cutoff < 20.0) cutoff = 20.0;
    if (cutoff > maximum) cutoff = maximum;
    const double resonance = static_cast<double>(synth::clampf(
        static_cast<float>(engine->filterResonanceSmoothed) + modulation.destination[9],
        0.0f, 1.0f));
    const double g = synth::tan_pi_normalized(cutoff / engine->sampleRate);
    const double k = 2.0 - 1.99 * resonance;
    const double a1 = 1.0 / (1.0 + g * (g + k));
    const double a2 = g * a1;
    const double a3 = g * a2;
    const uint32_t mode = static_cast<uint32_t>(engine->params[kFilterMode]);
    float* channels[2] = {left, right};
    for (uint32_t channel = 0; channel < 2; ++channel) {
        double output = process_svf_stage(static_cast<double>(*channels[channel]),
            &voice->filter[channel][0], mode, a1, a2, a3, k);
        if (mode >= 4) {
            output = process_svf_stage(output, &voice->filter[channel][1],
                mode, a1, a2, a3, k);
        }
        *channels[channel] = static_cast<float>(output);
    }
}

void render_m1c_voice(SynthEngine* engine, synth::Voice* voice, float lfo,
                      const ModulationValues& modulation,
                      float* left, float* right) {
    const uint32_t countA = static_cast<uint32_t>(engine->params[kOscAUnison]);
    const uint32_t countB = static_cast<uint32_t>(engine->params[kOscBUnison]);
    const float normalizationA = unison_normalization(countA);
    const float normalizationB = unison_normalization(countB);
    const uint32_t slotA = static_cast<uint32_t>(engine->params[kOscWavetable]);
    const uint32_t slotB = static_cast<uint32_t>(engine->params[kOscBWavetable]);
    const float levelA = synth::clampf(
        engine->params[kOscLevel] + modulation.destination[1], 0.0f, 4.0f);
    const float levelB = synth::clampf(
        engine->params[kOscBLevel] + modulation.destination[2], 0.0f, 4.0f);
    const float morphA = synth::clampf(
        engine->params[kOscMorph] + modulation.destination[3], 0.0f, 1.0f);
    const float morphB = synth::clampf(
        engine->params[kOscBMorph] + modulation.destination[4], 0.0f, 1.0f);
    const float fmBToA = synth::clampf(
        engine->params[kFmBToA] + modulation.destination[5], 0.0f, 1.0f);
    const float subLevel = synth::clampf(
        engine->params[kSubLevel] + modulation.destination[6], 0.0f, 4.0f);
    const float noiseLevel = synth::clampf(
        engine->params[kNoiseLevel] + modulation.destination[7], 0.0f, 4.0f);
    const float detuneA = synth::clampf(
        engine->params[kOscADetune] + modulation.destination[11], 0.0f, 50.0f);
    const double detuneDeltaCents =
        static_cast<double>(detuneA - engine->params[kOscADetune]);
    const double pitchCents =
        static_cast<double>(engine->params[kLfoToPitch]) * static_cast<double>(lfo) +
        static_cast<double>(modulation.destination[10]);
    const double pitchFactor = synth::exp2_fast(pitchCents / 1200.0);

    float bMod = 0.0f;
    for (uint32_t i = 0; i < countB; ++i) {
        const uint32_t mip = synth::select_mip(
            voice->frequencyB[i] * pitchFactor, engine->sampleRate);
        bMod += synth::read_wavetable(&engine->wavetable, slotB,
            morphB, mip, voice->phaseB[i]);
    }
    bMod *= normalizationB;

    float voiceLeft = 0.0f;
    float voiceRight = 0.0f;
    for (uint32_t i = 0; i < countA; ++i) {
        const double detuneFactor = synth::exp2_fast(
            detuneDeltaCents * unison_position(i, countA) / 1200.0);
        double readPhase = voice->phaseA[i];
        if (fmBToA != 0.0f) {
            readPhase = wrap_phase(readPhase +
                static_cast<double>(fmBToA) * 2.0 * static_cast<double>(bMod));
        }
        const uint32_t mip = synth::select_mip(
            voice->frequencyA[i] * pitchFactor * detuneFactor, engine->sampleRate);
        const float sample = synth::read_wavetable(&engine->wavetable, slotA,
            morphA, mip, readPhase) * normalizationA * levelA;
        float gainLeft = 0.0f;
        float gainRight = 0.0f;
        pan_gains(i, countA, engine->params[kOscAWidth], &gainLeft, &gainRight);
        voiceLeft += sample * gainLeft;
        voiceRight += sample * gainRight;
    }

    if (levelB != 0.0f) {
        for (uint32_t i = 0; i < countB; ++i) {
            const uint32_t mip = synth::select_mip(
                voice->frequencyB[i] * pitchFactor, engine->sampleRate);
            const float sample = synth::read_wavetable(&engine->wavetable, slotB,
                morphB, mip, voice->phaseB[i]) * normalizationB * levelB;
            float gainLeft = 0.0f;
            float gainRight = 0.0f;
            pan_gains(i, countB, engine->params[kOscBWidth], &gainLeft, &gainRight);
            voiceLeft += sample * gainLeft;
            voiceRight += sample * gainRight;
        }
    }

    if (subLevel != 0.0f) {
        static constexpr uint32_t subSlots[3] = {0u, 3u, 2u};
        const uint32_t shape = static_cast<uint32_t>(engine->params[kSubShape]);
        const uint32_t mip = synth::select_mip(
            voice->frequencySub * pitchFactor, engine->sampleRate);
        const float sub = synth::read_wavetable(&engine->wavetable, subSlots[shape], 0.0f,
            mip, voice->phaseSub) * subLevel;
        voiceLeft += sub;
        voiceRight += sub;
    }

    if (noiseLevel != 0.0f) {
        const float noise = render_noise(engine, voice) * noiseLevel;
        voiceLeft += noise;
        voiceRight += noise;
    }
    voice->noiseEnvelope *= engine->noiseDecayCoefficient;

    apply_m1c_voice_filter(engine, voice, lfo, modulation, &voiceLeft, &voiceRight);
    const float ampLfo = 1.0f - engine->params[kLfoToAmp] *
        (1.0f - (0.5f + 0.5f * lfo));
    const float modulatedAmp = synth::clampf(1.0f + modulation.destination[13], 0.0f, 2.0f);
    const float voiceGain = voice->velocity * voice->envelope * ampLfo * modulatedAmp;
    *left += voiceLeft * voiceGain;
    *right += voiceRight * voiceGain;
    advance_m1c_oscillators(
        voice, engine->sampleRate, pitchFactor, detuneDeltaCents, countA);
}

}  // namespace

extern "C" size_t synth_state_size(void) {
    return sizeof(SynthEngine) + alignof(SynthEngine) - 1u;
}

extern "C" SynthEngine* synth_create(void* memory, size_t bytes, double sampleRate,
                                      uint32_t maxBlock) {
    if (memory == 0 || sampleRate <= 0.0 || maxBlock == 0 || bytes < synth_state_size()) return 0;
    const uintptr_t raw = reinterpret_cast<uintptr_t>(memory);
    const uintptr_t aligned = (raw + alignof(SynthEngine) - 1u) & ~(alignof(SynthEngine) - 1u);
    SynthEngine* engine = reinterpret_cast<SynthEngine*>(aligned);
    engine->sampleRate = sampleRate;
    engine->maxBlock = maxBlock;
    engine->seed = 0;
    engine->orderCounter = 0;
    reset_params(engine);
    for (uint32_t i = 0; i < synth::kVoiceCapacity; ++i) clear_voice(&engine->voices[i]);
    reset_modulators(engine);
    synth::initialize_builtin_wavetables(&engine->wavetable);
    return engine;
}

extern "C" uint32_t synth_param_count(void) {
    return synth::kParamCount;
}

extern "C" int synth_param_info(uint32_t id, SynthParamInfo* out) {
    if (id >= synth::kParamCount || out == 0) return -1;
    *out = synth::kParameterInfo[id];
    return 0;
}

extern "C" int synth_set_param(SynthEngine* engine, uint32_t paramId, float value) {
    if (engine == 0 || paramId >= synth::kParamCount || value != value) return -1;
    const SynthParamInfo& definition = synth::kParameterInfo[paramId];
    value = synth::clampf(value, definition.minimum, definition.maximum);
    if ((definition.flags & SYNTH_PARAM_FLAG_INTEGER) != 0u)
        value = rounded_integer(value, definition.minimum, definition.maximum);
    bool frequencyChanged = false;
    switch (paramId) {
        case kVoiceCount: {
            engine->voiceLimit = static_cast<uint32_t>(value);
            for (uint32_t i = engine->voiceLimit; i < synth::kVoiceCapacity; ++i)
                clear_voice(&engine->voices[i]);
            break;
        }
        case kOscAUnison:
        case kOscBUnison:
        case kOscADetune:
        case kOscBDetune:
        case kOscAOctave:
        case kOscBOctave:
        case kOscASemitone:
        case kOscBSemitone:
        case kOscAFine:
        case kOscBFine:
        case kSubOctave:
            frequencyChanged = true;
            break;
        default: break;
    }
    engine->params[paramId] = value;
    if (frequencyChanged) update_active_frequencies(engine);
    if (paramId == kNoiseDecay) update_noise_coefficients(engine);
    return 0;
}

extern "C" int synth_load_wavetable(SynthEngine* engine, uint32_t slot,
                                     const float* frames, uint32_t frameCount) {
    if (engine == 0) return -1;
    return synth::load_wavetable(&engine->wavetable, slot, frames, frameCount);
}

extern "C" void synth_reset(SynthEngine* engine, uint32_t kind, uint64_t seed) {
    if (engine == 0) return;
    for (uint32_t i = 0; i < synth::kVoiceCapacity; ++i) clear_voice(&engine->voices[i]);
    engine->orderCounter = 0;
    engine->seed = seed;
    if (kind == SYNTH_RESET_ALL) reset_params(engine);
    reset_modulators(engine);
}

extern "C" int synth_process(SynthEngine* engine, const SynthEvent* events, uint32_t nEvents,
                              float* outL, float* outR, uint32_t nFrames) {
    if (engine == 0 || outL == 0 || outR == 0 || (events == 0 && nEvents != 0)) return -1;
    if (nFrames > engine->maxBlock) return -2;
    int ignored = 0;
    for (uint32_t e = 0; e < nEvents; ++e) {
        if (events[e].offset >= nFrames) ++ignored;
        else if (events[e].kind == SYNTH_EV_MACRO && events[e].id >= 2u) ++ignored;
    }
    for (uint32_t frame = 0; frame < nFrames; ++frame) {
        for (uint32_t e = 0; e < nEvents; ++e)
            if (events[e].offset == frame && events[e].kind == SYNTH_EV_NOTE_OFF)
                note_off(engine, events[e].id);
        for (uint32_t e = 0; e < nEvents; ++e)
            if (events[e].offset == frame &&
                (events[e].kind == SYNTH_EV_PARAM || events[e].kind == SYNTH_EV_MACRO))
                apply_event_param(engine, events[e]);
        for (uint32_t e = 0; e < nEvents; ++e)
            if (events[e].offset == frame && events[e].kind == SYNTH_EV_NOTE_ON)
                note_on(engine, events[e]);

        engine->filterCutoffSmoothed += engine->filterSmoothingCoefficient *
            (static_cast<double>(engine->params[kFilterCutoff]) - engine->filterCutoffSmoothed);
        engine->filterResonanceSmoothed += engine->filterSmoothingCoefficient *
            (static_cast<double>(engine->params[kFilterResonance]) -
             engine->filterResonanceSmoothed);
        engine->macroSmoothed[0] += engine->filterSmoothingCoefficient *
            (static_cast<double>(engine->params[kMacro1]) - engine->macroSmoothed[0]);
        engine->macroSmoothed[1] += engine->filterSmoothingCoefficient *
            (static_cast<double>(engine->params[kMacro2]) - engine->macroSmoothed[1]);
        const uint32_t lfoShape = static_cast<uint32_t>(engine->params[kLfoShape]);
        const float globalLfo = lfo_value(
            lfoShape, engine->globalLfoPhase, engine->globalLfoHold);
        const bool matrixActive = modulation_matrix_active(engine);

        if (!matrixActive && legacy_configuration(engine)) {
            float output = 0.0f;
            for (uint32_t voiceIndex = 0; voiceIndex < engine->voiceLimit; ++voiceIndex) {
                synth::Voice* voice = &engine->voices[voiceIndex];
                if (voice->active == 0) continue;
                const float envelope = advance_envelope(engine, voice);
                if (voice->active == 0) continue;
                const uint32_t mip = synth::select_mip(voice->frequencyA[0], engine->sampleRate);
                const uint32_t slot = static_cast<uint32_t>(engine->params[kOscWavetable]);
                output += synth::read_wavetable(&engine->wavetable, slot,
                                                engine->params[kOscMorph], mip, voice->phaseA[0]) *
                          voice->velocity * envelope * engine->params[kOscLevel];
                advance_oscillators(voice, engine->sampleRate);
                voice->noiseEnvelope *= engine->noiseDecayCoefficient;
                (void)advance_filter_envelope(engine, voice);
                if (engine->params[kLfoRetrigger] != 0.0f) {
                    advance_lfo(&voice->lfoPhase, &voice->lfoCycleIndex,
                        &voice->lfoHold, engine, voiceIndex);
                }
            }
            output *= engine->params[kMasterGain];
            outL[frame] = output;
            outR[frame] = output;
            advance_lfo(&engine->globalLfoPhase, &engine->globalLfoCycleIndex,
                &engine->globalLfoHold, engine, kGlobalLfoIndex);
            continue;
        }

        float left = 0.0f;
        float right = 0.0f;
        double modulatedLfoRate = static_cast<double>(engine->params[kLfoRate]);
        if (matrixActive) {
            const bool retrigger = engine->params[kLfoRetrigger] != 0.0f;
            for (uint32_t voiceIndex = 0; voiceIndex < engine->voiceLimit; ++voiceIndex) {
                synth::Voice* voice = &engine->voices[voiceIndex];
                if (voice->active == 0) continue;
                (void)advance_envelope(engine, voice);
                if (voice->active == 0) continue;
                (void)advance_filter_envelope(engine, voice);
            }
            modulatedLfoRate = modulation_lfo_rate(engine, lfoShape, globalLfo);
            for (uint32_t voiceIndex = 0; voiceIndex < engine->voiceLimit; ++voiceIndex) {
                synth::Voice* voice = &engine->voices[voiceIndex];
                if (voice->active == 0) continue;
                const float voiceLfo = retrigger
                    ? lfo_value(lfoShape, voice->lfoPhase, voice->lfoHold) : globalLfo;
                ModulationValues modulation{};
                evaluate_modulation(engine, voice, voiceLfo, &modulation);
                render_m1c_voice(engine, voice, voiceLfo, modulation, &left, &right);
                if (retrigger) {
                    advance_lfo_at_rate(&voice->lfoPhase, &voice->lfoCycleIndex,
                        &voice->lfoHold, engine, voiceIndex, modulatedLfoRate);
                }
            }
        } else if (m1b_bypassed(engine)) {
            for (uint32_t voiceIndex = 0; voiceIndex < engine->voiceLimit; ++voiceIndex) {
                synth::Voice* voice = &engine->voices[voiceIndex];
                if (voice->active == 0) continue;
                (void)advance_envelope(engine, voice);
                if (voice->active == 0) continue;
                render_extended_voice(engine, voice, &left, &right);
                advance_oscillators(voice, engine->sampleRate);
                (void)advance_filter_envelope(engine, voice);
                if (engine->params[kLfoRetrigger] != 0.0f) {
                    advance_lfo(&voice->lfoPhase, &voice->lfoCycleIndex,
                        &voice->lfoHold, engine, voiceIndex);
                }
            }
        } else {
            const bool retrigger = engine->params[kLfoRetrigger] != 0.0f;
            for (uint32_t voiceIndex = 0; voiceIndex < engine->voiceLimit; ++voiceIndex) {
                synth::Voice* voice = &engine->voices[voiceIndex];
                if (voice->active == 0) continue;
                (void)advance_envelope(engine, voice);
                if (voice->active == 0) continue;
                (void)advance_filter_envelope(engine, voice);
                const float voiceLfo = retrigger
                    ? lfo_value(lfoShape, voice->lfoPhase, voice->lfoHold) : globalLfo;
                render_m1b_voice(engine, voice, voiceLfo, &left, &right);
                if (retrigger) {
                    advance_lfo(&voice->lfoPhase, &voice->lfoCycleIndex,
                        &voice->lfoHold, engine, voiceIndex);
                }
            }
        }
        left *= engine->params[kMasterGain];
        right *= engine->params[kMasterGain];
        outL[frame] = left;
        outR[frame] = right;
        if (matrixActive) {
            advance_lfo_at_rate(&engine->globalLfoPhase, &engine->globalLfoCycleIndex,
                &engine->globalLfoHold, engine, kGlobalLfoIndex, modulatedLfoRate);
        } else {
            advance_lfo(&engine->globalLfoPhase, &engine->globalLfoCycleIndex,
                &engine->globalLfoHold, engine, kGlobalLfoIndex);
        }
    }
    return ignored;
}

extern "C" uint32_t synth_get_tail_frames(const SynthEngine* engine) {
    if (engine == 0) return 0;
    const double frames = static_cast<double>(engine->params[kAmpRelease]) * engine->sampleRate;
    return frames <= 0.0 ? 0u : static_cast<uint32_t>(frames + 0.999999);
}

extern "C" uint32_t synth_engine_version(void) { return 6; }
