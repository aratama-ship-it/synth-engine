#ifndef SYNTH_ENGINE_INTERNAL_HPP
#define SYNTH_ENGINE_INTERNAL_HPP

#include "../include/synth_engine.h"
#include "wavetable.hpp"

namespace synth {

constexpr uint32_t kVoiceCapacity = 16;
constexpr uint32_t kParamCount = 9;

enum EnvelopeStage : uint32_t {
    kEnvOff = 0,
    kEnvAttack = 1,
    kEnvDecay = 2,
    kEnvSustain = 3,
    kEnvRelease = 4
};

struct Voice {
    uint32_t active;
    uint32_t noteId;
    uint32_t stage;
    uint64_t startOrder;
    uint64_t releaseOrder;
    double phase;
    double frequency;
    float velocity;
    float envelope;
};

}  // namespace synth

struct SynthEngine {
    double sampleRate;
    uint32_t maxBlock;
    uint32_t voiceLimit;
    uint64_t seed;
    uint64_t orderCounter;
    float params[synth::kParamCount];
    synth::Voice voices[synth::kVoiceCapacity];
    synth::WavetableBank wavetable;
};

#endif
