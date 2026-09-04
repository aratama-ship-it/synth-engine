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
    kNoiseDecay = 34
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
    engine->params[kOscWavetable] = 0.0f;
    engine->params[kOscMorph] = 0.0f;
    engine->params[kOscLevel] = 0.8f;
    engine->params[kAmpAttack] = 0.005f;
    engine->params[kAmpDecay] = 0.1f;
    engine->params[kAmpSustain] = 0.8f;
    engine->params[kAmpRelease] = 0.2f;
    engine->params[kMasterGain] = 0.2f;
    engine->params[kVoiceCount] = 16.0f;
    engine->params[kOscAUnison] = 1.0f;
    engine->params[kOscADetune] = 10.0f;
    engine->params[kOscAWidth] = 0.5f;
    engine->params[kOscAOctave] = 0.0f;
    engine->params[kOscASemitone] = 0.0f;
    engine->params[kOscAFine] = 0.0f;
    engine->params[kOscAPhaseMode] = 0.0f;
    engine->params[kOscAPhase] = 0.0f;
    engine->params[kOscBWavetable] = 0.0f;
    engine->params[kOscBMorph] = 0.0f;
    engine->params[kOscBLevel] = 0.0f;
    engine->params[kOscBUnison] = 1.0f;
    engine->params[kOscBDetune] = 10.0f;
    engine->params[kOscBWidth] = 0.5f;
    engine->params[kOscBOctave] = 0.0f;
    engine->params[kOscBSemitone] = 0.0f;
    engine->params[kOscBFine] = 0.0f;
    engine->params[kOscBPhaseMode] = 0.0f;
    engine->params[kOscBPhase] = 0.0f;
    engine->params[kFmBToA] = 0.0f;
    engine->params[kSubLevel] = 0.0f;
    engine->params[kSubShape] = 0.0f;
    engine->params[kSubOctave] = -1.0f;
    engine->params[kNoiseLevel] = 0.0f;
    engine->params[kNoiseColor] = 0.0f;
    engine->params[kNoiseDecay] = 0.05f;
    engine->voiceLimit = 16;
    update_noise_coefficients(engine);
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
           engine->params[kNoiseLevel] == 0.0f;
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

double hashed_phase(const SynthEngine* engine, uint32_t noteId, uint32_t voiceIndex,
                    uint32_t layer) {
    return static_cast<double>(synth::hash_to_unit(
        synth::hash32(engine->seed, noteId, voiceIndex, layer)));
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
    voice->velocity = synth::clampf(event.b, 0.0f, 1.0f);
    voice->noiseEnvelope = 1.0f;
    update_voice_frequencies(engine, voice);

    const bool fixedA = engine->params[kOscAPhaseMode] == 1.0f;
    const bool fixedB = engine->params[kOscBPhaseMode] == 1.0f;
    for (uint32_t i = 0; i < synth::kMaxUnison; ++i) {
        voice->phaseA[i] = fixedA ? static_cast<double>(engine->params[kOscAPhase])
                                  : hashed_phase(engine, event.id, voiceIndex, i);
        voice->phaseB[i] = fixedB ? static_cast<double>(engine->params[kOscBPhase])
                                  : hashed_phase(engine, event.id, voiceIndex, 8u + i);
    }
    // M0a began at 0.25 cycle. Preserve that exact path when every M1a source is disabled.
    if (!fixedA && legacy_configuration(engine)) voice->phaseA[0] = 0.25;
    voice->phaseSub = hashed_phase(engine, event.id, voiceIndex, 16u);
}

void note_off(SynthEngine* engine, uint32_t noteId) {
    for (uint32_t i = 0; i < engine->voiceLimit; ++i) {
        synth::Voice* voice = &engine->voices[i];
        if (voice->active != 0 && voice->noteId == noteId) {
            voice->stage = synth::kEnvRelease;
            voice->releaseOrder = ++engine->orderCounter;
        }
    }
}

float advance_envelope(SynthEngine* engine, synth::Voice* voice) {
    if (voice->stage == synth::kEnvAttack) {
        const double samples = static_cast<double>(engine->params[kAmpAttack]) * engine->sampleRate;
        if (samples <= 1.0) voice->envelope = 1.0f;
        else voice->envelope += static_cast<float>(1.0 / samples);
        if (voice->envelope >= 1.0f) {
            voice->envelope = 1.0f;
            voice->stage = synth::kEnvDecay;
        }
    } else if (voice->stage == synth::kEnvDecay) {
        const float sustain = engine->params[kAmpSustain];
        const double samples = static_cast<double>(engine->params[kAmpDecay]) * engine->sampleRate;
        if (samples <= 1.0) voice->envelope = sustain;
        else {
            const float coefficient = static_cast<float>(synth::fast_exp2(-8.0 / samples));
            voice->envelope = sustain + (voice->envelope - sustain) * coefficient;
        }
        if (synth::absd(static_cast<double>(voice->envelope - sustain)) < 1.0e-6) {
            voice->envelope = sustain;
            voice->stage = synth::kEnvSustain;
        }
    } else if (voice->stage == synth::kEnvSustain) {
        voice->envelope = engine->params[kAmpSustain];
    } else if (voice->stage == synth::kEnvRelease) {
        const double samples = static_cast<double>(engine->params[kAmpRelease]) * engine->sampleRate;
        if (samples <= 1.0) voice->envelope = 0.0f;
        else voice->envelope *= static_cast<float>(synth::fast_exp2(-16.0 / samples));
        if (voice->envelope <= 0.0000158489319f) clear_voice(voice);
    }
    return voice->envelope;
}

void apply_event_param(SynthEngine* engine, const SynthEvent& event) {
    if (event.kind == SYNTH_EV_PARAM) (void)synth_set_param(engine, event.id, event.a);
}

void advance_oscillators(synth::Voice* voice, double sampleRate) {
    for (uint32_t i = 0; i < synth::kMaxUnison; ++i) {
        voice->phaseA[i] = wrap_phase(voice->phaseA[i] + voice->frequencyA[i] / sampleRate);
        voice->phaseB[i] = wrap_phase(voice->phaseB[i] + voice->frequencyB[i] / sampleRate);
    }
    voice->phaseSub = wrap_phase(voice->phaseSub + voice->frequencySub / sampleRate);
    ++voice->sampleIndex;
}

float render_noise(SynthEngine* engine, synth::Voice* voice) {
    const float white = synth::hash_to_unit(synth::hash32(
        engine->seed, voice->noteId, static_cast<uint32_t>(voice->sampleIndex), 3u)) * 2.0f - 1.0f;
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
    synth::initialize_builtin_wavetables(&engine->wavetable);
    return engine;
}

extern "C" int synth_set_param(SynthEngine* engine, uint32_t paramId, float value) {
    if (engine == 0 || paramId >= synth::kParamCount || value != value) return -1;
    bool frequencyChanged = false;
    switch (paramId) {
        case kOscWavetable: value = synth::clampf(value, 0.0f, 3.0f); break;
        case kOscBWavetable: value = rounded_integer(value, 0.0f, 3.0f); break;
        case kOscMorph:
        case kOscBMorph:
        case kOscAWidth:
        case kOscBWidth:
        case kOscAPhase:
        case kOscBPhase:
        case kFmBToA: value = synth::clampf(value, 0.0f, 1.0f); break;
        case kOscLevel:
        case kOscBLevel:
        case kSubLevel:
        case kNoiseLevel: value = synth::clampf(value, 0.0f, 4.0f); break;
        case kAmpAttack:
        case kAmpDecay:
        case kAmpRelease:
        case kNoiseDecay: value = synth::clampf(value, 0.0f, 60.0f); break;
        case kAmpSustain: value = synth::clampf(value, 0.0f, 1.0f); break;
        case kMasterGain: value = synth::clampf(value, 0.0f, 4.0f); break;
        case kVoiceCount: {
            value = rounded_integer(value, 1.0f, 16.0f);
            engine->voiceLimit = static_cast<uint32_t>(value);
            for (uint32_t i = engine->voiceLimit; i < synth::kVoiceCapacity; ++i)
                clear_voice(&engine->voices[i]);
            break;
        }
        case kOscAUnison:
        case kOscBUnison:
            value = rounded_integer(value, 1.0f, 4.0f);
            frequencyChanged = true;
            break;
        case kOscADetune:
        case kOscBDetune:
            value = synth::clampf(value, 0.0f, 50.0f);
            frequencyChanged = true;
            break;
        case kOscAOctave:
        case kOscBOctave:
            value = rounded_integer(value, -2.0f, 2.0f);
            frequencyChanged = true;
            break;
        case kOscASemitone:
        case kOscBSemitone:
            value = rounded_integer(value, -12.0f, 12.0f);
            frequencyChanged = true;
            break;
        case kOscAFine:
        case kOscBFine:
            value = synth::clampf(value, -100.0f, 100.0f);
            frequencyChanged = true;
            break;
        case kOscAPhaseMode:
        case kOscBPhaseMode:
        case kNoiseColor: value = rounded_integer(value, 0.0f, 1.0f); break;
        case kSubShape: value = rounded_integer(value, 0.0f, 2.0f); break;
        case kSubOctave:
            value = rounded_integer(value, -2.0f, 0.0f);
            frequencyChanged = true;
            break;
        default: return -1;
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
}

extern "C" int synth_process(SynthEngine* engine, const SynthEvent* events, uint32_t nEvents,
                              float* outL, float* outR, uint32_t nFrames) {
    if (engine == 0 || outL == 0 || outR == 0 || (events == 0 && nEvents != 0)) return -1;
    if (nFrames > engine->maxBlock) return -2;
    int ignored = 0;
    for (uint32_t e = 0; e < nEvents; ++e) if (events[e].offset >= nFrames) ++ignored;
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

        if (legacy_configuration(engine)) {
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
            }
            output *= engine->params[kMasterGain];
            outL[frame] = output;
            outR[frame] = output;
            continue;
        }

        float left = 0.0f;
        float right = 0.0f;
        for (uint32_t voiceIndex = 0; voiceIndex < engine->voiceLimit; ++voiceIndex) {
            synth::Voice* voice = &engine->voices[voiceIndex];
            if (voice->active == 0) continue;
            (void)advance_envelope(engine, voice);
            if (voice->active == 0) continue;
            render_extended_voice(engine, voice, &left, &right);
            advance_oscillators(voice, engine->sampleRate);
        }
        left *= engine->params[kMasterGain];
        right *= engine->params[kMasterGain];
        outL[frame] = left;
        outR[frame] = right;
    }
    return ignored;
}

extern "C" uint32_t synth_get_tail_frames(const SynthEngine* engine) {
    if (engine == 0) return 0;
    const double frames = static_cast<double>(engine->params[kAmpRelease]) * engine->sampleRate;
    return frames <= 0.0 ? 0u : static_cast<uint32_t>(frames + 0.999999);
}

extern "C" uint32_t synth_engine_version(void) { return 2; }
