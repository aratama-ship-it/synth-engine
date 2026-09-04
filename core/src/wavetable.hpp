#ifndef SYNTH_WAVETABLE_HPP
#define SYNTH_WAVETABLE_HPP

#include <stdint.h>

namespace synth {

constexpr uint32_t kTableSize = 2048;
constexpr uint32_t kMipLevels = 10;
constexpr uint32_t kWavetableSlots = 4;
constexpr uint32_t kMaxWavetableFrames = 4;

struct WavetableBank {
    uint32_t frameCount[kWavetableSlots];
    float samples[kWavetableSlots][kMaxWavetableFrames][kMipLevels][kTableSize];
};

void initialize_builtin_wavetables(WavetableBank* bank);
int load_wavetable(WavetableBank* bank, uint32_t slot, const float* frames, uint32_t frameCount);
float read_wavetable(const WavetableBank* bank, uint32_t slot, float morph,
                     uint32_t mip, double phase);
uint32_t select_mip(double frequency, double sampleRate);

}  // namespace synth

#endif
