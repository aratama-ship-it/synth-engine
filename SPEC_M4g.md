# SPEC M4g — Realtime control smoothing and unison placement

## Goal

Raise the oscillator core quality before automatic sound matching: manual Morph, FM, and Level changes must avoid one-sample discontinuities, while unison must keep a stable level, a clear pitch center, and a balanced stereo image.

## Scope

- Apply a 5 ms one-pole smoother to the global targets for Osc A/B Morph, Osc A/B Level, B-to-A FM, Sub Level, Noise Level, and Master Gain.
- Snap those smoothers when no voice is active, so preset loading and the first note start at the stored value without a ramp-in.
- Keep per-note `VOICE_PARAM` overrides exact at note start.
- Add Matrix/LFO modulation after the smoothed base value, so intentional audio-rate or rhythmic modulation is not blurred by the manual-control smoother.
- Keep unison at 1–4 voices in this milestone.
- Separate detune placement from stereo pan placement.
- Keep pan positions evenly distributed from left to right. For four voices, use detune positions `-1, -0.2, +0.2, +1` so the outer pair provides spread and the inner pair preserves the pitch center.
- Keep equal-power pan law and `1/sqrt(voice count)` normalization.
- Increment `engineVersion` from 10 to 11 because live automation and four-voice PCM change.

## Non-goals

- No unison voice-count expansion, phase-blend control, oscillator oversampling, effects, automatic reference search, or UI change.
- No smoothing of pitch/detune, envelope parameters, per-note overrides, or Matrix/LFO contributions.
- No claim that the new voice placement is subjectively final before a listening check.

## Acceptance

1. All eight smoothed controls hold their previous value when changed during an active note, move by the same bounded first-sample ratio, and settle within `0.0001` of target after 50 ms at 48 kHz.
2. Setting the same controls while idle snaps their state exactly to the target.
3. Unison detune and pan layouts are symmetric and zero-mean for 1–4 voices; four-voice detune uses `-1, -0.2, +0.2, +1` while pan remains evenly spaced.
4. Settled RMS for unison 2–4 remains within 2 dB of one voice. Four-voice full width remains stereo, stays within 1 dB left/right balance, and width zero is bit-identical mono.
5. Existing alias/FM, modulation, block-invariance, determinism, voice-parameter, and finite-output tests pass.
6. Freestanding compilation and native/WASM preset comparison pass.
7. The existing 16-voice, unison-4, LP24, six-slot performance test remains below 50% of the 48 kHz / 128-frame deadline.
