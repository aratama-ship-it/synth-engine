# SPEC M4c — Level-matched reference A/B

## Goal

Turn the M4b measurements into a falsifiable listening loop:

`reference audio → current editable core patch rendered at the measured note → shared listening level → A/B`

M4c compares rather than optimizes. It must not silently change the current patch or describe a merely rendered candidate as a recreated sound.

## Scope

- Keep the decoded reference in memory after local analysis.
- Enable candidate rendering only when monophonic pitch confidence is at least `0.70`.
- Render the current patch's 76 core parameters through the existing WASM synth in an `OfflineAudioContext`.
- Use the nearest MIDI note, the reference file's leading silence, active end, and the current amp release to plan note-on/off timing. Limit a comparison render to 12 seconds.
- Label the candidate `CORE DRY`; insert, delay, and reverb rendering remain outside this slice.
- Match each source independently to `-18 dBFS` active RMS while enforcing a `-1 dBFS` peak ceiling.
- Provide mutually exclusive `A REFERENCE`, `B CURRENT`, and `STOP` controls, and show envelope correlation plus pitch, attack, and brightness differences.
- Mark a rendered candidate stale when a core parameter or preset changes.

## Explicit non-goals

- Automatic OSC / ENV / FILTER suggestions or patch mutation.
- Full-FX offline parity, reverb removal, source separation, or semantic instrument recognition.
- Fractional-note tuning correction, looping, batch optimization, upload, analytics, or persistence.

## Acceptance

1. Active RMS excludes leading/trailing silence and drives a deterministic level-match gain with a `-1 dBFS` peak ceiling.
2. A 440 Hz reference maps to MIDI 69 and reports cents offset.
3. Render timing preserves reference leading silence and leaves room for the current patch release.
4. Low-confidence or missing pitch disables candidate rendering with an explicit reason.
5. Changing any core parameter invalidates the previous candidate before another comparison.
6. Web tests, core tests, freestanding build, responsive design audit, and one real-browser reference/candidate playback path pass.
