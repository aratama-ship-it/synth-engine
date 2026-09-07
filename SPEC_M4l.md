# SPEC M4l — Independent LFO 2 modulation source

## Goal

Add a second independent low-frequency oscillator so one patch can carry two unrelated motions without replacing the existing LFO 1 routing. Keep every existing preset and the unused-LFO-2 audio path unchanged.

## Scope

- Append four parameters without renumbering the existing 0–78 contract: LFO 2 Rate, Shape, Retrigger, and Phase.
- Reuse the six existing LFO shapes and the 0.01–40 Hz rate range.
- Add LFO 2 as modulation source 8. Keep source IDs 0–7 and all 14 destination IDs unchanged.
- Keep LFO 1's direct `TO FILTER / TO PITCH / TO AMP` controls. LFO 2 is Matrix-only in this milestone.
- Give LFO 2 independent global and per-voice phase, cycle, and sample-and-hold state. Use a separate deterministic hash layer from LFO 1.
- Expose an LFO 2 card beside ENV 1 / ENV 2 / LFO 1 in the Web Studio and include all four new values in the existing patch, autosave, Undo / Redo, JSON, AU generic parameter UI, and WASM metadata paths.
- Increment `engineVersion` from 12 to 13 because the parameter and modulation-source contracts grow.

## Compatibility

- Existing parameter IDs remain stable. Old text presets and schemaVersion 1 JSON patches omit IDs 79–82 and therefore receive their core defaults.
- With no Matrix route from source 8, existing native PCM golden cases remain bit-identical.
- The C ABI function signatures and 20-byte `SynthEvent` layout remain unchanged. The opaque state size may grow.

## UI contract

- Preserve the existing SynthEngine Studio visual system, controls, and role colors; do not redesign the shell in this milestone.
- At widths above 1100 px, show ENV 1 / ENV 2 / LFO 1 / LFO 2 as four equal columns. From 761–1100 px use two columns; at 760 px and below use one column.
- Reuse the existing 80 px graph, 48 px visual dial, 44 px interactive minimum, spacing tokens, and six-shape labels.
- Both LFO graphs are parameter-derived setting diagrams, not live signal scopes.

## Non-goals

- No LFO 2 direct-routing parameters, tempo sync, DAW host sync, editable LFO shapes, one-shot mode, additional Matrix slots, Macro 3/4, or subjective preset retuning.
- No automatic reference matching through LFO 2 and no claim that two LFOs complete Serum feature parity.

## Acceptance

1. Parameter IDs 79–82 are contiguous, finite, and available through native, AU-generic, and Web metadata paths; engine version is 13.
2. Source 8 changes a routed destination, while the same patch with no source-8 route is bit-identical to the pre-M4l golden path.
3. LFO 1 and LFO 2 advance at independently configured rates; retriggered state is per voice and sample-and-hold is deterministic but independent between the two LFOs.
4. Block sizes 1 / 7 / 64 / 128 / 511, 44.1 / 48 / 96 kHz health, native/WASM preset comparison, freestanding compile, and the existing performance ceiling pass.
5. The Web Matrix lists nine source labels including LFO 2, patch JSON accepts IDs through 82, and old patches remain loadable.
6. The normal OSC surface has no horizontal overflow at 1440×900 and 390×844, all interactive targets remain at least 44 px, and both LFO cards have visible names and accessible graph descriptions.
