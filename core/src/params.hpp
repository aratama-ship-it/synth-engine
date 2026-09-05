#ifndef SYNTH_ENGINE_PARAMS_HPP
#define SYNTH_ENGINE_PARAMS_HPP

#include "../include/synth_engine.h"

namespace synth {

inline constexpr SynthParamInfo kParameterInfo[] = {
    {0, "oscAWavetable", "Osc A Wavetable", 0.0f, 3.0f, 0.0f, SYNTH_PARAM_FLAG_NONE},
    {1, "oscAMorph", "Osc A Morph", 0.0f, 1.0f, 0.0f, SYNTH_PARAM_FLAG_NONE},
    {2, "oscALevel", "Osc A Level", 0.0f, 4.0f, 0.8f, SYNTH_PARAM_FLAG_GAIN},
    {3, "ampAttack", "Amp Attack", 0.0f, 60.0f, 0.005f, SYNTH_PARAM_FLAG_SECONDS},
    {4, "ampDecay", "Amp Decay", 0.0f, 60.0f, 0.1f, SYNTH_PARAM_FLAG_SECONDS},
    {5, "ampSustain", "Amp Sustain", 0.0f, 1.0f, 0.8f, SYNTH_PARAM_FLAG_NONE},
    {6, "ampRelease", "Amp Release", 0.0f, 60.0f, 0.2f, SYNTH_PARAM_FLAG_SECONDS},
    {7, "masterGain", "Master Gain", 0.0f, 4.0f, 0.2f, SYNTH_PARAM_FLAG_GAIN},
    {8, "voiceCountMax", "Voice Count Max", 1.0f, 16.0f, 16.0f, SYNTH_PARAM_FLAG_INTEGER},
    {9, "oscAUnison", "Osc A Unison", 1.0f, 4.0f, 1.0f, SYNTH_PARAM_FLAG_INTEGER},
    {10, "oscADetune", "Osc A Detune", 0.0f, 50.0f, 10.0f, SYNTH_PARAM_FLAG_CENTS},
    {11, "oscAWidth", "Osc A Width", 0.0f, 1.0f, 0.5f, SYNTH_PARAM_FLAG_NONE},
    {12, "oscAOctave", "Osc A Octave", -2.0f, 2.0f, 0.0f,
     SYNTH_PARAM_FLAG_INTEGER | SYNTH_PARAM_FLAG_OCTAVES | SYNTH_PARAM_FLAG_BIPOLAR},
    {13, "oscASemitone", "Osc A Semitone", -12.0f, 12.0f, 0.0f,
     SYNTH_PARAM_FLAG_INTEGER | SYNTH_PARAM_FLAG_SEMITONES | SYNTH_PARAM_FLAG_BIPOLAR},
    {14, "oscAFine", "Osc A Fine", -100.0f, 100.0f, 0.0f,
     SYNTH_PARAM_FLAG_CENTS | SYNTH_PARAM_FLAG_BIPOLAR},
    {15, "oscAPhaseMode", "Osc A Phase Mode", 0.0f, 1.0f, 0.0f, SYNTH_PARAM_FLAG_INTEGER},
    {16, "oscAPhase", "Osc A Phase", 0.0f, 1.0f, 0.0f, SYNTH_PARAM_FLAG_NONE},
    {17, "oscBWavetable", "Osc B Wavetable", 0.0f, 3.0f, 0.0f, SYNTH_PARAM_FLAG_INTEGER},
    {18, "oscBMorph", "Osc B Morph", 0.0f, 1.0f, 0.0f, SYNTH_PARAM_FLAG_NONE},
    {19, "oscBLevel", "Osc B Level", 0.0f, 4.0f, 0.0f, SYNTH_PARAM_FLAG_GAIN},
    {20, "oscBUnison", "Osc B Unison", 1.0f, 4.0f, 1.0f, SYNTH_PARAM_FLAG_INTEGER},
    {21, "oscBDetune", "Osc B Detune", 0.0f, 50.0f, 10.0f, SYNTH_PARAM_FLAG_CENTS},
    {22, "oscBWidth", "Osc B Width", 0.0f, 1.0f, 0.5f, SYNTH_PARAM_FLAG_NONE},
    {23, "oscBOctave", "Osc B Octave", -2.0f, 2.0f, 0.0f,
     SYNTH_PARAM_FLAG_INTEGER | SYNTH_PARAM_FLAG_OCTAVES | SYNTH_PARAM_FLAG_BIPOLAR},
    {24, "oscBSemitone", "Osc B Semitone", -12.0f, 12.0f, 0.0f,
     SYNTH_PARAM_FLAG_INTEGER | SYNTH_PARAM_FLAG_SEMITONES | SYNTH_PARAM_FLAG_BIPOLAR},
    {25, "oscBFine", "Osc B Fine", -100.0f, 100.0f, 0.0f,
     SYNTH_PARAM_FLAG_CENTS | SYNTH_PARAM_FLAG_BIPOLAR},
    {26, "oscBPhaseMode", "Osc B Phase Mode", 0.0f, 1.0f, 0.0f, SYNTH_PARAM_FLAG_INTEGER},
    {27, "oscBPhase", "Osc B Phase", 0.0f, 1.0f, 0.0f, SYNTH_PARAM_FLAG_NONE},
    {28, "fmBToA", "FM B to A", 0.0f, 1.0f, 0.0f, SYNTH_PARAM_FLAG_NONE},
    {29, "subLevel", "Sub Level", 0.0f, 4.0f, 0.0f, SYNTH_PARAM_FLAG_GAIN},
    {30, "subShape", "Sub Shape", 0.0f, 2.0f, 0.0f, SYNTH_PARAM_FLAG_INTEGER},
    {31, "subOctave", "Sub Octave", -2.0f, 0.0f, -1.0f,
     SYNTH_PARAM_FLAG_INTEGER | SYNTH_PARAM_FLAG_OCTAVES | SYNTH_PARAM_FLAG_BIPOLAR},
    {32, "noiseLevel", "Noise Level", 0.0f, 4.0f, 0.0f, SYNTH_PARAM_FLAG_GAIN},
    {33, "noiseColor", "Noise Color", 0.0f, 1.0f, 0.0f, SYNTH_PARAM_FLAG_INTEGER},
    {34, "noiseDecay", "Noise Decay", 0.0f, 60.0f, 0.05f, SYNTH_PARAM_FLAG_SECONDS},
    {35, "filterEnabled", "Filter Enabled", 0.0f, 1.0f, 0.0f, SYNTH_PARAM_FLAG_INTEGER},
    {36, "filterMode", "Filter Mode", 0.0f, 5.0f, 0.0f, SYNTH_PARAM_FLAG_INTEGER},
    {37, "filterCutoff", "Filter Cutoff", 20.0f, 20000.0f, 20000.0f,
     SYNTH_PARAM_FLAG_HERTZ},
    {38, "filterResonance", "Filter Resonance", 0.0f, 1.0f, 0.0f, SYNTH_PARAM_FLAG_NONE},
    {39, "filterKeyTrack", "Filter Key Track", 0.0f, 1.0f, 0.0f, SYNTH_PARAM_FLAG_NONE},
    {40, "filterEnvAmount", "Filter Env Amount", -8.0f, 8.0f, 0.0f,
     SYNTH_PARAM_FLAG_OCTAVES | SYNTH_PARAM_FLAG_BIPOLAR},
    {41, "filterEgAttack", "Filter EG Attack", 0.0f, 20.0f, 0.005f,
     SYNTH_PARAM_FLAG_SECONDS},
    {42, "filterEgDecay", "Filter EG Decay", 0.0f, 20.0f, 0.2f,
     SYNTH_PARAM_FLAG_SECONDS},
    {43, "filterEgSustain", "Filter EG Sustain", 0.0f, 1.0f, 1.0f,
     SYNTH_PARAM_FLAG_NONE},
    {44, "filterEgRelease", "Filter EG Release", 0.0f, 20.0f, 0.2f,
     SYNTH_PARAM_FLAG_SECONDS},
    {45, "filterVelToEnv", "Filter Velocity to Env", 0.0f, 1.0f, 0.0f,
     SYNTH_PARAM_FLAG_NONE},
    {46, "lfoRate", "LFO Rate", 0.01f, 40.0f, 1.0f, SYNTH_PARAM_FLAG_HERTZ},
    {47, "lfoShape", "LFO Shape", 0.0f, 5.0f, 0.0f, SYNTH_PARAM_FLAG_INTEGER},
    {48, "lfoRetrigger", "LFO Retrigger", 0.0f, 1.0f, 0.0f, SYNTH_PARAM_FLAG_INTEGER},
    {49, "lfoToCutoff", "LFO to Cutoff", -8.0f, 8.0f, 0.0f,
     SYNTH_PARAM_FLAG_OCTAVES | SYNTH_PARAM_FLAG_BIPOLAR},
    {50, "lfoToPitch", "LFO to Pitch", -1200.0f, 1200.0f, 0.0f,
     SYNTH_PARAM_FLAG_CENTS | SYNTH_PARAM_FLAG_BIPOLAR},
    {51, "lfoToAmp", "LFO to Amp", 0.0f, 1.0f, 0.0f, SYNTH_PARAM_FLAG_NONE},
    {52, "lfoPhase", "LFO Phase", 0.0f, 1.0f, 0.0f, SYNTH_PARAM_FLAG_NONE},
    {53, "ampEgCurve", "Amp EG Curve", 0.0f, 1.0f, 0.0f, SYNTH_PARAM_FLAG_NONE},
    {54, "filterEgCurve", "Filter EG Curve", 0.0f, 1.0f, 0.0f, SYNTH_PARAM_FLAG_NONE},
};

inline constexpr uint32_t kParamCount =
    static_cast<uint32_t>(sizeof(kParameterInfo) / sizeof(kParameterInfo[0]));

constexpr bool parameter_ids_are_contiguous() {
    for (uint32_t id = 0; id < kParamCount; ++id) {
        if (kParameterInfo[id].id != id) return false;
    }
    return true;
}

static_assert(kParamCount == 55);
static_assert(parameter_ids_are_contiguous());

}  // namespace synth

#endif
