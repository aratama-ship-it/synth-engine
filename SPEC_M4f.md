# SPEC M4f — Alias-safe wavetable mip crossfade

## Goal

Improve the oscillator itself before adding automatic sound search. Pitch movement across a band-limited wavetable mip boundary must not switch harmonic content in one sample.

## Scope

- Keep the existing 4 slots, 4 frames, 10 mip levels, parameters, C ABI, and UI.
- Keep `select_mip()` as the conservative alias-safe primary-level selector.
- Add one band-limited reader that crossfades from the next more restrictive mip into the newly safe primary mip during the first 100 cents below each boundary.
- Use a smoothstep weight so both ends of the transition have zero slope.
- Never read a richer mip before all of its stored harmonics fit below Nyquist.
- Outside the transition, return the existing primary mip sample without a second table read so established tones and the common real-time path remain bit-identical.
- Apply the reader consistently to Osc A, Osc B, the B-to-A phase-modulation source, and Sub in every render path.
- Increment `engineVersion` from 9 to 10 because PCM can change near mip boundaries.

## Non-goals

- No automatic reference search.
- No new wavetable frames, oscillator parameters, oversampling, filter character, effects, or UI.
- No change to phase, unison, morph, modulation, or voice-stealing rules.
- No claim of subjective improvement without a listening check.

## Acceptance

1. A direct saw-table measurement immediately below and above a mip boundary shows at least 20 dB less sample discontinuity than the former hard switch.
2. A frequency outside the 100-cent transition is sample-identical to the existing primary-mip reader.
3. Existing alias and FM-alias tests still pass.
4. Block invariance, determinism, native tests, freestanding compilation, and native/WASM comparison pass.
5. The existing 16-voice, unison-4, LP24, six-slot performance test remains below 50% of the 48 kHz / 128-frame deadline.
