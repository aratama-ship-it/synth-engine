# M4s — Performance octave and Custom WT lifecycle

## Scope

1. PC keyboard `Z` shifts the performance octave down and `X` shifts it up.
2. The visible piano follows the same temporary octave range.
3. A loaded Custom WT can be replaced or cleared without automatic playback.

## Contracts

- Default octave offset: `0`; bounds: `-3..+3`; step: `12` MIDI notes.
- Changing octave first releases every pending or active note, then redraws the piano.
- Note release uses the physical-key token captured at keydown, not a note recomputed after an octave change.
- Octave offset is session input state, not patch state, and is not persisted.
- `LOAD WAV` becomes `REPLACE WAV` after a successful load.
- `CLEAR` is disabled when no Custom WT is loaded.
- Clearing closes the output gate, resets voices, overwrites slot 4 with one finite sine frame, moves OSC A/B off slot 4, and removes browser-side Custom WT data.
- No octave or Custom WT lifecycle action automatically opens the output gate or starts a note.

## Verification

- Unit-test Z/X mapping, octave bounds, and shifted note values.
- Verify octave changes leave no pending/active notes and the visible range label changes.
- Run Web tests and the disconnected-output AudioWorklet safety test after the octave unit.
- Add and test REPLACE/CLEAR, then rerun the same safety gate.
- Inspect desktop and 390 px layouts, touch-target size, console errors, and published asset content.
