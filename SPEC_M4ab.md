# M4ab — Held-envelope control smoothing

## Goal

Keep the established static ADSR and filter-envelope tones while removing direct sample steps from the three held-note controls that feed amplitude or filter cutoff: AMP Sustain, FILTER Sustain, and FILTER ENV AMOUNT.

## Scope

- Store a private target-following value in each active voice for AMP Sustain, FILTER Sustain, and FILTER ENV AMOUNT.
- Move an already-active voice toward a changed global value with the established 5 ms one-pole coefficient.
- Initialize a newly started voice from the current parameter target, even when another voice is still smoothing an older value.
- Leave voice-parameter overrides immutable for their note, as before.
- Preserve parameter IDs and count, C ABI, UI, patch format, presets, static envelope curves, and static filter response.
- Increment `synth_engine_version()` from 18 to 19 because held-note parameter automation changes core PCM.

## Non-goals

- No new envelope parameter or UI control.
- No retuning of the existing Attack, Decay, Release, or Curve behavior. Those values change an envelope rate or shape rather than directly replacing the current amplitude/cutoff value, so they do not introduce the one-sample step addressed here.
- No automatic playback, physical-output test, or claim of subjective sound quality.

## Acceptance

1. At 48 kHz, changing AMP Sustain `0.2 → 0.8`, FILTER Sustain `0.2 → 0.8`, and FILTER ENV AMOUNT `0 → 4` during a held note advances every voice-local value by the existing first-sample ratio (`0.003..0.006`) and reaches a normalized residual of at most `0.0001` after 50 ms.
2. A note started after those changes begins at `0.8 / 4 / 0.8` exactly, while the earlier held note still follows the 5 ms transition.
3. Existing golden, deterministic, envelope, filter, static preset, native/WASM parity, Web, and freestanding checks remain valid.
4. The disconnected real-WASM AudioWorklet safety gate changes AMP Sustain at frame 1536, FILTER ENV AMOUNT at frame 2304, FILTER Sustain at frame 2816, and FILTER ON/BYPASS at frames 2048/3072 during a held high-FM note; output remains finite, peak `<= 0.25`, and release/panic silence remain zero.
5. Physical speakers, subjective listening, live device routing, and long-running real-time scheduling remain outside this verification.
