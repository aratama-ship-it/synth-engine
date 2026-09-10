# M4al — Four-step unison density modes with Wide+

## Goal

Turn the M4ak continuous comparison into the owner's preferred switchable form,
while keeping the exact existing four-voice sound as the default and adding one
clearly opt-in wider choice.

## DSP contract

- Keep parameters 115 and 116 as Osc A/B unison density. Extend their maximum
  from 1 to `sqrt(1.5)` (approximately 1.2247449); keep the default at 1.
- Density still changes only four-unison gain distribution. Inner layers have
  raw gain 1; outer layers have raw gain `density`.
- Normalize all four gains by `1 / sqrt(2 + 2 * density^2)` across the extended
  range. At density 1, retain the exact previous 0.5 normalization branch.
- The four UI modes map to effective energy participation:
  - `2.0 FOCUS`: density 0
  - `3.0 BALANCED`: density `sqrt(0.5)`
  - `4.0 FULL`: density 1, the unchanged default sound
  - `5.0 WIDE+`: density `sqrt(1.5)`, so each outer layer has about 1.225 times
    the raw weight of an inner layer
- `5.0` is not a fifth oscillator. Four layers are still rendered, polyphony
  remains integer, and this mode does not reduce or increase CPU allocation.
- Keep pair symmetry, the established detune and pan positions, and existing
  5 ms density smoothing. Apply Osc B density to both audible B and B-to-A FM.
- Density remains inactive for unison counts one through three.

The opt-in Wide+ value changes PCM, so engine version becomes 24. The C ABI,
parameter count, existing identifiers, and all defaults remain unchanged.

## Web audition

- Keep density out of the normal Studio surface and inside `?quality=1`.
- Replace the continuous range with four 44 px segmented buttons named above.
- A button writes the matching value to both Osc A and Osc B without stopping,
  restarting, or creating a note. The 5 ms DSP smoothing is audible live.
- Use `aria-pressed` and a text status; color alone must not identify selection.
- If an imported patch has a non-mode or A/B-different value, show `CUSTOM` or
  the separate A/B effective values until a mode button links them again.

## Non-goals

- More than four actual unison layers
- Pan positions beyond the stereo boundaries or a Haas/micro-delay widener
- Changing the standard value above 4.0 before comparison approval
- Promoting the experimental modes to the normal OSC surface

## Acceptance

1. Tests prove all four mappings, symmetry, energy normalization, exact 4.0
   compatibility, monotonic outer contribution, and no effect below four layers.
2. A fixed render proves Wide+ raises side-to-mid energy relative to Full while
   keeping summed-mono level bounded and finite.
3. The real-WASM disconnected safety gate switches through 2/3/4/5 while held,
   stays below the peak ceiling, releases to zero, and remains panic-silent.
4. Core, Web, freestanding, WASM, diff, and 390x844 / 1440x900 design checks pass.
