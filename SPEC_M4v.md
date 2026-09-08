# SPEC M4v — High-register sample-rate measurement coverage

## Goal

Make the high-register OSC and opt-in HQ FM guard check reproducible at 44.1, 48, and 96 kHz, without changing SynthEngine sound generation or the Web UI.

## Scope

- Add one core regression (`test_high_range_sample_rates`) at C8 / MIDI 108.
- For 4 built-in wavetable slots at `POS = 50%`, measure the worst off-grid spectral energy ratio with a Blackman-Harris 4096-point FFT. Require `<= -60 dB` at every selected sample rate.
- For full B→A FM, measure Legacy and HQ Guard off-grid spectral energy at the same C8 condition. At 44.1 and 48 kHz, require HQ to reduce the metric by at least 15 dB; at 96 kHz, require HQ not to worsen it by more than 0.25 dB because the guard is expected to be nearly inactive there.
- At C5 / MIDI 72, require Legacy and HQ PCM to remain bit-identical at all three rates.
- Render the existing C8 HQ fixture through the native CLI and the actual WASM binary at all three rates; require bit-identical output and no non-finite WASM samples.
- Keep the physical-output-disconnected Worklet safety gate in the verification ledger.

## Non-goals

- No change to engine code, engine version, wavetable content, HQ-Guard curve, preset values, UI, or audio routing.
- No claim that a better off-grid metric is a better production sound.
- No autoplay, browser audition, speaker test, or real-device claim while the owner is away from speakers.

## Result (2026-09-08)

The regression passes at all three rates. The detailed conditions, figures, native/WASM comparison, safety result, and listening boundary are in `design/verify/m4v-high-range-sample-rate-20260908/index.html`.
