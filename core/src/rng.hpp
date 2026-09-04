#ifndef SYNTH_RNG_HPP
#define SYNTH_RNG_HPP

#include <stdint.h>

namespace synth {

inline uint32_t hash32(uint64_t seed, uint32_t eventId, uint32_t voice, uint32_t layer) {
    uint32_t x = static_cast<uint32_t>(seed) ^ static_cast<uint32_t>(seed >> 32);
    x ^= eventId * 0x9e3779b9u;
    x ^= voice * 0x85ebca6bu;
    x ^= layer * 0xc2b2ae35u;
    x ^= x >> 16;
    x *= 0x7feb352du;
    x ^= x >> 15;
    x *= 0x846ca68bu;
    x ^= x >> 16;
    return x;
}

inline float hash_to_unit(uint32_t value) {
    return static_cast<float>(value >> 8) * (1.0f / 16777216.0f);
}

}  // namespace synth

#endif
