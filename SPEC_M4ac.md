# M4ac — Held-note filter-mode transition

## Goal

Keep the established static filter response while removing the direct sample step that occurred when a held note changed FILTER MODE.

## Scope

- Preserve the six existing mode IDs and map them consistently in the web shell: `0 LP12`, `1 BP12`, `2 HP12`, `3 NOTCH`, `4 LP24`, `5 HP24`.
- For an active, audible filter, run the previous and requested filter paths with independent per-voice SVF states, then crossfade their outputs with the existing 5 ms one-pole coefficient.
- Cover both the normal voice path and the modulation-matrix voice path.
- If a user changes the mode again before the first transition settles, finish the in-flight crossfade and queue the latest requested mode for a second smooth transition. Do not reset an in-flight state or insert a direct output step.
- Start a new note, or re-enable FILTER from a fully bypassed held note, at its current requested mode. No unnecessary mode fade is added where the FILTER dry/wet fade already protects the output.
- Correct the existing web label order and let MATCH Cutoff calibration accept only the actual LP12 (ID 0) and LP24 (ID 4) modes.
- Preserve parameter IDs and count, C ABI, preset data, patch format, filter coefficients, static filter response, and static native/WASM output. Increment `synth_engine_version()` from 19 to 20 because held-mode automation changes core PCM.

## Non-goals

- No new filter mode, BP24 mode, oversampling, cutoff/resonance retune, UI layout change, or physical-output playback.
- No subjective claim about the preferred filter character.

## Acceptance

1. A held note changing across the 12 dB and 24 dB modes begins with a `0.003..0.006` crossfade contribution, remains finite, and settles to the requested state. A new note starts directly at the requested mode.
2. A rapid second mode request is retained as the pending target and runs only after the current transition settles; the modulation-matrix path uses the same transition mechanism.
3. The disconnected real-WASM AudioWorklet safety gate changes mode at frames 2176, 2432, and 2688 during a held high-FM note, alongside FILTER ON at 2048 and BYPASS at 3072. It requires finite output, peak `<= 0.25`, and zero release/panic residual.
4. Core, Web, WASM, freestanding, and a static-filter native/WASM parity check pass. Physical speakers, listening judgment, live device routing, and long-running real-time scheduling remain outside this verification.
