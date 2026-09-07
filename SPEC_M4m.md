# SPEC M4m — Four macros and a dedicated modulation envelope

## Goal

Expand editable modulation without changing the existing six-slot routing model: add Macro 3/4 and a per-note modulation envelope that can be routed from the Matrix.

## Core contract

- Append parameter IDs 83–89. Do not renumber IDs 0–82.
- `83 / 84`: Macro 3 / Macro 4, range 0–1, default 0.
- `85–89`: Mod EG Attack / Decay / Sustain / Release / Curve. Use the same envelope ranges and curve definition as Filter EG.
- Add Matrix sources `9 = Macro 3`, `10 = Macro 4`, and `11 = ENV 3 · Mod`. Keep existing source IDs 0–8 and destination IDs 0–13 unchanged.
- Extend `SYNTH_EV_MACRO` from IDs 0–1 to 0–3. The 20-byte event ABI and every C entry point remain unchanged.
- Apply the existing 5 ms macro smoothing independently to all four macros.
- Give each voice independent Mod EG stage, value, elapsed samples, and release start. Note-on starts Attack; note-off starts Release. Mod EG must not keep an otherwise silent voice alive.
- Engine version becomes 14 and parameter count becomes 90.

## UI contract

- Keep the normal OSC surface at four equal ENV/LFO cards. Do not add a fifth card to the already dense row.
- Place `ENV 3 · MOD ENVELOPE` at the start of the MATRIX surface, directly before source selection and routing rows, because it is a Matrix-only source.
- Expand the persistent performance strip from two to four macros while preserving 44 px minimum targets and the existing role color.
- Preserve the current 4 / 2 / 1 OSC-card responsive layout and all established tokens.

## Compatibility

- Existing text presets and schema-version-1 JSON patches load unchanged; absent new IDs use defaults.
- Bypass output remains bit-identical when new sources are not routed.
- AU generic parameter UI and saved state receive the new parameters through the existing dynamic metadata path.

## Out of scope

- More than six Matrix slots, direct Mod EG destinations, tempo/DAW sync, loopable or multi-stage envelopes, macro naming, macro curves, subjective preset retuning, and final UI/UX redesign.
- FX migration is a separate milestone because its DSP/state/tail contract must be shared between Web and AU rather than copied between shells.

## Acceptance

1. Core metadata is contiguous through ID 89 and Matrix source fields accept 0–11.
2. Macro events 0–3 are accepted, independently smoothed, and sources 6/7/9/10 affect routed destinations; event ID 4 is ignored.
3. Mod EG reaches Attack/Decay/Sustain/Release states deterministically and source 11 affects a routed destination.
4. Old presets preserve their existing dry output exactly.
5. Native and WASM renders match for every bundled text preset.
6. Web tests cover 12 source labels, four macro controls, Mod EG rendering, and patch IDs through 89.
7. MATRIX layout passes the 390×844 and 1440×900 design audit with no unresolved NG/WARN.
