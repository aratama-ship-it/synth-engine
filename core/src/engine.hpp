#ifndef SYNTH_ENGINE_INTERNAL_HPP
#define SYNTH_ENGINE_INTERNAL_HPP

#include "../include/synth_engine.h"
#include "params.hpp"
#include "wavetable.hpp"

namespace synth {

constexpr uint32_t kVoiceCapacity = 16;
constexpr uint32_t kMaxUnison = 4;

enum EnvelopeStage : uint32_t {
    kEnvOff = 0,
    kEnvAttack = 1,
    kEnvDecay = 2,
    kEnvSustain = 3,
    kEnvRelease = 4
};

struct SvfState {
    double ic1;
    double ic2;
};

struct Voice {
    uint32_t active;
    uint32_t noteId;
    uint32_t stage;
    uint64_t startOrder;
    uint64_t releaseOrder;
    double baseFrequency;
    float midiNote;
    double phaseA[kMaxUnison];
    double phaseB[kMaxUnison];
    double frequencyA[kMaxUnison];
    double frequencyB[kMaxUnison];
    double phaseSub;
    double frequencySub;
    uint64_t sampleIndex;
    float noiseEnvelope;
    float pinkState[3];
    float velocity;
    float envelope;
    uint64_t envelopeStageSamples;
    float envelopeReleaseStart;
    uint32_t filterStage;
    float filterEnvelope;
    uint64_t filterEnvelopeStageSamples;
    float filterEnvelopeReleaseStart;
    SvfState filter[2][2];
    double lfoPhase;
    uint64_t lfoCycleIndex;
    float lfoHold;
};

}  // namespace synth

struct SynthEngine {
    double sampleRate;
    uint32_t maxBlock;
    uint32_t voiceLimit;
    uint64_t seed;
    uint64_t orderCounter;
    float noiseDecayCoefficient;
    float pinkCoefficient[3];
    double filterCutoffSmoothed;
    double filterResonanceSmoothed;
    double filterSmoothingCoefficient;
    double macroSmoothed[2];
    double globalLfoPhase;
    uint64_t globalLfoCycleIndex;
    float globalLfoHold;
    float params[synth::kParamCount];
    synth::Voice voices[synth::kVoiceCapacity];
    synth::WavetableBank wavetable;
};

#endif
