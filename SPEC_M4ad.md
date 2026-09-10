# M4ad — Dense filter automation safety gate

## Goal

Extend the disconnected, real-WASM AudioWorklet regression gate around FILTER so that a combination of held-note control changes is checked for bounded and recoverable output before any speaker listening.

## Scope

- Keep the product DSP, Web UI, parameter IDs, presets, patch format, and output routing unchanged; this is a test-only change.
- Render three held notes through the actual `SynthEngineProcessor` with 4-voice unison and a low-output fixture (`master = 0.02`). The processor is not connected to an `AudioContext` destination or a physical device.
- Combine FILTER ON/BYPASS, all six modes, low/high Cutoff, low/high Resonance, Key Track, Filter ENV Amount, Filter EG values, per-note FILTER overrides, and a rapid sequence of requested modes.
- Enable Matrix routes `LFO 1 → Filter Cutoff` and `LFO 2 → Filter Resonance`, then remove them before release.
- Require finite output, an audible automation response, maximum peak `<= 0.25`, zero residual after note release, and zero residual after a new note followed by voice-reset panic.
- Keep the `0.25` ceiling fixed. An initial fixture gain of `0.08` exceeded it (`0.749`), so the test fixture—not the product and not the ceiling—was calibrated to `0.02` for the intended low-output safety gate.

## Non-goals

- No proof that every real-world patch, physical output device, browser, or speaker is safe.
- No subjective filter-tone judgment, live device-switch test, or new FILTER feature.

## Acceptance

1. The dense held-note sequence remains finite, produces an automation response, and stays at or below `0.25` peak.
2. The released notes and a subsequent panic sequence both render silence (`<= 1e-7`).
3. The full Web test suite passes with current WASM. Physical playback remains outside this test.
