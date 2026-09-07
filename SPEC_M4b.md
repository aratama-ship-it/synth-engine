# SPEC M4b — Reference Match measurement foundation

## Goal

Build the first deterministic layer for the long-term workflow:

`reference audio → measured features → editable SynthEngine candidate → level-matched A/B → manual refinement`

M4b only covers reference loading, playback, measurement, and quality warnings. It must not silently change the current patch or claim that a sound has been recreated.

## Scope

- Add a fourth `MATCH` work area to the existing Web Synth.
- Decode a user-selected audio file locally with Web Audio. Do not upload or persist it.
- Measure duration, peak, RMS, active region, 10–90% attack time, monophonic pitch estimate with confidence, derivative-based brightness proxy, stereo width, and a 20 ms RMS envelope.
- Show the measured envelope and explain the next unavailable step in the UI.
- Extract the M2 envelope, derivative-centroid, and correlation definitions into a reusable dependency-free module. Keep `tools/compare-timbre.mjs` thresholds and text output compatible.
- Add a JSON CLI for deterministic Float32 WAV inspection.

## Explicit non-goals

- Automatic patch generation or optimization.
- Polyphonic transcription, source separation, or semantic instrument recognition.
- Reverb removal, loop detection, or sample/wavetable import.
- Any server upload, analytics, or permanent storage.

## Acceptance

1. Synthetic 440 Hz input estimates pitch within 2 Hz with confidence at least 0.9.
2. A known amplitude ramp produces a non-zero measured attack close to the source ramp.
3. Identical stereo channels measure near-zero width; opposite channels measure near-one width.
4. Existing M2 comparison still runs with the same `0.95` envelope / `15%` brightness thresholds.
5. Web tests, core tests, and responsive design audit pass.
6. Browser inspection confirms the fourth tab, local file explanation, empty state, and no patch mutation before or after analysis.
