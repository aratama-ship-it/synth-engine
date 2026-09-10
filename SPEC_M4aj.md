# M4aj — Glide articulation correction and integer Voice display

## Goal

Keep a connected MONO glide from producing a new amplitude attack before the
pitch reaches its target, and ensure discrete parameter values are presented as
discrete values in the Studio UI.

## Behavior

- MONO with `glideTime > 0` preserves the current amp, filter, and modulation
  envelope stages while the held voice moves to the newest note.
- MONO with `glideTime = 0` keeps the explicit re-articulation behavior.
- LEGATO continues to preserve envelopes at every Glide value.
- A new phrase still starts its envelope and starts immediately at its target
  pitch; the change only affects transitions while another note is held.
- Parameters flagged `SYNTH_PARAM_FLAG_INTEGER`, including `voices`, are rounded
  in the Studio value model on direct input and patch restoration. The core
  already applied the same rounding contract.

## Compatibility

- Parameter IDs, ranges, defaults, C ABI, and patch schema stay unchanged.
- Default `POLY / Glide 0 s` renders remain bit-identical.
- The opt-in MONO + nonzero Glide PCM change increments engine version to 22.

## Acceptance

1. Core regression proves MONO + Glide keeps the current envelope, MONO with
   Glide 0 re-articulates, LEGATO stays continuous, and held-note fallback and
   final release still work.
2. Web regression fixes integer rounding for direct input and restored patches.
3. The output-disconnected real-WASM safety gate stays finite and bounded, with
   silence after release and panic.
