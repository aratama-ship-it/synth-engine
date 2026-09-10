# M4aa — Filter bypass crossfade

## Goal

Keep the established filter tone, controls, and bypass defaults while removing the one-sample step caused by changing FILTER ON/BYPASS during an active note.

## Scope

- Give each active voice a private filter wet mix.
- A note that begins with FILTER ON uses the full wet filter immediately; a note that begins with FILTER BYPASS remains fully dry.
- While a voice is active, FILTER ON/BYPASS moves the wet mix with the existing 5 ms one-pole control coefficient.
- Keep processing the filter until an ON-to-BYPASS transition reaches zero, then clear the two-stage stereo SVF state before returning to the fast bypass route.
- Keep all parameter IDs, parameter count, C ABI, UI, patch format, static filter response, and existing presets unchanged.
- Increment `synth_engine_version()` from 17 to 18 because an active FILTER toggle changes core PCM.

## Non-goals

- No new filter mode, oversampling, resonance or cutoff retuning, envelope-shape change, UI redesign, or new user-facing parameter.
- No automatic playback or physical-output test.
- No claim that the crossfade alone settles the subjective character of the filter.

## Acceptance

1. At 48 kHz, the first active-sample filter mix after either toggle changes by the existing 5 ms ratio (`0.003..0.006`), and it is within `0.0001` of its target after 50 ms.
2. The SVF state is cleared only after the BYPASS mix reaches zero; a later re-enable cannot reuse stale filter history.
3. FILTER ON before note-on remains full wet from its first rendered sample, and the existing static-filter accuracy, slope, resonance, modulation, golden, determinism, and performance checks remain valid.
4. The disconnected real-WASM AudioWorklet safety gate toggles FILTER ON at frame 2048 and BYPASS at frame 3072 during a held high-FM note, with finite output, peak `<= 0.25`, release silence, and panic silence.
5. Core, Web/WASM, and freestanding checks pass. Physical speakers, subjective listening, and live device routing remain outside this verification.
