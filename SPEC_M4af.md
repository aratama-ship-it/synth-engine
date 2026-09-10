# M4af — Filter event-bundle boundary safety gate

## Goal

Verify that the real-WASM Worklet remains bounded and releasable when FILTER control bundles land immediately before, on, and immediately after a 128-sample block boundary.

## Scope

- Keep product DSP, UI, parameters, presets, output routing, and the low-output fixture unchanged.
- At 48 kHz, send ordered same-frame FILTER bundles at frames `127/128/129`, `255/256/257`, and `511/512/513`.
- The bundles exercise ON/BYPASS, mode, cutoff, resonance, an LFO 1 → Filter Cutoff Matrix route, plus per-note mode/cutoff/resonance/env overrides followed by note-on in the same frame.
- Use three held notes with 4-voice unison, then require silence after simultaneous note-off and after a subsequent panic reset.
- The `SynthEngineProcessor` is not connected to an `AudioContext` destination or physical audio device.

## Non-goals

- No claim about live browser scheduling, arbitrary event orders, speaker safety, subjective tone, or device switching.
- No new FILTER behavior or test of a production-audio output path.

## Acceptance

1. The boundary sequence remains finite, audible in the disconnected buffer, and stays at or below `0.25` peak.
2. The output returns to silence (`<= 1e-7`) after release and panic.
3. Current WASM and the complete Web test suite pass.
