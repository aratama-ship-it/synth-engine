# M4ae — Dense filter automation sample-rate safety gate

## Goal

Run the established dense FILTER automation gate at the three supported Web Audio sample rates, without changing the product signal path or introducing physical playback.

## Scope

- Retain the M4ad low-output fixture, event order, three held notes, 4-voice unison, FILTER controls, per-note overrides, and Matrix routes.
- Create a fresh real-WASM `SynthEngineProcessor` at `44_100`, `48_000`, and `96_000` Hz. The processor remains disconnected from an `AudioContext` destination and any physical device.
- At every rate, require finite output, an active automation response, `maximumPeak <= 0.25`, release silence, and panic silence.
- Report each sample-rate result independently; a result at one rate cannot mask another rate's failure.

## Non-goals

- No DSP, preset, UI, parameter, patch-format, C ABI, or output-routing change.
- No live device-switch, physical-speaker, arbitrary-patch, or subjective sound-quality claim.

## Acceptance

1. The dense held-note sequence passes at 44.1, 48, and 96 kHz with no NaN or Infinity.
2. Each rate stays at or below the unchanged `0.25` low-output ceiling and returns to silence (`<= 1e-7`) after both release and panic.
3. The current WASM build and full Web regression suite pass.
