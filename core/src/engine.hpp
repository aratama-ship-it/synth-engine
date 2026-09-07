#ifndef SYNTH_ENGINE_INTERNAL_HPP
#define SYNTH_ENGINE_INTERNAL_HPP

#include "../include/synth_engine.h"
#include "params.hpp"
#include "wavetable.hpp"

namespace synth {

constexpr uint32_t kVoiceCapacity = 16;
constexpr uint32_t kMaxUnison = 4;
constexpr uint32_t kVoiceParamCount = 22;
constexpr uint32_t kControlSmoothingCount = 8;
constexpr uint32_t kInsertFxCount = 4;
constexpr uint32_t kChorusDelayCapacity = 16384;

enum ControlSmoothingIndex : uint32_t {
    kSmoothOscAMorph = 0,
    kSmoothOscALevel,
    kSmoothMasterGain,
    kSmoothOscBMorph,
    kSmoothOscBLevel,
    kSmoothFmBToA,
    kSmoothSubLevel,
    kSmoothNoiseLevel
};

double unison_detune_position(uint32_t index, uint32_t count);
double unison_pan_position(uint32_t index, uint32_t count);
double unison_phase_offset(uint32_t index, uint32_t count);
double unison_width_amount(double width, uint32_t curve);
float fm_high_guard_depth(float requested, double carrierHz,
                          double modulatorHz, double sampleRate);

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
    uint32_t modStage;
    float modEnvelope;
    uint64_t modEnvelopeStageSamples;
    float modEnvelopeReleaseStart;
    SvfState filter[2][2];
    double lfoPhase;
    uint64_t lfoCycleIndex;
    float lfoHold;
    double lfo2Phase;
    uint64_t lfo2CycleIndex;
    float lfo2Hold;
    uint32_t voiceParamMask;
    float voiceParams[kVoiceParamCount];
};

struct InsertFxState {
    float mix[kInsertFxCount];
    float distortionTone[2];
    float chorusDelay[2][kChorusDelayCapacity];
    uint32_t chorusWrite;
    double chorusPhase[2];
    float eqLow[2];
    float eqHighLow[2];
    float compressorEnvelope;
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
    double macroSmoothed[4];
    double controlSmoothed[synth::kControlSmoothingCount];
    double globalLfoPhase;
    uint64_t globalLfoCycleIndex;
    float globalLfoHold;
    double globalLfo2Phase;
    uint64_t globalLfo2CycleIndex;
    float globalLfo2Hold;
    float params[synth::kParamCount];
    uint32_t pendingVoiceParamMask;
    float pendingVoiceParams[synth::kVoiceParamCount];
    synth::Voice voices[synth::kVoiceCapacity];
    synth::InsertFxState insertFx;
    synth::WavetableBank wavetable;
};

#endif
