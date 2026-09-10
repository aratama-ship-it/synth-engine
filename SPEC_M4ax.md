# SPEC M4ax — Parametric EQ controls and response curve

## Goal

Turn the M4aw musical three-band EQ into an editable shared-core EQ. Add frequency controls for the low and high shelves, and frequency plus Q for the mid bell. Show the combined response in the Web FX rack from the same coefficient design used by the DSP.

## Parameters and compatibility

- Preserve all existing IDs and defaults.
- Append four parameters:
  - 121 `eqLowFrequency`: 40..600 Hz, default 160 Hz.
  - 122 `eqMidFrequency`: 200..8000 Hz, default 1200 Hz.
  - 123 `eqMidQ`: 0.25..8, default 0.75.
  - 124 `eqHighFrequency`: 1500..18000 Hz, default 6800 Hz.
- Parameter count becomes 125. Patch schema remains 1 because older patches are completed from the human-readable FX defaults and core IDs are append-only.
- Existing M4aw patches and renders keep the same sound because every appended parameter defaults to the former fixed value.
- Enabled-EQ PCM can now change, so engine version becomes 30.

## DSP

- Keep low shelf slope 1 and high shelf slope 1. Q is editable only for the mid bell.
- Smooth all four new continuous controls with the existing 5 ms coefficient while a voice is active. Snap them before first note and after reset.
- Clamp every designed frequency below 45% of the current sample rate.
- Keep the three serial biquads, stereo state, no-allocation/no-exception core, event ABI, and native/WASM processing path.

## Web UI

- Keep the existing EQ card and its ON/BYPASS and reorder controls.
- Add a non-interactive `FILTER RESPONSE` SVG above the controls. It uses a 20 Hz..20 kHz logarithmic x-axis and a fixed -24..+24 dB y-axis.
- Compute the curve from the same RBJ low-shelf, peaking, and high-shelf formulas and serial response multiplication used by the core.
- Show Low Frequency/Gain, Mid Frequency/Q/Gain, and High Frequency/Gain as seven 44 px range controls. Frequency controls use logarithmic slider positioning while storing and sending actual Hz values.
- Do not add draggable graph points, a realtime analyzer, more EQ types, or external dependencies in this milestone.

## Acceptance

1. Defaults are identical to M4aw and EQ ON at 0 dB remains bit-identical to bypass.
2. Moving each frequency relocates its measured response in the expected direction; increasing mid Q narrows the bell.
3. An active-voice frequency or Q change begins through the 5 ms smoother, not a one-sample jump.
4. Rapid full-range Gain/Frequency/Q event changes remain finite and bounded at 44.1, 48, and 96 kHz; release and panic leave no residual.
5. The response helper is finite, 0 dB for neutral gain, and responds to frequency and Q changes.
6. Core, freestanding, WASM, Web, Apple compile-only, native/WASM comparison, contrast, and 390/1440 UI audits pass.

## Listening boundary

Automated tests establish response intent and safety. The owner should audition frequency sweeps and narrow/high-gain mid settings at low speaker volume. No physical output is used by automated validation.
