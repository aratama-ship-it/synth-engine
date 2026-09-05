#ifndef SYNTH_ENGINE_H
#define SYNTH_ENGINE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct SynthEngine SynthEngine;

enum SynthEventKind {
    SYNTH_EV_NOTE_ON = 1,
    SYNTH_EV_NOTE_OFF = 2,
    SYNTH_EV_PARAM = 3,
    SYNTH_EV_MACRO = 4
};

typedef struct {
    uint32_t offset;
    uint32_t kind;
    uint32_t id;
    float a;
    float b;
} SynthEvent;

enum SynthResetKind {
    SYNTH_RESET_VOICES = 0,
    SYNTH_RESET_ALL = 1
};

enum SynthParamFlags {
    SYNTH_PARAM_FLAG_NONE = 0,
    SYNTH_PARAM_FLAG_INTEGER = 1 << 0,
    SYNTH_PARAM_FLAG_SECONDS = 1 << 1,
    SYNTH_PARAM_FLAG_HERTZ = 1 << 2,
    SYNTH_PARAM_FLAG_CENTS = 1 << 3,
    SYNTH_PARAM_FLAG_SEMITONES = 1 << 4,
    SYNTH_PARAM_FLAG_OCTAVES = 1 << 5,
    SYNTH_PARAM_FLAG_GAIN = 1 << 6,
    SYNTH_PARAM_FLAG_BIPOLAR = 1 << 7
};

typedef struct {
    uint32_t id;
    const char* identifier;
    const char* displayName;
    float minimum;
    float maximum;
    float defaultValue;
    uint32_t flags;
} SynthParamInfo;

size_t synth_state_size(void);
SynthEngine* synth_create(void* memory, size_t bytes, double sampleRate, uint32_t maxBlock);
uint32_t synth_param_count(void);
int synth_param_info(uint32_t id, SynthParamInfo* out);
int synth_set_param(SynthEngine* engine, uint32_t paramId, float value);
int synth_load_wavetable(SynthEngine* engine, uint32_t slot, const float* frames, uint32_t frameCount);
void synth_reset(SynthEngine* engine, uint32_t kind, uint64_t seed);
int synth_process(SynthEngine* engine, const SynthEvent* events, uint32_t nEvents,
                  float* outL, float* outR, uint32_t nFrames);
uint32_t synth_get_tail_frames(const SynthEngine* engine);
uint32_t synth_engine_version(void);

#ifdef __cplusplus
}
#endif

#endif
