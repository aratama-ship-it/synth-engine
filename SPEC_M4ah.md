# M4ah — Mono / Legato / Glide articulation

## Goal

Add the minimum performance articulation needed for bass and lead sounds while
leaving every existing patch in its current POLY, zero-glide behavior.

## Scope

- Append core parameters 113 `voiceMode` and 114 `glideTime`; do not renumber
  the existing 0–112 parameter contract.
- `voiceMode`: `0=POLY`, `1=MONO`, `2=LEGATO`. MONO and LEGATO retain the
  newest held note, return to the next newest held note on release, and release
  only when no held notes remain.
- MONO re-articulates the envelope from its present level when a key is added
  while another key is held. LEGATO retains its present envelope state.
- `glideTime` is 0–2 seconds. It moves only between held MONO / LEGATO notes;
  a 0 value or a new phrase starts at the target pitch immediately.
- Add VOICES / MODE / GLIDE together in the persistent PERFORMANCE strip.
  Default values remain `16 / POLY / 0 s`.
- Extend core metadata, parameter sweep, patch JSON validation, Studio source
  regression coverage, and build documentation.

## Non-goals

- No automatic playback, arpeggiator, portamento curve selector, MPE, or
  change to the emergency output gate.
- No modification to existing preset files; old patches get the appended
  default parameters on load.
- No claim that automated DSP checks substitute for a low-volume real-speaker
  listening check.

## Acceptance

1. Existing POLY golden renders remain bit-identical with Glide 0.
2. Core regression proves POLY two-note overlap, MONO latest-note priority and
   fallback, final release, LEGATO envelope continuity, finite Glide settling,
   and parameter metadata bounds.
3. Studio shows all three controls with 44px interaction surfaces and no
   horizontal overflow at 390px or 1440px.
4. Native tests, WASM build, Web tests, design lint, and whitespace checks pass.
