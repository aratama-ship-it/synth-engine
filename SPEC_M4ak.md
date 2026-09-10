# M4ak — Continuous 4-voice unison density experiment

## Goal

Test whether the previously meaningless idea of a fractional `VOICES` value is
musically useful when expressed as a separate, reversible 4-voice unison
density. Global polyphony and oscillator unison counts remain integers.

## DSP contract

- Append `oscAUnisonDensity` and `oscBUnisonDensity` as parameters 115 and 116,
  each in the range 0..1 with default 1.
- Density only changes the gain distribution when the matching oscillator has
  four unison layers. The inner pair has raw gain 1 and the outer pair has raw
  gain `density`.
- Normalize the four gains by `1 / sqrt(2 + 2 * density^2)`. Therefore the
  effective energy-participating layer count shown for audition is
  `2 + 2 * density^2`: 2.0 at density 0, 3.0 near 0.707, and 4.0 at density 1.
- Keep outer layers as a left/right pair. Density must not move the pitch center
  or introduce a one-sided stereo layer.
- Apply the same B density weights to the audible Osc B path and the B-to-A
  phase-modulation signal.
- Smooth both density parameters with the existing 5 ms control coefficient.
  When no voice is active, parameter changes snap to their target.
- For one, two, or three unison layers, density has no effect. This experiment
  is intentionally limited to the established four-layer placement.
- At density 1, use the exact previous `0.5` per-layer normalization path so
  default patches and golden PCM remain bit-identical.

The opt-in density path changes PCM, so the engine version becomes 23. The C
ABI and existing parameter identifiers remain unchanged.

## Web audition

- Keep the control out of the normal Studio surface.
- Under `?quality=1`, add one `4-VOICE DENSITY` range that writes the same value
  to Osc A and B and displays `2.0..4.0 LAYERS` to one decimal place.
- Changing density while holding a note is allowed; it must not stop, restart,
  or automatically create a note.
- Saved/imported patches retain the two density values. If they differ, the
  audition state names both values; moving the shared range makes them equal.

## Non-goals

- Fractional maximum polyphony or fractional oscillator allocation
- CPU reduction when density is below 1
- Random/probabilistic layer activation
- Promotion to the normal OSC surface before listening approval

## Acceptance

1. Unit tests prove symmetric four-layer weights, unit energy, monotonic outer
   contribution, exact full-density gains, and no effect below four layers.
2. Existing golden renders stay bit-identical at the default density.
3. Held-note density changes use the 5 ms smoothing path and real-WASM safety
   output stays finite, bounded, releasable, and panic-silent while disconnected
   from physical output.
4. Web tests, freestanding build, WASM build, whitespace checks, and design lint
   at 390x844 and 1440x900 pass.
