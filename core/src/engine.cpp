#include "engine.hpp"
#include "fast_math.hpp"
#include "rng.hpp"

namespace synth {

double unison_pan_position(uint32_t index, uint32_t count) {
    if (count <= 1) return 0.0;
    return (2.0 * static_cast<double>(index) / static_cast<double>(count - 1)) - 1.0;
}

double unison_detune_position(uint32_t index, uint32_t count) {
    if (count == 4) {
        static constexpr double positions[4] = {-1.0, -0.2, 0.2, 1.0};
        return positions[index < 4 ? index : 3];
    }
    return unison_pan_position(index, count);
}

double unison_phase_offset(uint32_t index, uint32_t count) {
    if (count <= 1) return 0.0;
    const uint32_t bounded = index < count ? index : count - 1u;
    return (static_cast<double>(bounded) -
            0.5 * static_cast<double>(count - 1u)) * 0.125;
}

double unison_width_amount(double width, uint32_t curve) {
    if (width <= 0.0) return 0.0;
    if (width >= 1.0) return 1.0;
    return curve == 0u ? width : fast_sin(width * kPi * 0.5);
}

float fm_high_guard_depth(float requested, double carrierHz,
                          double modulatorHz, double sampleRate) {
    if (requested <= 0.0f || carrierHz <= 0.0 || modulatorHz <= 0.0 ||
        sampleRate <= 0.0) return requested;
    const double upperLimit = 0.45 * sampleRate;
    const double sidebandHeadroom = (upperLimit - carrierHz) / modulatorHz;
    if (sidebandHeadroom <= 1.0) return 0.0f;
    const double safeDepth = (sidebandHeadroom - 1.0) / (4.0 * kPi);
    return safeDepth >= static_cast<double>(requested)
        ? requested : static_cast<float>(safeDepth);
}

}  // namespace synth

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
    kMacro2 = 74,
    kSendLevel = 75,
    kOscAWidthCurve = 76,
    kOscBWidthCurve = 77,
    kFmQuality = 78,
    kLfo2Rate = 79,
    kLfo2Shape = 80,
    kLfo2Retrigger = 81,
    kLfo2Phase = 82,
    kMacro3 = 83,
    kMacro4 = 84,
    kModEgAttack = 85,
    kModEgDecay = 86,
    kModEgSustain = 87,
    kModEgRelease = 88,
    kModEgCurve = 89,
    kDistortionOn = 90,
    kDistortionDrive = 91,
    kDistortionTone = 92,
    kDistortionMix = 93,
    kChorusOn = 94,
    kChorusRate = 95,
    kChorusDepth = 96,
    kChorusWidth = 97,
    kChorusMix = 98,
    kEqOn = 99,
    kEqLow = 100,
    kEqMid = 101,
    kEqHigh = 102,
    kCompressorOn = 103,
    kCompressorThreshold = 104,
    kCompressorRatio = 105,
    kCompressorAttack = 106,
    kCompressorRelease = 107,
    kCompressorMakeup = 108,
    kInsertOrder1 = 109,
    kInsertOrder2 = 110,
    kInsertOrder3 = 111,
    kInsertOrder4 = 112
};

enum VoiceParamIndex : uint32_t {
    kVoiceOscAMorph = 0,
    kVoiceOscALevel,
    kVoiceAmpAttack,
    kVoiceAmpDecay,
    kVoiceAmpSustain,
    kVoiceAmpRelease,
    kVoiceOscBMorph,
    kVoiceOscBLevel,
    kVoiceFmBToA,
    kVoiceSubLevel,
    kVoiceNoiseLevel,
    kVoiceNoiseDecay,
    kVoiceFilterMode,
    kVoiceFilterCutoff,
    kVoiceFilterResonance,
    kVoiceFilterEnvAmount,
    kVoiceFilterEgAttack,
    kVoiceFilterEgDecay,
    kVoiceFilterEgSustain,
    kVoiceFilterEgRelease,
    kVoiceFilterEgCurve,
    kVoiceSendLevel
};

constexpr uint32_t kVoiceParamIds[synth::kVoiceParamCount] = {
    kOscMorph, kOscLevel, kAmpAttack, kAmpDecay, kAmpSustain, kAmpRelease,
    kOscBMorph, kOscBLevel, kFmBToA, kSubLevel, kNoiseLevel, kNoiseDecay,
    kFilterMode, kFilterCutoff, kFilterResonance, kFilterEnvAmount,
    kFilterEgAttack, kFilterEgDecay, kFilterEgSustain, kFilterEgRelease,
    kFilterEgCurve, kSendLevel
};

constexpr uint32_t kControlSmoothingParamIds[synth::kControlSmoothingCount] = {
    kOscMorph, kOscLevel, kMasterGain, kOscBMorph,
    kOscBLevel, kFmBToA, kSubLevel, kNoiseLevel
};

constexpr uint32_t kModSlotCount = 6;
constexpr uint32_t kModSlotStride = 3;
constexpr uint32_t kModDestinationCount = 14;
constexpr uint32_t kLfoHashLayer = 32u;
constexpr uint32_t kLfo2HashLayer = 33u;
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

int32_t voice_param_index(uint32_t paramId) {
    for (uint32_t index = 0; index < synth::kVoiceParamCount; ++index)
        if (kVoiceParamIds[index] == paramId) return static_cast<int32_t>(index);
    return -1;
}

bool voice_param_overridden(const synth::Voice* voice, uint32_t index) {
    return (voice->voiceParamMask & (1u << index)) != 0u;
}

float voice_param(const SynthEngine* engine, const synth::Voice* voice, uint32_t index) {
    return voice_param_overridden(voice, index)
        ? voice->voiceParams[index] : engine->params[kVoiceParamIds[index]];
}

int32_t control_smoothing_index(uint32_t paramId) {
    switch (paramId) {
        case kOscMorph: return synth::kSmoothOscAMorph;
        case kOscLevel: return synth::kSmoothOscALevel;
        case kMasterGain: return synth::kSmoothMasterGain;
        case kOscBMorph: return synth::kSmoothOscBMorph;
        case kOscBLevel: return synth::kSmoothOscBLevel;
        case kFmBToA: return synth::kSmoothFmBToA;
        case kSubLevel: return synth::kSmoothSubLevel;
        case kNoiseLevel: return synth::kSmoothNoiseLevel;
        default: return -1;
    }
}

float smoothed_control(const SynthEngine* engine, uint32_t paramId) {
    const int32_t index = control_smoothing_index(paramId);
    return index < 0 ? engine->params[paramId]
                     : static_cast<float>(engine->controlSmoothed[index]);
}

float voice_control(const SynthEngine* engine, const synth::Voice* voice,
                    uint32_t voiceIndex, uint32_t paramId) {
    return voice_param_overridden(voice, voiceIndex)
        ? voice->voiceParams[voiceIndex] : smoothed_control(engine, paramId);
}

bool any_active_voice(const SynthEngine* engine) {
    for (uint32_t i = 0; i < engine->voiceLimit; ++i)
        if (engine->voices[i].active != 0u) return true;
    return false;
}

void reset_control_smoothing(SynthEngine* engine) {
    for (uint32_t i = 0; i < synth::kControlSmoothingCount; ++i)
        engine->controlSmoothed[i] =
            static_cast<double>(engine->params[kControlSmoothingParamIds[i]]);
}

void advance_control_smoothing(SynthEngine* engine) {
    for (uint32_t i = 0; i < synth::kControlSmoothingCount; ++i) {
        const double target = static_cast<double>(
            engine->params[kControlSmoothingParamIds[i]]);
        engine->controlSmoothed[i] += engine->filterSmoothingCoefficient *
            (target - engine->controlSmoothed[i]);
        if (synth::absd(target - engine->controlSmoothed[i]) < 1.0e-7)
            engine->controlSmoothed[i] = target;
    }
}

double wrap_phase(double phase) {
    long long whole = static_cast<long long>(phase);
    if (phase < 0.0 && static_cast<double>(whole) != phase) --whole;
    return phase - static_cast<double>(whole);
}

float decibels_to_gain(float decibels) {
    return static_cast<float>(synth::fast_exp2(
        static_cast<double>(decibels) / 6.0205999132796239042));
}

float insert_mix_target(const SynthEngine* engine, uint32_t effect) {
    switch (effect) {
        case 0u:
            return engine->params[kDistortionOn] != 0.0f
                ? engine->params[kDistortionMix] : 0.0f;
        case 1u:
            return engine->params[kChorusOn] != 0.0f
                ? engine->params[kChorusMix] : 0.0f;
        case 2u: return engine->params[kEqOn] != 0.0f ? 1.0f : 0.0f;
        case 3u: return engine->params[kCompressorOn] != 0.0f ? 1.0f : 0.0f;
        default: return 0.0f;
    }
}

void reset_insert_fx(SynthEngine* engine) {
    for (uint32_t effect = 0; effect < synth::kInsertFxCount; ++effect)
        engine->insertFx.mix[effect] = insert_mix_target(engine, effect);
    engine->insertFx.distortionTone[0] = 0.0f;
    engine->insertFx.distortionTone[1] = 0.0f;
    for (uint32_t channel = 0; channel < 2; ++channel) {
        for (uint32_t frame = 0; frame < synth::kChorusDelayCapacity; ++frame)
            engine->insertFx.chorusDelay[channel][frame] = 0.0f;
        engine->insertFx.chorusPhase[channel] = 0.0;
        engine->insertFx.eqLow[channel] = 0.0f;
        engine->insertFx.eqHighLow[channel] = 0.0f;
    }
    engine->insertFx.chorusWrite = 0u;
    engine->insertFx.compressorEnvelope = 0.0f;
}

float advance_insert_mix(SynthEngine* engine, uint32_t effect) {
    const float target = insert_mix_target(engine, effect);
    float& current = engine->insertFx.mix[effect];
    current += static_cast<float>(engine->filterSmoothingCoefficient) * (target - current);
    if (synth::absd(static_cast<double>(target - current)) < 1.0e-7) current = target;
    return current;
}

float one_pole_coefficient(double cutoff, double sampleRate) {
    const double bounded = cutoff < 1.0 ? 1.0
        : (cutoff > sampleRate * 0.45 ? sampleRate * 0.45 : cutoff);
    return static_cast<float>(1.0 - synth::fast_exp2(
        -synth::kTwoPi * bounded / (sampleRate * synth::kLn2)));
}

float normalized_soft_clip(float input, float drive) {
    const float amount = 1.0f + drive * 28.0f;
    const float normalization = amount / (1.0f + amount);
    const float driven = input * amount;
    return (driven / (1.0f + static_cast<float>(synth::absd(driven)))) / normalization;
}

void process_distortion(SynthEngine* engine, float* left, float* right) {
    const float mix = advance_insert_mix(engine, 0u);
    if (mix == 0.0f) return;
    const float toneCoefficient = one_pole_coefficient(
        engine->params[kDistortionTone], engine->sampleRate);
    const float inputs[2] = {*left, *right};
    float* outputs[2] = {left, right};
    for (uint32_t channel = 0; channel < 2; ++channel) {
        const float clipped = normalized_soft_clip(
            inputs[channel], engine->params[kDistortionDrive]);
        float& tone = engine->insertFx.distortionTone[channel];
        tone += toneCoefficient * (clipped - tone);
        *outputs[channel] = inputs[channel] + mix * (tone - inputs[channel]);
    }
}

float chorus_delay_sample(const float* buffer, uint32_t writeIndex, double delaySamples) {
    if (delaySamples < 1.0) delaySamples = 1.0;
    const double maximum = static_cast<double>(synth::kChorusDelayCapacity - 2u);
    if (delaySamples > maximum) delaySamples = maximum;
    const uint32_t whole = static_cast<uint32_t>(delaySamples);
    const float fraction = static_cast<float>(delaySamples - static_cast<double>(whole));
    const uint32_t newer = (writeIndex + synth::kChorusDelayCapacity - whole) &
        (synth::kChorusDelayCapacity - 1u);
    const uint32_t older = (newer + synth::kChorusDelayCapacity - 1u) &
        (synth::kChorusDelayCapacity - 1u);
    return buffer[newer] + fraction * (buffer[older] - buffer[newer]);
}

void process_chorus(SynthEngine* engine, float* left, float* right) {
    static_assert((synth::kChorusDelayCapacity & (synth::kChorusDelayCapacity - 1u)) == 0u);
    const float mix = advance_insert_mix(engine, 1u);
    if (mix == 0.0f) return;
    const float inputs[2] = {*left, *right};
    engine->insertFx.chorusDelay[0][engine->insertFx.chorusWrite] = inputs[0];
    engine->insertFx.chorusDelay[1][engine->insertFx.chorusWrite] = inputs[1];
    const double depthSeconds = 0.001 + static_cast<double>(engine->params[kChorusDepth]) * 0.008;
    const double widthOffset = depthSeconds * static_cast<double>(engine->params[kChorusWidth]) * 0.35;
    const double baseSeconds[2] = {0.012 - widthOffset, 0.012 + widthOffset};
    float wet[2];
    for (uint32_t channel = 0; channel < 2; ++channel) {
        const double polarity = channel == 0u ? 1.0 : -1.0;
        const double modulation = polarity * depthSeconds *
            synth::fast_sin(synth::kTwoPi * engine->insertFx.chorusPhase[channel]);
        wet[channel] = chorus_delay_sample(
            engine->insertFx.chorusDelay[channel], engine->insertFx.chorusWrite,
            (baseSeconds[channel] + modulation) * engine->sampleRate);
        const double rate = static_cast<double>(engine->params[kChorusRate]) *
            (channel == 0u ? 1.0 : 1.013);
        engine->insertFx.chorusPhase[channel] = wrap_phase(
            engine->insertFx.chorusPhase[channel] + rate / engine->sampleRate);
    }
    engine->insertFx.chorusWrite = (engine->insertFx.chorusWrite + 1u) &
        (synth::kChorusDelayCapacity - 1u);
    *left = inputs[0] + mix * (wet[0] - inputs[0]);
    *right = inputs[1] + mix * (wet[1] - inputs[1]);
}

void process_eq(SynthEngine* engine, float* left, float* right) {
    const float mix = advance_insert_mix(engine, 2u);
    if (mix == 0.0f) return;
    const float lowCoefficient = one_pole_coefficient(160.0, engine->sampleRate);
    const float highCoefficient = one_pole_coefficient(6800.0, engine->sampleRate);
    const float gains[3] = {
        decibels_to_gain(engine->params[kEqLow]),
        decibels_to_gain(engine->params[kEqMid]),
        decibels_to_gain(engine->params[kEqHigh])
    };
    const float inputs[2] = {*left, *right};
    float* outputs[2] = {left, right};
    for (uint32_t channel = 0; channel < 2; ++channel) {
        float& low = engine->insertFx.eqLow[channel];
        float& highLow = engine->insertFx.eqHighLow[channel];
        low += lowCoefficient * (inputs[channel] - low);
        highLow += highCoefficient * (inputs[channel] - highLow);
        const float processed = low * gains[0] + (highLow - low) * gains[1] +
            (inputs[channel] - highLow) * gains[2];
        *outputs[channel] = inputs[channel] + mix * (processed - inputs[channel]);
    }
}

void process_compressor(SynthEngine* engine, float* left, float* right) {
    const float mix = advance_insert_mix(engine, 3u);
    if (mix == 0.0f) return;
    const float inputLeft = *left;
    const float inputRight = *right;
    const float detector = static_cast<float>(synth::absd(inputLeft)) >
            static_cast<float>(synth::absd(inputRight))
        ? static_cast<float>(synth::absd(inputLeft))
        : static_cast<float>(synth::absd(inputRight));
    const float attack = engine->params[kCompressorAttack];
    const float release = engine->params[kCompressorRelease];
    const float attackCoefficient = static_cast<float>(1.0 - synth::fast_exp2(
        -1.0 / (static_cast<double>(attack) * engine->sampleRate * synth::kLn2)));
    const float releaseCoefficient = static_cast<float>(1.0 - synth::fast_exp2(
        -1.0 / (static_cast<double>(release) * engine->sampleRate * synth::kLn2)));
    float& envelope = engine->insertFx.compressorEnvelope;
    envelope += (detector > envelope ? attackCoefficient : releaseCoefficient) *
        (detector - envelope);
    const float level = envelope > 1.0e-12f ? envelope : 1.0e-12f;
    const float levelDb = static_cast<float>(6.0205999132796239042 *
        synth::fast_log2(static_cast<double>(level)));
    const float over = levelDb - engine->params[kCompressorThreshold];
    const float reduction = over > 0.0f
        ? -over * (1.0f - 1.0f / engine->params[kCompressorRatio]) : 0.0f;
    const float gain = decibels_to_gain(reduction + engine->params[kCompressorMakeup]);
    *left = inputLeft + mix * (inputLeft * gain - inputLeft);
    *right = inputRight + mix * (inputRight * gain - inputRight);
}

void effective_insert_order(const SynthEngine* engine, uint32_t* order) {
    uint32_t mask = 0u;
    bool valid = true;
    for (uint32_t slot = 0; slot < synth::kInsertFxCount; ++slot) {
        const uint32_t effect = static_cast<uint32_t>(engine->params[kInsertOrder1 + slot]);
        order[slot] = effect;
        const uint32_t bit = 1u << effect;
        if ((mask & bit) != 0u) valid = false;
        mask |= bit;
    }
    if (!valid || mask != 0x0fu)
        for (uint32_t slot = 0; slot < synth::kInsertFxCount; ++slot) order[slot] = slot;
}

void process_insert_fx(SynthEngine* engine, float* left, float* right) {
    bool inactive = true;
    for (uint32_t effect = 0; effect < synth::kInsertFxCount; ++effect) {
        if (engine->insertFx.mix[effect] != 0.0f || insert_mix_target(engine, effect) != 0.0f) {
            inactive = false;
            break;
        }
    }
    if (inactive) return;
    uint32_t order[synth::kInsertFxCount];
    effective_insert_order(engine, order);
    for (uint32_t slot = 0; slot < synth::kInsertFxCount; ++slot) {
        switch (order[slot]) {
            case 0u: process_distortion(engine, left, right); break;
            case 1u: process_chorus(engine, left, right); break;
            case 2u: process_eq(engine, left, right); break;
            case 3u: process_compressor(engine, left, right); break;
            default: break;
        }
    }
}

float unison_normalization(uint32_t count) {
    static constexpr float gains[synth::kMaxUnison + 1] = {
        0.0f, 1.0f, 0.70710678118654752440f, 0.57735026918962576451f, 0.5f
    };
    return gains[count <= synth::kMaxUnison ? count : synth::kMaxUnison];
}

float oscillator_sample(const SynthEngine* engine, uint32_t slot, float morph,
                        double frequency, double phase) {
    return synth::read_wavetable_bandlimited(
        &engine->wavetable, slot, morph, frequency, engine->sampleRate, phase);
}

void pan_gains(uint32_t index, uint32_t count, float width, uint32_t curve,
               float* left, float* right) {
    const double pan = synth::unison_width_amount(static_cast<double>(width), curve) *
                       synth::unison_pan_position(index, count);
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

float effective_fm_depth(const SynthEngine* engine, float requested,
                         double carrierHz, double modulatorHz) {
    if (engine->params[kFmQuality] == 0.0f) return requested;
    return synth::fm_high_guard_depth(
        requested, carrierHz, modulatorHz, engine->sampleRate);
}

double maximum_modulator_frequency(const synth::Voice* voice, uint32_t count,
                                   double pitchFactor) {
    double maximum = 0.0;
    for (uint32_t i = 0; i < count; ++i) {
        const double frequency = voice->frequencyB[i] * pitchFactor;
        if (frequency > maximum) maximum = frequency;
    }
    return maximum;
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
    voice->modStage = synth::kEnvOff;
    voice->modEnvelope = 0.0f;
    voice->modEnvelopeStageSamples = 0;
    voice->modEnvelopeReleaseStart = 0.0f;
    for (uint32_t channel = 0; channel < 2; ++channel) {
        for (uint32_t stage = 0; stage < 2; ++stage) {
            voice->filter[channel][stage].ic1 = 0.0;
            voice->filter[channel][stage].ic2 = 0.0;
        }
    }
    voice->lfoPhase = 0.0;
    voice->lfoCycleIndex = 0;
    voice->lfoHold = 0.0f;
    voice->lfo2Phase = 0.0;
    voice->lfo2CycleIndex = 0;
    voice->lfo2Hold = 0.0f;
    voice->voiceParamMask = 0;
    for (uint32_t i = 0; i < synth::kVoiceParamCount; ++i) voice->voiceParams[i] = 0.0f;
}

void clear_pending_voice_params(SynthEngine* engine) {
    engine->pendingVoiceParamMask = 0;
    for (uint32_t i = 0; i < synth::kVoiceParamCount; ++i)
        engine->pendingVoiceParams[i] = 0.0f;
}

float noise_decay_coefficient(float decayValue, double sampleRate) {
    const double decay = decayValue < 0.0005f ? 0.0005 : static_cast<double>(decayValue);
    return static_cast<float>(
        synth::fast_exp2(-1.0 / (decay * sampleRate * synth::kLn2)));
}

void update_noise_coefficients(SynthEngine* engine) {
    engine->noiseDecayCoefficient = noise_decay_coefficient(
        engine->params[kNoiseDecay], engine->sampleRate);
    static constexpr double cutoffs[3] = {20.0, 200.0, 2000.0};
    for (uint32_t i = 0; i < 3; ++i) {
        engine->pinkCoefficient[i] = static_cast<float>(synth::fast_exp2(
            -synth::kTwoPi * cutoffs[i] / (engine->sampleRate * synth::kLn2)));
    }
}

float voice_noise_decay_coefficient(const SynthEngine* engine, const synth::Voice* voice) {
    if (!voice_param_overridden(voice, kVoiceNoiseDecay))
        return engine->noiseDecayCoefficient;
    return noise_decay_coefficient(
        voice_param(engine, voice, kVoiceNoiseDecay), engine->sampleRate);
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

float lfo2_hash_value(const SynthEngine* engine, uint64_t cycleIndex, uint32_t voiceIndex) {
    return synth::hash_to_unit(synth::hash32(
        engine->seed, static_cast<uint32_t>(cycleIndex), voiceIndex, kLfo2HashLayer)) * 2.0f - 1.0f;
}

void reset_modulators(SynthEngine* engine) {
    engine->filterCutoffSmoothed = static_cast<double>(engine->params[kFilterCutoff]);
    engine->filterResonanceSmoothed = static_cast<double>(engine->params[kFilterResonance]);
    engine->macroSmoothed[0] = static_cast<double>(engine->params[kMacro1]);
    engine->macroSmoothed[1] = static_cast<double>(engine->params[kMacro2]);
    engine->macroSmoothed[2] = static_cast<double>(engine->params[kMacro3]);
    engine->macroSmoothed[3] = static_cast<double>(engine->params[kMacro4]);
    reset_control_smoothing(engine);
    engine->globalLfoPhase = static_cast<double>(engine->params[kLfoPhase]);
    engine->globalLfoCycleIndex = 0;
    engine->globalLfoHold = lfo_hash_value(engine, 0, kGlobalLfoIndex);
    engine->globalLfo2Phase = static_cast<double>(engine->params[kLfo2Phase]);
    engine->globalLfo2CycleIndex = 0;
    engine->globalLfo2Hold = lfo2_hash_value(engine, 0, kGlobalLfoIndex);
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
                               synth::unison_detune_position(i, unisonA) * 0.01;
        const double detuneB = static_cast<double>(engine->params[kOscBDetune]) *
                               synth::unison_detune_position(i, unisonB) * 0.01;
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

bool voice_requires_extended_path(const SynthEngine* engine, const synth::Voice* voice) {
    return voice_control(engine, voice, kVoiceOscBLevel, kOscBLevel) != 0.0f ||
           voice_control(engine, voice, kVoiceFmBToA, kFmBToA) != 0.0f ||
           voice_control(engine, voice, kVoiceSubLevel, kSubLevel) != 0.0f ||
           voice_control(engine, voice, kVoiceNoiseLevel, kNoiseLevel) != 0.0f;
}

bool active_voice_requires_extended_path(const SynthEngine* engine) {
    for (uint32_t i = 0; i < engine->voiceLimit; ++i) {
        const synth::Voice* voice = &engine->voices[i];
        if (voice->active != 0 && voice_requires_extended_path(engine, voice)) return true;
    }
    return false;
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
    voice->voiceParamMask = engine->pendingVoiceParamMask;
    for (uint32_t i = 0; i < synth::kVoiceParamCount; ++i)
        voice->voiceParams[i] = engine->pendingVoiceParams[i];
    clear_pending_voice_params(engine);
    voice->active = 1;
    voice->noteId = event.id;
    voice->stage = synth::kEnvAttack;
    voice->startOrder = ++engine->orderCounter;
    voice->baseFrequency = midi_frequency(event.a);
    voice->midiNote = event.a;
    voice->velocity = synth::clampf(event.b, 0.0f, 1.0f);
    voice->noiseEnvelope = 1.0f;
    voice->filterStage = synth::kEnvAttack;
    voice->modStage = synth::kEnvAttack;
    update_voice_frequencies(engine, voice);

    const uint32_t phaseModeA = static_cast<uint32_t>(engine->params[kOscAPhaseMode]);
    const uint32_t phaseModeB = static_cast<uint32_t>(engine->params[kOscBPhaseMode]);
    const uint32_t phaseCountA = static_cast<uint32_t>(engine->params[kOscAUnison]);
    const uint32_t phaseCountB = static_cast<uint32_t>(engine->params[kOscBUnison]);
    const bool fixedA = phaseModeA == 1u;
    const bool fixedB = phaseModeB == 1u;
    const uint32_t startOrder = static_cast<uint32_t>(voice->startOrder);
    for (uint32_t i = 0; i < synth::kMaxUnison; ++i) {
        voice->phaseA[i] = fixedA ? static_cast<double>(engine->params[kOscAPhase])
            : phaseModeA == 2u ? wrap_phase(static_cast<double>(engine->params[kOscAPhase]) +
                synth::unison_phase_offset(i, phaseCountA))
            : hashed_phase(engine, startOrder, voiceIndex, i);
        voice->phaseB[i] = fixedB ? static_cast<double>(engine->params[kOscBPhase])
            : phaseModeB == 2u ? wrap_phase(static_cast<double>(engine->params[kOscBPhase]) +
                synth::unison_phase_offset(i, phaseCountB))
            : hashed_phase(engine, startOrder, voiceIndex, 8u + i);
    }
    // M0a began at 0.25 cycle. Preserve that exact path when every M1a source is disabled.
    if (!fixedA && legacy_configuration(engine) && !voice_requires_extended_path(engine, voice))
        voice->phaseA[0] = 0.25;
    voice->phaseSub = hashed_phase(engine, startOrder, voiceIndex, 16u);
    voice->lfoPhase = static_cast<double>(engine->params[kLfoPhase]);
    voice->lfoCycleIndex = 0;
    voice->lfoHold = lfo_hash_value(engine, 0, voiceIndex);
    voice->lfo2Phase = static_cast<double>(engine->params[kLfo2Phase]);
    voice->lfo2CycleIndex = 0;
    voice->lfo2Hold = lfo2_hash_value(engine, 0, voiceIndex);
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
            voice->modStage = synth::kEnvRelease;
            voice->modEnvelopeStageSamples = 0;
            voice->modEnvelopeReleaseStart = voice->modEnvelope;
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
        const double samples = static_cast<double>(
            voice_param(engine, voice, kVoiceFilterEgAttack)) * engine->sampleRate;
        if (samples <= 1.0) voice->filterEnvelope = 1.0f;
        else voice->filterEnvelope += static_cast<float>(1.0 / samples);
        if (voice->filterEnvelope >= 1.0f) {
            voice->filterEnvelope = 1.0f;
            voice->filterStage = synth::kEnvDecay;
            voice->filterEnvelopeStageSamples = 0;
        }
    } else if (voice->filterStage == synth::kEnvDecay) {
        const float sustain = voice_param(engine, voice, kVoiceFilterEgSustain);
        const double samples = static_cast<double>(
            voice_param(engine, voice, kVoiceFilterEgDecay)) * engine->sampleRate;
        if (voice_param(engine, voice, kVoiceFilterEgCurve) == 0.0f) {
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
                    voice_param(engine, voice, kVoiceFilterEgCurve));
                voice->filterEnvelope = sustain + (1.0f - sustain) * shape;
            }
        }
    } else if (voice->filterStage == synth::kEnvSustain) {
        voice->filterEnvelope = voice_param(engine, voice, kVoiceFilterEgSustain);
    } else if (voice->filterStage == synth::kEnvRelease) {
        const double samples = static_cast<double>(
            voice_param(engine, voice, kVoiceFilterEgRelease)) * engine->sampleRate;
        if (voice_param(engine, voice, kVoiceFilterEgCurve) == 0.0f) {
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
                    voice->filterEnvelopeStageSamples, samples,
                    voice_param(engine, voice, kVoiceFilterEgCurve));
            }
        }
    }
    return voice->filterEnvelope;
}

float advance_mod_envelope(SynthEngine* engine, synth::Voice* voice) {
    if (voice->modStage == synth::kEnvAttack) {
        const double samples = static_cast<double>(engine->params[kModEgAttack]) * engine->sampleRate;
        if (samples <= 1.0) voice->modEnvelope = 1.0f;
        else voice->modEnvelope += static_cast<float>(1.0 / samples);
        if (voice->modEnvelope >= 1.0f) {
            voice->modEnvelope = 1.0f;
            voice->modStage = synth::kEnvDecay;
            voice->modEnvelopeStageSamples = 0;
        }
    } else if (voice->modStage == synth::kEnvDecay) {
        const float sustain = engine->params[kModEgSustain];
        const double samples = static_cast<double>(engine->params[kModEgDecay]) * engine->sampleRate;
        if (engine->params[kModEgCurve] == 0.0f) {
            if (samples <= 1.0) voice->modEnvelope = sustain;
            else {
                const float coefficient = static_cast<float>(synth::fast_exp2(-8.0 / samples));
                voice->modEnvelope = sustain + (voice->modEnvelope - sustain) * coefficient;
            }
            if (synth::absd(static_cast<double>(voice->modEnvelope - sustain)) < 1.0e-6) {
                voice->modEnvelope = sustain;
                voice->modStage = synth::kEnvSustain;
            }
        } else if (samples <= 1.0) {
            voice->modEnvelope = sustain;
            voice->modStage = synth::kEnvSustain;
        } else {
            ++voice->modEnvelopeStageSamples;
            if (static_cast<double>(voice->modEnvelopeStageSamples) >= samples) {
                voice->modEnvelope = sustain;
                voice->modStage = synth::kEnvSustain;
            } else {
                const float shape = envelope_shape(voice->modEnvelopeStageSamples, samples,
                                                   engine->params[kModEgCurve]);
                voice->modEnvelope = sustain + (1.0f - sustain) * shape;
            }
        }
    } else if (voice->modStage == synth::kEnvSustain) {
        voice->modEnvelope = engine->params[kModEgSustain];
    } else if (voice->modStage == synth::kEnvRelease) {
        const double samples = static_cast<double>(engine->params[kModEgRelease]) * engine->sampleRate;
        if (engine->params[kModEgCurve] == 0.0f) {
            if (samples <= 1.0) voice->modEnvelope = 0.0f;
            else voice->modEnvelope *= static_cast<float>(synth::fast_exp2(-16.0 / samples));
            if (voice->modEnvelope <= 0.0000158489319f) {
                voice->modEnvelope = 0.0f;
                voice->modStage = synth::kEnvOff;
            }
        } else if (samples <= 1.0) {
            voice->modEnvelope = 0.0f;
            voice->modStage = synth::kEnvOff;
        } else {
            ++voice->modEnvelopeStageSamples;
            if (static_cast<double>(voice->modEnvelopeStageSamples) >= samples) {
                voice->modEnvelope = 0.0f;
                voice->modStage = synth::kEnvOff;
            } else {
                voice->modEnvelope = voice->modEnvelopeReleaseStart * envelope_shape(
                    voice->modEnvelopeStageSamples, samples, engine->params[kModEgCurve]);
            }
        }
    }
    return voice->modEnvelope;
}

float advance_envelope(SynthEngine* engine, synth::Voice* voice) {
    if (voice->stage == synth::kEnvAttack) {
        const double samples = static_cast<double>(
            voice_param(engine, voice, kVoiceAmpAttack)) * engine->sampleRate;
        if (samples <= 1.0) voice->envelope = 1.0f;
        else voice->envelope += static_cast<float>(1.0 / samples);
        if (voice->envelope >= 1.0f) {
            voice->envelope = 1.0f;
            voice->stage = synth::kEnvDecay;
            voice->envelopeStageSamples = 0;
        }
    } else if (voice->stage == synth::kEnvDecay) {
        const float sustain = voice_param(engine, voice, kVoiceAmpSustain);
        const double samples = static_cast<double>(
            voice_param(engine, voice, kVoiceAmpDecay)) * engine->sampleRate;
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
        voice->envelope = voice_param(engine, voice, kVoiceAmpSustain);
    } else if (voice->stage == synth::kEnvRelease) {
        const double samples = static_cast<double>(
            voice_param(engine, voice, kVoiceAmpRelease)) * engine->sampleRate;
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
    } else if (event.kind == SYNTH_EV_MACRO && event.id < 4u) {
        const uint32_t macroIds[4] = {kMacro1, kMacro2, kMacro3, kMacro4};
        (void)synth_set_param(engine, macroIds[event.id], event.a);
    }
}

bool apply_voice_param(SynthEngine* engine, const SynthEvent& event) {
    const int32_t mapped = voice_param_index(event.id);
    if (mapped < 0 || event.a != event.a) return false;
    const SynthParamInfo& definition = synth::kParameterInfo[event.id];
    float value = synth::clampf(event.a, definition.minimum, definition.maximum);
    if ((definition.flags & SYNTH_PARAM_FLAG_INTEGER) != 0u)
        value = rounded_integer(value, definition.minimum, definition.maximum);
    const uint32_t index = static_cast<uint32_t>(mapped);
    engine->pendingVoiceParams[index] = value;
    engine->pendingVoiceParamMask |= 1u << index;
    return true;
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

void advance_lfo2(double* phase, uint64_t* cycleIndex, float* held,
                  const SynthEngine* engine, uint32_t voiceIndex) {
    const double advanced = *phase + static_cast<double>(engine->params[kLfo2Rate]) /
        engine->sampleRate;
    const uint64_t wraps = static_cast<uint64_t>(advanced);
    *phase = advanced - static_cast<double>(wraps);
    if (wraps != 0) {
        *cycleIndex += wraps;
        *held = lfo2_hash_value(engine, *cycleIndex, voiceIndex);
    }
}

float modulation_source(const SynthEngine* engine, const synth::Voice* voice,
                        uint32_t source, float lfo, float lfo2) {
    if (source == 1u) return lfo;
    if (source == 8u) return lfo2;
    if (source == 6u) return static_cast<float>(engine->macroSmoothed[0]);
    if (source == 7u) return static_cast<float>(engine->macroSmoothed[1]);
    if (source == 9u) return static_cast<float>(engine->macroSmoothed[2]);
    if (source == 10u) return static_cast<float>(engine->macroSmoothed[3]);
    if (voice == 0 || voice->active == 0) return 0.0f;
    if (source == 2u) return voice->envelope;
    if (source == 3u) return voice->filterEnvelope;
    if (source == 4u) return voice->velocity;
    if (source == 5u) return synth::clampf((voice->midiNote - 60.0f) / 60.0f, -1.0f, 1.0f);
    if (source == 11u) return voice->modEnvelope;
    return 0.0f;
}

void evaluate_modulation(const SynthEngine* engine, const synth::Voice* voice,
                         float lfo, float lfo2, ModulationValues* values) {
    for (uint32_t destination = 0; destination < kModDestinationCount; ++destination)
        values->destination[destination] = 0.0f;
    for (uint32_t slot = 0; slot < kModSlotCount; ++slot) {
        const uint32_t base = kModSlotBase + slot * kModSlotStride;
        const uint32_t source = static_cast<uint32_t>(engine->params[base]);
        const uint32_t destination = static_cast<uint32_t>(engine->params[base + 1]);
        if (source == 0u || destination == 0u || destination >= kModDestinationCount) continue;
        values->destination[destination] += modulation_source(engine, voice, source, lfo, lfo2) *
            engine->params[base + 2] * kModDestinationFull[destination];
    }
}

double modulation_lfo_rate(const SynthEngine* engine, uint32_t lfoShape,
                           uint32_t lfo2Shape, float globalLfo, float globalLfo2) {
    const synth::Voice* voice = &engine->voices[0];
    const bool retrigger = engine->params[kLfoRetrigger] != 0.0f;
    const float lfo = retrigger
        ? lfo_value(lfoShape, voice->lfoPhase, voice->lfoHold) : globalLfo;
    const bool retrigger2 = engine->params[kLfo2Retrigger] != 0.0f;
    const float lfo2 = retrigger2
        ? lfo_value(lfo2Shape, voice->lfo2Phase, voice->lfo2Hold) : globalLfo2;
    ModulationValues modulation{};
    evaluate_modulation(engine, voice, lfo, lfo2, &modulation);
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
                           float* left, float* right, float* sendLeft, float* sendRight) {
    const uint32_t countA = static_cast<uint32_t>(engine->params[kOscAUnison]);
    const uint32_t countB = static_cast<uint32_t>(engine->params[kOscBUnison]);
    const float normalizationA = unison_normalization(countA);
    const float normalizationB = unison_normalization(countB);
    const uint32_t slotA = static_cast<uint32_t>(engine->params[kOscWavetable]);
    const uint32_t slotB = static_cast<uint32_t>(engine->params[kOscBWavetable]);

    float bMod = 0.0f;
    for (uint32_t i = 0; i < countB; ++i) {
        bMod += oscillator_sample(engine, slotB,
            voice_control(engine, voice, kVoiceOscBMorph, kOscBMorph), voice->frequencyB[i],
            voice->phaseB[i]);
    }
    bMod *= normalizationB;
    const double modulatorFrequency = maximum_modulator_frequency(voice, countB, 1.0);

    float voiceLeft = 0.0f;
    float voiceRight = 0.0f;
    for (uint32_t i = 0; i < countA; ++i) {
        double readPhase = voice->phaseA[i];
        const float fmBToA = effective_fm_depth(engine,
            voice_control(engine, voice, kVoiceFmBToA, kFmBToA),
            voice->frequencyA[i], modulatorFrequency);
        if (fmBToA != 0.0f) {
            readPhase = wrap_phase(readPhase +
                static_cast<double>(fmBToA) * 2.0 * static_cast<double>(bMod));
        }
        const float sample = oscillator_sample(engine, slotA,
            voice_control(engine, voice, kVoiceOscAMorph, kOscMorph),
            voice->frequencyA[i], readPhase) * normalizationA *
            voice_control(engine, voice, kVoiceOscALevel, kOscLevel);
        float gainLeft = 0.0f;
        float gainRight = 0.0f;
        pan_gains(i, countA, engine->params[kOscAWidth],
                  static_cast<uint32_t>(engine->params[kOscAWidthCurve]),
                  &gainLeft, &gainRight);
        voiceLeft += sample * gainLeft;
        voiceRight += sample * gainRight;
    }

    const float levelB = voice_control(engine, voice, kVoiceOscBLevel, kOscBLevel);
    if (levelB != 0.0f) {
        for (uint32_t i = 0; i < countB; ++i) {
            const float sample = oscillator_sample(engine, slotB,
                voice_control(engine, voice, kVoiceOscBMorph, kOscBMorph),
                voice->frequencyB[i],
                voice->phaseB[i]) *
                normalizationB * levelB;
            float gainLeft = 0.0f;
            float gainRight = 0.0f;
            pan_gains(i, countB, engine->params[kOscBWidth],
                      static_cast<uint32_t>(engine->params[kOscBWidthCurve]),
                      &gainLeft, &gainRight);
            voiceLeft += sample * gainLeft;
            voiceRight += sample * gainRight;
        }
    }

    const float subLevel = voice_control(engine, voice, kVoiceSubLevel, kSubLevel);
    if (subLevel != 0.0f) {
        static constexpr uint32_t subSlots[3] = {0u, 3u, 2u};
        const uint32_t shape = static_cast<uint32_t>(engine->params[kSubShape]);
        const float sub = oscillator_sample(
            engine, subSlots[shape], 0.0f, voice->frequencySub, voice->phaseSub) * subLevel;
        voiceLeft += sub;
        voiceRight += sub;
    }

    const float noiseLevel = voice_control(engine, voice, kVoiceNoiseLevel, kNoiseLevel);
    if (noiseLevel != 0.0f) {
        const float noise = render_noise(engine, voice) * noiseLevel;
        voiceLeft += noise;
        voiceRight += noise;
    }
    voice->noiseEnvelope *= voice_noise_decay_coefficient(engine, voice);

    const float voiceGain = voice->velocity * voice->envelope;
    *left += voiceLeft * voiceGain;
    *right += voiceRight * voiceGain;
    const float sendLevel = voice_param(engine, voice, kVoiceSendLevel);
    *sendLeft += voiceLeft * voiceGain * sendLevel;
    *sendRight += voiceRight * voiceGain * sendLevel;
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
        static_cast<double>(voice_param(engine, voice, kVoiceFilterEnvAmount)) * velocityDepth *
            static_cast<double>(voice->filterEnvelope) +
        static_cast<double>(engine->params[kLfoToCutoff]) * static_cast<double>(lfo);
    const double baseCutoff = voice_param_overridden(voice, kVoiceFilterCutoff)
        ? static_cast<double>(voice_param(engine, voice, kVoiceFilterCutoff))
        : engine->filterCutoffSmoothed;
    double cutoff = baseCutoff * synth::exp2_fast(octaves);
    const double maximum = 0.45 * engine->sampleRate;
    if (cutoff < 20.0) cutoff = 20.0;
    if (cutoff > maximum) cutoff = maximum;
    const double g = synth::tan_pi_normalized(cutoff / engine->sampleRate);
    const double resonance = voice_param_overridden(voice, kVoiceFilterResonance)
        ? static_cast<double>(voice_param(engine, voice, kVoiceFilterResonance))
        : engine->filterResonanceSmoothed;
    const double k = 2.0 - 1.99 * resonance;
    const double a1 = 1.0 / (1.0 + g * (g + k));
    const double a2 = g * a1;
    const double a3 = g * a2;
    const uint32_t mode = static_cast<uint32_t>(
        voice_param(engine, voice, kVoiceFilterMode));
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
                      float* left, float* right, float* sendLeft, float* sendRight) {
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
        bMod += oscillator_sample(engine, slotB,
            voice_control(engine, voice, kVoiceOscBMorph, kOscBMorph),
            voice->frequencyB[i] * pitchFactor,
            voice->phaseB[i]);
    }
    bMod *= normalizationB;
    const double modulatorFrequency = maximum_modulator_frequency(voice, countB, pitchFactor);

    float voiceLeft = 0.0f;
    float voiceRight = 0.0f;
    for (uint32_t i = 0; i < countA; ++i) {
        double readPhase = voice->phaseA[i];
        const float fmBToA = effective_fm_depth(engine,
            voice_control(engine, voice, kVoiceFmBToA, kFmBToA),
            voice->frequencyA[i] * pitchFactor, modulatorFrequency);
        if (fmBToA != 0.0f) {
            readPhase = wrap_phase(readPhase +
                static_cast<double>(fmBToA) * 2.0 * static_cast<double>(bMod));
        }
        const float sample = oscillator_sample(engine, slotA,
            voice_control(engine, voice, kVoiceOscAMorph, kOscMorph),
            voice->frequencyA[i] * pitchFactor,
            readPhase) * normalizationA *
            voice_control(engine, voice, kVoiceOscALevel, kOscLevel);
        float gainLeft = 0.0f;
        float gainRight = 0.0f;
        pan_gains(i, countA, engine->params[kOscAWidth],
                  static_cast<uint32_t>(engine->params[kOscAWidthCurve]),
                  &gainLeft, &gainRight);
        voiceLeft += sample * gainLeft;
        voiceRight += sample * gainRight;
    }

    const float levelB = voice_control(engine, voice, kVoiceOscBLevel, kOscBLevel);
    if (levelB != 0.0f) {
        for (uint32_t i = 0; i < countB; ++i) {
            const float sample = oscillator_sample(engine, slotB,
                voice_control(engine, voice, kVoiceOscBMorph, kOscBMorph),
                voice->frequencyB[i] * pitchFactor, voice->phaseB[i]) *
                normalizationB * levelB;
            float gainLeft = 0.0f;
            float gainRight = 0.0f;
            pan_gains(i, countB, engine->params[kOscBWidth],
                      static_cast<uint32_t>(engine->params[kOscBWidthCurve]),
                      &gainLeft, &gainRight);
            voiceLeft += sample * gainLeft;
            voiceRight += sample * gainRight;
        }
    }

    const float subLevel = voice_control(engine, voice, kVoiceSubLevel, kSubLevel);
    if (subLevel != 0.0f) {
        static constexpr uint32_t subSlots[3] = {0u, 3u, 2u};
        const uint32_t shape = static_cast<uint32_t>(engine->params[kSubShape]);
        const float sub = oscillator_sample(engine, subSlots[shape], 0.0f,
            voice->frequencySub * pitchFactor, voice->phaseSub) * subLevel;
        voiceLeft += sub;
        voiceRight += sub;
    }

    const float noiseLevel = voice_control(engine, voice, kVoiceNoiseLevel, kNoiseLevel);
    if (noiseLevel != 0.0f) {
        const float noise = render_noise(engine, voice) * noiseLevel;
        voiceLeft += noise;
        voiceRight += noise;
    }
    voice->noiseEnvelope *= voice_noise_decay_coefficient(engine, voice);

    apply_voice_filter(engine, voice, lfo, &voiceLeft, &voiceRight);
    const float ampLfo = 1.0f - engine->params[kLfoToAmp] *
        (1.0f - (0.5f + 0.5f * lfo));
    const float voiceGain = voice->velocity * voice->envelope * ampLfo;
    *left += voiceLeft * voiceGain;
    *right += voiceRight * voiceGain;
    const float sendLevel = voice_param(engine, voice, kVoiceSendLevel);
    *sendLeft += voiceLeft * voiceGain * sendLevel;
    *sendRight += voiceRight * voiceGain * sendLevel;
    advance_modulated_oscillators(voice, engine->sampleRate, pitchFactor);
}

void advance_m1c_oscillators(synth::Voice* voice, double sampleRate,
                             double pitchFactor, double detuneDeltaCents,
                             uint32_t unisonA) {
    for (uint32_t i = 0; i < synth::kMaxUnison; ++i) {
        const double detuneFactor = synth::exp2_fast(
            detuneDeltaCents * synth::unison_detune_position(i, unisonA) / 1200.0);
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
        static_cast<double>(voice_param(engine, voice, kVoiceFilterEnvAmount)) * velocityDepth *
            static_cast<double>(voice->filterEnvelope) +
        static_cast<double>(engine->params[kLfoToCutoff]) * static_cast<double>(lfo) +
        static_cast<double>(modulation.destination[8]);
    const double baseCutoff = voice_param_overridden(voice, kVoiceFilterCutoff)
        ? static_cast<double>(voice_param(engine, voice, kVoiceFilterCutoff))
        : engine->filterCutoffSmoothed;
    double cutoff = baseCutoff * synth::exp2_fast(octaves);
    const double maximum = 0.45 * engine->sampleRate;
    if (cutoff < 20.0) cutoff = 20.0;
    if (cutoff > maximum) cutoff = maximum;
    const float baseResonance = voice_param_overridden(voice, kVoiceFilterResonance)
        ? voice_param(engine, voice, kVoiceFilterResonance)
        : static_cast<float>(engine->filterResonanceSmoothed);
    const double resonance = static_cast<double>(synth::clampf(
        baseResonance + modulation.destination[9], 0.0f, 1.0f));
    const double g = synth::tan_pi_normalized(cutoff / engine->sampleRate);
    const double k = 2.0 - 1.99 * resonance;
    const double a1 = 1.0 / (1.0 + g * (g + k));
    const double a2 = g * a1;
    const double a3 = g * a2;
    const uint32_t mode = static_cast<uint32_t>(
        voice_param(engine, voice, kVoiceFilterMode));
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
                      float* left, float* right, float* sendLeft, float* sendRight) {
    const uint32_t countA = static_cast<uint32_t>(engine->params[kOscAUnison]);
    const uint32_t countB = static_cast<uint32_t>(engine->params[kOscBUnison]);
    const float normalizationA = unison_normalization(countA);
    const float normalizationB = unison_normalization(countB);
    const uint32_t slotA = static_cast<uint32_t>(engine->params[kOscWavetable]);
    const uint32_t slotB = static_cast<uint32_t>(engine->params[kOscBWavetable]);
    const float levelA = synth::clampf(
        voice_control(engine, voice, kVoiceOscALevel, kOscLevel) +
        modulation.destination[1], 0.0f, 4.0f);
    const float levelB = synth::clampf(
        voice_control(engine, voice, kVoiceOscBLevel, kOscBLevel) +
        modulation.destination[2], 0.0f, 4.0f);
    const float morphA = synth::clampf(
        voice_control(engine, voice, kVoiceOscAMorph, kOscMorph) +
        modulation.destination[3], 0.0f, 1.0f);
    const float morphB = synth::clampf(
        voice_control(engine, voice, kVoiceOscBMorph, kOscBMorph) +
        modulation.destination[4], 0.0f, 1.0f);
    const float fmBToA = synth::clampf(
        voice_control(engine, voice, kVoiceFmBToA, kFmBToA) +
        modulation.destination[5], 0.0f, 1.0f);
    const float subLevel = synth::clampf(
        voice_control(engine, voice, kVoiceSubLevel, kSubLevel) +
        modulation.destination[6], 0.0f, 4.0f);
    const float noiseLevel = synth::clampf(
        voice_control(engine, voice, kVoiceNoiseLevel, kNoiseLevel) +
        modulation.destination[7], 0.0f, 4.0f);
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
        bMod += oscillator_sample(
            engine, slotB, morphB, voice->frequencyB[i] * pitchFactor, voice->phaseB[i]);
    }
    bMod *= normalizationB;
    const double modulatorFrequency = maximum_modulator_frequency(voice, countB, pitchFactor);

    float voiceLeft = 0.0f;
    float voiceRight = 0.0f;
    for (uint32_t i = 0; i < countA; ++i) {
        const double detuneFactor = synth::exp2_fast(
            detuneDeltaCents * synth::unison_detune_position(i, countA) / 1200.0);
        double readPhase = voice->phaseA[i];
        const float guardedFm = effective_fm_depth(
            engine, fmBToA, voice->frequencyA[i] * pitchFactor * detuneFactor,
            modulatorFrequency);
        if (guardedFm != 0.0f) {
            readPhase = wrap_phase(readPhase +
                static_cast<double>(guardedFm) * 2.0 * static_cast<double>(bMod));
        }
        const float sample = oscillator_sample(engine, slotA, morphA,
            voice->frequencyA[i] * pitchFactor * detuneFactor, readPhase) *
            normalizationA * levelA;
        float gainLeft = 0.0f;
        float gainRight = 0.0f;
        pan_gains(i, countA, engine->params[kOscAWidth],
                  static_cast<uint32_t>(engine->params[kOscAWidthCurve]),
                  &gainLeft, &gainRight);
        voiceLeft += sample * gainLeft;
        voiceRight += sample * gainRight;
    }

    if (levelB != 0.0f) {
        for (uint32_t i = 0; i < countB; ++i) {
            const float sample = oscillator_sample(engine, slotB, morphB,
                voice->frequencyB[i] * pitchFactor, voice->phaseB[i]) *
                normalizationB * levelB;
            float gainLeft = 0.0f;
            float gainRight = 0.0f;
            pan_gains(i, countB, engine->params[kOscBWidth],
                      static_cast<uint32_t>(engine->params[kOscBWidthCurve]),
                      &gainLeft, &gainRight);
            voiceLeft += sample * gainLeft;
            voiceRight += sample * gainRight;
        }
    }

    if (subLevel != 0.0f) {
        static constexpr uint32_t subSlots[3] = {0u, 3u, 2u};
        const uint32_t shape = static_cast<uint32_t>(engine->params[kSubShape]);
        const float sub = oscillator_sample(engine, subSlots[shape], 0.0f,
            voice->frequencySub * pitchFactor, voice->phaseSub) * subLevel;
        voiceLeft += sub;
        voiceRight += sub;
    }

    if (noiseLevel != 0.0f) {
        const float noise = render_noise(engine, voice) * noiseLevel;
        voiceLeft += noise;
        voiceRight += noise;
    }
    voice->noiseEnvelope *= voice_noise_decay_coefficient(engine, voice);

    apply_m1c_voice_filter(engine, voice, lfo, modulation, &voiceLeft, &voiceRight);
    const float ampLfo = 1.0f - engine->params[kLfoToAmp] *
        (1.0f - (0.5f + 0.5f * lfo));
    const float modulatedAmp = synth::clampf(1.0f + modulation.destination[13], 0.0f, 2.0f);
    const float voiceGain = voice->velocity * voice->envelope * ampLfo * modulatedAmp;
    *left += voiceLeft * voiceGain;
    *right += voiceRight * voiceGain;
    const float sendLevel = voice_param(engine, voice, kVoiceSendLevel);
    *sendLeft += voiceLeft * voiceGain * sendLevel;
    *sendRight += voiceRight * voiceGain * sendLevel;
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
    clear_pending_voice_params(engine);
    for (uint32_t i = 0; i < synth::kVoiceCapacity; ++i) clear_voice(&engine->voices[i]);
    reset_modulators(engine);
    reset_insert_fx(engine);
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
    const int32_t smoothingIndex = control_smoothing_index(paramId);
    if (smoothingIndex >= 0 && !any_active_voice(engine))
        engine->controlSmoothed[static_cast<uint32_t>(smoothingIndex)] =
            static_cast<double>(value);
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
    clear_pending_voice_params(engine);
    if (kind == SYNTH_RESET_ALL) reset_params(engine);
    reset_modulators(engine);
    reset_insert_fx(engine);
}

extern "C" int synth_process(SynthEngine* engine, const SynthEvent* events, uint32_t nEvents,
                              float* outL, float* outR, uint32_t nFrames) {
    return synth_process_send(engine, events, nEvents, outL, outR, 0, 0, nFrames);
}

extern "C" int synth_process_send(SynthEngine* engine, const SynthEvent* events,
                                   uint32_t nEvents, float* outL, float* outR,
                                   float* sendL, float* sendR, uint32_t nFrames) {
    if (engine == 0 || outL == 0 || outR == 0 || (events == 0 && nEvents != 0)) return -1;
    if (nFrames > engine->maxBlock) return -2;
    int ignored = 0;
    for (uint32_t e = 0; e < nEvents; ++e) {
        if (events[e].offset >= nFrames) ++ignored;
        else if (events[e].kind == SYNTH_EV_MACRO && events[e].id >= 4u) ++ignored;
    }
    for (uint32_t frame = 0; frame < nFrames; ++frame) {
        for (uint32_t e = 0; e < nEvents; ++e)
            if (events[e].offset == frame && events[e].kind == SYNTH_EV_NOTE_OFF)
                note_off(engine, events[e].id);
        for (uint32_t e = 0; e < nEvents; ++e)
            if (events[e].offset == frame &&
                (events[e].kind == SYNTH_EV_PARAM || events[e].kind == SYNTH_EV_MACRO))
                apply_event_param(engine, events[e]);
        // A VOICE_PARAM* -> NOTE_ON bundle is ordered by the caller.  Do not
        // gather all overrides before all notes here: at one offset that would
        // make the first NOTE_ON consume overrides intended for later notes.
        for (uint32_t e = 0; e < nEvents; ++e) {
            if (events[e].offset != frame) continue;
            if (events[e].kind == SYNTH_EV_VOICE_PARAM) {
                if (!apply_voice_param(engine, events[e])) ++ignored;
            } else if (events[e].kind == SYNTH_EV_NOTE_ON) {
                note_on(engine, events[e]);
            }
        }

        advance_control_smoothing(engine);
        engine->filterCutoffSmoothed += engine->filterSmoothingCoefficient *
            (static_cast<double>(engine->params[kFilterCutoff]) - engine->filterCutoffSmoothed);
        engine->filterResonanceSmoothed += engine->filterSmoothingCoefficient *
            (static_cast<double>(engine->params[kFilterResonance]) -
             engine->filterResonanceSmoothed);
        engine->macroSmoothed[0] += engine->filterSmoothingCoefficient *
            (static_cast<double>(engine->params[kMacro1]) - engine->macroSmoothed[0]);
        engine->macroSmoothed[1] += engine->filterSmoothingCoefficient *
            (static_cast<double>(engine->params[kMacro2]) - engine->macroSmoothed[1]);
        engine->macroSmoothed[2] += engine->filterSmoothingCoefficient *
            (static_cast<double>(engine->params[kMacro3]) - engine->macroSmoothed[2]);
        engine->macroSmoothed[3] += engine->filterSmoothingCoefficient *
            (static_cast<double>(engine->params[kMacro4]) - engine->macroSmoothed[3]);
        const uint32_t lfoShape = static_cast<uint32_t>(engine->params[kLfoShape]);
        const float globalLfo = lfo_value(
            lfoShape, engine->globalLfoPhase, engine->globalLfoHold);
        const uint32_t lfo2Shape = static_cast<uint32_t>(engine->params[kLfo2Shape]);
        const float globalLfo2 = lfo_value(
            lfo2Shape, engine->globalLfo2Phase, engine->globalLfo2Hold);
        const bool matrixActive = modulation_matrix_active(engine);

        if (!matrixActive && legacy_configuration(engine) &&
            !active_voice_requires_extended_path(engine)) {
            float output = 0.0f;
            float sendOutput = 0.0f;
            for (uint32_t voiceIndex = 0; voiceIndex < engine->voiceLimit; ++voiceIndex) {
                synth::Voice* voice = &engine->voices[voiceIndex];
                if (voice->active == 0) continue;
                const float envelope = advance_envelope(engine, voice);
                if (voice->active == 0) continue;
                const uint32_t slot = static_cast<uint32_t>(engine->params[kOscWavetable]);
                const float oscillator = oscillator_sample(engine, slot,
                    voice_control(engine, voice, kVoiceOscAMorph, kOscMorph),
                    voice->frequencyA[0],
                    voice->phaseA[0]);
                output += oscillator *
                    voice->velocity * envelope *
                    voice_control(engine, voice, kVoiceOscALevel, kOscLevel);
                const float sendLevel = voice_param(engine, voice, kVoiceSendLevel);
                if (sendLevel != 0.0f) {
                    sendOutput += oscillator *
                        voice->velocity * envelope *
                        voice_control(engine, voice, kVoiceOscALevel, kOscLevel) * sendLevel;
                }
                advance_oscillators(voice, engine->sampleRate);
                voice->noiseEnvelope *= voice_noise_decay_coefficient(engine, voice);
                (void)advance_filter_envelope(engine, voice);
                (void)advance_mod_envelope(engine, voice);
                if (engine->params[kLfoRetrigger] != 0.0f) {
                    advance_lfo(&voice->lfoPhase, &voice->lfoCycleIndex,
                        &voice->lfoHold, engine, voiceIndex);
                }
                if (engine->params[kLfo2Retrigger] != 0.0f) {
                    advance_lfo2(&voice->lfo2Phase, &voice->lfo2CycleIndex,
                        &voice->lfo2Hold, engine, voiceIndex);
                }
            }
            output *= smoothed_control(engine, kMasterGain);
            float outputLeft = output;
            float outputRight = output;
            process_insert_fx(engine, &outputLeft, &outputRight);
            outL[frame] = outputLeft;
            outR[frame] = outputRight;
            if (sendL != 0) sendL[frame] = sendOutput;
            if (sendR != 0) sendR[frame] = sendOutput;
            advance_lfo(&engine->globalLfoPhase, &engine->globalLfoCycleIndex,
                &engine->globalLfoHold, engine, kGlobalLfoIndex);
            advance_lfo2(&engine->globalLfo2Phase, &engine->globalLfo2CycleIndex,
                &engine->globalLfo2Hold, engine, kGlobalLfoIndex);
            continue;
        }

        float left = 0.0f;
        float right = 0.0f;
        float sendLeft = 0.0f;
        float sendRight = 0.0f;
        double modulatedLfoRate = static_cast<double>(engine->params[kLfoRate]);
        if (matrixActive) {
            const bool retrigger = engine->params[kLfoRetrigger] != 0.0f;
            const bool retrigger2 = engine->params[kLfo2Retrigger] != 0.0f;
            for (uint32_t voiceIndex = 0; voiceIndex < engine->voiceLimit; ++voiceIndex) {
                synth::Voice* voice = &engine->voices[voiceIndex];
                if (voice->active == 0) continue;
                (void)advance_envelope(engine, voice);
                if (voice->active == 0) continue;
                (void)advance_filter_envelope(engine, voice);
                (void)advance_mod_envelope(engine, voice);
            }
            modulatedLfoRate = modulation_lfo_rate(
                engine, lfoShape, lfo2Shape, globalLfo, globalLfo2);
            for (uint32_t voiceIndex = 0; voiceIndex < engine->voiceLimit; ++voiceIndex) {
                synth::Voice* voice = &engine->voices[voiceIndex];
                if (voice->active == 0) continue;
                const float voiceLfo = retrigger
                    ? lfo_value(lfoShape, voice->lfoPhase, voice->lfoHold) : globalLfo;
                const float voiceLfo2 = retrigger2
                    ? lfo_value(lfo2Shape, voice->lfo2Phase, voice->lfo2Hold) : globalLfo2;
                ModulationValues modulation{};
                evaluate_modulation(engine, voice, voiceLfo, voiceLfo2, &modulation);
                render_m1c_voice(engine, voice, voiceLfo, modulation,
                    &left, &right, &sendLeft, &sendRight);
                if (retrigger) {
                    advance_lfo_at_rate(&voice->lfoPhase, &voice->lfoCycleIndex,
                        &voice->lfoHold, engine, voiceIndex, modulatedLfoRate);
                }
                if (retrigger2) {
                    advance_lfo2(&voice->lfo2Phase, &voice->lfo2CycleIndex,
                        &voice->lfo2Hold, engine, voiceIndex);
                }
            }
        } else if (m1b_bypassed(engine)) {
            for (uint32_t voiceIndex = 0; voiceIndex < engine->voiceLimit; ++voiceIndex) {
                synth::Voice* voice = &engine->voices[voiceIndex];
                if (voice->active == 0) continue;
                (void)advance_envelope(engine, voice);
                if (voice->active == 0) continue;
                render_extended_voice(engine, voice, &left, &right, &sendLeft, &sendRight);
                advance_oscillators(voice, engine->sampleRate);
                (void)advance_filter_envelope(engine, voice);
                (void)advance_mod_envelope(engine, voice);
                if (engine->params[kLfoRetrigger] != 0.0f) {
                    advance_lfo(&voice->lfoPhase, &voice->lfoCycleIndex,
                        &voice->lfoHold, engine, voiceIndex);
                }
                if (engine->params[kLfo2Retrigger] != 0.0f) {
                    advance_lfo2(&voice->lfo2Phase, &voice->lfo2CycleIndex,
                        &voice->lfo2Hold, engine, voiceIndex);
                }
            }
        } else {
            const bool retrigger = engine->params[kLfoRetrigger] != 0.0f;
            const bool retrigger2 = engine->params[kLfo2Retrigger] != 0.0f;
            for (uint32_t voiceIndex = 0; voiceIndex < engine->voiceLimit; ++voiceIndex) {
                synth::Voice* voice = &engine->voices[voiceIndex];
                if (voice->active == 0) continue;
                (void)advance_envelope(engine, voice);
                if (voice->active == 0) continue;
                (void)advance_filter_envelope(engine, voice);
                (void)advance_mod_envelope(engine, voice);
                const float voiceLfo = retrigger
                    ? lfo_value(lfoShape, voice->lfoPhase, voice->lfoHold) : globalLfo;
                render_m1b_voice(engine, voice, voiceLfo,
                    &left, &right, &sendLeft, &sendRight);
                if (retrigger) {
                    advance_lfo(&voice->lfoPhase, &voice->lfoCycleIndex,
                        &voice->lfoHold, engine, voiceIndex);
                }
                if (retrigger2) {
                    advance_lfo2(&voice->lfo2Phase, &voice->lfo2CycleIndex,
                        &voice->lfo2Hold, engine, voiceIndex);
                }
            }
        }
        left *= smoothed_control(engine, kMasterGain);
        right *= smoothed_control(engine, kMasterGain);
        process_insert_fx(engine, &left, &right);
        outL[frame] = left;
        outR[frame] = right;
        if (sendL != 0) sendL[frame] = sendLeft;
        if (sendR != 0) sendR[frame] = sendRight;
        if (matrixActive) {
            advance_lfo_at_rate(&engine->globalLfoPhase, &engine->globalLfoCycleIndex,
                &engine->globalLfoHold, engine, kGlobalLfoIndex, modulatedLfoRate);
        } else {
            advance_lfo(&engine->globalLfoPhase, &engine->globalLfoCycleIndex,
                &engine->globalLfoHold, engine, kGlobalLfoIndex);
        }
        advance_lfo2(&engine->globalLfo2Phase, &engine->globalLfo2CycleIndex,
            &engine->globalLfo2Hold, engine, kGlobalLfoIndex);
    }
    return ignored;
}

extern "C" uint32_t synth_get_tail_frames(const SynthEngine* engine) {
    if (engine == 0) return 0;
    double frames = static_cast<double>(engine->params[kAmpRelease]) * engine->sampleRate;
    if (engine->params[kChorusOn] != 0.0f) frames += 0.022 * engine->sampleRate;
    return frames <= 0.0 ? 0u : static_cast<uint32_t>(frames + 0.999999);
}

extern "C" uint32_t synth_engine_version(void) { return 15; }
