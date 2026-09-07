# SPEC M4h — Unison phase/width audition and high-FM guard

## Goal

Make the four-voice unison and high-register FM quality directly auditionable while compacting the Studio UI without removing synthesis controls.

## Scope

- Preserve phase mode 0 (Random) and 1 (Fixed), and add mode 2 (Balanced).
- In Balanced mode place four starts symmetrically around the phase control at `-3/16, -1/16, +1/16, +3/16` cycle. Use the corresponding centered subset for one to three voices.
- Add an independent width-curve parameter to OSC A and B. Mode 0 keeps linear width; mode 1 maps the control through `sin(width * pi/2)` before the existing equal-power pan law.
- Add an FM quality parameter. Mode 0 keeps the legacy phase-modulation depth; mode 1 continuously limits only high-register depth whose estimated significant upper sideband would exceed 45% of sample rate.
- Keep FM OFF and low/mid-register FM bit-identical to the previous path.
- Add two independent audition switches to the OSC work area: unison CURRENT/FOCUSED and FM LEGACY/HQ GUARD.
- Compact the Studio UI using the values in `design/SYNTH_UI_TOKEN_SHEET.md`; keep all controls and at least 44 px interactive targets.
- Increment `engineVersion` from 11 to 12 because the parameter contract and opt-in PCM paths change.

## Non-goals

- No oscillator oversampling, voice-count expansion, automatic quality selection, preset retuning, or reference-sound search.
- No claim that the FOCUSED or HQ setting is subjectively final before the user listens.
- No removal or hiding of existing Studio functions.

## Acceptance

1. Phase modes 0 and 1 retain their previous behavior; mode 2 is deterministic across engine seeds and symmetric around the phase control.
2. Linear and Natural width share exact 0% and 100% endpoints; Natural is monotonic and wider at intermediate settings.
3. FM HQ is bit-identical to legacy when FM is zero and for a defined low-register case where the guard is inactive.
4. A high-register FM analysis shows less off-grid folded energy than legacy while retaining finite output.
5. All core, web, freestanding, and native/WASM comparison tests pass; the existing performance case remains below half the 48 kHz / 128-frame deadline.
6. At 1440×900 and 390×844 the OSC surface has no horizontal overflow, all interactive targets are at least 44 px, and the selected comparison states are available by text and `aria-pressed`.
