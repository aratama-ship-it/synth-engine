#include "engine.hpp"
#include "fast_math.hpp"

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
    kVoiceCount = 8
};

void clear_voice(synth::Voice* voice) {
    voice->active = 0;
    voice->noteId = 0;
    voice->stage = synth::kEnvOff;
    voice->startOrder = 0;
    voice->releaseOrder = 0;
    voice->phase = 0.0;
    voice->frequency = 0.0;
    voice->velocity = 0.0f;
    voice->envelope = 0.0f;
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
    engine->voiceLimit = 16;
}

double midi_frequency(float midi) {
    return 440.0 * synth::fast_exp2((static_cast<double>(midi) - 69.0) / 12.0);
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

void note_on(SynthEngine* engine, const SynthEvent& event) {
    synth::Voice* voice = choose_voice(engine, event.id);
    clear_voice(voice);
    voice->active = 1;
    voice->noteId = event.id;
    voice->stage = synth::kEnvAttack;
    voice->startOrder = ++engine->orderCounter;
    voice->phase = 0.25;
    voice->frequency = midi_frequency(event.a);
    voice->velocity = synth::clampf(event.b, 0.0f, 1.0f);
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
    switch (paramId) {
        case kOscWavetable: value = synth::clampf(value, 0.0f, 3.0f); break;
        case kOscMorph: value = synth::clampf(value, 0.0f, 1.0f); break;
        case kOscLevel: value = synth::clampf(value, 0.0f, 4.0f); break;
        case kAmpAttack:
        case kAmpDecay:
        case kAmpRelease: value = synth::clampf(value, 0.0f, 60.0f); break;
        case kAmpSustain: value = synth::clampf(value, 0.0f, 1.0f); break;
        case kMasterGain: value = synth::clampf(value, 0.0f, 4.0f); break;
        case kVoiceCount: {
            value = synth::clampf(value, 1.0f, 16.0f);
            engine->voiceLimit = static_cast<uint32_t>(value + 0.5f);
            for (uint32_t i = engine->voiceLimit; i < synth::kVoiceCapacity; ++i)
                clear_voice(&engine->voices[i]);
            value = static_cast<float>(engine->voiceLimit);
            break;
        }
        default: return -1;
    }
    engine->params[paramId] = value;
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

        float output = 0.0f;
        for (uint32_t voiceIndex = 0; voiceIndex < engine->voiceLimit; ++voiceIndex) {
            synth::Voice* voice = &engine->voices[voiceIndex];
            if (voice->active == 0) continue;
            const float envelope = advance_envelope(engine, voice);
            if (voice->active == 0) continue;
            const uint32_t mip = synth::select_mip(voice->frequency, engine->sampleRate);
            const uint32_t slot = static_cast<uint32_t>(engine->params[kOscWavetable]);
            output += synth::read_wavetable(&engine->wavetable, slot,
                                            engine->params[kOscMorph], mip, voice->phase) *
                      voice->velocity * envelope * engine->params[kOscLevel];
            voice->phase += voice->frequency / engine->sampleRate;
            if (voice->phase >= 1.0) voice->phase -= static_cast<uint32_t>(voice->phase);
        }
        output *= engine->params[kMasterGain];
        outL[frame] = output;
        outR[frame] = output;
    }
    return ignored;
}

extern "C" uint32_t synth_get_tail_frames(const SynthEngine* engine) {
    if (engine == 0) return 0;
    const double frames = static_cast<double>(engine->params[kAmpRelease]) * engine->sampleRate;
    return frames <= 0.0 ? 0u : static_cast<uint32_t>(frames + 0.999999);
}

extern "C" uint32_t synth_engine_version(void) { return 1; }
