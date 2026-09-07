# SPEC M4d — Reviewable AMP envelope hypothesis

## Goal

Convert the measured reference envelope into a small, reviewable edit proposal:

`measured envelope → ATTACK / DECAY / SUSTAIN / RELEASE hypothesis → explicit apply → render and A/B`

The proposal is evidence-bounded. Audio alone does not always reveal where the original key was released, so M4d must preserve the current release when the tail cannot be separated from natural decay.

## Scope

- Derive an AMP envelope hypothesis from the existing 20 ms RMS envelope and active region.
- Estimate Attack from the measured 10–90% rise, correcting for the synth's linear attack and the 20 ms analysis floor.
- Find the most stable post-peak body window and use it to estimate Sustain and the end of Decay.
- Suggest Release only when a sustained, non-rebounding tail drop is visible in the final 20% after the stable body. Otherwise mark Release as `KEEP CURRENT`.
- Show `CURRENT → SUGGESTED`, per-field confidence, and a short evidence label for all four fields.
- Apply only finite detected values after an explicit `APPLY DETECTED` action. The existing Undo history remains the recovery path.
- Invalidate any previously rendered A/B candidate after applying or otherwise changing a core value.

## Explicit non-goals

- Automatic application on file load.
- Claiming that amplitude alone identifies the original ADSR exactly.
- Amp curve, oscillator, filter, pitch, FX, semantic instrument recognition, or iterative optimization.
- Upload, persistence, or model/network inference.

## Acceptance

1. A synthetic held envelope produces finite Attack, Decay, Sustain, and a detected Release.
2. A continuously decaying one-shot preserves the current Release rather than inventing a note-off.
3. Too-short, silent, or malformed envelopes produce an unavailable result without patch mutation.
4. The UI distinguishes measured evidence, hypothesis, current values, and applied state in text rather than color alone.
5. Applying suggestions is one reversible history edit and makes the old A/B render stale.
6. Web tests, core tests, freestanding build, responsive design audit, and a real-browser load/apply/render loop pass.
